/**
 * Remote Job Crawler — edge router + SEO renderer.
 * Serves: / (server-patched HTML), /app, /api/*, /robots.txt, /sitemap.xml.
 */

const BUILD = '2.0.0';
const DEFAULT_Q = 'software engineer';
const CACHE_TTL = 300;
const MAX_LIMIT = 50;

const QUERIES = [
  'react', 'node', 'python', 'javascript', 'typescript', 'devops', 'kubernetes',
  'aws', 'data-engineer', 'machine-learning', 'ai', 'golang', 'rust', 'php',
  'laravel', 'wordpress', 'designer', 'ui-ux', 'product-manager', 'qa',
  'technical-writer', 'customer-support', 'marketing', 'sales', 'finance'
];

const EMP = {
  full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR',
  freelance: 'CONTRACTOR', internship: 'INTERN', temporary: 'TEMPORARY'
};

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const strip = (h) => String(h || '')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/* ---------- sources ---------- */

async function fromRemotive(q, limit) {
  const u = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=${Math.min(limit * 2, 60)}`;
  const r = await fetch(u, {
    headers: { Accept: 'application/json', 'User-Agent': `RemoteJobCrawler/${BUILD}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('remotive ' + r.status);
  const d = await r.json();
  return (d.jobs || []).map((j) => ({
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || 'Worldwide',
    salary: j.salary || '',
    jobType: j.job_type || '',
    category: j.category || '',
    snippet: strip(j.description).slice(0, 220),
    source: 'Remotive',
    url: j.url,
    postedAt: j.publication_date || ''
  }));
}

async function fromArbeitnow(q, limit) {
  const r = await fetch('https://www.arbeitnow.com/api/job-board-api', {
    headers: { Accept: 'application/json', 'User-Agent': `RemoteJobCrawler/${BUILD}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('arbeitnow ' + r.status);
  const d = await r.json();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (d.data || [])
    .filter((j) => {
      const hay = `${j.title} ${(j.tags || []).join(' ')} ${strip(j.description)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit)
    .map((j) => ({
      title: j.title,
      company: j.company_name,
      location: j.location || (j.remote ? 'Remote' : 'Worldwide'),
      salary: j.salary || '',
      jobType: (j.job_types || [])[0] || '',
      category: (j.tags || [])[0] || '',
      snippet: strip(j.description).slice(0, 220),
      source: 'Arbeitnow',
      url: j.url,
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : ''
    }));
}

async function crawl(q, limit) {
  const n = Math.max(1, Math.min(Number(limit) || 15, MAX_LIMIT));
  const settled = await Promise.allSettled([fromRemotive(q, n), fromArbeitnow(q, n)]);
  const seen = new Set();
  const jobs = [];
  const sources = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const j of s.value) {
      if (!j.url || seen.has(j.url)) continue;
      seen.add(j.url);
      jobs.push(j);
    }
    if (s.value.length) sources.push(s.value[0].source);
  }
  return { jobs: jobs.slice(0, n), source: sources.join(' + ') || 'live feeds', fetchedAt: new Date().toISOString() };
}

/* ---------- structured data ---------- */

function jobListLd(jobs, q, fetchedAt) {
  if (!jobs.length) return '{}';
  const posted = (fetchedAt || new Date().toISOString()).slice(0, 10);
  const valid = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const itemListElement = jobs.slice(0, 20).map((j, i) => {
    let desc = (j.snippet || '').trim();
    if (desc.length < 60) desc = `${j.title} at ${j.company || 'a remote-first company'}. ${desc}`.trim();
    const job = {
      '@type': 'JobPosting',
      title: j.title || 'Remote role',
      description: `<p>${esc(desc)}</p>`,
      datePosted: posted,
      validThrough: valid,
      employmentType: EMP[j.jobType] || 'FULL_TIME',
      directApply: false,
      url: j.url,
      hiringOrganization: { '@type': 'Organization', name: j.company || 'Remote employer' },
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'Country', name: j.location || 'Worldwide' }
    };
    if (j.category) job.occupationalCategory = j.category;
    if (j.salary) job.estimatedSalary = {
      '@type': 'MonetaryAmountDistribution', name: 'base', currency: 'USD', duration: 'P1Y', description: j.salary
    };
    return { '@type': 'ListItem', position: i + 1, item: job };
  });
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Remote jobs for "${q}"`,
    numberOfItems: itemListElement.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement
  });
}

/* ---------- markup patching (function replacement so "$" stays literal) ---------- */

const sub = (html, re, val) => html.replace(re, (m, a, b) => a + val + b);

function patch(html, m) {
  html = sub(html, /<title>[\s\S]*?<\/title>/, `<title>${m.title}</title>`);
  html = sub(html, /(<meta name="description" content=")[^"]*(")/, m.desc);
  html = sub(html, /(<link rel="canonical" href=")[^"]*(")/, m.canon);
  html = sub(html, /(<meta property="og:url" content=")[^"]*(")/, m.canon);
  html = sub(html, /(<meta property="og:title" content=")[^"]*(")/, m.title);
  html = sub(html, /(<meta property="og:description" content=")[^"]*(")/, m.desc);
  html = sub(html, /(<meta name="twitter:title" content=")[^"]*(")/, m.title);
  html = sub(html, /(<meta name="twitter:description" content=")[^"]*(")/, m.desc);
  html = sub(html, /(<iframe id="viewer" src=")[^"]*(")/, m.app);
  html = sub(html, /(<h1 id="page-h1">)[\s\S]*?(<\/h1>)/, m.h1);
  html = sub(html, /(<ol class="crumbs" id="crumbs">)[\s\S]*?(<\/ol>)/, m.crumbs);
  html = sub(html, /(<span id="qlabel">)[\s\S]*?(<\/span>)/, m.qlabel);
  html = sub(html, /(<span id="count">)[\s\S]*?(<\/span>)/, m.count);
  html = sub(html, /(<span id="source">)[\s\S]*?(<\/span>)/, m.source);
  html = sub(html, /(<ul class="jobs" id="jobs">)[\s\S]*?(<\/ul>)/, m.jobs);
  html = sub(html, /(<script type="application\/ld\+json" id="joblist-ld">)[\s\S]*?(<\/script>)/, m.ld);
  html = sub(html, /(<span id="build">)[\s\S]*?(<\/span>)/, BUILD);
  html = sub(html, /(<span id="year">)[\s\S]*?(<\/span>)/, String(new Date().getUTCFullYear()));
  return html;
}

/* ---------- render ---------- */

let tpl = { html: null, at: 0 };

async function template(env, origin) {
  if (tpl.html && Date.now() - tpl.at < 60000) return tpl.html;
  const res = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  tpl = { html: await res.text(), at: Date.now() };
  return tpl.html;
}

async function render(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const raw = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const q = (raw ? raw.replace(/-/g, ' ') : DEFAULT_Q).toLowerCase();
  const home = !raw;
  const label = titleCase(q);

  const { jobs, source, fetchedAt } = await crawl(q, 15).catch(() => ({ jobs: [], source: 'live feeds', fetchedAt: '' }));

  const canon = home ? `${origin}/` : `${origin}/?q=${encodeURIComponent(raw)}`;
  const title = esc(home
    ? 'Remote Job Crawler — Live Remote Tech Jobs at the Edge'
    : `${label} Remote Jobs — ${jobs.length || 'Live'} Open Listings | Remote Job Crawler`);
  const desc = esc(home
    ? 'Free live remote job crawler. Search real, currently-open remote jobs for developers, designers, DevOps and writers, pulled in real time from Remotive and Arbeitnow. No signup, no keys.'
    : `${jobs.length} live remote ${q} jobs, fetched in real time from Remotive and Arbeitnow. Free, no signup, updated on every request. Apply on the original board.`);

  const jobsHtml = jobs.length
    ? jobs.map((j) => `<li><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a><span class="jmeta">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''}${j.source ? ` · ${esc(j.source)}` : ''}</span></li>`).join('')
    : `<li class="empty">No live listings matched <strong>${esc(q)}</strong> right now. <a href="/">Reset search</a> or try a broader term.</li>`;

  const html = patch(await template(env, origin), {
    title,
    desc,
    canon: esc(canon),
    app: home ? '/app' : `/app?q=${encodeURIComponent(raw)}`,
    h1: home ? 'Remote Job Crawler' : `${esc(label)} remote jobs`,
    crumbs: home ? '<li><a href="/">Home</a></li>' : `<li><a href="/">Home</a></li><li aria-current="page">${esc(label)}</li>`,
    qlabel: esc(q),
    count: String(jobs.length),
    source: esc(source),
    jobs: jobsHtml,
    ld: jobListLd(jobs, q, fetchedAt)
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL}`,
      'X-Robots-Tag': 'index, follow, max-image-preview:large, max-snippet:-1',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/* ---------- robots / sitemap ---------- */

