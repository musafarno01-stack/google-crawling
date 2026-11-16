/**
 * Cloudflare Worker — Remote Job Crawler  ·  BUILD 1.7.0
 * Entry point: functions/api/crawl.js (matches main in wrangler.jsonc).
 * Two upstream sources: Remotive primary, Arbeitnow fallback.
 */

const BUILD = '1.7.0';
const REMOTIVE_BASE = 'https://remotive.com/api/remote-jobs';
const ARBEITNOW_BASE = 'https://www.arbeitnow.com/api/job-board-api';
const DEFAULT_QUERY = 'software engineer';
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;
const UPSTREAM_TIMEOUT_MS = 12000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400'
};

const HTML_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Worker-Build': BUILD,
  'Cache-Control': 'public, max-age=0, must-revalidate'
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-Worker-Build': BUILD,
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      ...extra
    }
  });
}

function stripHtml(v) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ');
}

function decodeEntities(v) {
  return String(v == null ? '' : v)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function cleanText(v, max = 240) {
  const t = decodeEntities(stripHtml(v)).replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '\u2026';
}

function normLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function normQuery(raw) {
  const q = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 120);
  return q || DEFAULT_QUERY;
}

function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

async function fetchJson(target) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'CloudflareWorkerCrawler/' + BUILD + ' (+https://workers.dev)',
        Accept: 'application/json'
      },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!res.ok) {
      const err = new Error('upstream ' + res.status);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#f97316"/>' +
  '<path d="M18 22h28M18 32h20M18 42h24" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>';

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname;

      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...CORS } });
      }

      if (path === '/api/health') {
        return json({
          ok: true,
          build: BUILD,
          time: new Date().toISOString(),
          routes: ['/api/health', '/api/ping', '/api/crawl?q=&limit=', '/'],
          sources: ['Remotive', 'Arbeitnow']
        });
      }

      if (path === '/api/ping') {
        const out = { ok: false, build: BUILD, remotive: null, arbeitnow: null };
        try {
          const r = await fetch(REMOTIVE_BASE + '?search=react&limit=1', {
            headers: { 'User-Agent': 'CloudflareWorkerCrawler/' + BUILD }
          });
          out.remotive = r.status;
        } catch (e) {
          out.remotive = e.name === 'AbortError' ? 'timeout' : e.message;
        }
        try {
          const r2 = await fetch(ARBEITNOW_BASE, {
            headers: { 'User-Agent': 'CloudflareWorkerCrawler/' + BUILD }
          });
          out.arbeitnow = r2.status;
        } catch (e2) {
          out.arbeitnow = e2.name === 'AbortError' ? 'timeout' : e2.message;
        }
        out.ok = out.remotive === 200 || out.arbeitnow === 200;
        return json(out, out.ok ? 200 : 502);
      }

      if (path === '/api/crawl') {
        if (method !== 'GET' && method !== 'HEAD') {
          return json({ success: false, error: 'Method not allowed. Use GET.' }, 405, {
            Allow: 'GET, HEAD, OPTIONS'
          });
        }
        return await handleCrawl(url, method === 'HEAD');
      }

      if (path.startsWith('/api/')) {
        return json({ success: false, error: 'Unknown API route: ' + path }, 404);
      }

      if (path === '/favicon.svg' || path === '/favicon.ico') {
        return new Response(method === 'HEAD' ? null : FAVICON, {
          headers: { 'Content-Type': 'image/svg+xml;charset=UTF-8', 'Cache-Control': 'public, max-age=86400' }
        });
      }

      if (path === '/' || path === '/index.html') {
        if (method !== 'GET' && method !== 'HEAD') {
          return new Response('Method not allowed', {
            status: 405,
            headers: { ...HTML_HEADERS, Allow: 'GET, HEAD, OPTIONS' }
          });
        }
        return new Response(method === 'HEAD' ? null : renderPage(), { headers: HTML_HEADERS });
      }

      return new Response('404 — Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    } catch (fatal) {
      return json({ success: false, error: 'Worker crash: ' + (fatal?.message || 'unknown') }, 500);
    }
  }
};

/* ================= crawl ================= */

