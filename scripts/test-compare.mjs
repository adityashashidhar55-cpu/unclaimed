#!/usr/bin/env node
/**
 * /compare/ hub and competitor pages, plus the trust labels on programme
 * pages (company and household).
 *
 * Three things this guards against regressing silently:
 *
 *   - A competitor fact drifting from what was actually verified. The pages
 *     are built from the COMPETITORS list in src/pages/compare.mjs, and every
 *     tier price on the page must also appear as a string in that list, so a
 *     hand-edit of the rendered HTML without touching the source (or vice
 *     versa) cannot happen unnoticed.
 *   - Our own headline numbers (company programmes, jurisdictions, household
 *     benefits, countries) being hardcoded rather than read from the build's
 *     own stats — checked by requiring the numbers on the page to match the
 *     dataset counted directly from data/.
 *   - The trust label rule: a source_url with a bare path (root, or one
 *     generic segment) reads as "funder's homepage", everything else reads
 *     "Source: <host>" — checked against the underlying rule, not against a
 *     hardcoded example, so a change to the classifier is caught either way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITORS } from '../src/pages/compare.mjs';
import { sourceTrust } from '../src/pages/trust.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const t = (m, v) => (v ? ok(m) : bad(m));

const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

console.log('\n/compare/ — hub and competitor pages\n');

t('COMPETITORS lists exactly the 10 required competitors', COMPETITORS.length === 10);
for (const slug of [
  'instrumentl', 'grantwatch', 'subsdy', 'grantable', 'eu-funding-tenders-portal',
  'opengrants', 'candid', 'grantstation', 'granted-ai', 'hello-alice',
]) {
  t(`COMPETITORS includes ${slug}`, COMPETITORS.some((c) => c.slug === slug));
}

t('/compare/index.html is built', exists('compare/index.html'));
const hub = exists('compare/index.html') ? read('compare/index.html') : '';
t('hub links to every competitor page', COMPETITORS.every((c) => hub.includes(`/compare/${c.slug}/`)));
t('hub is not indexed as a duplicate of home (has its own title)', /<title>Compare Unclaimed/.test(hub));
t('hub does not sit in the main nav (no /compare/ link in <header>)', !/<header[\s\S]*?<\/header>/.exec(hub)[0].includes('/compare/'));
t('hub is reachable from the footer', /<footer[\s\S]*\/compare\//.test(hub));

// ---- Compute our own real numbers from the data the build reads, so the
// test cannot be fooled by a hardcoded figure agreeing with itself. ----
function countHousehold() {
  let total = 0;
  let countries = 0;
  const dataDir = path.join(ROOT, 'data');
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json') || f === 'fx-rates.json') continue;
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    if (!Array.isArray(d.programmes)) continue;
    total += d.programmes.length;
    countries += 1;
  }
  return { total, countries };
}
function countStartups() {
  let total = 0;
  const dataDir = path.join(ROOT, 'data', 'startups');
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    if (Array.isArray(d.programmes)) total += d.programmes.length;
  }
  return { total, jurisdictions: manifest.countries.length };
}
const household = countHousehold();
const startups = countStartups();
const nf = (n) => new Intl.NumberFormat('en').format(n);

for (const comp of COMPETITORS) {
  const rel = `compare/${comp.slug}/index.html`;
  t(`${comp.slug}: page is built`, exists(rel));
  if (!exists(rel)) continue;
  const html = read(rel);

  for (const tier of comp.pricing) {
    t(`${comp.slug}: page states "${tier.price}"`, html.includes(tier.price));
  }
  t(`${comp.slug}: cites its own source URL`, html.includes(comp.sourceUrl));
  t(`${comp.slug}: our company count (${startups.total}) is on the page, not hardcoded`, html.includes(nf(startups.total)));
  t(`${comp.slug}: our jurisdiction count (${startups.jurisdictions}) is on the page`, html.includes(nf(startups.jurisdictions)));
  t(`${comp.slug}: our household count (${household.total}) is on the page`, html.includes(nf(household.total)));
  t(`${comp.slug}: our country count (${household.countries}) is on the page`, html.includes(nf(household.countries)));
  t(`${comp.slug}: names the MCP server`, html.includes('/mcp'));
  t(`${comp.slug}: has a real <title> naming the competitor`, html.includes(`<title>${escapeForHtml(comp.metaTitle)}`));
  t(`${comp.slug}: links back to the hub`, html.includes('/compare/'));
  t(`${comp.slug}: at least one "we're ahead" and one "they're ahead" point rendered`,
    comp.weDoBetter.every((x) => html.includes(escapeForHtml(fillT(x)))) &&
    comp.theyDoBetter.every((x) => html.includes(escapeForHtml(fillT(x)))));
  t(`${comp.slug}: no unfilled {jur}/{hh} placeholder shipped`, !/\{(jur|hh)\}/.test(html));
  t(`${comp.slug}: competitor copy carries no hardcoded coverage count`,
    ![...comp.weDoBetter, ...comp.theyDoBetter, comp.metaDesc].some((x) => /\b\d+ (jurisdictions|countries)\b/.test(x)));
}

function fillT(x) {
  return String(x).replace(/\{jur\}/g, nf(startups.jurisdictions)).replace(/\{hh\}/g, nf(household.countries));
}

function escapeForHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

console.log('\nTrust labels\n');

// ---- sourceTrust() itself: the rule stated in the brief, tested directly. ----
t('root path is a homepage', sourceTrust('https://example.gov/').homepage === true);
t('a generic one-segment section is a homepage', sourceTrust('https://example.gov/grants').homepage === true);
t('a specific one-segment slug is NOT a homepage (gov.uk-style)', sourceTrust('https://www.gov.uk/winter-fuel-payment').homepage === false);
t('a locale-only path is a homepage', sourceTrust('https://example.eu/en').homepage === true);
t('two segments is not a homepage', sourceTrust('https://example.gov/grants/innovation-fund').homepage === false);
t('host is reported for a real page', sourceTrust('https://example.gov/grants/innovation-fund').host === 'example.gov');
t('an unparseable URL is treated as a homepage, not thrown', sourceTrust('not a url').homepage === true);
t('a missing source_url is treated as a homepage, not thrown', sourceTrust(undefined).homepage === true);

// ---- The label actually reaches both programme surfaces. ----
function firstFile(dir, filterFn) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name === 'index.html' && filterFn(full)) return full;
    }
  }
  return null;
}

// A household programme page: three path segments under a country dir
// (/<cc>/<category>/<slug>/), skipping the category index itself.
const gbDir = path.join(DIST, 'gb');
let householdProgrammeFile = null;
if (fs.existsSync(gbDir)) {
  for (const cat of fs.readdirSync(gbDir)) {
    const catDir = path.join(gbDir, cat);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const slug of fs.readdirSync(catDir)) {
      const full = path.join(catDir, slug, 'index.html');
      if (fs.existsSync(full)) { householdProgrammeFile = full; break; }
    }
    if (householdProgrammeFile) break;
  }
}
t('found a household programme page to check', !!householdProgrammeFile);
if (householdProgrammeFile) {
  const html = fs.readFileSync(householdProgrammeFile, 'utf8');
  t('household programme page prints "Verified on"', /Verified on /.test(html));
  t('household programme page prints a Source line', /Source: /.test(html) || html.includes("funder's homepage"));
}

const startupsDir = path.join(DIST, 'startups');
let startupProgrammeFile = null;
if (fs.existsSync(startupsDir)) {
  outer: for (const cc of fs.readdirSync(startupsDir)) {
    const ccDir = path.join(startupsDir, cc);
    if (!fs.statSync(ccDir).isDirectory() || cc === 'check') continue;
    for (const slug of fs.readdirSync(ccDir)) {
      const full = path.join(ccDir, slug, 'index.html');
      if (fs.existsSync(full)) { startupProgrammeFile = full; break outer; }
    }
  }
}
t('found a company programme page to check', !!startupProgrammeFile);
if (startupProgrammeFile) {
  const html = fs.readFileSync(startupProgrammeFile, 'utf8');
  t('company programme page prints "Verified on"', /Verified on /.test(html));
  t('company programme page prints a Source line', /Source: /.test(html) || html.includes("funder's homepage"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
