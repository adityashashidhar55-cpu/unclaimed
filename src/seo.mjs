/**
 * Technical-SEO finishing pass, run once after every page has been written.
 *
 * Why a post-pass rather than markup in each template: hreflang is a property
 * of the whole page SET (every alternate must point back), so the only place
 * that can know which locale versions exist is after all of them are written.
 * Hand-maintaining that per template is how /blog/ posts, /pricing/ children
 * and most of the site ended up with none, or with links to pages that were
 * never generated.
 *
 * This pass:
 *   1. replaces every hreflang link with a reciprocal set (each locale that
 *      actually exists + x-default; English-only pages get en + x-default),
 *   2. adds a BreadcrumbList from the visible breadcrumb where a template did
 *      not emit one,
 *   3. makes <title> and meta description unique across the site (a locale
 *      copy of a page that shares its English twin's text gets the language
 *      name appended; nothing is touched unless it actually collides),
 *   4. writes a sitemap index with one child sitemap per section, with a real
 *      <lastmod> only where a record carries a verification date.
 *
 * Nothing here invents data: a page with no date gets no <lastmod>.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_URLS = 45000; // protocol cap is 50k; leave headroom

const unesc = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function finalizeSeo({ OUT, PAGE_LANG, SITE_URL, ORIGIN, LANGS, LOCALES, countries, STARTUP_DATA, write }) {
  const urlOf = (rel) => `${SITE_URL}/${rel.replace(/index\.html$/, '')}`;
  const logicalOf = (rel, lang) => (lang !== 'en' && rel.startsWith(`${lang}/`) ? rel.slice(lang.length + 1) : rel);
  const order = new Map(LANGS.map((l, i) => [l, i]));

  /* ---- pass 1: read heads ------------------------------------------- */
  const info = new Map(); // rel -> {lang, logical, canonical, title, desc, html}
  for (const [rel, lang] of PAGE_LANG) {
    if (!rel.endsWith('.html')) continue;
    const file = path.join(OUT, rel);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (/<meta name="robots" content="[^"]*noindex/.test(html)) continue;
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (!canonical) continue;
    info.set(rel, {
      lang,
      logical: logicalOf(rel, lang),
      canonical,
      title: (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '',
      desc: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] ?? '',
    });
  }

  /* ---- hreflang groups ----------------------------------------------- */
  const groups = new Map(); // logical -> Map(lang -> rel)
  for (const [rel, i] of info) {
    if (!groups.has(i.logical)) groups.set(i.logical, new Map());
    groups.get(i.logical).set(i.lang, rel);
  }

  /* ---- unique title / description ------------------------------------ */
  const byTitle = new Map();
  const byDesc = new Map();
  for (const [rel, i] of info) {
    (byTitle.get(`${i.title}`) ?? byTitle.set(i.title, []).get(i.title)).push(rel);
    (byDesc.get(`${i.desc}`) ?? byDesc.set(i.desc, []).get(i.desc)).push(rel);
  }
  const newTitle = new Map();
  const newDesc = new Map();
  for (const rels of byTitle.values()) {
    if (rels.length < 2) continue;
    for (const rel of rels) {
      const i = info.get(rel);
      if (i.lang === 'en') continue;
      newTitle.set(rel, i.title.replace(/( · Unclaimed)?$/, ` (${xmlEsc(LOCALES[i.lang].native)})$1`));
    }
  }
  for (const rels of byDesc.values()) {
    if (rels.length < 2) continue;
    for (const rel of rels) {
      const i = info.get(rel);
      if (i.lang === 'en') continue;
      newDesc.set(rel, `${i.desc} (${xmlEsc(LOCALES[i.lang].native)})`);
    }
  }

  /* ---- pass 2: rewrite ------------------------------------------------ */
  let crumbsAdded = 0;
  for (const [rel, i] of info) {
    const file = path.join(OUT, rel);
    let html = fs.readFileSync(file, 'utf8');

    // hreflang
    html = html.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/g, '');
    const g = groups.get(i.logical);
    const langs = [...g.keys()].sort((a, b) => order.get(a) - order.get(b));
    const links = langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${urlOf(g.get(l))}">`);
    const xdef = g.get('en') ?? g.get(langs[0]);
    links.push(`<link rel="alternate" hreflang="x-default" href="${urlOf(xdef)}">`);
    html = html.replace('</head>', `${links.join('\n')}\n</head>`);

    // titles and descriptions
    if (newTitle.has(rel)) {
      const t = newTitle.get(rel);
      html = html
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
        .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${t.replace(/"/g, '&quot;')}"`);
    }
    if (newDesc.has(rel)) {
      const d = newDesc.get(rel);
      html = html
        .replace(/(<meta name="description" content=")[^"]*"/, `$1${d}"`)
        .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${d}"`);
    }

    // BreadcrumbList from the visible breadcrumb, when the template emitted none
    if (!html.includes('"BreadcrumbList"')) {
      const nav = html.match(/<nav class="breadcrumb"[^>]*>([\s\S]*?)<\/nav>/);
      if (nav) {
        const items = [];
        for (const m of nav[1].matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<span(?![^>]*id="acct-crumb-in")[^>]*>([\s\S]*?)<\/span>/g)) {
          const name = unesc(m[2] ?? m[3] ?? '');
          if (!name) continue;
          const href = m[1];
          items.push({ name, item: href ? (href.startsWith('/') ? `${ORIGIN}${href}` : href) : undefined });
        }
        if (items.length >= 2) {
          const ld = {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: items.map((it, n) => ({ '@type': 'ListItem', position: n + 1, name: it.name, item: it.item })),
          };
          html = html.replace(
            '</head>',
            `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`,
          );
          crumbsAdded++;
        }
      }
    }
    fs.writeFileSync(file, html);
  }

  /* ---- sitemaps -------------------------------------------------------- */
  const ccs = new Set(countries.map((c) => c.entry.slug));
  const lastmod = new Map(); // logical rel -> ISO date
  for (const { entry, data } of countries) {
    for (const p of data.programmes) {
      if (p.last_verified_at) lastmod.set(`${entry.slug}/${p.category}/${p.slug}/index.html`, String(p.last_verified_at).slice(0, 10));
    }
  }
  for (const [cc, d] of Object.entries(STARTUP_DATA)) {
    for (const p of d.programmes) {
      if (p.last_verified_at) lastmod.set(`startups/${cc}/${p.slug}/index.html`, String(p.last_verified_at).slice(0, 10));
    }
  }

  const sectionOf = (i) => {
    const seg = i.logical.split('/')[0];
    if (seg === 'startups') return 'startups';
    if (seg === 'funders') return 'funders';
    if (seg === 'learn') return 'learn';
    if (seg === 'compare') return 'compare';
    if (seg === 'blog') return 'blog';
    if (ccs.has(seg)) return `programmes-${i.lang}`;
    return 'core';
  };
  const sections = new Map();
  for (const [rel, i] of info) {
    const sec = sectionOf(i);
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec).push({ loc: i.canonical, lm: lastmod.get(i.logical) ?? null });
  }

  const files = [];
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
  for (const [sec, entries] of [...sections].sort(([a], [b]) => a.localeCompare(b))) {
    entries.sort((a, b) => (a.loc < b.loc ? -1 : 1));
    for (let off = 0, n = 1; off < entries.length; off += MAX_URLS, n++) {
      const chunk = entries.slice(off, off + MAX_URLS);
      const name = `sitemap-${sec}${entries.length > MAX_URLS ? `-${n}` : ''}.xml`;
      write(
        name,
        `${header}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${chunk
          .map((e) => `  <url><loc>${xmlEsc(e.loc)}</loc>${e.lm ? `<lastmod>${e.lm}</lastmod>` : ''}</url>`)
          .join('\n')}\n</urlset>\n`,
      );
      const maxLm = chunk.reduce((m, e) => (e.lm && e.lm > m ? e.lm : m), '');
      files.push({ name, count: chunk.length, lm: maxLm || null });
    }
  }
  write(
    'sitemap.xml',
    `${header}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
      .map((f) => `  <sitemap><loc>${SITE_URL}/${f.name}</loc>${f.lm ? `<lastmod>${f.lm}</lastmod>` : ''}</sitemap>`)
      .join('\n')}\n</sitemapindex>\n`,
  );
  return { sitemapFiles: files.map((f) => f.name), urls: [...sections.values()].reduce((a, b) => a + b.length, 0), crumbsAdded };
}
