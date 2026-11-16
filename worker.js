/**
 * Path viewer. /<host>/<path>?<query> renders a page framing https://<host>/<path>?<query>.
 * Home, 404, robots, sitemap and favicon are generated here — no HTML files required.
 */

const BUILD = '4.0.0';
const CACHE_TTL = 600;
const MAX_BYTES = 300000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

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
#viewer{display:block;width:100%;height:calc(100svh - 44px);border:0;background:#fff}
.note{margin:0;padding:10px 14px;background:#1e293b;color:#94a3b8;font-size:12.5px;border-top:1px solid #1f2937}
main{max-width:820px;margin:0 auto;padding:30px 18px 20px}
h1{font-size:clamp(22px,3.6vw,32px);letter-spacing:-.02em;margin:0 0 10px;color:#f8fafc}
h2{font-size:18px;margin:28px 0 10px;color:#f8fafc}
p{color:#a7b2c2;font-size:15px}
.crumbs{list-style:none;display:flex;gap:8px;padding:0;margin:0 0 16px;font-size:12.5px;color:#64748b;flex-wrap:wrap}
.crumbs li+li::before{content:"›";margin-right:8px;color:#334155}
.excerpt{border-left:3px solid #f97316;padding-left:14px;color:#94a3b8;font-size:14.5px}
footer{border-top:1px solid #1f2937;margin-top:26px;padding:18px;text-align:center;font-size:12.5px;color:#64748b}
.noscript{border:1px solid #f97316;border-radius:10px;padding:12px;margin:14px 0;color:#fbbf24}
form{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0 6px}
input{flex:1 1 300px;min-width:0;padding:14px 16px;font-size:15px;border-radius:11px;border:1px solid #1f2937;background:#111827;color:#e5e7eb;outline:none}
input:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,.18)}
button{padding:14px 22px;font-size:15px;font-weight:700;border:0;border-radius:11px;background:#f97316;color:#0d1422;cursor:pointer}
button:hover{background:#ea580c}
.hint{font-size:12.5px;color:#64748b}
code{background:#111827;padding:2px 6px;border-radius:5px;font-size:12.5px}
ul{padding-left:18px}li{margin-bottom:8px;color:#a7b2c2}`;

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
  const last = segs.pop() || t.hostname;
  const s = decodeURIComponent(last).replace(/\.(html?|php|aspx?|jsp)$/i, '').replace(/[-_+]+/g, ' ').trim();
  return clip(titleCase(s) || t.hostname, 80);
}

/* ---------- target metadata ---------- */

const textOf = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

const pick = (re, h) => { const m = h.match(re); return m && m[1] ? textOf(m[1]) : ''; };

async function meta(target, origin) {
  const cache = caches.default;
  const key = new Request(`${origin}/__meta?u=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const out = { title: '', desc: '', text: '' };
  try {
    const res = await fetch(target.href, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, MAX_BYTES);
      out.title = clip(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html) ||
                       pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html), 70);
      out.desc = clip(pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
                      pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html), 160);
      out.text = clip(textOf(html).slice(0, 1400), 900);
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
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
${o.canon ? `<meta property="og:url" content="${esc(o.canon)}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
${o.body}
${ADS}
</body>
</html>`;
}

/* ---------- pages ---------- */

async function viewPage(target, url) {
  const origin = url.origin;
  const m = await meta(target, origin);
  const human = humanise(target);
  const title = m.title || `${human} · ${target.hostname}`;
  const desc = m.desc || `View ${human} on ${target.hostname} in a clean frame. The original page is one click away.`;

  const body = `<div class="bar"><span>Viewing <b>${esc(target.hostname)}</b></span><a href="${esc(target.href)}" target="_blank" rel="noopener">Open original ↗</a></div>
<iframe id="viewer" src="${esc(target.href)}" title="${esc(title)}" allow="clipboard-write; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="eager"></iframe>
<p class="note" id="note">Blank frame? The site may block embedding — use “Open original”. The text below is a server-side copy for search engines.</p>
<noscript><div class="noscript" style="margin:14px">JavaScript is off. <a href="${esc(target.href)}">Open the original page</a>.</div></noscript>
<main>
  <ol class="crumbs"><li><a href="/">Viewer</a></li><li>${esc(target.hostname)}</li></ol>
  <h1>${esc(human)}</h1>
  <p>A frame showing <strong>${esc(human)}</strong> from ${esc(target.hostname)}. The content belongs to the original site.</p>
  ${m.text ? `<h2>About this page</h2><p class="excerpt">${esc(m.text)}</p>` : ''}
  <h2>Open it elsewhere</h2>
  <p><a href="${esc(target.href)}" target="_blank" rel="noopener">${esc(target.href)}</a></p>
  <h2>What this is</h2>
  <p>A thin wrapper that loads the requested page in a frame at this address so the link can be shared, bookmarked and indexed here. Nothing is stored.</p>
</main>
<footer>Build ${BUILD} · <a href="/">Viewer home</a> · <a href="/sitemap.xml">Sitemap</a></footer>
<script>
(function(){
  var v=document.getElementById('viewer'), n=document.getElementById('note');
  var p=location.pathname.replace(/^\\/+/,'');
  if(/^[a-z0-9-]+(\\.[a-z0-9-]+)+$/i.test(p.split('/')[0]||'')){
    var t='https://'+p+location.search;
    if(v.getAttribute('src')!==t) v.src=t;
  }
  var done=false;
  v.addEventListener('error',function(){
    if(done) return; done=true;
    n.innerHTML='This site refuses to be framed. <a href="'+(v.src||location.href)+'" target="_blank" rel="noopener">Open it directly ↗</a>';
  });
})();
</script>`;

  return shell({
    title,
    desc,
    canon: origin + url.pathname + (url.search || ''),
    body
  });
}

function homePage(url) {
  const body = `<main>
  <h1>URL Viewer</h1>
  <p>Paste any address. It opens in a clean frame at this domain, and the page keeps the original title and text below for reference. No account, nothing stored.</p>
  <form id="go">
    <input id="url" type="text" placeholder="jobs.gov.pk/JobSeeker/ViewJobDetails/…" autocomplete="off" spellcheck="false" aria-label="Address to view">
    <button type="submit">View</button>
  </form>
  <p class="hint">Works with or without <code>https://</code>. The address becomes <code>/&lt;host&gt;/&lt;path&gt;</code>.</p>
  <h2>Try these</h2>
  <ul>
    <li><a href="/jobs.gov.pk/JobSeeker/ViewJobDetails/129acf20-6a5c-49e8-ae1a-08dcc051e55e">jobs.gov.pk — job details</a></li>
    <li><a href="/wikipedia.org/wiki/Remote_work">wikipedia.org — Remote work</a></li>
    <li><a href="/example.com">example.com</a></li>
  </ul>
  <h2>How it works</h2>
  <ul>
    <li>The first path segment is the host, the rest is the path.</li>
    <li>The page frames that address and repeats its title and excerpt for search engines.</li>
    <li>If a site forbids framing, “Open original” always works.</li>
  </ul>
  <h2>Why bother</h2>
  <p>Viewer links survive reader-mode stripping, keep one address for sharing, and give a readable fallback when the source site is heavy, ad-stuffed or offline.</p>
</main>
<footer>Build ${BUILD} · <a href="/sitemap.xml">Sitemap</a> · <a href="/api/health">Status</a></footer>
<script>
document.getElementById('go').addEventListener('submit',function(e){
  e.preventDefault();
  var v=document.getElementById('url').value.trim().replace(/^https?:\\/\\//i,'').replace(/^\\/+/,'');
  if(v) location.href='/'+v;
});
</script>`;

  return shell({
    title: 'URL Viewer — open any page in a clean frame',
    desc: 'Paste any URL and read it in a clean full-screen frame on this domain. No signup, no redirects, no clutter.',
    canon: url.origin + '/',
    body
  });
}

function notFound(url) {
  return shell({
    title: 'Nothing to view here',
    desc: 'The first path segment must be a real host, like /example.com/page.',
    canon: null,
    noindex: true,
    body: `<main><h1>Nothing to view here</h1>
<p>The first path segment must be a real host, for example <code>/example.com/page</code>.</p>
<p><a href="/">Back to the viewer</a></p></main>`
  });
}

/* ---------- static bits ---------- */

const robots = (o) => `User-agent: *
Allow: /
Disallow: /__meta
Disallow: /api/

Sitemap: ${o}/sitemap.xml
`;

const EXAMPLES = [
  'jobs.gov.pk/JobSeeker/ViewJobDetails/129acf20-6a5c-49e8-ae1a-08dcc051e55e',
  'wikipedia.org/wiki/Remote_work',
  'example.com'
];

function sitemap(o) {
  const d = new Date().toISOString().slice(0, 10);
  const rows = [
    `<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...EXAMPLES.map((p) => `<url><loc>${o}/${p}</loc><lastmod>${d}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1422"/><path d="M14 22h24a8 8 0 0 1 0 16H26" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round"/><path d="M22 44l-8-6 8-6" fill="none" stroke="#f97316" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
};

/* ---------- router ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin = url.origin;

    if (p === '/robots.txt') {
      return new Response(robots(origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/sitemap.xml') {
      return new Response(sitemap(origin), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/favicon.svg' || p === '/favicon.ico') {
      return new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }

    if (p === '/api/health') {
      return Response.json({ success: true, build: BUILD, mode: 'path-viewer', time: new Date().toISOString() });
    }

    if (p === '/' || p === '/index.html') {
      // ?url= / ?u= convenience -> redirect to the canonical path form
      const raw = url.searchParams.get('url') || url.searchParams.get('u');
      if (raw) {
        const clean = raw.trim().replace(/^https?:\/\//i, '').replace(/^\/+/, '');
        if (HOST_RE.test(clean.split('/')[0] || '')) {
          return Response.redirect(origin + '/' + clean, 301);
        }
      }
      const html = homePage(url);
      return new Response(html, {
        headers: { ...HTML_HEADERS, 'Cache-Control': 'public, max-age=0, s-maxage=60', 'X-Robots-Tag': 'index, follow' }
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const target = parseTarget(url);
    if (!target) {
      return new Response(notFound(url), { status: 404, headers: HTML_HEADERS });
    }

    const cache = caches.default;
    const key = new Request(origin + p + (url.search || ''));
    const hit = await cache.match(key);
    if (hit) return hit;

    const html = await viewPage(target, url);
    const res = new Response(html, {
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL}`,
        'X-Robots-Tag': 'index, follow, max-image-preview:large, max-snippet:-1'
      }
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
};
