#!/usr/bin/env node
/**
 * Build verification. Runs in CI after src/build.mjs and fails the build on
 * anything that would ship a broken or dishonest page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testProgramme } from '../src/engine/startup.js';

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

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/*                                                                     */
/* Several assertions below used to test for a substring of the built   */
/* HTML. Every one of them passed on a div with no CSS rule, a link     */
/* that 404s, or an empty container — this repo's standing failure      */
/* mode. These helpers are what a property assertion needs instead: the */
/* stylesheet, the locale list, and a way to ask whether an href points */
/* at a file that actually exists in the published tree.               */
/* ------------------------------------------------------------------ */

const themeCss = fs.readFileSync(path.join(DIST, 'theme.css'), 'utf8');
const LOCALE_CODES = Object.keys((await import(path.join(ROOT, 'src/i18n.mjs'))).LOCALES);

/** Does this site-absolute href resolve to a real file under dist/? */
function resolvesInDist(href) {
  if (!href) return true;
  /* The footer language links are absolute on our own origin (hreflang wants a
     canonical URL), so strip the origin rather than waving them through as
     "external" — an absolute link to a page we do not publish is still dead. */
  const own = href.match(/^https?:\/\/(?:www\.)?unclaimedgrant\.com(\/.*)?$/i);
  if (own) href = own[1] || '/';
  else if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return true;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return true;
  const target = path.join(DIST, clean.replace(/^\/+/, ''));
  return fs.existsSync(target) || fs.existsSync(path.join(target, 'index.html'));
}

/**
 * Walk an HTML string and hand back every anchor with the class names of its
 * ancestors. No parser is available here (zero dependencies is the rule), so
 * this is a tag scanner with a stack — enough to answer "is this link inside
 * something marked aud-me", which is the only structural question asked.
 */
