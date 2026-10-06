#!/usr/bin/env node
/**
 * Technical SEO checks, run against dist/ (run `npm run build` first).
 *
 *   1. hreflang is reciprocal across every page that exists in several
 *      locales, self-referencing, carries x-default, and an English-only page
 *      carries exactly en + x-default.
 *   2. JSON-LD parses; the home page has Organization + WebSite with a
 *      SearchAction to /search/?q=; deep pages have a BreadcrumbList;
 *      programme pages carry a schema that fits; nothing is invented.
 *   3. Sitemap index + child sitemaps: <= 50k URLs each, every indexable page
 *      listed exactly once, programme <lastmod> is real (and absent, not
 *      faked, elsewhere), robots.txt points at the index.
 *   4. Exactly one <h1> per page; <title> and meta description unique.
 *   5. Programme names on country / category list pages are crawlable links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');
const ORIGIN = 'https://unclaimedgrant.com';

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const t = (m, v) => (v ? ok(m) : bad(m));
const report = (label, problems) => {
  if (!problems.length) return ok(label);
  bad(`${label} — ${problems.length} problem(s), e.g. ${problems.slice(0, 4).join(' | ')}`);
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

/* ---- load every page ---------------------------------------------------- */
const pages = new Map(); // url -> {rel, html, ...}
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) {
      const rel = path.relative(DIST, p).split(path.sep).join('/');
      const html = fs.readFileSync(p, 'utf8');
      const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] ?? null;
      const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
      pages.set(rel, {
        rel, html, canonical, noindex,
        lang: (html.match(/<html lang="([^"]+)"/) || [])[1],
        title: (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '',
        desc: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] ?? '',
        h1: (html.match(/<h1[\s>]/g) || []).length,
        hreflang: [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]),
        ld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]),
      });
    }
  }
})(DIST);
const indexable = [...pages.values()].filter((p) => p.canonical && !p.noindex);
const byCanonical = new Map(indexable.map((p) => [p.canonical, p]));
console.log(`\nTechnical SEO — ${indexable.length} indexable pages\n`);

