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

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