function anchorsWithAncestry(html) {
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|path|circle|rect|use|polygon|line|stop)$/i;
  const stack = [];
  const out = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tagRaw, attrs, selfClose] = m;
    const tag = tagRaw.toLowerCase();
    if (close) {
      for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    const href = (attrs.match(/href="([^"]*)"/) || [])[1];
    if (href) out.push({ href, chain: `${stack.map((x) => x.cls).join(' ')} ${cls}`, stack: stack.map((x) => x.tag) });
    if (!selfClose && !VOID.test(tag)) stack.push({ tag, cls });
  }
  return out;
}


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
{
  /* "Server-rendered" means a reader with no JavaScript gets a headline and a
     way in. `includes('<h1')` is true of an empty <h1>, and
     `includes('funding programmes')` is true of the meta description — neither
     says anything about what is on the page. Assert the headline has text and
     that at least one programme link on the page points at a file that exists. */
  const h1 = sIndex.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const h1Text = h1 ? h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const links = [...sIndex.matchAll(/href="(\/startups\/[^"]+)"/g)].map((m) => m[1]);
  const live = links.filter((h) => resolvesInDist(h));
  h1Text.length > 8 && live.length
    ? ok(`startup index is server-rendered (h1 "${h1Text.slice(0, 40)}…", ${live.length} links resolve on disk)`)
    : fail(
        `startup index is not server-rendered: h1 text ${JSON.stringify(h1Text)}, ${live.length} of ${links.length} links resolve`,
      );
}
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
/* The footer language switcher, asserted as a property rather than as the
   string `class="langbar"`.

   `includes('class="langbar"')` passed on a div with no CSS rule, on a bar with
   zero links in it, and on links that 404 — which is this repo's whole
   silent-failure catalogue in one assertion. What a reader needs is one
   reachable route per language, so that is what is checked: one anchor per
   locale, and every href resolving to a file that exists in the published
   tree. */
{
  const bar = landingHtml.match(/<[^>]*class="[^"]*\blangbar\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|nav|ul|p)>/);
  if (!bar) {
    fail('no language switcher in the footer');
  } else {
    const hrefs = [...bar[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const paths = hrefs.map((h) => h.replace(/^https?:\/\/[^/]+/, '') || '/');
    const missingLang = LOCALE_CODES.filter((l) =>
      l === 'en' ? !paths.includes('/') : !paths.some((h) => h === `/${l}/`),
    );
    const dead = hrefs.filter((h) => !resolvesInDist(h));
    if (missingLang.length) fail(`footer language switcher is missing ${missingLang.join(', ')}`);
    else if (dead.length) fail(`footer language switcher links to ${dead.length} paths with no file in dist (first: ${dead[0]})`);
    else ok(`footer language switcher offers all ${LOCALE_CODES.length} locales and every link resolves in dist`);
  }
}
/* The four numbered steps. Checks the step count too, not just the container —
   an empty .steps4 div would have passed the old class-name-only assertion. */
{
  /* Four steps, each of which actually says something.

     Counting `class="step4"` passed on four empty divs. What the reader needs
     is four distinct, non-empty instructions, so the text is what is counted:
     strip the tags out of each step and require four unique non-blank
     strings. */
  const strip = landingHtml.replace(/<div class="step4__n">[^<]*<\/div>/g, ' ');
  const blocks = strip
    .split('<div class="step4">')
    .slice(1)
    .map((chunk) => chunk.split('</div>')[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const filled = blocks.filter((b) => b.length > 12);
  const distinct = new Set(filled);
  blocks.length === 4 && filled.length === 4 && distinct.size === 4
    ? ok('how-it-works shows four numbered steps, each with distinct non-empty text')
    : fail(
        `how-it-works has ${blocks.length} steps, ${filled.length} with text, ${distinct.size} distinct — expected 4/4/4`,
      );
}
{
  /* The orbit graphic, asserted against the stylesheet as well as the markup.

     `includes('class="orbit')` is true of a div whose class has no rule
     anywhere — which renders as an unstyled block and looks, to the test, like
     a pass. An ornament that exists in the HTML and nowhere in the CSS is not
     present; it is invisible. So: the element must exist, and at least one of
     the class names it carries must be selected by a rule in theme.css. */
  const el = landingHtml.match(/class="([^"]*\borbit[\w-]*[^"]*)"/);
  if (!el) {
    fail('no hero orbit graphic in the markup');
  } else {
    const names = el[1].split(/\s+/).filter((c) => c.startsWith('orbit'));
    const styled = names.filter((c) => new RegExp(`\\.${c}(?![\\w-])`).test(themeCss));
    styled.length
      ? ok(`hero orbit graphic present and styled (.${styled[0]} has a rule in theme.css)`)
      : fail(`hero orbit graphic has classes ${names.join(', ')} and none of them has a rule in theme.css`);
  }
}
landingHtml.includes('hero-centre') ? ok('hero text is centred') : fail('hero is not centred');
fs.existsSync(path.join(DIST, 'enterprise/index.html')) ? ok('enterprise page present') : fail('enterprise page MISSING');


/* Entry motion hides content until JS runs. If it never runs, the page must
   still be readable — a blank landing page is a total failure, and an
   animation is only a nicety. Two independent fallbacks, both asserted. */
/* Both of these used to be substring searches, and the second one searched
   for the words "Safety net" — which are in a COMMENT. Deleting the comment
   failed the test on a working page; deleting the setTimeout it describes
   passed it on a blank one. They now match the mechanism rather than the
   prose, and the property itself — "the words are on the screen when the
   animation never runs" — is measured in a real browser, with JS off and
   again with a dead IntersectionObserver, by scripts/qa-screens.mjs. */
/<noscript><style>[^<]*\.reveal[^<]*opacity:\s*1/.test(landingHtml)
  ? ok('noscript fallback forces the hidden content visible')
  : fail('no noscript fallback — page would be blank without JS');
/setTimeout\(function \(\)[\s\S]{0,300}?classList\.add\('in'\)[\s\S]{0,60}?\},\s*\d{3,}\)/.test(landingHtml)
  ? ok('a timeout adds .in if the observer never fires')
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
  /* This used to require the words "Android and iOS app" on /pricing/. There is
     no listing in either store, so the assertion was holding a false claim in
     place — and it now directly contradicts the unshipped-claims check in
     scripts/verify-render.mjs, which forbids that exact phrase. What we do ship
     is the installable web app, so that is what the page has to point at: a
     real, resolving link to it rather than a particular sentence. */
  /<a[^>]+href="[^"]*\/app\/"/.test(pricing)
    ? ok('pricing links to the app we actually ship')
    : fail('pricing does not link to /app/');
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
    /* Read the attribute, not the whole tag. <html> also carries data-audience
       now, so `includes('<html lang="fr">')` failed on a page that is correct. */
    /<html\b[^>]*\slang="fr"/.test(html) ? ok('localised pages declare their own lang') : fail('/fr/ does not declare lang="fr"');
    html.includes('hreflang="fr"') ? ok('hreflang alternates are emitted') : fail('no hreflang alternates');
  }
}

