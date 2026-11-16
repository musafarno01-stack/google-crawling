/**
 * Job mirror + discovery index.
 * - /<host>/<path>  mirrors a page (unique title/desc/H1 + JobPosting schema)
 * - /browse, /browse/<host>, /jobs-in/<city>  crawlable hubs
 * - /sitemap.xml -> sitemap index; /sitemap-p.xml, /sitemap-N.xml  chunked
 * - cron refreshes the index from several public job feeds
 * - IndexNow ping after refresh
 */

const BUILD = '7.0.0';
const CACHE_TTL = 600;
const MAX_BYTES = 400000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const JOB_HOST_RE = /(^|\.)(remoteok|remotive|weworkremotely|arbeitnow|indeed|wellfound|linkedin|glassdoor)\.|(^|\.)jobs\./i;

const INDEXNOW_KEY = 'f3c9a7d21b6e4c8a9d05f1b7e2c4a6d8';
const MIN_TEXT = 220;
const PER_SITEMAP = 2000;
const MAX_SITEMAPS = 20;

const CITIES = ['kohat','lahore','karachi','islamabad','rawalpindi','peshawar','quetta','multan','faisalabad','hyderabad','sialkot','gujranwala','abbottabad','remote','worldwide'];

const SEEDS = [
  { kind: 'remotive', q: 'engineer' },
  { kind: 'remotive', q: 'developer' },
  { kind: 'remotive', q: 'designer' },
  { kind: 'arbeitnow' },
  { kind: 'remoteok' },
  { kind: 'govpk' }
];

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sha = async (s) => {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 10).map((x) => x.toString(16).padStart(2, '0')).join('');
};

const ADS = `<script>(function(s){s.dataset.zone='12248935',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
<script>(function(s){s.dataset.zone='12248892',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
<script>(function(s){s.dataset.zone='12248811',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>`;

const CSS = `*{box-sizing:border-box}
body{margin:0;background:#0d1422;color:#e5e7eb;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#7dd3fc}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 14px;background:#0a1020;border-bottom:1px solid #1f2937;font-size:13px;color:#94a3b8}
.bar b{color:#e5e7eb}
.bar a{margin-left:auto;background:#f97316;color:#0d1422;text-decoration:none;font-weight:700;padding:7px 13px;border-radius:8px;white-space:nowrap}
.bar a:hover{background:#ea580c}
.summary{max-width:860px;margin:0 auto;padding:26px 18px 18px;border-bottom:1px solid #1f2937}
.summary h1{font-size:clamp(21px,3.4vw,30px);letter-spacing:-.02em;margin:0 0 10px;color:#f8fafc}
.summary .meta{color:#94a3b8;font-size:13.5px;margin:0 0 4px}
.summary .crumbs{list-style:none;display:flex;gap:8px;padding:0;margin:0 0 14px;font-size:12.5px;color:#64748b;flex-wrap:wrap}
.summary .crumbs li+li::before{content:"›";margin-right:8px;color:#334155}
.summary .go{display:inline-block;margin-top:10px;font-size:13px;border:1px solid #1f2937;border-radius:8px;padding:7px 12px;text-decoration:none;color:#cbd5e1}
.summary .go:hover{border-color:#f97316;color:#f97316}
#embed{background:#fff;color:#111;min-height:50vh}
#embed img{max-width:100%;height:auto}
#embed table{max-width:100%}
.note{margin:0;padding:10px 14px;background:#1e293b;color:#94a3b8;font-size:12.5px;border-top:1px solid #1f2937}
.foot{padding:20px 18px 40px;text-align:center;font-size:12.5px;color:#64748b;background:#0d1422}
main.home{max-width:820px;margin:0 auto;padding:30px 18px 20px}
main.home h1{font-size:clamp(22px,3.6vw,32px);letter-spacing:-.02em;margin:0 0 10px;color:#f8fafc}
main.home h2{font-size:18px;margin:28px 0 10px;color:#f8fafc}
main.home p,main.home li{color:#a7b2c2;font-size:15px}
form{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0 6px}
input{flex:1 1 300px;min-width:0;padding:14px 16px;font-size:15px;border-radius:11px;border:1px solid #1f2937;background:#111827;color:#e5e7eb;outline:none}
input:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,.18)}
button{padding:14px 22px;font-size:15px;font-weight:700;border:0;border-radius:11px;background:#f97316;color:#0d1422;cursor:pointer}
button:hover{background:#ea580c}
.hint{font-size:12.5px;color:#64748b}
code{background:#111827;padding:2px 6px;border-radius:5px;font-size:12.5px;color:#e5e7eb}
ul{padding-left:18px}li{margin-bottom:8px}
.list{list-style:none;padding:0;display:grid;gap:10px}
.list li{border:1px solid #1f2937;border-radius:12px;padding:13px 15px;background:#111827}
.list a{font-weight:700;text-decoration:none}
.list span{display:block;font-size:12.8px;color:#94a3b8;margin-top:4px}
.tags{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}
.tags a{display:inline-block;font-size:13px;padding:7px 12px;border-radius:999px;background:#111827;border:1px solid #1f2937;text-decoration:none;color:#cbd5e1}
.tags a:hover{border-color:#f97316;color:#f97316}`;

