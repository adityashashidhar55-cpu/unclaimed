#!/usr/bin/env node
/**
 * Site-wide search: the build-time index, the /search/ page, and the header
 * search box on a sample of localised pages.
 *
 * Run against `dist/`, so `npm run build` must have already run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nSite-wide search\n');

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

/* ---- the two indexes ---- */
const hPath = path.join(DIST, 'search/household.json');
const cPath = path.join(DIST, 'search/company.json');
t('search/household.json is published', fs.existsSync(hPath));
t('search/company.json is published', fs.existsSync(cPath));

const household = JSON.parse(fs.readFileSync(hPath, 'utf8'));
const company = JSON.parse(fs.readFileSync(cPath, 'utf8'));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8'));
const startupManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/manifest.json'), 'utf8'));

let householdTotal = 0;
for (const c of manifest.countries) {
  householdTotal += JSON.parse(fs.readFileSync(path.join(ROOT, `data/${c.slug}.json`), 'utf8')).programmes.length;
}
let companyTotal = 0;
for (const c of startupManifest.countries) {
  companyTotal += JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${c.slug}.json`), 'utf8')).programmes.length;
}

t(`household index carries every household record (${household.records.length} = ${householdTotal})`, household.records.length === householdTotal);
t(`company index carries every company record (${company.records.length} = ${companyTotal})`, company.records.length === companyTotal);

/* ---- only public fields, and only the shapes a client can rank on ---- */
const PUBLIC_HOUSEHOLD_FIELDS = new Set(['s', 'n', 'l', 'f', 'c', 'g', 'v']);
const PUBLIC_COMPANY_FIELDS = new Set(['s', 'n', 'l', 'f', 'c', 'g', 'st']);

const hFieldsOk = household.records.every((r) => Object.keys(r).every((k) => PUBLIC_HOUSEHOLD_FIELDS.has(k)));
t('every household record carries only the declared public fields (no application_url, source_url, steps, documents)', hFieldsOk);

const cFieldsOk = company.records.every((r) => Object.keys(r).every((k) => PUBLIC_COMPANY_FIELDS.has(k)));
t('every company record carries only the declared public fields (no application_url, source_url, steps, documents)', cFieldsOk);

const hHasSlugAndName = household.records.every((r) => r.s && r.n && r.c);
t('every household record has a slug, a name and a country', hHasSlugAndName);
const cHasSlugAndName = company.records.every((r) => r.s && r.n && r.c);
t('every company record has a slug, a name and a country', cHasSlugAndName);

/* Company status must go through effectiveStatus(), never a raw stored
   field — CLAUDE.md's rule for this repo, and the same one
   scripts/test-deadlines.mjs checks for the closing-soon pages. */
const rawStatuses = new Set();
for (const c of startupManifest.countries) {
  for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${c.slug}.json`), 'utf8')).programmes) {
    rawStatuses.add(p.status);
  }
}
const KNOWN_DERIVED = new Set(['open', 'rolling', 'upcoming', 'closed', 'paused', 'ended', 'unknown']);
const statusesLookDerived = company.records.every((r) => KNOWN_DERIVED.has(r.st));
t('every company index status is one effectiveStatus() actually returns', statusesLookDerived);

/* name_local is only carried when it differs from name_en — an identical
   pair is dead weight the client would never need to disambiguate. */
const noDeadLocal = [...household.records, ...company.records].every((r) => r.l === undefined || r.l !== r.n);
t('name_local is only included when it differs from name_en', noDeadLocal);

/* Every country referenced by a record has a name+flag entry, so the client
   never renders "undefined" for a country. */
const hCountriesOk = household.records.every((r) => household.countries[r.c]?.name);
t('every household record’s country resolves in the countries map', hCountriesOk);
const cCountriesOk = company.records.every((r) => company.countries[r.c]?.name);
t('every company record’s country resolves in the countries map', cCountriesOk);

/* ---- the shared /search/ page ---- */
const searchPage = path.join(DIST, 'search/index.html');
t('search/index.html is published', fs.existsSync(searchPage));
if (fs.existsSync(searchPage)) {
  const html = fs.readFileSync(searchPage, 'utf8');
  t('the search page mounts #search-app', html.includes('id="search-app"'));
  t('the search page loads search.js as a module', /<script type="module" src="[^"]*\/search\.js/.test(html));
  t('the search page has a noscript fallback that links elsewhere', /<noscript>[\s\S]*<a[^>]+href/.test(html));
  t('the search page is in the sitemap', fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8').includes('/search/'));
}

t('search.js is published', fs.existsSync(path.join(DIST, 'search.js')));

/* ---- the header search box, on English and on a localised page ---- */
for (const rel of ['index.html', 'fr/index.html', 'de/index.html']) {
  const f = path.join(DIST, rel);
  if (!fs.existsSync(f)) continue;
  const html = fs.readFileSync(f, 'utf8');
  t(`${rel}: masthead carries the search box`, html.includes('class="header-search"'));
  t(`${rel}: the search box points at the shared /search/ page`, /class="header-search"[^>]*action="[^"]*\/search\/"/.test(html));
  t(`${rel}: the placeholder is not the literal English text on a translated page`,
    rel === 'index.html' || !html.includes('placeholder="Search programmes & benefits"'));
}

/* ---- theme.css actually styles the class the page emits ---- */
const css = fs.readFileSync(path.join(ROOT, 'src/theme.css'), 'utf8');
t('theme.css defines .header-search', /\.header-search\b/.test(css));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