async function fromRemotive(query, limit) {
  const target =
    REMOTIVE_BASE + '?search=' + encodeURIComponent(query) + '&limit=' + encodeURIComponent(String(limit));
  const data = await fetchJson(target);
  const raw = Array.isArray(data?.jobs) ? data.jobs : [];
  return raw
    .filter((j) => j && typeof j === 'object')
    .slice(0, limit)
    .map((j) => ({
      title: cleanText(j.title, 160) || 'Untitled role',
      company: cleanText(j.company_name, 120) || 'Unnamed company',
      location: cleanText(j.candidate_required_location, 120) || 'Remote',
      jobType: cleanText(j.job_type, 60) || 'Unspecified',
      salary: cleanText(j.salary, 120) || '',
      category: cleanText(j.category, 80) || '',
      snippet: cleanText(j.description, 240),
      url: safeUrl(j.url),
      source: 'Remotive'
    }))
    .filter((j) => j.url.length > 0);
}

async function fromArbeitnow(query, limit) {
  const data = await fetchJson(ARBEITNOW_BASE);
  const raw = Array.isArray(data?.data) ? data.data : [];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  const mapped = raw
    .filter((j) => j && typeof j === 'object')
    .map((j) => {
      const hay = (
        String(j.title || '') + ' ' + String(j.description || '') + ' ' + (Array.isArray(j.tags) ? j.tags.join(' ') : '')
      ).toLowerCase();
      const score = tokens.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
      return {
        score,
        title: cleanText(j.title, 160) || 'Untitled role',
        company: cleanText(j.company_name, 120) || 'Unnamed company',
        location: cleanText(j.location, 120) || (j.remote ? 'Remote' : 'Unspecified'),
        jobType: cleanText(Array.isArray(j.job_types) ? j.job_types[0] : '', 60) || 'Unspecified',
        salary: '',
        category: cleanText(Array.isArray(j.tags) ? j.tags[0] : '', 80) || '',
        snippet: cleanText(j.description, 240),
        url: safeUrl(j.url),
        source: 'Arbeitnow'
      };
    })
    .filter((j) => j.url.length > 0);

  const matched = mapped.filter((j) => j.score > 0).sort((a, b) => b.score - a.score);
  const pool = matched.length > 0 ? matched : mapped;
  return pool.slice(0, limit).map(({ score, ...rest }) => rest);
}

async function handleCrawl(url, headOnly) {
  const query = normQuery(url.searchParams.get('q'));
  const limit = normLimit(url.searchParams.get('limit'));

  let jobs = [];
  let source = '';
  const failures = [];

  try {
    jobs = await fromRemotive(query, limit);
    if (jobs.length > 0) source = 'Remotive';
  } catch (e) {
    failures.push('Remotive: ' + (e?.message || 'failed'));
  }

  if (jobs.length === 0) {
    try {
      jobs = await fromArbeitnow(query, limit);
      if (jobs.length > 0) source = 'Arbeitnow';
    } catch (e) {
      failures.push('Arbeitnow: ' + (e?.message || 'failed'));
    }
  }

  if (jobs.length === 0 && failures.length > 0) {
    return json(
      { success: false, error: 'All job sources failed — ' + failures.join(' | '), query },
      502
    );
  }

  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store', ...CORS }
    });
  }

  return json({
    success: true,
    build: BUILD,
    query,
    count: jobs.length,
    source: source || 'none',
    fetchedAt: new Date().toISOString(),
    jobs
  });
}

/* ================= frontend ================= */

function renderPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Remote Job Crawler — Edge Dashboard</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{--bg:#f6f7f9;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#f97316;--accent-ink:#ea580c;--ok:#15803d;--bad:#dc2626;--chip:#f1f5f9}
  @media(prefers-color-scheme:dark){:root{--bg:#0b1120;--panel:#111827;--ink:#e5e7eb;--muted:#94a3b8;--line:#1f2937;--chip:#1e293b}}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:radial-gradient(900px 420px at 12% -10%,rgba(249,115,22,.14),transparent 70%),var(--bg);color:var(--ink);min-height:100vh;padding:40px 18px 64px;line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:880px;margin:0 auto}
  header{display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap}
  .logo{width:40px;height:40px;border-radius:11px;flex:0 0 auto;background:linear-gradient(135deg,#fb923c,#ea580c);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px;box-shadow:0 8px 20px -8px rgba(234,88,12,.7)}
  h1{font-size:21px;margin:0;letter-spacing:-.02em}
  .sub{font-size:13px;color:var(--muted);margin:2px 0 0}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 12px 30px -22px rgba(15,23,42,.45)}
  .lbl{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:9px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  input[type=text],select{flex:1 1 240px;min-width:0;padding:12px 14px;font-size:15px;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px;outline:none;transition:border-color .15s,box-shadow .15s}
  select{flex:0 0 130px;cursor:pointer}
  input[type=text]:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(249,115,22,.18)}
  button{padding:12px 20px;font-size:15px;font-weight:700;color:#fff;background:var(--accent);border:0;border-radius:10px;cursor:pointer;flex:0 0 auto;transition:background .15s,transform .08s}
  button:hover:not(:disabled){background:var(--accent-ink)}
  button:active:not(:disabled){transform:translateY(1px)}
  button:disabled{opacity:.6;cursor:progress}
  .hint{font-size:12.5px;color:var(--muted);margin:12px 0 0}
  .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .bar h2{font-size:15px;margin:0}
  .status{font-size:13px;color:var(--muted)}
  .status.ok{color:var(--ok);font-weight:700}
  .status.bad{color:var(--bad);font-weight:700}
  .banner{display:none;border-radius:11px;padding:13px 15px;font-size:13.5px;font-weight:600;margin-bottom:16px;line-height:1.5}
  .banner.show{display:block}
  .banner.good{background:rgba(21,128,61,.12);color:var(--ok);border:1px solid rgba(21,128,61,.35)}
  .banner.bad{background:rgba(220,38,38,.1);color:var(--bad);border:1px solid rgba(220,38,38,.35)}
  .state{color:var(--muted);font-size:14.5px;padding:26px 4px;text-align:center}
  .state.bad{color:var(--bad)}
  .job{border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;background:var(--panel);transition:border-color .15s,transform .15s}
  .job:hover{border-color:var(--accent);transform:translateY(-1px)}
  .job a.title{font-size:16.5px;font-weight:700;color:#0284c7;text-decoration:none;display:block;letter-spacing:-.01em}
  @media(prefers-color-scheme:dark){.job a.title{color:#7dd3fc}}
  .job a.title:hover{text-decoration:underline}
  .meta{font-size:13px;color:var(--muted);margin-top:7px}
  .meta strong{color:var(--ink)}
  .chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
  .chip{font-size:11.5px;font-weight:700;background:var(--chip);color:var(--muted);padding:4px 9px;border-radius:999px;text-transform:uppercase}
  .chip.pay{background:rgba(21,128,61,.12);color:var(--ok)}
  .snip{font-size:13.5px;color:var(--muted);margin-top:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  footer{text-align:center;font-size:12.5px;color:var(--muted);margin-top:26px}
  footer code{background:var(--chip);padding:2px 6px;border-radius:5px;font-size:11.5px}
  .spin{width:15px;height:15px;border-radius:50%;display:inline-block;border:2px solid rgba(249,115,22,.3);border-top-color:var(--accent);animation:spin .7s linear infinite;vertical-align:-2px;margin-right:8px}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:520px){body{padding:24px 14px 48px}select,button{flex:1 1 100%}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo" aria-hidden="true">R</div>
    <div>
      <h1>Remote Job Crawler</h1>
      <p class="sub">Live listings fetched at the edge by a Cloudflare Worker</p>
    </div>
  </header>

  <div class="banner" id="banner" role="status" aria-live="polite"></div>

  <section class="panel">
    <label class="lbl" for="jobQuery">Search keyword or tech stack</label>
    <div class="row">
      <input type="text" id="jobQuery" placeholder="e.g. React, Rust, DevOps, Technical Writer" value="software engineer" autocomplete="off" spellcheck="false" maxlength="120">
      <select id="limitSelect" aria-label="Result count">
        <option value="10">10 results</option>
        <option value="15" selected>15 results</option>
        <option value="25">25 results</option>
        <option value="30">30 results</option>
      </select>
      <button id="crawlBtn" type="button">Crawl Jobs</button>
    </div>
    <p class="hint">Press <strong>Enter</strong> or click <strong>Crawl Jobs</strong>. Sources: Remotive, Arbeitnow.</p>
  </section>

  <section class="panel">
    <div class="bar">
      <h2>Live Crawled Results</h2>
      <span class="status" id="status" role="status" aria-live="polite"></span>
    </div>
    <div id="results"><p class="state">Nothing fetched yet. Run a crawl to pull live remote listings.</p></div>
  </section>

  <footer>BUILD <span id="buildTag">?</span> &middot; route <code>/api/crawl?q=</code> &middot; same-origin, no keys</footer>
</div>

<script>
(function () {
  'use strict';

  var BUILD = '1.7.0';
  var input = document.getElementById('jobQuery');
  var limitSelect = document.getElementById('limitSelect');
  var button = document.getElementById('crawlBtn');
  var results = document.getElementById('results');
  var statusEl = document.getElementById('status');
  var banner = document.getElementById('banner');
  var buildTag = document.getElementById('buildTag');
  var busy = false;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function say(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function showBanner(text, kind) {
    banner.textContent = text;
    banner.className = 'banner show ' + kind;
  }

  function setBusy(v) {
    busy = v;
    button.disabled = v;
    button.textContent = v ? 'Crawling...' : 'Crawl Jobs';
  }

  function renderJobs(list) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      html += '<article class="job">';
      html += '<a class="title" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">' + esc(j.title) + '</a>';
      html += '<div class="meta"><strong>' + esc(j.company) + '</strong> &middot; ' + esc(j.location) + '</div>';
      var chips = '';
      if (j.jobType) chips += '<span class="chip">' + esc(j.jobType) + '</span>';
      if (j.category) chips += '<span class="chip">' + esc(j.category) + '</span>';
      if (j.salary) chips += '<span class="chip pay">' + esc(j.salary) + '</span>';
      if (j.source) chips += '<span class="chip">' + esc(j.source) + '</span>';
      if (chips) html += '<div class="chips">' + chips + '</div>';
      if (j.snippet) html += '<p class="snip">' + esc(j.snippet) + '</p>';
      html += '</article>';
    }
    results.innerHTML = html;
  }

  function fail(msg) {
    say('Failed', 'bad');
    results.innerHTML = '<p class="state bad">Crawl failed: ' + esc(msg) + '</p>';
  }

  async function selfCheck() {
    try {
      var r = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      var ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('json') === -1) {
        showBanner('HTML came back from /api/health — the worker is not serving the API. Confirm main points at functions/api/crawl.js.', 'bad');
        return;
      }
      var d = await r.json();
      buildTag.textContent = d.build || '?';
      if (d.build === BUILD) {
        showBanner('API connected · build ' + d.build + ' · routing OK', 'good');
      } else {
        showBanner('API is on build ' + (d.build || 'unknown') + ' but this page is ' + BUILD + '. Redeploy so both match.', 'bad');
      }
    } catch (e) {
      showBanner('Could not reach /api/health: ' + (e.message || 'network error'), 'bad');
    }
  }

  async function crawl() {
    if (busy) return;
    var q = input.value.trim() || 'software engineer';
    var limit = limitSelect.value || '15';

    setBusy(true);
    say('');
    results.innerHTML = '<p class="state"><span class="spin"></span>Crawling live job boards...</p>';

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);

    try {
      var res = await fetch(
        '/api/crawl?q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit),
        { signal: ctrl.signal, headers: { Accept: 'application/json' } }
      );

      var ct = (res.headers.get('content-type') || '').toLowerCase();
      var body = await res.text();

      if (ct.indexOf('json') === -1) {
        fail('server returned ' + (ct || 'no content-type') + ' instead of JSON. Body starts: ' + body.slice(0, 80));
        return;
      }

      var data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        fail('unparseable JSON: ' + e.message);
        return;
      }

      if (!res.ok || !data.success) {
        fail(data.error || ('request failed with status ' + res.status));
        return;
      }

      if (!data.jobs || data.jobs.length === 0) {
        say('0 matches', 'bad');
        results.innerHTML = '<p class="state">No live listings for <strong>' + esc(data.query || q) + '</strong>. Try a broader keyword.</p>';
        return;
      }

      say(data.count + ' live listing' + (data.count === 1 ? '' : 's') + ' · ' + (data.source || ''), 'ok');
      renderJobs(data.jobs);
    } catch (e) {
      fail(e.name === 'AbortError' ? 'request timed out after 20s' : (e.message || 'network error'));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  button.addEventListener('click', crawl);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); crawl(); }
  });
  limitSelect.addEventListener('change', function () {
    if (results.querySelector('.job')) crawl();
  });

  selfCheck();
})();
</script>
</body>
</html>`;
}