/* One theme-color, not two. A duplicate meta is a coin toss in some browsers. */
{
  const n = (landingHtml.match(/name="theme-color"/g) || []).length;
  n === 1 ? ok('exactly one theme-color meta') : fail(`${n} theme-color metas`);
}


/* ------------------------------------------------------------------ */
/* The full dataset must actually ship.                                */
/*                                                                     */
/* dist/api/v1/full/ is what the Worker serves to a paying subscriber. */
/* It is emitted behind a build flag, and when the flag was off the    */
/* Worker fell back to the stripped public file without a word: an     */
/* entitled /check/ rendered 69 cards with empty titles linking to     */
/* 404s, and every locked panel on a programme page still said "Sign   */
/* in to unlock" to someone who had paid. Nothing errored. So the      */
/* build fails here instead.                                           */
/* ------------------------------------------------------------------ */
{
  const pub = path.join(DIST, 'api/v1/programmes');
  const full = path.join(DIST, 'api/v1/full/programmes');
  /* Same predicate as src/build.mjs: the copies ship unless someone asked for a
     deliberately public-only build. Written the same way round on purpose, so
     this check and scripts/test-gating.mjs cannot disagree about what the
     build was asked to produce. */
  const wanted = process.env.EMIT_FULL_DATASET !== '0';
  if (!fs.existsSync(full)) {
    wanted
      ? fail('dist/api/v1/full/programmes/ is MISSING — every paid answer would silently serve stripped rows')
      : ok('no full dataset, as EMIT_FULL_DATASET=0 asked');
  } else {
    const pubFiles = fs.existsSync(pub) ? fs.readdirSync(pub).filter((f) => f.endsWith('.json')) : [];
    const fullFiles = fs.readdirSync(full).filter((f) => f.endsWith('.json'));
    fullFiles.length >= pubFiles.length
      ? ok(`full dataset covers every country (${fullFiles.length} of ${pubFiles.length})`)
      : fail(`full dataset has ${fullFiles.length} countries, public has ${pubFiles.length} — paid answers would be stripped for the rest`);

    /* A file that exists but holds stripped rows is the same outage with a
       green tick on it. name_en is the field the stripping removes, so it is
       the field worth asserting on. */
    let nameless = 0;
    let namelessWhere = '';
    let records = 0;
    for (const f of fullFiles) {
      const doc = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8'));
      for (const p of doc.programmes || []) {
        records += 1;
        if (!p.name_en) {
          nameless += 1;
          if (!namelessWhere) namelessWhere = `${f}:${p.slug || '(no slug)'}`;
        }
      }
    }
    nameless === 0
      ? ok(`every record in the full dataset has a name (${records} records)`)
      : fail(`${nameless} records in dist/api/v1/full/ have no name_en (first: ${namelessWhere}) — the full copy is itself stripped`);
  }
}


