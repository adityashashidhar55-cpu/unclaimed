#!/usr/bin/env node
/**
 * /funders/ — the A-Z hub and one profile page per qualifying funder.
 *
 * What this guards against regressing silently:
 *
 *   - The grouping threshold. A funder with fewer than FUNDER_MIN_PROGRAMMES
 *     records must NOT get a page — checked by rebuilding the directory
 *     straight from data/ and comparing against dist/, so a change to the
 *     threshold or the grouping key is caught either way.
 *   - Every programme funder points somewhere real. Household and company
 *     records whose funder groups to a page-worthy bucket must show up as an
 *     <a> from that funder's programme page in dist/ (checked on a sample,
 *     not all 2000+, to keep this fast).
 *   - The normaliser's own contract: punctuation and case differences group
 *     together; two genuinely different names do not.
 *   - JSON-LD: every funder page carries an Organization and an ItemList.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFunderDirectory, funderKey, FUNDER_MIN_PROGRAMMES } from '../src/pages/funders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const t = (m, v) => (v ? ok(m) : bad(m));

console.log('\n/funders/ — profile pages\n');

/* -- rebuild the directory the same way build.mjs does ------------------ */
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const countries = manifest.countries.map((raw) => ({
  entry: raw,
  data: JSON.parse(fs.readFileSync(path.join(DATA, `${raw.slug}.json`), 'utf8')),
}));
const STARTUP_MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA, 'startups/manifest.json'), 'utf8'));
const STARTUP_DATA = Object.fromEntries(
  STARTUP_MANIFEST.countries.map((c) => [c.slug, JSON.parse(fs.readFileSync(path.join(DATA, `startups/${c.slug}.json`), 'utf8'))]),
);

const directory = buildFunderDirectory({ countries, STARTUP_MANIFEST, STARTUP_DATA });
t(`directory groups at least one funder (${directory.length} total)`, directory.length > 0);

const withPages = directory.filter((f) => f.hasPage);
t(`every funder with a page clears the ${FUNDER_MIN_PROGRAMMES}-programme threshold`, withPages.every((f) => f.total >= FUNDER_MIN_PROGRAMMES));
t('no funder below the threshold has a page', directory.filter((f) => f.total < FUNDER_MIN_PROGRAMMES).every((f) => !f.hasPage));

/* -- normaliser contract -------------------------------------------------- */
t('punctuation and case fold together', funderKey('U.S. Small Business Administration') === funderKey('US Small Business Administration'));
t('an apostrophe variant folds the same way', funderKey("Caisse d'allocations familiales") === funderKey('Caisse d’allocations familiales'));
t('genuinely different names stay apart', funderKey('Department for Work and Pensions') !== funderKey('Department of Health'));
t('empty or missing funder yields an empty key', funderKey('') === '' && funderKey(undefined) === '' && funderKey(null) === '');

/* -- dist agrees with the directory -------------------------------------- */
t('dist/funders/index.html exists', fs.existsSync(path.join(DIST, 'funders/index.html')));
const distFunderDirs = fs.existsSync(path.join(DIST, 'funders'))
  ? fs.readdirSync(path.join(DIST, 'funders'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
t(`dist has exactly the page-worthy funders (${withPages.length} expected, ${distFunderDirs.length} found)`,
  distFunderDirs.length === withPages.length && withPages.every((f) => distFunderDirs.includes(f.slug)));

/* -- spot-check a handful of funder pages -------------------------------- */
const sample = withPages.slice(0, 25);
let ldOk = true;
let countOk = true;
let linkedOk = true;
for (const f of sample) {
  const file = path.join(DIST, 'funders', f.slug, 'index.html');
  if (!fs.existsSync(file)) { ldOk = false; continue; }
  const html = fs.readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  if (!blocks.some((b) => b['@type'] === 'Organization')) ldOk = false;
  const itemList = blocks.find((b) => b['@type'] === 'ItemList');
  if (!itemList || itemList.itemListElement.length !== f.total) countOk = false;

  const r = f.household[0] || f.startup[0];
  if (r) {
    const kind = f.household[0] ? 'household' : 'startup';
    const progFile =
      kind === 'household'
        ? path.join(DIST, r.cc, r.p.category, r.p.slug, 'index.html')
        : path.join(DIST, 'startups', r.cc, r.p.slug, 'index.html');
    if (fs.existsSync(progFile)) {
      const progHtml = fs.readFileSync(progFile, 'utf8');
      if (!progHtml.includes(`/funders/${f.slug}/`)) linkedOk = false;
    }
  }
}
t(`sampled funder pages (${sample.length}) each carry an Organization block`, ldOk);
t('each sampled funder page\'s ItemList count matches its programme total', countOk);
t('a sampled programme page links back to its funder\'s page', linkedOk);

/* -- a single-programme funder gets no page, and its own programme page
      still names the funder in plain text -------------------------------- */
const single = directory.find((f) => f.total === 1);
if (single) {
  t('a single-programme funder has no page', !single.hasPage);
  const r = single.household[0] || single.startup[0];
  const kind = single.household[0] ? 'household' : 'startup';
  const progFile =
    kind === 'household'
      ? path.join(DIST, r.cc, r.p.category, r.p.slug, 'index.html')
      : path.join(DIST, 'startups', r.cc, r.p.slug, 'index.html');
  if (fs.existsSync(progFile)) {
    const html = fs.readFileSync(progFile, 'utf8');
    t('…but its own programme page still names it', html.includes(escapeHtml(r.p.funder)));
    t('…and does not link it to a funder page that does not exist', !html.includes(`/funders/${funderKey(r.p.funder).replace(/[^a-z0-9]+/g, '-')}/`));
  }
} else {
  ok('every funder in this dataset has 2+ programmes (nothing to check for the single-programme case)');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
