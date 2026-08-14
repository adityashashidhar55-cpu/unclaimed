#!/usr/bin/env node
/**
 * Build verification. Runs in CI after src/build.mjs and fails the build on
 * anything that would ship a broken or dishonest page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');

let failures = 0;
let checks = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => {
  checks += 1;
  console.log(`  ✓ ${msg}`);
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log('\nVerifying build\n');

/* 1. Required files exist */
for (const f of [
  'index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'theme.css',
  'app.js',
  'engine/matcher.js',
  'api/v1/countries.json',
  'api/v1/stats.json',
  'check/index.html',
  'methodology/index.html',
  'countries/index.html',
]) {
  fs.existsSync(path.join(DIST, f)) ? ok(`${f} present`) : fail(`${f} MISSING`);
}

/* 2. Every programme in the data has a page */
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
let expected = 0;
let missing = 0;
for (const entry of manifest.countries) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
  for (const p of data.programmes) {
    expected += 1;
    if (!fs.existsSync(path.join(DIST, entry.slug, p.category, p.slug, 'index.html'))) {
      missing += 1;
      if (missing <= 5) fail(`no page for ${entry.slug}/${p.category}/${p.slug}`);
    }
  }
}
missing === 0 ? ok(`all ${expected} programmes have a page`) : fail(`${missing} programmes have no page`);

/* 3. Stats in the API match the dataset (cross-surface consistency rule) */
const stats = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/stats.json'), 'utf8'));
stats.total === expected ? ok(`stats.json total (${stats.total}) matches dataset`) : fail(`stats.json total ${stats.total} != ${expected}`);

/* 4. The landing page renders the computed totals, not hand-typed ones */
const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const fmt = new Intl.NumberFormat('en').format(stats.total);
home.includes(fmt) ? ok(`landing page shows computed total ${fmt}`) : fail(`landing page does not show ${fmt}`);
home.includes(String(stats.countryCount)) ? ok('landing page shows computed country count') : fail('country count missing from landing page');

/* 5. Programme pages are real HTML, not a JS shell */
const sample = path.join(DIST, manifest.countries[0].slug, 'index.html');
const html = fs.readFileSync(sample, 'utf8');
html.length > 4000 ? ok('country page is server-rendered HTML') : fail('country page suspiciously small — is it a shell?');
html.includes('application/ld+json') ? ok('JSON-LD present in static HTML') : fail('JSON-LD not in static HTML');

/* 6. No unresolved template literals leaked into output */
const pages = walk(DIST).filter((f) => f.endsWith('.html'));
let leaked = 0;
for (const f of pages) {
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes('${') || s.includes('undefined</') || s.includes('>undefined<') || s.includes('[object Object]')) {
    leaked += 1;
    if (leaked <= 5) fail(`template leak or undefined in ${path.relative(DIST, f)}`);
  }
}
leaked === 0 ? ok(`no template leaks across ${pages.length} pages`) : fail(`${leaked} pages contain leaked template output`);

/* 7. Sitemap covers every page */
const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
const locs = (sitemap.match(/<loc>/g) || []).length;
locs >= pages.length - 1 ? ok(`sitemap lists ${locs} URLs`) : fail(`sitemap lists ${locs} but ${pages.length} pages exist`);

/* 8. Every record still carries a source URL (the project's hard rule) */
let noSource = 0;
for (const entry of manifest.countries) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
  for (const p of data.programmes) if (!p.source_url || !/^https?:\/\//.test(p.source_url)) noSource += 1;
}
noSource === 0 ? ok('every record has an http(s) source_url') : fail(`${noSource} records have no valid source_url`);


/* --- Startup grants ------------------------------------------------ */
const sMan = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/startups/index.json'), 'utf8'));
sMan.total === 1684 && sMan.countries.length >= 25 ? ok('startup pool index is published') : fail('startup pool index is published');
sMan.countries.every((c) => fs.existsSync(path.join(DIST, `api/v1/startups/${c.slug}.json`)))
  ? ok('every startup pool has a JSON asset')
  : fail('a startup pool JSON asset is missing');