const robots = (o) => `User-agent: *
Allow: /
Disallow: /api/

User-agent: AdsBot-Google
Allow: /

User-agent: Mediapartners-Google
Allow: /

Sitemap: ${o}/sitemap.xml
`;

function sitemap(o) {
  const d = new Date().toISOString().slice(0, 10);
  const rows = [
    `<url><loc>${o}/</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...QUERIES.map((q) => `<url><loc>${o}/?q=${q}</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${rows}\n</urlset>`;
}

/* ---------- router ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin = url.origin;

    if (p === '/api/crawl') {
      const q = (url.searchParams.get('q') || DEFAULT_Q).trim();
      try {
        const d = await crawl(q, url.searchParams.get('limit') || 15);
        return Response.json(
          { success: true, build: BUILD, query: q, count: d.jobs.length, source: d.source, fetchedAt: d.fetchedAt, jobs: d.jobs },
          { headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } }
        );
      } catch (e) {
        return Response.json({ success: false, build: BUILD, error: e.message || 'crawl failed' }, { status: 502 });
      }
    }

    if (p === '/api/health') {
      return Response.json({ success: true, build: BUILD, status: 'ok', sources: ['remotive', 'arbeitnow'], time: new Date().toISOString() });
    }

    if (p === '/robots.txt') {
      return new Response(robots(origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/sitemap.xml') {
      return new Response(sitemap(origin), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (p === '/' || p === '/index.html') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const cache = caches.default;
      const key = new Request(`${origin}/?q=${encodeURIComponent(url.searchParams.get('q') || '')}`, { method: 'GET' });
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await render(request, env);
      if (res.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    return env.ASSETS.fetch(request);
  }
};
