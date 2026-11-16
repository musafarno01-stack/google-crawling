/**
 * URL viewer with an indexable shell.
 * /<host>/<path>?<query>  ->  renders a page whose iframe loads https://<host>/<path>?<query>
 * The target's own title/description/excerpt are fetched server-side so each
 * page is a unique, crawlable document even if the site refuses to be framed.
 */

const BUILD = '3.0.0';
const CACHE_TTL = 600;
const MAX_BYTES = 300000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ---------- target parsing ---------- */

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function parseTarget(url) {
  const path = url.pathname.replace(/^\/+/, '');
  if (!path) return null;
  if (!HOST_RE.test(path.split('/')[0])) return null;
  try {
    const t = new URL('https://' + path + (url.search || ''));
    if (!HOST_RE.test(t.hostname)) return null;
    return t;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function humanise(target) {
  const segs = target.pathname.split('/').filter(Boolean)
    .filter((s) => !UUID_RE.test(s) && !/^\d{4,}$/.test(s));
  const last = segs.pop() || target.hostname;
  let s = decodeURIComponent(last).replace(/\.(html?|php|aspx?|jsp)$/i, '').replace(/[-_+]+/g, ' ').trim();
  if (target.searchParams.get('jobId')) s = s || 'Job details';
  return clip(titleCase(s) || target.hostname, 80);
}

/* ---------- target metadata (cached) ---------- */

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(re, html) {
  const m = html.match(re);
  return m && m[1] ? textOf(m[1]) : '';
}

async function meta(target, origin) {
  const cache = caches.default;
  const key = new Request(`${origin}/__meta?u=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();

  let out = { ok: false, title: '', desc: '', text: '', final: target.href };
  try {
    const res = await fetch(target.href, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, MAX_BYTES);
      out.ok = true;
      out.final = res.url || target.href;
      out.title = clip(
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html) ||
        pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html), 70);
      out.desc = clip(
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
        pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html), 160);
      out.text = clip(textOf(html).slice(0, 1400), 900);
    }
  } catch {}

  const res = Response.json(out, { headers: { 'Cache-Control': `max-age=${CACHE_TTL}` } });
  await cache.put(key, res.clone());
  return out;
}

/* ---------- page ---------- */

function page(o) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${esc(o.canon)}">
<meta name="theme-color" content="#0d1422">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(o.canon)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: o.title,
  description: o.desc,
  url: o.canon,
  isPartOf: { '@type': 'WebSite', name: 'URL Viewer', url: o.origin + '/' }
})}
</script>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#0d1422;color:#e5e7eb;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 14px;background:#0a1020;border-bottom:1px solid #1f2937;font-size:13px;color:#94a3b8}
  .bar b{color:#e5e7eb;font-weight:600}
  .bar a{margin-left:auto;color:#0d1422;background:#f97316;text-decoration:none;font-weight:700;padding:7px 13px;border-radius:8px;white-space:nowrap}
  .bar a:hover{background:#ea580c}
  #viewer{display:block;width:100%;height:calc(100svh - 44px);border:0;background:#fff}
  .note{margin:0;padding:10px 14px;background:#1e293b;color:#94a3b8;font-size:12.5px;border-top:1px solid #1f2937}
  main{max-width:820px;margin:0 auto;padding:30px 18px 20px}
  h1{font-size:clamp(22px,3.6vw,30px);letter-spacing:-.02em;margin:0 0 10px;color:#f8fafc}
  h2{font-size:18px;margin:28px 0 10px;color:#f8fafc}
  p{color:#a7b2c2;font-size:15px}
  a{color:#7dd3fc}
  .crumbs{list-style:none;display:flex;gap:8px;padding:0;margin:0 0 16px;font-size:12.5px;color:#64748b;flex-wrap:wrap}
  .crumbs li+li::before{content:"›";margin-right:8px;color:#334155}
  .excerpt{border-left:3px solid #f97316;padding-left:14px;color:#94a3b8;font-size:14.5px}
  footer{border-top:1px solid #1f2937;margin-top:26px;padding:18px;text-align:center;font-size:12.5px;color:#64748b}
  .noscript{border:1px solid #f97316;border-radius:10px;padding:12px;margin:14px 0;color:#fbbf24}
</style>
</head>
<body>

<div class="bar">
  <span>Viewing <b>${esc(o.host)}</b></span>
  <a href="${esc(o.target)}" target="_blank" rel="noopener">Open original ↗</a>
</div>

<iframe id="viewer" src="${esc(o.target)}" title="${esc(o.title)}"
  allow="clipboard-write; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
  loading="eager"></iframe>

<p class="note">Blank frame? The site blocks embedding — use “Open original” above. The text below is a server-side copy for search engines.</p>

<noscript><div class="noscript" style="margin:14px">JavaScript is off. <a href="${esc(o.target)}">Open the original page</a>.</div></noscript>

<main>
  <ol class="crumbs"><li><a href="/">Viewer</a></li><li>${esc(o.host)}</li></ol>
  <h1>${esc(o.human)}</h1>
  <p>${esc(o.lede)}</p>

  ${o.text ? `<h2>About this page</h2><p class="excerpt">${esc(o.text)}</p>` : ''}

  <h2>Open it elsewhere</h2>
  <p><a href="${esc(o.target)}" target="_blank" rel="noopener">${esc(o.target)}</a></p>

  <h2>What this viewer is</h2>
  <p>A thin wrapper that loads the requested page inside a frame at this address, so a link can be shared, bookmarked and indexed on this domain. Nothing is stored; the original site always owns the content.</p>
</main>

<footer>Build ${BUILD} · <a href="/">Viewer home</a> · <a href="/sitemap.xml">Sitemap</a></footer>

<script src="/script.js"></script>
<script>(function(s){s.dataset.zone='12248935',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
<script>(function(s){s.dataset.zone='12248892',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
<script>(function(s){s.dataset.zone='12248811',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>

</body>
</html>`;
}

/* ---------- routes ---------- */

async function view(target, url, env, ctx) {
  const origin = url.origin;
  const m = await meta(target, origin);
  const human = humanise(target);

  const title = m.title || `${human} · ${target.hostname}`;
  const desc = m.desc || `View ${human} on ${target.hostname} in a clean frame at ${origin.replace(/^https?:\/\//, '')}. Original page, no signup.`;
  const lede = `A frame showing <strong>${esc(human)}</strong> from ${esc(target.hostname)}. Content belongs to the original site; open it directly if the frame stays blank.`;

  const html = page({
    origin,
    host: target.hostname,
    target: target.href,
    canon: origin + url.pathname + (url.search || ''),
    title,
    desc,
    human,
    lede,
    text: m.text
  });

  const res = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL}`,
      'X-Robots-Tag': 'index, follow, max-image-preview:large, max-snippet:-1',
      'X-Content-Type-Options': 'nosniff'
    }
  });
  ctx.waitUntil(caches.default.put(new Request(origin + url.pathname + (url.search || '')), res.clone()));
  return res;
}

const robots = (o) => `User-agent: *
Allow: /
Disallow: /__meta

Sitemap: ${o}/sitemap.xml
`;

const EXAMPLES = [
  'jobs.gov.pk/JobSeeker/ViewJobDetails/129acf20-6a5c-49e8-ae1a-08dcc051e55e',
  'example.com',
  'wikipedia.org/wiki/Remote_work'
];

function sitemap(o) {
  const d = new Date().toISOString().slice(0, 10);
  const rows = [
    `<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...EXAMPLES.map((p) => `<url><loc>${o}/${p}</loc><lastmod>${d}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/robots.txt') {
      return new Response(robots(url.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/sitemap.xml') {
      return new Response(sitemap(url.origin), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/api/health') {
      return Response.json({ success: true, build: BUILD, mode: 'path-viewer', time: new Date().toISOString() });
    }

    if (p === '/' || p === '/index.html') {
      return env.ASSETS.fetch(new Request(url.origin + '/index.html', request));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const target = parseTarget(url);
    if (!target) {
      const res = await env.ASSETS.fetch(new Request(url.origin + '/404.html'));
      return new Response(res.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const cache = caches.default;
    const key = new Request(url.origin + p + (url.search || ''));
    const hit = await cache.match(key);
    if (hit) return hit;

    return view(target, url, env, ctx);
  }
};