const sIndex = fs.readFileSync(path.join(DIST, 'startups/index.html'), 'utf8');
sIndex.includes('<h1') && sIndex.includes('funding programmes') ? ok('startup index is server-rendered') : fail('startup index is server-rendered');
sIndex.includes('300,000') ? ok('startup index states the de minimis ceiling') : fail('startup index states the de minimis ceiling');
let sPages = 0;
let sLeaks = 0;
const walkStartups = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walkStartups(f);
    else if (e.name === 'index.html') {
      sPages += 1;
      const html = fs.readFileSync(f, 'utf8');
      if (html.includes('${') || html.includes('[object Object]')) sLeaks += 1;
    }
  }
};
walkStartups(path.join(DIST, 'startups'));
sLeaks === 0 ? ok(`no template leaks across ${sPages} startup pages`) : fail(`no template leaks across ${sPages} startup pages`);
fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8').includes('/startups/') ? ok('startup pages are in the sitemap') : fail('startup pages are in the sitemap');


/* --- The app (PWA) -------------------------------------------------- */
for (const f of ['app/index.html', 'app/app.js', 'app/app.css', 'sw.js', 'manifest.webmanifest', 'icon-192.svg', 'icon-512.svg']) {
  fs.existsSync(path.join(DIST, f)) ? ok(`${f} present`) : fail(`${f} MISSING`);
}
const mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
mf.display === 'standalone' && mf.start_url && mf.icons.length >= 2
  ? ok('web manifest is installable (standalone, start_url, icons)')
  : fail('web manifest would not install');

/* The single check that matters: every module the app imports must resolve
   INSIDE dist. A specifier that is correct in the repo can still escape the
   published tree and 404 in the browser — which is exactly what happened. */
const distReal = fs.realpathSync(DIST);
const walked = new Set();
let escapes = 0;
let absent = 0;
(function walkApp(file) {
  if (walked.has(file)) return;
  walked.add(file);
  if (!fs.existsSync(file)) { absent += 1; return; }
  if (!file.startsWith(distReal + path.sep)) { escapes += 1; return; }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    walkApp(path.resolve(path.dirname(file), m[1]));
  }
})(path.join(distReal, 'app/app.js'));
escapes === 0 ? ok(`app module graph stays inside dist (${walked.size} modules)`) : fail(`${escapes} app imports escape dist and would 404`);
absent === 0 ? ok('every app import exists') : fail(`${absent} app imports are missing`);

const swSrc = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
/addEventListener\(['"]fetch/.test(swSrc) && /caches\.open/.test(swSrc)
  ? ok('service worker caches and serves offline')
  : fail('service worker does not handle fetch');

/* Language switcher, top and bottom. */
const landingHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
landingHtml.includes('lang-select') ? ok('language switcher in the masthead') : fail('no language switcher at top');
landingHtml.includes('class="langbar"') ? ok('language switcher in the footer') : fail('no language switcher at bottom');
landingHtml.includes('class="flow"') ? ok('how-it-works flow is on the landing page') : fail('no how-it-works flow');
fs.existsSync(path.join(DIST, 'enterprise/index.html')) ? ok('enterprise page present') : fail('enterprise page MISSING');


/* Entry motion hides content until JS runs. If it never runs, the page must
   still be readable — a blank landing page is a total failure, and an
   animation is only a nicety. Two independent fallbacks, both asserted. */
landingHtml.includes('<noscript><style>.reveal')
  ? ok('noscript fallback reveals hidden content')
  : fail('no noscript fallback — page would be blank without JS');
landingHtml.includes('Safety net')
  ? ok('timeout fallback reveals content if the observer fails')
  : fail('no timeout fallback for the reveal animation');

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