/* ---------------- target parsing ---------------- */

function parseTarget(url) {
  const path = url.pathname.replace(/^\/+/, '');
  if (!path || !HOST_RE.test(path.split('/')[0])) return null;
  try {
    const t = new URL('https://' + path + (url.search || ''));
    return HOST_RE.test(t.hostname) ? t : null;
  } catch { return null; }
}

function humanise(t) {
  const segs = t.pathname.split('/').filter(Boolean)
    .filter((s) => !UUID_RE.test(s) && !/^\d{4,}$/.test(s));
  const s = decodeURIComponent(segs.pop() || t.hostname)
    .replace(/\.(html?|php|aspx?|jsp)$/i, '').replace(/[-_+]+/g, ' ').trim();
  return clip(titleCase(s) || t.hostname, 80);
}

/* ---------------- extraction ---------------- */

const textOf = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

const grab = (re, h) => { const m = h.match(re); return m && m[1] ? textOf(m[1]) : ''; };
const iso = (d) => {
  const m = String(d).match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

function cityOf(loc) {
  const s = String(loc || '').toLowerCase();
  return CITIES.find((c) => s.includes(c)) || '';
}

function jobFields(html) {
  const org = grab(/<h2[^>]*class="[^"]*\bh4\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i, html)
    || grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i, html);

  let title = grab(/<b[^>]*>\s*&quot;([\s\S]*?)&quot;\s*<\/b>/i, html)
    || grab(/<b[^>]*>\s*"([\s\S]*?)"\s*<\/b>/i, html)
    || grab(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  if (!title) {
    title = grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html)
      .replace(/\s*[|\-–]\s*[^|\-–]{2,30}$/, '').trim();
  }

  const loc = grab(/fa-map-marker-alt[^>]*><\/i>\s*([A-Za-z][A-Za-z .'-]{1,40})/i, html)
    || grab(/Location:\s*(?:<[^>]+>\s*)*([A-Za-z][A-Za-z ,.'-]{1,40})/i, html);
  const posted = grab(/Published On:\s*(?:<[^>]+>\s*)*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4})/i, html);
  const deadline = grab(/Deadline:\s*(?:<[^>]+>\s*)*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4})/i, html);
  const type = /full[\s-]*time/i.test(html) ? 'FULL_TIME'
    : /part[\s-]*time/i.test(html) ? 'PART_TIME'
    : /contract/i.test(html) ? 'CONTRACTOR' : '';

  return {
    org: clip(org, 80), title: clip(title, 90), loc: clip(loc, 40),
    city: cityOf(loc), posted: iso(posted), deadline: iso(deadline), type
  };
}

const rewrite = (html, base) => html
  .replace(/(\b(?:href|src|action|poster)=["'])\/(?!\/)/gi, `$1${base}/`)
  .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${base}/`);

async function load(target, origin) {
  const cache = caches.default;
  const key = new Request(`${origin}/__meta?u=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const out = { ok: false, title: '', desc: '', text: '', body: '', styles: '', jobLd: '', job: null };
  try {
    const res = await fetch(target.href, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000)
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, MAX_BYTES);
      const base = new URL(res.url || target.href).origin;
      out.ok = true;
      out.title = grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html)
        || grab(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
      out.desc = grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html)
        || grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html);
      out.text = clip(textOf(html).slice(0, 1600), 1000);
      out.job = jobFields(html);
      for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (/"JobPosting"/.test(m[1])) { out.jobLd = m[1].trim(); break; }
      }
      out.styles = (html.match(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi) || []).join('\n')
        + (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
      const bm = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      out.body = rewrite((bm ? bm[1] : '')
        .replace(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/i, ''), base);
    }
  } catch {}

  const res = Response.json(out, { headers: { 'Cache-Control': `max-age=${CACHE_TTL}` } });
  await cache.put(key, res.clone());
  return out;
}