/* ================================================================== */
/* Data invariants the engines depend on.                             */
/*                                                                    */
/* Every one of these was a live defect. They are asserted here rather */
/* than in an engine test because the engine is correct on the data it */
/* is given — the failures were all in the data, or in a mismatch      */
/* between two fields that nothing kept in step.                       */
/* ================================================================== */

/* --- Startup dataset: closed means closed, and money is comparable --- */
{
  const SDIR = path.join(DATA, 'startups');
  const fx = JSON.parse(fs.readFileSync(path.join(DATA, 'fx-rates.json'), 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  let disagree = 0;
  let disagreeWhere = '';
  let closedRecords = 0;
  /* Deliberately permissive: a profile that clears every gate, so the ONLY
     thing that can produce a 'closed' verdict is closedness itself. */
  const OPEN_PROFILE = {
    country_code: 'de', stage: 'seed', headcount: 10, age_months: 24,
    turnover_annual_eur: 100000, balance_sheet_eur: 100000, sectors: [],
    has_local_entity: true, is_sme: true,
  };
  let pastOpen = 0;
  let pastOpenWhere = '';
  let noEur = 0;
  let noEurWhere = '';
  let badRate = 0;
  let badRateWhere = '';

  for (const f of fs.readdirSync(SDIR)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const doc = JSON.parse(fs.readFileSync(path.join(SDIR, f), 'utf8'));
    for (const p of doc.programmes || []) {
      /* This used to assert that `status === 'closed'` implies
         `deadline_type === 'closed'`, on the premise that the two are "two
         names for the same fact". They are not, and enforcing it would have
         destroyed data: `deadline_type` is the SHAPE of the deadline
         (rolling / cutoff / annual_call / closed / irregular) and `status` is
         the state today. 158 of the 168 records it flagged are annual calls
         that are currently between rounds — "this year's call has closed, it
         reopens annually" is one coherent record, and overwriting
         deadline_type would have deleted the half of it that tells a founder
         to come back.

         The defect underneath was real, but it was in the engine, and it is
         fixed: src/engine/startup.js:265 now reads status, deadline_type and
         closes_at together. So assert THAT, against the shipped engine,
         instead of dictating a shape to the data: nothing the data calls
         closed may come back as anything else. */
      const closedByData =
        p.status === 'closed' || p.status === 'paused' ||
        p.deadline_type === 'closed' ||
        (typeof p.closes_at === 'string' && p.closes_at < today);
      if (closedByData) {
        closedRecords += 1;
        const v = testProgramme(p, OPEN_PROFILE, Date.parse(today)).verdict;
        if (v !== 'closed') {
          disagree += 1;
          if (!disagreeWhere) disagreeWhere = `${f}:${p.slug} → ${v}`;
        }
      }
      /* A date in the past is not an open programme. */
      if (typeof p.closes_at === 'string' && p.closes_at < today && p.status === 'open') {
        pastOpen += 1;
        if (!pastOpenWhere) pastOpenWhere = `${f}:${p.slug} closed ${p.closes_at}`;
      }
      const e = p.eligibility || {};
      if (e.turnover_annual_max != null) {
        /* The engine compares against a EUR profile figure, so it may only
           read the derived EUR sibling. A record with the local figure and no
           sibling is one where the comparison silently reverts to comparing
           SEK against EUR. */
        if (e.turnover_annual_max_eur == null) {
          noEur += 1;
          if (!noEurWhere) noEurWhere = `${f}:${p.slug}`;
        } else {
          const cur = e.turnover_annual_max_currency || p.amount_currency || doc.currency || 'EUR';
          const rate = fx.units_per_eur[cur];
          if (rate == null) {
            badRate += 1;
            if (!badRateWhere) badRateWhere = `${f}:${p.slug} (no rate for ${cur})`;
          } else {
            const expected = Math.round(e.turnover_annual_max / rate);
            /* Exact, not approximate: the sibling is derived, so a drift means
               the rate table moved and the data did not follow. */
            if (Math.abs(expected - e.turnover_annual_max_eur) > 1) {
              badRate += 1;
              if (!badRateWhere) badRateWhere = `${f}:${p.slug} (${e.turnover_annual_max_eur} vs ${expected} at ${cur} ${rate})`;
            }
          }
        }
      }
    }
  }
  closedRecords > 0
    ? (disagree === 0
      ? ok(`every one of the ${closedRecords} records the data calls closed is scored closed by the engine`)
      : fail(`${disagree} of ${closedRecords} closed startup records are not scored closed (first: ${disagreeWhere})`))
    : fail('no startup record reads as closed at all — the closedness check is measuring nothing');
  pastOpen === 0 ? ok('no startup record has a past closes_at while status=open') : fail(`${pastOpen} startup records closed in the past but still say open (first: ${pastOpenWhere})`);
  noEur === 0 ? ok('every turnover ceiling has a derived EUR sibling') : fail(`${noEur} records set turnover_annual_max with no turnover_annual_max_eur (first: ${noEurWhere}) — the engine would compare a local figure against a EUR profile`);
  badRate === 0 ? ok(`derived EUR ceilings match the rate table (as of ${fx.rates_as_of})`) : fail(`${badRate} derived EUR ceilings do not match data/fx-rates.json (first: ${badRateWhere})`);
}

/* --- Geography: a local scheme must know where it is local to ------- */
{
  let ungated = 0;
  let ungatedWhere = '';
  let selfDisagree = 0;
  let selfWhere = '';
  let notOfferable = 0;
  let notOfferableWhere = '';

  for (const entry of manifest.countries) {
    const doc = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
    const offered = new Set(entry.regions || []);
    for (const p of doc.programmes || []) {
      const e = p.eligibility || {};
      const areas = e.admin_areas || [];

      /* The rule only fired on a non-empty list, so 115 sub-national records
         with an empty one were offered to the whole country — a Quebec
         resident told they could claim a City of Toronto transit discount. */
      if (p.admin_level && p.admin_level !== 'national' && areas.length === 0 && e.rule_source !== 'geography_unknown') {
        ungated += 1;
        if (!ungatedWhere) ungatedWhere = `${entry.slug}/${p.slug} (${p.admin_level})`;
      }

      /* A record that contradicts itself: DE/muenchen-mobilaktiv named
         "München" beside a list reading ["Bayern"]. */
      if (typeof p.admin_area === 'string' && p.admin_area.trim() && areas.length && !areas.includes(p.admin_area)) {
        selfDisagree += 1;
        if (!selfWhere) selfWhere = `${entry.slug}/${p.slug}: "${p.admin_area}" ∉ [${areas.join(', ')}]`;
      }

      /* And the one that made 35 records unreachable rather than merely wrong:
         a gate whose answer the wizard never offers. Every one of those
         records is dead — no answer, and no answer at all, matches it. */
      for (const a of areas) {
        if (!offered.has(a)) {
          notOfferable += 1;
          if (!notOfferableWhere) notOfferableWhere = `${entry.slug}/${p.slug} needs "${a}", not in manifest.regions`;
        }
      }
    }
  }
  ungated === 0 ? ok('every sub-national record is gated or flagged geography_unknown') : fail(`${ungated} sub-national records have no geography gate and no flag (first: ${ungatedWhere})`);
  selfDisagree === 0 ? ok("every record's admin_area is a member of its own admin_areas") : fail(`${selfDisagree} records contradict themselves on geography (first: ${selfWhere})`);
  notOfferable === 0 ? ok('every admin_areas value is an answer the wizard offers') : fail(`${notOfferable} geography gates name a region the wizard never offers (first: ${notOfferableWhere}) — run node scripts/gen-manifest.mjs`);
}

/* --- Totals must not invert, and a ceiling must not be below a floor - */
{
  const { match } = await import(new URL('../src/engine/matcher.js', import.meta.url));

  /* A grid, not one persona: the inversion in B9 only appeared once enough
     flat-rate matches accumulated, which is exactly the case a single
     hand-written fixture misses. */
  const PERSONAS = [
    { label: 'low income, two children, renting', status: 'unemployed', age: 34, income_annual: 6000, household_size: 4, children_count: 2, housing_tenure: 'renting' },
    { label: 'employed, no children', status: 'employee', age: 41, income_annual: 42000, household_size: 1, children_count: 0, housing_tenure: 'renting' },
    { label: 'retired', status: 'retired', age: 72, income_annual: 14000, household_size: 2, children_count: 0, housing_tenure: 'owner' },
    { label: 'student', status: 'student', age: 21, income_annual: 4000, household_size: 1, children_count: 0, housing_tenure: 'student_housing' },
    { label: 'everything skipped', status: null, age: null, income_annual: null, household_size: 1, children_count: 0, housing_tenure: null },
  ];

  let inverted = 0;
  let invertedWhere = '';
  let badRange = 0;
  let badRangeWhere = '';
  for (const entry of manifest.countries) {
    const doc = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
    for (const persona of PERSONAS) {
      const r = match(
        { ...persona, country_code: entry.country_code, admin_area: null, nationality_group: 'citizen_or_pr', circumstances: [] },
        doc,
        entry,
      );
      if (r.total_min > r.total_max) {
        inverted += 1;
        if (!invertedWhere) invertedWhere = `${entry.slug} / ${persona.label}: ${r.total_min} > ${r.total_max}`;
      }
      for (const m of [...r.eligible, ...(r.tapered || []), ...r.conditional]) {
        const lo = m.est_annual_min;
        const hi = m.est_annual_max;
        if ((lo != null || hi != null) && lo != null && hi != null && hi < lo) {
          badRange += 1;
          if (!badRangeWhere) badRangeWhere = `${entry.slug}/${m.programme.slug}: ${lo}..${hi}`;
        }
      }
    }
  }
  inverted === 0
    ? ok(`no country inverts its total across ${PERSONAS.length} personas`)
    : fail(`${inverted} country/persona pairs report a floor above their ceiling (first: ${invertedWhere})`);
  badRange === 0
    ? ok('no programme reports est_annual_max below est_annual_min')
    : fail(`${badRange} programmes have a ceiling below their floor (first: ${badRangeWhere})`);
}


/* ================================================================== */
/* Honesty and audience guards                                         */
/*                                                                     */
/* Each of these stands over a bug that shipped. They are written as    */
/* properties of the built tree rather than as string matches, because  */
/* every one of these bugs rendered without erroring.                   */
/* ================================================================== */

/* --- A doubled word in a generated heading -------------------------- */
{
  /* "Other income support support in United Kingdom" was on 641 pages: the
     heading template appended " support" to a category label that already
     ended in it. */
  const doubled = pages.filter((f) => fs.readFileSync(f, 'utf8').includes('support support'));
  doubled.length === 0
    ? ok('no page repeats the word "support"')
    : fail(`${doubled.length} pages contain "support support" (first: ${path.relative(DIST, doubled[0])})`);
}

/* --- Selling content that is not behind the paywall ------------------ */
{
  /* 344 records have no procedure_steps, no documents_required, and an
     application_url identical to source_url. On those pages the paywall
     sentence promised "the steps, documents and official link" — three things
     that do not exist. Sampled across the worst-affected countries rather than
     over all 2,216 pages, because reading every file here doubles the run. */
  const WORST = ['ae', 'be', 'pt', 'es', 'at', 'gb', 'sg', 'de', 'fr', 'it'];
  const PROMISE = 'steps, documents and official link';
  let sampled = 0;
  let lying = 0;
  let first = '';
  for (const cc of WORST) {
    const file = path.join(DATA, `${cc}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const thin = data.programmes.filter(
      (pr) =>
        !(pr.procedure_steps || []).length &&
        !(pr.documents_required || []).length &&
        (!pr.application_url || pr.application_url === pr.source_url),
    );
    for (const pr of thin.slice(0, 12)) {
      const page = path.join(DIST, cc, pr.category, pr.slug, 'index.html');
      if (!fs.existsSync(page)) continue;
      sampled += 1;
      if (fs.readFileSync(page, 'utf8').includes(PROMISE)) {
        lying += 1;
        if (!first) first = `${cc}/${pr.category}/${pr.slug}`;
      }
    }
  }
  if (sampled < 50) {
    fail(`paywall-promise check only found ${sampled} thin programme pages to sample; expected at least 50`);
  } else if (lying) {
    fail(`${lying} of ${sampled} sampled pages promise steps and documents the record does not have (first: ${first})`);
  } else {
    ok(`${sampled} programme pages with no steps, no documents and no distinct application link promise none of them`);
  }
}

/* --- A per-record claim backed by a corpus-wide constant -------------- */
{
  /* Every record carries the same last_verified_at, so a per-programme "Last
     checked {date}" sentence is a specificity the data cannot support. The day
     real per-record dates land, this check stops applying by itself. */
  const dates = new Set();
  for (const entry of manifest.countries) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
    for (const pr of data.programmes) if (pr.last_verified_at) dates.add(pr.last_verified_at);
  }
  if (dates.size > 1) {
    ok(`last_verified_at varies across ${dates.size} values — per-programme dates are legitimate`);
  } else {
    /* A DATE after the words is the claim; "the date we last checked it" in a
       country lede is prose about the corpus and says nothing per record. */
    const offenders = pages.filter((f) => /Last checked\s+\d/.test(fs.readFileSync(f, 'utf8')));
    offenders.length === 0
      ? ok('last_verified_at is one corpus-wide value and no page prints it as a per-programme date')
      : fail(
          `last_verified_at has a single value (${[...dates][0]}) but ${offenders.length} pages print "Last checked" (first: ${path.relative(DIST, offenders[0])})`,
        );
  }
}

/* --- A page that contradicts itself ---------------------------------- */
{
  /* /enterprise/ sold "CSV and API out" two sections above "There is no
     outbound API and no webhook layer yet". There is no export endpoint in
     worker/index.js, so the second sentence is the true one. */
  const both = pages.filter((f) => {
    const h = fs.readFileSync(f, 'utf8');
    return h.includes('API out') && h.includes('no outbound API');
  });
  both.length === 0
    ? ok('no page both sells an outbound API and says there is not one')
    : fail(`${both.length} pages claim "API out" and "no outbound API" at once (first: ${path.relative(DIST, both[0])})`);
}

/* --- A residency promise the infrastructure does not keep ------------- */
{
  /* Pinning storage to the EU is a Cloudflare account operation, not a copy
     change, so this check is written to switch itself off the day the config
     is real: it reads wrangler.jsonc and only objects while the D1 binding
     carries no jurisdiction or location hint. */
  const wrangler = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  const pinned = /"(jurisdiction|location_hint)"\s*:\s*"(eu|weur|eeur)"/i.test(wrangler);
  const claims = pages.filter((f) => fs.readFileSync(f, 'utf8').includes('EU data residency'));
  if (pinned) {
    ok('wrangler.jsonc pins storage to an EU region, so "EU data residency" is sellable');
  } else if (claims.length) {
    fail(
      `${claims.length} pages sell "EU data residency" while wrangler.jsonc's D1 binding has no jurisdiction or EU location_hint (first: ${path.relative(DIST, claims[0])})`,
    );
  } else {
    ok('no page claims EU data residency while the D1 binding is unpinned');
  }
}

/* --- The audience a call to action sends you to ----------------------- */
{
  /* On the home page with the company audience selected, the closing CTA sent
     a company visitor to the HOUSEHOLD wizard, because the closing section
     carried no audience attribute at all. The property: a /check/ link either
     lives inside the individual half, or sits beside a company alternative so
     the reader is being offered a choice rather than pushed. */
  const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const anchors = anchorsWithAncestry(home);
  const startupsPresent = anchors.some((a) => a.href.includes('/startups/'));
  const strayMe = anchors.filter(
    (a) => /^\/check\/$/.test(a.href) && !/\baud-me\b/.test(a.chain),
  );
  const strayBiz = anchors.filter(
    (a) => /^\/startups\/check\/$/.test(a.href) && !/\baud-biz\b/.test(a.chain),
  );
  /* A neutral /check/ link is only honest where the company route is offered
     alongside it. On this page that is the "two things this site does" pair. */
  const orphaned = strayMe.length && !startupsPresent ? strayMe.length : strayMe.length > 1 ? strayMe.length : 0;
  orphaned === 0 && strayBiz.length === 0
    ? ok('every audience-specific CTA on the home page sits in its own audience')
    : fail(
        `home page has ${orphaned} household CTAs outside .aud-me and ${strayBiz.length} company CTAs outside .aud-biz`,
      );
}

/* --- A hub page with no way in --------------------------------------- */
{
  /* /startups/ at 1280 had no in-page control until y=4256: the only buttons
     above the fold were "Skip to content" and the masthead. Every other hub
     puts a pair directly under the lede. The property is "a button exists
     inside the hero", i.e. before the first <section> that follows it. */
  const hubs = ['index.html', 'startups/index.html', 'pricing/index.html'];
  for (const entry of manifest.countries.slice(0, 5)) hubs.push(`${entry.slug}/index.html`);
  const noCta = [];
  for (const rel of hubs) {
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const main = html.slice(html.indexOf('<main'));
    const secondSection = main.indexOf('<section', main.indexOf('<section') + 1);
    const hero = secondSection === -1 ? main : main.slice(0, secondSection);
    if (!/class="[^"]*\bbtn\b[^"]*"/.test(hero)) noCta.push(rel);
  }
  noCta.length === 0
    ? ok(`every hub page offers a button inside its hero (${hubs.length} checked)`)
    : fail(`${noCta.length} hub pages have no button in the hero: ${noCta.join(', ')}`);
}

/* --- One component per idea ------------------------------------------- */
{
  /* /us/ and / drew stat tiles as .stat > .stat__n + .stat__l; /startups/ drew
     the same information as .card > .figure-sm + p.small. Same idea, two
     components, and they had already drifted apart on figure size, label case,
     padding and radius. Assert the second shape is gone from the hubs. */
  const hubs = ['index.html', 'startups/index.html', 'countries/index.html', 'pricing/index.html'];
  const offenders = [];
  for (const rel of hubs) {
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    /* A card whose figure is a bare count IS a stat tile wearing the wrong
       component. A card whose figure is a price is a pricing tier, which is
       what `.card` + `.figure-sm` is for — so the test is the content of the
       figure, not the class names around it. */
    for (const chunk of html.split('<div class="card').slice(1)) {
      const body = chunk.slice(0, 600);
      const fig = body.match(/class="figure-sm">([^<]*)</);
      if (fig && /^[\d,. ]+$/.test(fig[1].trim()) && /<p class="small"/.test(body)) {
        offenders.push(`${rel} (figure "${fig[1].trim()}")`);
        break;
      }
    }
  }
  offenders.length === 0
    ? ok('hub pages draw every numeric stat tile with .stat__n, not a second card-shaped component')
    : fail(`${offenders.join(', ')} still draw stat tiles as .card > .figure-sm + p.small`);
}

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
