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
    /* Strip the cache-busting query before resolving. The build stamps ?v= on
       every first-party import inside a JS file — without it the service
       worker pinned an old matcher in every returning browser — and the file
       on disk of course has no query in its name. */
    walkApp(path.resolve(path.dirname(file), m[1].split('?')[0]));
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
/* The four numbered steps. Checks the step count too, not just the container —
   an empty .steps4 div would have passed the old class-name-only assertion. */
{
  const steps = (landingHtml.match(/class="step4"/g) || []).length;
  steps === 4
    ? ok('how-it-works shows four numbered steps')
    : fail(`how-it-works has ${steps} steps, expected 4`);
}
landingHtml.includes('class="orbit') ? ok('hero orbit graphic present') : fail('no hero orbit graphic');
landingHtml.includes('hero-centre') ? ok('hero text is centred') : fail('hero is not centred');
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


/* Raster icons. Safari ignores an SVG apple-touch-icon, so an SVG-only icon
   set means every iPhone home-screen install gets a page screenshot instead of
   a logo — a failure nobody reports because it looks like it worked. */
for (const s of [180, 192, 512]) {
  const f = path.join(DIST, `icon-${s}.png`);
  if (!fs.existsSync(f)) { fail(`icon-${s}.png missing`); continue; }
  const b = fs.readFileSync(f);
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = b.readUInt32BE(16);
  sig && w === s ? ok(`icon-${s}.png is a ${s}px PNG`) : fail(`icon-${s}.png is not a valid ${s}px PNG`);
}
landingHtml.includes('icon-180.png') ? ok('apple-touch-icon points at a PNG') : fail('apple-touch-icon is not a PNG');

/* The company wizard has its own URL. It is linked from the startups index, so
   if it stops being generated that link dies silently. */
fs.existsSync(path.join(DIST, 'startups/check/index.html'))
  ? ok('company check page present')
  : fail('/startups/check/ MISSING');


/* The workspace. The enterprise page now links to it as the product, so a
   build that ships the page without the app is a broken promise, not a
   missing nicety. */
for (const f of ['dashboard/index.html', 'dashboard/dashboard.js', 'dashboard/dashboard.css',
                 'packages/stateaid/index.js', 'packages/registry/index.js', 'packages/vault/index.js']) {
  fs.existsSync(path.join(DIST, f)) ? ok(`${f} present`) : fail(`${f} MISSING`);
}
{
  /* The dashboard sits one directory deep so its ../packages/ and ../engine/
     specifiers resolve. Assert every relative import actually exists, because
     a module that 404s leaves a blank page and no error the visitor can see. */
  const js = fs.readFileSync(path.join(DIST, 'dashboard/dashboard.js'), 'utf8');
  let bad = 0;
  for (const m of js.matchAll(/from '(\.[^']+)'/g)) {
    const target = path.resolve(path.join(DIST, 'dashboard'), m[1].split('?')[0]);
    if (!fs.existsSync(target)) { fail(`dashboard imports ${m[1]}, which was not emitted`); bad += 1; }
  }
  if (!bad) ok('every dashboard import resolves in dist');
}

/* The headline splitter. The whole document is a template literal, so a
   single-escaped \s silently became the letter s and shipped headlines like
   "One work pace for every company you upport." Assert the emitted regex. */
landingHtml.includes(String.raw`split(/\s+/)`)
  ? ok('blur-word splitter emits a real \\s regex')
  : fail('blur-word splitter lost its backslash — headlines will split on the letter s');

/* Every workspace tab the enterprise page promises has to exist. This list is
   the promise; the check is that the code kept it. */
{
  const js = fs.readFileSync(path.join(DIST, 'dashboard/dashboard.js'), 'utf8');
  for (const tab of ['projects', 'applications', 'documents', 'postaward', 'stateaid', 'reports']) {
    js.includes(`  ${tab}: `) || js.includes(`${tab}View`)
      ? ok(`workspace has a ${tab} view`)
      : fail(`workspace is missing the ${tab} view`);
  }
}