/* ---------------- index (KV) ---------------- */

const KEY = (h) => `u:${h}`;

async function remember(env, items) {
  if (!env.INDEX || !items.length) return 0;
  const hosts = new Set(JSON.parse(await env.INDEX.get('hosts') || '[]'));
  const cities = new Set(JSON.parse(await env.INDEX.get('cities') || '[]'));
  let n = 0;
  for (const it of items.slice(0, 120)) {
    const h = await sha(it.url);
    await env.INDEX.put(KEY(h), '1', {
      metadata: { url: it.url, title: clip(it.title || '', 90), host: it.host, city: it.city || '', ts: Date.now() }
    });
    hosts.add(it.host);
    if (it.city) cities.add(it.city);
    n++;
  }
  await env.INDEX.put('hosts', JSON.stringify([...hosts].slice(0, 400)));
  await env.INDEX.put('cities', JSON.stringify([...cities].slice(0, 200)));
  return n;
}

async function listIndex(env, cursor, limit = PER_SITEMAP) {
  if (!env.INDEX) return { keys: [], cursor: null };
  const r = await env.INDEX.list({ prefix: 'u:', limit, cursor: cursor || undefined });
  return { keys: r.keys.map((k) => k.metadata).filter(Boolean), cursor: r.list_complete ? null : r.cursor };
}

/* ---------------- seeds ---------------- */

const isJobUrl = (u) => /\/jobs?\/|\/job\/|viewjob|remote-jobs?\/|vacanc|career/i.test(u);

