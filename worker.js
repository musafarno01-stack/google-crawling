/**
 * Path viewer with inlined source. /<host>/<path> fetches the target and inlines its
 * body so the page is a real, unique, crawlable document.
 * Unique title/description/H1 and JobPosting schema are derived from the source page.
 */

const BUILD = '6.0.0';
const CACHE_TTL = 600;
const MAX_BYTES = 400000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const JOB_HOST_RE = /(^|\.)(remoteok|remotive|weworkremotely|arbeitnow|indeed|wellfound|linkedin|glassdoor)\.|(^|\.)jobs\./i;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

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
#embed{background:#fff;color:#111;min-height:60vh}
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
ul{padding-left:18px}li{margin-bottom:8px}`;

/* ---------- target ---------- */

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

/* ---------- extraction ---------- */

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

function jobFields(html) {
  const org = grab(/<h2[^>]*class="[^"]*\bh4\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i, html)
    || grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i, html);

  let title = grab(/<b[^>]*>\s*&quot;([\s\S]*?)&quot;\s*<\/b>/i, html)
    || grab(/<b[^>]*>\s*"([\s\S]*?)"\s*<\/b>/i, html);
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

  return { org: clip(org, 80), title: clip(title, 90), loc: clip(loc, 40), posted: iso(posted), deadline: iso(deadline), type };
}

function rewrite(html, base) {
  return html
    .replace(/(\b(?:href|src|action|poster)=["'])\/(?!\/)/gi, `$1${base}/`)
    .replace(/url\(\s*(['"]?)\/(?!\/)/gi, `url($1${base}/`);
}

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

      // Reuse the source's own JobPosting schema when it has one.
      for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (/"JobPosting"/.test(m[1])) { out.jobLd = m[1].trim(); break; }
      }

      // Stylesheets + style blocks so the inlined markup keeps its look.
      out.styles = (html.match(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi) || []).join('\n')
        + (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');

      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      let body = bodyMatch ? bodyMatch[1] : '';
      body = body
        .replace(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/i, '');
      out.body = rewrite(body, base);
    }
  } catch {}

  const res = Response.json(out, { headers: { 'Cache-Control': `max-age=${CACHE_TTL}` } });
  await cache.put(key, res.clone());
  return out;
}

/* ---------- shell ---------- */

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

/* ---------- viewer page ---------- */

async function viewPage(target, url) {
  const origin = url.origin;
  const canon = origin + url.pathname + (url.search || '');
  const d = await load(target, origin);
  const job = d.job || {};

  const fallback = humanise(target);
  const h1 = job.title || (d.title ? d.title.replace(/\s*[|\-–]\s*[^|\-–]{2,30}$/, '').trim() : '') || fallback;

  const title = clip(
    job.title && job.org ? `${job.title} at ${job.org}${job.loc ? ', ' + job.loc : ''}`
      : job.title ? `${job.title}${job.loc ? ' — ' + job.loc : ''} · ${target.hostname}`
      : d.title ? `${d.title} · ${target.hostname}`
      : `${fallback} · ${target.hostname}`, 72);

  const desc = clip(
    job.title
      ? `${job.title}${job.org ? ' at ' + job.org : ''}${job.loc ? ', ' + job.loc : ''}.${job.deadline ? ' Apply by ' + job.deadline + '.' : ''} ${d.text.slice(0, 120)}`
      : (d.desc || `${fallback} — viewed on ${target.hostname}. Content from the original page, one click away.`), 160);

  /* structured data */
  const graph = [{
    '@type': 'WebPage',
    name: h1,
    description: desc,
    url: canon,
    isPartOf: { '@type': 'WebSite', name: 'URL Viewer', url: origin + '/' }
  }, {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Viewer', item: origin + '/' },
      { '@type': 'ListItem', position: 2, name: target.hostname, item: canon }
    ]
  }];

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
    job.loc && esc(job.loc),
    job.type && esc(job.type.replace('_', ' ').toLowerCase()),
    job.deadline && `closes ${esc(job.deadline)}`
  ].filter(Boolean).join(' · ');

  const body = `<div class="bar"><span>Source <b>${esc(target.hostname)}</b></span><a href="${esc(target.href)}" target="_blank" rel="noopener">Open original ↗</a></div>

<section class="summary">
  <ol class="crumbs"><li><a href="/">Viewer</a></li><li>${esc(target.hostname)}</li></ol>
  <h1>${esc(h1)}</h1>
  ${metaLine ? `<p class="meta">${metaLine}</p>` : ''}
  <p class="meta">Page mirrored from ${esc(target.hostname)}. Text and links belong to the original site.</p>
  <a class="go" href="${esc(target.href)}" target="_blank" rel="noopener">Read on ${esc(target.hostname)} ↗</a>
</section>

<p class="note">${d.ok ? 'Content below is fetched live from the source and refreshed periodically.' : 'The source did not respond just now — the summary above is the last known state. Use the original link.'}</p>

<div id="embed">${d.body || ''}</div>

<div class="foot">Build ${BUILD} · <a href="/">Viewer home</a> · <a href="/sitemap.xml">Sitemap</a></div>`;

  return shell({ title, desc, canon, ld, styles: d.styles, body });
}

/* ---------- home ---------- */

function homePage(url) {
  const origin = url.origin;
  const body = `<main class="home">
  <h1>URL Viewer</h1>
  <p>Paste any address. It is fetched and mirrored here in a readable page — original title, text and links kept intact, one click back to the source. No account, nothing stored.</p>
  <form id="go">
    <input id="url" type="text" placeholder="remoteok.com/remote-jobs/…" autocomplete="off" spellcheck="false" aria-label="Address to view">
    <button type="submit">View</button>
  </form>
  <p class="hint">Works with or without <code>https://</code>. The address becomes <code>/&lt;host&gt;/&lt;path&gt;</code>.</p>
  <h2>Try these</h2>
  <ul>
    <li><a href="/remoteok.com/remote-jobs/remote-software-engineer-ai-tooling-supabase-1137793">remoteok.com — remote software engineer</a></li>
    <li><a href="/jobs.gov.pk/JobSeeker/ViewJobDetails/129acf20-6a5c-49e8-ae1a-08dcc051e55e">jobs.gov.pk — job details</a></li>
    <li><a href="/wikipedia.org/wiki/Remote_work">wikipedia.org — Remote work</a></li>
    <li><a href="/example.com">example.com</a></li>
  </ul>
  <h2>How it works</h2>
  <ul>
    <li>The first path segment is the host, the rest is the path.</li>
    <li>The page is fetched at the edge, its markup mirrored and its relative links repaired.</li>
    <li>Each mirrored page gets its own title, summary and job metadata so it can be indexed on its own.</li>
  </ul>
</main>
<div class="foot">Build ${BUILD} · <a href="/sitemap.xml">Sitemap</a> · <a href="/api/health">Status</a></div>
<script>
document.getElementById('go').addEventListener('submit',function(e){
  e.preventDefault();
  var v=document.getElementById('url').value.trim().replace(/^https?:\\/\\//i,'').replace(/^\\/+/,'');
  if(v) location.href='/'+v;
});
</script>`;

  return shell({
    title: 'URL Viewer — mirror any page into a clean, readable copy',
    desc: 'Paste any URL and get a clean mirrored copy with the original title, text and links. No signup, nothing stored.',
    canon: origin + '/',
    body
  });
}

function notFound() {
  return shell({
    title: 'Nothing to view here',
    desc: 'The first path segment must be a real host, like /example.com/page.',
    canon: null,
    noindex: true,
    body: `<main class="home"><h1>Nothing to view here</h1>
<p>The first path segment must be a real host, for example <code>/example.com/page</code>.</p>
<p><a href="/">Back to the viewer</a></p></main>`
  });
}

/* ---------- static ---------- */

const robots = (o) => `User-agent: *
Allow: /
Disallow: /__meta
Disallow: /api/

Sitemap: ${o}/sitemap.xml
`;

const EXAMPLES = [
  'remoteok.com/remote-jobs/remote-software-engineer-ai-tooling-supabase-1137793',
  'jobs.gov.pk/JobSeeker/ViewJobDetails/129acf20-6a5c-49e8-ae1a-08dcc051e55e',
  'wikipedia.org/wiki/Remote_work',
  'example.com'
];

function sitemap(o) {
  const d = new Date().toISOString().slice(0, 10);
  const rows = [
    `<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...EXAMPLES.map((p) => `<url><loc>${o}/${p}</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1422"/><path d="M14 22h24a8 8 0 0 1 0 16H26" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round"/><path d="M22 44l-8-6 8-6" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const H = { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

/* ---------- router ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin = url.origin;

    if (p === '/robots.txt') return new Response(robots(origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    if (p === '/sitemap.xml') return new Response(sitemap(origin), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    if (p === '/favicon.svg' || p === '/favicon.ico') return new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    if (p === '/api/health') return Response.json({ success: true, build: BUILD, mode: 'mirror', time: new Date().toISOString() });

    if (p === '/' || p === '/index.html') {
      const raw = url.searchParams.get('url') || url.searchParams.get('u');
      if (raw) {
        const clean = raw.trim().replace(/^https?:\/\//i, '').replace(/^\/+/, '');
        if (HOST_RE.test(clean.split('/')[0] || '')) return Response.redirect(origin + '/' + clean, 301);
      }
      return new Response(homePage(url), {
        headers: { ...H, 'Cache-Control': 'public, max-age=0, s-maxage=60', 'X-Robots-Tag': 'index, follow' }
      });
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

      const res = new Response(await viewPage(target, url), {
        headers: { ...H, 'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL}`, 'X-Robots-Tag': 'index, follow, max-image-preview:large, max-snippet:-1' }
      });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    if (env && env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return new Response(notFound(), { status: 404, headers: H });
  }
};
