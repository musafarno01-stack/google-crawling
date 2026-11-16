/**
 * Remote Job Crawler — edge router + SEO renderer
 * Fixes: missing API entry point, blank iframe, thin content, no robots/sitemap.
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
const strip = (html) => String(html || '')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

function fill(tpl, map) {
  return tpl.replace(/\{\{([A-Z0-9]+)\}\}/g, (_, k) => (map[k] == null ? '' : map[k]));
}

/* ---------------- crawl sources ---------------- */

async function fromRemotive(q, limit) {
  const u = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=${Math.min(limit * 2, 60)}`;
  const r = await fetch(u, {
    headers: { Accept: 'application/json', 'User-Agent': `RemoteJobCrawler/${BUILD}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`remotive ${r.status}`);
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
  if (!r.ok) throw new Error(`arbeitnow ${r.status}`);
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
  return { jobs: jobs.slice(0, n), source: sources.join(' + ') || 'none', query: q, fetchedAt: new Date().toISOString() };
}

/* ---------------- JSON-LD ---------------- */

function jobListLd(jobs, q, origin, fetchedAt) {
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

/* ---------------- HTML rendering ---------------- */

let tplCache = { html: null, at: 0 };

async function template(env, origin) {
  if (tplCache.html && Date.now() - tplCache.at < 60000) return tplCache.html;
  const res = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  const html = await res.text();
  tplCache = { html, at: Date.now() };
  return html;
}

async function render(request, env, ctx) {
  const url = new URL(request.url);
  const origin = url.origin;
  const raw = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const q = (raw ? raw.replace(/-/g, ' ') : DEFAULT_Q).toLowerCase();
  const isHome = !raw;
  const label = titleCase(q);

  const { jobs, source, fetchedAt } = await crawl(q, 15).catch(() => ({ jobs: [], source: 'none', fetchedAt: '' }));

  const canonical = isHome ? `${origin}/` : `${origin}/?q=${encodeURIComponent(raw)}`;
  const title = isHome
    ? 'Remote Job Crawler — Live Remote Tech Jobs at the Edge'
    : `${label} Remote Jobs — ${jobs.length || 'Live'} Open Listings | Remote Job Crawler`;
  const desc = isHome
    ? 'Free live remote job crawler. Search real, currently-open remote jobs for developers, designers, DevOps and writers, pulled in real time from Remotive and Arbeitnow. No signup, no keys.'
    : `${jobs.length} live remote ${q} jobs, fetched in real time from Remotive and Arbeitnow. Updated on every request, free, no signup. Apply on the original board.`;

  const jobHtml = jobs.length
    ? `<ul class="jobs">${jobs.map((j) => `<li>
        <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        <span class="jmeta">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''}${j.source ? ` · ${esc(j.source)}` : ''}</span>
      </li>`).join('')}</ul>`
    : `<p class="empty">No live listings matched <strong>${esc(q)}</strong> right now. <a href="/">Reset search</a> or try a broader term.</p>`;

  const html = fill(await template(env, origin), {
    TITLE: esc(title),
    DESC: esc(desc),
    CANON: esc(canonical),
    OGURL: esc(canonical),
    APPURL: isHome ? '/app' : `/app?q=${encodeURIComponent(raw)}`,
    H1: isHome ? 'Remote Job Crawler' : `${esc(label)} remote jobs`,
    QLABEL: esc(q),
    COUNT: String(jobs.length),
    SOURCE: esc(source),
    JOBS: jobHtml,
    JOBLD: jobListLd(jobs, q, origin, fetchedAt),
    CRUMB: isHome ? '' : `<li><a href="/">Home</a></li><li aria-current="page">${esc(label)}</li>`,
    BUILD,
    YEAR: String(new Date().getUTCFullYear())
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

/* ---------------- robots + sitemap ---------------- */

function robots(origin) {
  return `User-agent: *
Allow: /
Disallow: /api/

User-agent: AdsBot-Google
Allow: /

User-agent: Mediapartners-Google
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}

function sitemap(origin) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `<url><loc>${origin}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...QUERIES.map((q) => `<url><loc>${origin}/?q=${q}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;
}

/* ---------------- router ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const origin = url.origin;

    if (pathname === '/api/crawl') {
      const q = (url.searchParams.get('q') || DEFAULT_Q).trim();
      try {
        const data = await crawl(q, url.searchParams.get('limit') || 15);
        return Response.json(
          { success: true, build: BUILD, query: q, count: data.jobs.length, source: data.source, fetchedAt: data.fetchedAt, jobs: data.jobs },
          { headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } }
        );
      } catch (e) {
        return Response.json({ success: false, build: BUILD, error: e.message || 'crawl failed' }, { status: 502 });
      }
    }

    if (pathname === '/api/health') {
      return Response.json({ success: true, build: BUILD, status: 'ok', sources: ['remotive', 'arbeitnow'], time: new Date().toISOString() });
    }

    if (pathname === '/robots.txt') {
      return new Response(robots(origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (pathname === '/sitemap.xml') {
      return new Response(sitemap(origin), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (pathname === '/' || pathname === '/index.html') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const cache = caches.default;
      const key = new Request(`${origin}/?q=${encodeURIComponent(url.searchParams.get('q') || '')}`, { method: 'GET' });
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await render(request, env, ctx);
      if (res.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    return env.ASSETS.fetch(request);
  }
};