async function seedRemotive(q) {
  const r = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=40`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.jobs || []).map((j) => ({
    url: j.url, host: 'remotive.com', title: j.title, city: cityOf(j.candidate_required_location)
  }));
}

async function seedArbeitnow() {
  const r = await fetch('https://www.arbeitnow.com/api/job-board-api', {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.data || []).slice(0, 60).map((j) => ({
    url: j.url, host: 'www.arbeitnow.com', title: j.title, city: cityOf(j.location)
  }));
}

async function seedRemoteok() {
  const r = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (Array.isArray(d) ? d : []).filter((j) => j && j.slug)
    .slice(0, 60).map((j) => ({
      url: 'https://remoteok.com/remote-jobs/' + j.slug, host: 'remoteok.com', title: j.position, city: ''
    }));
}

async function seedGovpk() {
  const r = await fetch('https://jobs.gov.pk/JobSeeker/JobSeekerJobs', {
    headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(9000)
  });
  if (!r.ok) return [];
  const html = await r.text();
  const out = [];
  for (const m of html.matchAll(/href="(\/JobSeeker\/ViewJobDetails\/[^"]+)"/g)) {
    const url = 'https://jobs.gov.pk' + m[1].replace(/&amp;/g, '&');
    if (!out.some((o) => o.url === url)) out.push({ url, host: 'jobs.gov.pk', title: '', city: '' });
  }
  return out.slice(0, 60);
}

async function refresh(env) {
  const all = [];
  for (const s of SEEDS) {
    try {
      if (s.kind === 'remotive') all.push(...await seedRemotive(s.q));
      else if (s.kind === 'arbeitnow') all.push(...await seedArbeitnow());
      else if (s.kind === 'remoteok') all.push(...await seedRemoteok());
      else if (s.kind === 'govpk') all.push(...await seedGovpk());
    } catch {}
  }
  const uniq = new Map();
  for (const it of all) if (it.url && isJobUrl(it.url)) uniq.set(it.url, it);
  const added = await remember(env, [...uniq.values()]);
  return { found: uniq.size, added };
}

async function pingIndexNow(origin, urls) {
  if (!urls.length) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(origin).host,
        key: INDEXNOW_KEY,
        keyLocation: `${origin}/${INDEXNOW_KEY}.txt`,
        urlList: urls.slice(0, 100)
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {}
}

/* ---------------- shell ---------------- */

function shell(o) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'}">
${o.canon ? `<link rel="canonical" href="${esc(o.canon)}">` : ''}
<meta name="theme-color" content="#0d1422">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
${o.canon ? `<meta property="og:url" content="${esc(o.canon)}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${o.ld ? `<script type="application/ld+json">${o.ld}</script>` : ''}
${o.styles || ''}
<style>${CSS}</style>
</head>
<body>
${o.body}
${ADS}
</body>
</html>`;
}

/* ---------------- viewer ---------------- */

async function viewPage(target, url) {
  const origin = url.origin;
  const canon = origin + url.pathname + (url.search || '');
  const d = await load(target, origin);
  const job = d.job || {};
  const thin = !d.ok || d.text.length < MIN_TEXT;

  const fallback = humanise(target);
  const h1 = job.title || (d.title ? d.title.replace(/\s*[|\-–]\s*[^|\-–]{2,30}$/, '').trim() : '') || fallback;

  const title = clip(
    job.title && job.org ? `${job.title} at ${job.org}${job.loc ? ', ' + job.loc : ''}`
      : job.title ? `${job.title}${job.loc ? ' — ' + job.loc : ''} · ${target.hostname}`
      : d.title ? `${d.title} · ${target.hostname}`
      : `${fallback} · ${target.hostname}`, 72);

  const desc = clip(
    job.title
      ? `${job.title}${job.org ? ' at ' + job.org : ''}${job.loc ? ', ' + job.loc : ''}.${job.deadline ? ' Apply by ' + job.deadline + '.' : ''} ${d.text.slice(0, 110)}`
      : (d.desc || `${fallback} — mirrored from ${target.hostname}. Content belongs to the original page.`), 160);

  const graph = [
    { '@type': 'WebPage', name: h1, description: desc, url: canon, isPartOf: { '@type': 'WebSite', name: 'Job Mirror', url: origin + '/' } },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: origin + '/' },
        { '@type': 'ListItem', position: 2, name: target.hostname, item: origin + '/browse/' + target.hostname },
        { '@type': 'ListItem', position: 3, name: clip(h1, 60), item: canon }
      ]
    }
  ];

  if (job.title && JOB_HOST_RE.test(target.hostname)) {
    graph.push({
      '@type': 'JobPosting',
      title: job.title,
      description: `<p>${esc(d.text.slice(0, 900) || desc)}</p>`,
      datePosted: job.posted || new Date().toISOString().slice(0, 10),
      validThrough: job.deadline || new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
      employmentType: job.type || 'FULL_TIME',
      directApply: false,
      url: target.href,
      hiringOrganization: { '@type': 'Organization', name: job.org || target.hostname },
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'Country', name: job.loc || 'Worldwide' }
    });
  }

  const ld = d.jobLd || JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  const metaLine = [
    job.org && `<strong>${esc(job.org)}</strong>`,
    job.loc && `<a href="/jobs-in/${esc(job.city || 'remote')}">${esc(job.loc)}</a>`,
    job.type && esc(job.type.replace('_', ' ').toLowerCase()),
    job.deadline && `closes ${esc(job.deadline)}`
  ].filter(Boolean).join(' · ');

  const body = `<div class="bar"><span>Source <b>${esc(target.hostname)}</b></span><a href="${esc(target.href)}" target="_blank" rel="noopener">Open original ↗</a></div>

<section class="summary">
  <ol class="crumbs"><li><a href="/">Home</a></li><li><a href="/browse/${esc(target.hostname)}">${esc(target.hostname)}</a></li><li>job</li></ol>
  <h1>${esc(h1)}</h1>
  ${metaLine ? `<p class="meta">${metaLine}</p>` : ''}
  <p class="meta">Mirrored from ${esc(target.hostname)}. Text and links belong to the original site.</p>
  <a class="go" href="${esc(target.href)}" target="_blank" rel="noopener">Read on ${esc(target.hostname)} ↗</a>
</section>

<p class="note">${d.ok ? 'Content below is fetched live from the source and refreshed periodically.' : 'Source did not respond just now — the summary above is the last known state.'}</p>

<div id="embed">${d.body || ''}</div>

<div class="foot">Build ${BUILD} · <a href="/">Home</a> · <a href="/browse">All sources</a> · <a href="/sitemap.xml">Sitemap</a></div>`;

  return { html: shell({ title, desc, canon, ld, styles: d.styles, body, noindex: thin }), thin };
}

/* ---------------- hubs ---------------- */

function itemList(items, origin) {
  return `<ul class="list">${items.map((m) => `<li>
    <a href="${esc(new URL(m.url).pathname + (new URL(m.url).search || ''))}">${esc(m.title || m.url)}</a>
    <span>${esc(m.host)}${m.city ? ' · ' + esc(m.city) : ''}</span></li>`).join('')}</ul>`;
}

async function hub(env, url, o) {
  const origin = url.origin;
  const items = o.items || [];
  const body = `<main class="home">
  <ol class="crumbs" style="list-style:none;display:flex;gap:8px;padding:0;font-size:12.5px;color:#64748b">
    <li><a href="/">Home</a></li><li>›</li><li>${esc(o.crumb)}</li>
  </ol>
  <h1>${esc(o.h1)}</h1>
  <p>${o.lede}</p>
  ${items.length ? itemList(items, origin) : '<p>Nothing indexed for this filter yet — the crawler fills it within a few hours.</p>'}
  <h2>Browse more</h2>
  <ul class="tags">
    <li><a href="/browse">All sources</a></li>
    ${CITIES.slice(0, 12).map((c) => `<li><a href="/jobs-in/${c}">${titleCase(c)}</a></li>`).join('')}
  </ul>
</main>
<div class="foot">Build ${BUILD} · <a href="/sitemap.xml">Sitemap</a></div>`;

  return shell({ title: o.title, desc: o.desc, canon: origin + url.pathname, body });
}

/* ---------------- home ---------------- */

function homePage(url) {
  const origin = url.origin;
  const body = `<main class="home">
  <h1>Job Mirror</h1>
  <p>Every job page from the boards we follow, mirrored into one readable copy. Paste any job address, or start from a source or a city. No account, nothing stored.</p>
  <form id="go">
    <input id="url" type="text" placeholder="jobs.gov.pk/JobSeeker/ViewJobDetails/…" autocomplete="off" spellcheck="false" aria-label="Address to mirror">
    <button type="submit">Mirror</button>
  </form>
  <p class="hint">Works with or without <code>https://</code>. The address becomes <code>/&lt;host&gt;/&lt;path&gt;</code>.</p>

  <h2>Browse by source</h2>
  <ul class="tags">
    <li><a href="/browse/jobs.gov.pk">jobs.gov.pk</a></li>
    <li><a href="/browse/remoteok.com">remoteok.com</a></li>
    <li><a href="/browse/remotive.com">remotive.com</a></li>
    <li><a href="/browse/www.arbeitnow.com">arbeitnow</a></li>
    <li><a href="/browse">All sources</a></li>
  </ul>

  <h2>Browse by city</h2>
  <ul class="tags">${CITIES.map((c) => `<li><a href="/jobs-in/${c}">${titleCase(c)}</a></li>`).join('')}</ul>

  <h2>How it works</h2>
  <ul>
    <li>A cron job pulls fresh listings from several public job feeds every six hours.</li>
    <li>Each listing becomes a page with its own title, summary, employer, city and job schema.</li>
    <li>Hubs, city pages and a sitemap index keep everything reachable for search engines.</li>
  </ul>
</main>
<div class="foot">Build ${BUILD} · <a href="/browse">Browse</a> · <a href="/sitemap.xml">Sitemap</a> · <a href="/api/health">Status</a></div>
<script>
document.getElementById('go').addEventListener('submit',function(e){
  e.preventDefault();
  var v=document.getElementById('url').value.trim().replace(/^https?:\\/\\//i,'').replace(/^\\/+/,'');
  if(v) location.href='/'+v;
});
</script>`;
  return shell({
    title: 'Job Mirror — every listing, one readable copy',
    desc: 'Mirrored job listings from several boards with employer, city, salary and closing date. Browse by source or city, no signup.',
    canon: origin + '/',
    body
  });
}

function notFound() {
  return shell({
    title: 'Nothing here',
    desc: 'The first path segment must be a real host, like /example.com/page.',
    canon: null, noindex: true,
    body: `<main class="home"><h1>Nothing here</h1><p>The first segment must be a host, e.g. <code>/jobs.gov.pk/…</code>.</p><p><a href="/">Home</a></p></main>`
  });
}

/* ---------------- static ---------------- */

const robots = (o) => `User-agent: *
Allow: /
Disallow: /__meta
Disallow: /api/

Sitemap: ${o}/sitemap.xml
`;

async function sitemapIndex(env, origin) {
  const d = new Date().toISOString().slice(0, 10);
  const total = await countIndex(env);
  const chunks = Math.min(Math.ceil(total / PER_SITEMAP) || 1, MAX_SITEMAPS);
  const rows = [`<url><loc>${origin}/</loc><lastmod>${d}</lastmod><priority>1.0</priority></url>`]
    .concat(CITIES.map((c) => `<url><loc>${origin}/jobs-in/${c}</loc><lastmod>${d}</lastmod><priority>0.9</priority></url>`))
    .concat(Array.from({ length: chunks }, (_, i) => `<url><loc>${origin}/sitemap-${i + 1}.xml</loc><lastmod>${d}</lastmod></url>`))
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

async function countIndex(env) {
  if (!env.INDEX) return 0;
  let n = 0, cursor = null;
  for (let i = 0; i < MAX_SITEMAPS; i++) {
    const r = await env.INDEX.list({ prefix: 'u:', limit: 1000, cursor: cursor || undefined });
    n += r.keys.length;
    if (r.list_complete) break;
    cursor = r.cursor;
  }
  return n;
}

async function sitemapChunk(env, origin, page) {
  if (!env.INDEX) return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  let cursor = null;
  for (let i = 1; i < page; i++) {
    const r = await env.INDEX.list({ prefix: 'u:', limit: PER_SITEMAP, cursor: cursor || undefined });
    if (r.list_complete) return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    cursor = r.cursor;
  }
  const r = await env.INDEX.list({ prefix: 'u:', limit: PER_SITEMAP, cursor: cursor || undefined });
  const rows = r.keys.map((k) => k.metadata).filter(Boolean).map((m) => {
    const u = new URL(m.url);
    const last = new Date(m.ts || Date.now()).toISOString().slice(0, 10);
    return `<url><loc>${esc(origin + u.pathname + (u.search || ''))}</loc><lastmod>${last}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
  }).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1422"/><path d="M14 22h24a8 8 0 0 1 0 16H26" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round"/><path d="M22 44l-8-6 8-6" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const H = { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
const XML = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' };

/* ---------------- router ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin = url.origin;

    if (p === '/robots.txt') return new Response(robots(origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    if (p === `/${INDEXNOW_KEY}.txt`) return new Response(INDEXNOW_KEY, { headers: { 'Content-Type': 'text/plain' } });
    if (p === '/sitemap.xml') return new Response(await sitemapIndex(env, origin), { headers: XML });

    const chunk = p.match(/^\/sitemap-(\d+)\.xml$/);
    if (chunk) return new Response(await sitemapChunk(env, origin, Number(chunk[1])), { headers: XML });

    if (p === '/favicon.svg' || p === '/favicon.ico') return new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    if (p === '/api/health') return Response.json({ success: true, build: BUILD, mode: 'mirror+index', time: new Date().toISOString() });
    if (p === '/api/refresh') return Response.json({ success: true, ...(await refresh(env)) });

    if (p === '/' || p === '/index.html') {
      const raw = url.searchParams.get('url') || url.searchParams.get('u');
      if (raw) {
        const clean = raw.trim().replace(/^https?:\/\//i, '').replace(/^\/+/, '');
        if (HOST_RE.test(clean.split('/')[0] || '')) return Response.redirect(origin + '/' + clean, 301);
      }
      return new Response(homePage(url), { headers: { ...H, 'Cache-Control': 'public, max-age=0, s-maxage=60', 'X-Robots-Tag': 'index, follow' } });
    }

    /* hubs */
    if (p === '/browse') {
      const hosts = JSON.parse(await env.INDEX?.get('hosts') || '[]');
      const items = [];
      for (const h of hosts.slice(0, 40)) {
        const r = await env.INDEX.list({ prefix: 'u:', limit: 3 });
        items.push({ url: `${origin}/browse/${h}`, host: h, title: `Jobs from ${h}` });
      }
      return new Response(await hub(env, url, {
        crumb: 'Sources', h1: 'All sources',
        title: 'All mirrored job sources',
        desc: 'Every board this mirror follows, one link each.',
        lede: 'Pick a source to see its mirrored listings.'
      }).then((h) => h), { headers: H });
    }

    if (p.startsWith('/browse/')) {
      const host = p.slice(8);
      const r = await env.INDEX?.list({ prefix: 'u:', limit: 200 });
      const items = (r?.keys || []).map((k) => k.metadata).filter((m) => m && m.host === host).slice(0, 120);
      return new Response(await hub(env, url, {
        crumb: host, h1: `Jobs from ${host}`,
        title: `Mirrored jobs from ${host}`,
        desc: `Latest mirrored listings from ${host}, with employer, city and closing date.`,
        lede: `Mirrored listings from ${host}. Each opens a full copy.`,
        items
      }), { headers: H });
    }

    if (p.startsWith('/jobs-in/')) {
      const city = p.slice(9).toLowerCase();
      const r = await env.INDEX?.list({ prefix: 'u:', limit: 400 });
      const items = (r?.keys || []).map((k) => k.metadata).filter((m) => m && m.city === city).slice(0, 120);
      return new Response(await hub(env, url, {
        crumb: titleCase(city), h1: `Jobs in ${titleCase(city)}`,
        title: `Jobs in ${titleCase(city)} — mirrored listings`,
        desc: `Mirrored job listings in ${titleCase(city)} with employer, salary and closing date. Updated every six hours.`,
        lede: `Open roles in ${titleCase(city)} collected from every board we follow.`,
        items
      }), { headers: H });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const target = parseTarget(url);
    if (target) {
      const cache = caches.default;
      const key = new Request(origin + p + (url.search || ''));
      const hit = await cache.match(key);
      if (hit) return hit;

      const { html, thin } = await viewPage(target, url);
      const res = new Response(html, {
        headers: {
          ...H,
          'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL}`,
          'X-Robots-Tag': thin ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'
        }
      });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    if (env && env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return new Response(notFound(), { status: 404, headers: H });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await refresh(env);
      if (r.added) {
        const list = await env.INDEX?.list({ prefix: 'u:', limit: 100 });
        const urls = (list?.keys || []).map((k) => k.metadata?.url).filter(Boolean);
        await pingIndexNow('https://google-crawling.muzilla.workers.dev', urls);
      }
    })());
  }
};