/* The pricing page's free tier must say what it excludes. Selling "free" and
   leaving the limits to be discovered after a questionnaire is the thing this
   rewrite existed to stop. */
{
  const pricing = fs.readFileSync(path.join(DIST, 'pricing/index.html'), 'utf8');
  pricing.includes('ticks--no') ? ok('free tier lists what it excludes') : fail('free tier has no exclusions list');
  /* The switch is now one control on every page, not a pair of radios per
     page. Three things have to be true or it silently stops working:
     the control exists in the hero, the runtime that persists the choice is
     loaded, and the pre-paint boot script sets the attribute the CSS keys on.
     Miss the third and the site flashes the wrong audience on every load. */
  const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  for (const [label, html] of [['landing', home], ['pricing', pricing]]) {
    html.includes('data-aud-set="me"') && html.includes('data-aud-set="biz"')
      ? ok(`${label} carries the individual/company switch`)
      : fail(`${label} has no audience switch`);
    html.includes("setAttribute('data-audience'")
      ? ok(`${label} sets the audience before first paint`)
      : fail(`${label} would flash the wrong audience`);
    html.includes('audience.js')
      ? ok(`${label} loads the audience runtime`)
      : fail(`${label} switch would not persist`);
  }
  /* Both halves must actually be present, or the switch flips to nothing. */
  home.includes('aud-me') && home.includes('aud-biz')
    ? ok('landing ships both audiences')
    : fail('landing is missing one audience');
  /Android and iOS app/.test(pricing) ? ok('pricing states the apps are included') : fail('pricing does not mention the apps');
}

/* The blog is the SEO surface now that the directory is paid, so an empty or
   missing blog is a strategy failure, not a cosmetic one. And each post must
   declare itself free — the opposite of the programme pages. */
{
  const idx = path.join(DIST, 'blog/index.html');
  if (!fs.existsSync(idx)) fail('/blog/ MISSING');
  else {
    const dirs = fs.readdirSync(path.join(DIST, 'blog'), { withFileTypes: true }).filter((e) => e.isDirectory());
    dirs.length >= 3 ? ok(`blog has ${dirs.length} posts`) : fail(`blog has only ${dirs.length} posts`);
    let free = 0;
    for (const d of dirs) {
      const html = fs.readFileSync(path.join(DIST, 'blog', d.name, 'index.html'), 'utf8');
      if (html.includes('"isAccessibleForFree":true')) free += 1;
    }
    free === dirs.length ? ok('every post declares itself free to read') : fail(`${dirs.length - free} posts do not declare isAccessibleForFree`);
  }
}

/* .shell-narrow is used by methodology, privacy and every post. It was used
   for months without being defined, so all three ran edge to edge. */
fs.readFileSync(path.join(DIST, 'theme.css'), 'utf8').includes('.shell-narrow')
  ? ok('.shell-narrow is defined')
  : fail('.shell-narrow is used but never defined — those pages will run full-bleed');

/* The language switcher must offer every locale, and a localised page must
   declare its own lang attribute — a French page claiming lang="en" is read
   aloud in an English voice by every screen reader. */
{
  const fr = path.join(DIST, 'fr/index.html');
  if (!fs.existsSync(fr)) fail('/fr/ MISSING');
  else {
    const html = fs.readFileSync(fr, 'utf8');
    html.includes('<html lang="fr">') ? ok('localised pages declare their own lang') : fail('/fr/ does not declare lang="fr"');
    html.includes('hreflang="fr"') ? ok('hreflang alternates are emitted') : fail('no hreflang alternates');
  }
}

/* One theme-color, not two. A duplicate meta is a coin toss in some browsers. */
{
  const n = (landingHtml.match(/name="theme-color"/g) || []).length;
  n === 1 ? ok('exactly one theme-color meta') : fail(`${n} theme-color metas`);
}

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