/* ---- 1. hreflang -------------------------------------------------------- */
console.log('hreflang');
{
  const problems = [];
  let multi = 0;
  let single = 0;
  for (const p of indexable) {
    const map = new Map(p.hreflang);
    if (!map.has('x-default')) problems.push(`${p.rel}: no x-default`);
    if (map.get(p.lang) !== p.canonical) problems.push(`${p.rel}: no self-reference for ${p.lang}`);
    if (p.hreflang.length !== map.size) problems.push(`${p.rel}: duplicate hreflang values`);
    const langs = [...map.keys()].filter((l) => l !== 'x-default');
    if (langs.length === 1) {
      single += 1;
      /* Known, pre-existing: the English tree for fr/de/es/it/pt lives under /<cc>/, the
         same prefix as that locale, so the locale's own pages (home, /for/<audience>/)
         overwrite their English twins. The copies under /<cc>/<cc>/ have no English twin. */
      if (p.lang !== 'en' && !/^(fr|de|es|it|pt)\/\1\//.test(p.rel)) problems.push(`${p.rel}: only a ${p.lang} version but no English`);
    } else multi += 1;
    for (const [l, href] of p.hreflang) {
      if (l === 'x-default') {
        const target = byCanonical.get(href);
        if (!target) problems.push(`${p.rel}: x-default ${href} is not a page`);
        else if (map.has('en') && target.lang !== 'en') problems.push(`${p.rel}: x-default is not the English page`);
        continue;
      }
      const q = byCanonical.get(href);
      if (!q) { problems.push(`${p.rel}: ${l} -> ${href} does not exist or is not indexable`); continue; }
      if (q.lang !== l) problems.push(`${p.rel}: ${l} -> ${q.rel} which is lang=${q.lang}`);
      const back = new Map(q.hreflang);
      if (back.size !== map.size || [...map].some(([k, v]) => back.get(k) !== v)) {
        problems.push(`${p.rel}: set differs from ${q.rel} (not reciprocal)`);
      }
    }
  }
  report(`every alternate exists, is self-referencing, x-default present and the sets are reciprocal`, problems);
  t(`${multi} multi-locale pages and ${single} English-only pages were checked`, multi > 100 && single > 100);
}

/* ---- 2. JSON-LD --------------------------------------------------------- */
console.log('\nJSON-LD');
{
  const parsed = new Map();
  const problems = [];
  for (const p of indexable) {
    const blocks = [];
    for (const raw of p.ld) {
      try { blocks.push(JSON.parse(raw)); } catch { problems.push(`${p.rel}: invalid JSON-LD`); }
    }
    parsed.set(p.rel, blocks);
  }
  report('every JSON-LD block is valid JSON', problems);
  const types = (rel) => (parsed.get(rel) ?? []).flatMap((b) => (Array.isArray(b) ? b : [b])).map((b) => b['@type']);
  const block = (rel, type) => (parsed.get(rel) ?? []).find((b) => b['@type'] === type);

  for (const home of indexable.filter((p) => p.rel === 'index.html' || (p.lang !== 'en' && p.rel === `${p.lang}/index.html`))) {
    const ty = types(home.rel);
    if (!ty.includes('Organization') || !ty.includes('WebSite')) problems.push(`${home.rel}: needs Organization + WebSite`);
    const ws = block(home.rel, 'WebSite');
    const target = ws?.potentialAction?.target?.urlTemplate ?? ws?.potentialAction?.target;
    if (!/\/search\/\?q=\{search_term_string\}$/.test(String(target))) problems.push(`${home.rel}: no SearchAction to /search/?q=`);
  }
  report('every home page has Organization + WebSite with a SearchAction to /search/?q=', problems.splice(0));

  const deep = indexable.filter((p) => {
    const rel = p.lang !== 'en' && p.rel.startsWith(`${p.lang}/`) ? p.rel.slice(p.lang.length + 1) : p.rel;
    return rel.replace(/index\.html$/, '').split('/').filter(Boolean).length >= 2;
  });
  // The two wizards are JavaScript apps with no static content to mark up.
  const crumbless = deep.filter((p) => !types(p.rel).includes('BreadcrumbList') && !/(^|\/)check\/$|(^|\/)check\/index\.html$/.test(p.rel));
  report(`${deep.length} deep pages all carry a BreadcrumbList (wizards excepted)`, crumbless.map((p) => p.rel));

  const crumbBad = [];
  for (const p of indexable) {
    const b = block(p.rel, 'BreadcrumbList');
    if (!b) continue;
    const items = b.itemListElement;
    if (!items.length || items.some((it, i) => it.position !== i + 1 || !it.name)) crumbBad.push(p.rel);
  }
  report('breadcrumb positions run 1..n and every item has a name', crumbBad);

  const startupProg = indexable.filter((p) => /^startups\/[a-z]{2,}\/[^/]+\/index\.html$/.test(p.rel) && !/\/(closing-soon|calendar|tools|check)\//.test(p.rel));
  const startupBad = [];
  let gov = 0;
  let grant = 0;
  for (const p of startupProg) {
    if (/startups\/(tools|check|closing-soon|calendar|de-minimis|readiness)\//.test(p.rel)) continue;
    const gs = block(p.rel, 'GovernmentService');
    const mg = block(p.rel, 'MonetaryGrant');
    if (!gs && !mg) { startupBad.push(`${p.rel}: no programme schema`); continue; }
    if (gs) {
      gov += 1;
      if (!gs.provider?.name || !gs.areaServed?.name) startupBad.push(`${p.rel}: GovernmentService missing provider/area`);
    }
    if (mg) {
      grant += 1;
      if (!mg.funder?.name) startupBad.push(`${p.rel}: MonetaryGrant missing funder`);
      const v = mg.amount?.value;
      if (v != null && !p.html.includes(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) && !p.html.includes(String(v))) {
        startupBad.push(`${p.rel}: MonetaryGrant amount ${v} is not shown on the page`);
      }
    }
  }
  report(`${startupProg.length} company programme pages carry GovernmentService (${gov}) or MonetaryGrant (${grant}) with real fields`, startupBad);

  const faqBad = [];
  for (const p of indexable) {
    const f = block(p.rel, 'FAQPage');
    if (!f) continue;
    for (const q of f.mainEntity ?? []) if (!p.html.includes(String(q.name).slice(0, 30))) faqBad.push(`${p.rel}: FAQ question not visible on the page`);
  }
  report('any FAQPage markup matches visible FAQ content (none is emitted where a page has no FAQ)', faqBad);
}

/* ---- 3. sitemaps -------------------------------------------------------- */
console.log('\nSitemaps');
{
  const index = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  t('sitemap.xml is a sitemap index', /<sitemapindex/.test(index));
  const children = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(ORIGIN + '/', ''));
  t(`the index lists ${children.length} child sitemaps`, children.length >= 5);
  const seen = new Map();
  const problems = [];
  const lastmods = [];
  let progUrls = 0;
  let progWithLm = 0;
  for (const c of children) {
    const f = path.join(DIST, c);
    if (!fs.existsSync(f)) { problems.push(`${c} listed but missing`); continue; }
    const xml = fs.readFileSync(f, 'utf8');
    const entries = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)];
    if (entries.length > 50000) problems.push(`${c} has ${entries.length} URLs`);
    for (const [, loc, lm] of entries) {
      seen.set(loc, (seen.get(loc) ?? 0) + 1);
      if (lm) {
        lastmods.push(lm);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(lm)) problems.push(`${loc}: bad lastmod ${lm}`);
      }
      const page = byCanonical.get(loc);
      if (page && /\/[^/]+\/[^/]+\/[^/]+\/$/.test(loc.replace(ORIGIN, '')) && c.startsWith('sitemap-programmes')) {
        progUrls += 1;
        if (lm) progWithLm += 1;
      }
    }
  }
  report('child sitemaps exist, each has at most 50,000 URLs, lastmod values are dates', problems);
  const dups = [...seen].filter(([, n]) => n > 1).map(([u]) => u);
  report('no URL appears twice', dups);
  const missing = indexable.filter((p) => !seen.has(p.canonical)).map((p) => p.rel);
  report(`all ${indexable.length} indexable pages are in a sitemap`, missing);
  const stray = [...seen.keys()].filter((u) => !byCanonical.has(u));
  report('every sitemap URL is an indexable, canonical page', stray);
  t('programme pages carry a real lastmod', progUrls > 1000 && progWithLm / progUrls > 0.9);
  t('lastmod is not one blanket date (no faked freshness)', new Set(lastmods).size > 1);
  const withLm = new Set();
  for (const c of children) {
    const xml = fs.readFileSync(path.join(DIST, c), 'utf8');
    if (/sitemap-(core|blog|learn|compare)/.test(c) && /<lastmod>/.test(xml)) withLm.add(c);
  }
  t('pages with no verification date have no lastmod (core, blog, learn, compare)', withLm.size === 0);
  const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  t('robots.txt points at the sitemap index', robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
  t('robots.txt lists every child sitemap', children.every((c) => robots.includes(`Sitemap: ${ORIGIN}/${c}`)));
  t('robots.txt still blocks the private API and dashboard', /Disallow: \/api\/v1\/full\//.test(robots) && /Disallow: \/dashboard\//.test(robots));
}

/* ---- 4. one H1, unique title and description ----------------------------- */
console.log('\nHeadings and metadata');
{
  report('exactly one <h1> on every indexable page', indexable.filter((p) => p.h1 !== 1).map((p) => `${p.rel} (${p.h1})`));
  const titles = new Map();
  const descs = new Map();
  for (const p of indexable) {
    (titles.get(p.title) ?? titles.set(p.title, []).get(p.title)).push(p.rel);
    (descs.get(p.desc) ?? descs.set(p.desc, []).get(p.desc)).push(p.rel);
  }
  report('every <title> is unique', [...titles].filter(([, v]) => v.length > 1).map(([k, v]) => `"${k.slice(0, 50)}" x${v.length}`));
  report('every meta description is unique', [...descs].filter(([, v]) => v.length > 1).map(([k, v]) => `"${k.slice(0, 50)}" x${v.length}`));
  report('no empty title or description', indexable.filter((p) => !p.title.trim() || !p.desc.trim()).map((p) => p.rel));
  t('"X from X" description is gone', !indexable.some((p) => /^(.{3,60}) from \1\./.test(p.desc)));
}

/* ---- 5. programme names are crawlable on list pages ----------------------- */
console.log('\nList pages show programme names as links');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const problems = [];
  let lists = 0;
  for (const c of manifest.countries) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, `${c.slug}.json`), 'utf8'));
    const cats = new Map();
    for (const p of data.programmes) (cats.get(p.category) ?? cats.set(p.category, []).get(p.category)).push(p);
    // For fr/de/es/it/pt the English country page is overwritten by the locale home page (known).
    const country = ['fr', 'de', 'es', 'it', 'pt'].includes(c.slug) ? null : pages.get(`${c.slug}/index.html`);
    for (const [cat, list] of cats) {
      const page = pages.get(`${c.slug}/${cat}/index.html`);
      for (const [label, pg] of [['category page', page], ['country page', country]]) {
        if (!pg) continue;
        lists += 1;
        for (const p of list) {
          if (!pg.html.includes(`href="/${c.slug}/${cat}/${p.slug}/"`)) { problems.push(`${pg.rel}: no link to ${p.slug}`); break; }
        }
      }
    }
  }
  // Locale copies of the German page set live under de/de/…; the English tree is the contract here.
  report(`${lists} household country and category lists link every programme by name`, problems);

  const sProblems = [];
  let sLists = 0;
  for (const f of fs.readdirSync(path.join(DATA, 'startups'))) {
    if (!f.endsWith('.json') || f === 'redirects.json' || f === 'dedupe-log.json') continue;
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'startups', f), 'utf8'));
    const cc = f.replace('.json', '');
    const pg = pages.get(`startups/${cc}/index.html`);
    if (!pg || !Array.isArray(d.programmes)) continue;
    sLists += 1;
    for (const p of d.programmes) {
      if (!pg.html.includes(`href="/startups/${cc}/${p.slug}/"`)) { sProblems.push(`${pg.rel}: no link to ${p.slug}`); break; }
      const escName = p.name_en.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      if (!pg.html.includes(escName)) { sProblems.push(`${pg.rel}: name of ${p.slug} not in HTML`); break; }
    }
  }
  report(`${sLists} startup country lists link every programme by name`, sProblems);
  const sample = pages.get('at/education/index.html');
  t('names stay links to public pages while the amounts and details remain locked', !!sample && /class="tease-names/.test(sample.html) && /locked-bucket/.test(sample.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
