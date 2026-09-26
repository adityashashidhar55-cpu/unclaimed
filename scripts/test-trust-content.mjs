#!/usr/bin/env node
/**
 * Trust, content and open-data pages: /trust/, /scams/, /accessibility/,
 * /changelog/, the startup Atom feeds, the OpenAPI spec and the per-country
 * public CSVs.
 *
 * Runs against the built dist/, like scripts/test-compare.mjs and
 * scripts/test-closing-soon.mjs — run `npm run build` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, LOCALES } from '../src/i18n.mjs';
import { effectiveStatus } from '../packages/deadlines/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const t = (m, v) => (v ? ok(m) : bad(m));

const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

console.log('\nTrust, content and open-data pages\n');

/* ---- /trust/ — localised like /privacy/ ---- */
t('/trust/index.html is built', exists('trust/index.html'));
const trustEn = exists('trust/index.html') ? read('trust/index.html') : '';
t('/trust/ names the analytics beacon fields exactly', /step/i.test(trustEn) && /visitor/i.test(trustEn.toLowerCase()) || /random id/i.test(trustEn));
t('/trust/ states no IP address is kept', /no IP address/i.test(trustEn));
t('/trust/ states the eligibility check runs client-side', /engine\/matcher\.js/.test(trustEn));
t('/trust/ names the AI vendor (Anthropic\'s Claude API)', /Anthropic/.test(trustEn) && /Claude/.test(trustEn));
t('/trust/ states no training happens', /do not train/i.test(trustEn));
t('/trust/ describes the MCP server as read-only', /read-only/i.test(trustEn) && /mcp/i.test(trustEn.toLowerCase()));
/* The installed app POSTs the household profile to /api/check (src/pwa/auth.js
   fetchMatch) and MCP's check_entitlements does the same — the page must say
   so rather than claim answers never leave the device. */
t('/trust/ discloses that the app sends answers to /api/check', /\/api\/check/.test(trustEn));
t('/trust/ does not claim no endpoint accepts answers', !/no endpoint accepts them/i.test(trustEn));
t('/trust/ names report_issue as the MCP tool that is not read-only', /report_issue/.test(trustEn));
t('/trust/ does not promise a self-serve account deletion the worker lacks', !/Deleting your account removes/i.test(trustEn));
t('/trust/ is linked from the footer', /href="\/trust\/"/.test(read('index.html')));

for (const lang of LANGS.filter((l) => l !== 'en')) {
  const rel = `${lang}/trust/index.html`;
  t(`/${lang}/trust/ is built`, exists(rel));
}

/* ---- /scams/ ---- */
t('/scams/index.html is built', exists('scams/index.html'));
const scams = exists('scams/index.html') ? read('scams/index.html') : '';
t('/scams/ states the core rule (no fee for a real grant)', /no real government grant.*fee|never asks you to pay a fee/i.test(scams));
for (const host of ['reportfraud.ftc.gov', 'actionfraud.police.uk', 'cybermalveillance.gouv.fr', 'signal.conso.gouv.fr', 'anti-fraud.ec.europa.eu', 'cybercrime.gov.in']) {
  t(`/scams/ links to ${host}`, scams.includes(host));
}
t('/scams/ is linked from the footer', /href="\/scams\/"/.test(read('index.html')));

/* ---- /accessibility/ ---- */
t('/accessibility/index.html is built', exists('accessibility/index.html'));
const a11y = exists('accessibility/index.html') ? read('accessibility/index.html') : '';
t('/accessibility/ mentions the skip link', /skip link/i.test(a11y));
t('/accessibility/ mentions reduced motion', /reduced motion|prefers-reduced-motion|reduce motion/i.test(a11y));
t('/accessibility/ does not claim an unaudited WCAG conformance level', !/WCAG 2\.[01] (AA|AAA) conformant|fully accessible/i.test(a11y));
t('/accessibility/ is linked from the footer', /href="\/accessibility\/"/.test(read('index.html')));

/* ---- /changelog/ ---- */
t('/changelog/index.html is built', exists('changelog/index.html'));
const changelogData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/site/changelog.json'), 'utf8'));
t('data/changelog.json has entries', Array.isArray(changelogData.entries) && changelogData.entries.length > 0);
const changelogHtml = exists('changelog/index.html') ? read('changelog/index.html') : '';
t('every changelog entry title renders on the page', changelogData.entries.every((e) => changelogHtml.includes(e.title)));
t('/changelog/ is linked from the footer', /href="\/changelog\/"/.test(read('index.html')));

/* ---- RSS/Atom feeds ---- */
t('/startups/feed.xml is built', exists('startups/feed.xml'));
const feed = exists('startups/feed.xml') ? read('startups/feed.xml') : '';
t('/startups/feed.xml is a valid Atom feed (root element + required fields)', /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(feed) && /<id>/.test(feed) && /<updated>/.test(feed));
t('/startups/feed.xml self-link is present', /rel="self"/.test(feed));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/manifest.json'), 'utf8'));
let feedCountriesChecked = 0;
for (const c of manifest.countries) {
  const rel = `startups/${c.slug}/feed.xml`;
  if (!exists(rel)) continue; // a jurisdiction with zero programmes would have nothing to feed
  feedCountriesChecked += 1;
  const xml = read(rel);
  t(`/startups/${c.slug}/feed.xml is valid Atom`, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(xml));
  /* RFC 4287 §4.1.1: a feed MUST carry atom:author unless every entry does. */
  t(`/startups/${c.slug}/feed.xml has a feed-level author`, /<feed[^>]*>[\s\S]*?<author><name>[^<]+<\/name>/.test(xml.split('<entry>')[0]));
}
t('at least one per-country feed was checked', feedCountriesChecked > 0);

/* Sort order: most recently verified first. Parse <updated> per entry and
   check it is non-increasing (equal dates allowed), which is what
   last_verified_at-desc sorting guarantees. */
{
  const dates = [...feed.matchAll(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/g)].map((m) => Date.parse(m[1]));
  let sorted = true;
  for (let i = 1; i < dates.length; i++) if (dates[i] > dates[i - 1]) sorted = false;
  t('/startups/feed.xml entries are sorted most-recently-verified first', sorted && dates.length > 0);
}

/* ---- OpenAPI spec ---- */
t('/api/v1/openapi.json is built', exists('api/v1/openapi.json'));
let spec = null;
try { spec = JSON.parse(read('api/v1/openapi.json')); } catch { /* handled below */ }
t('/api/v1/openapi.json is valid JSON', spec !== null);
t('openapi.json declares version 3.1.0', spec?.openapi === '3.1.0');
for (const p of ['/api/check', '/api/startups/check', '/api/v1/countries.json', '/api/v1/programmes/{cc}.json', '/api/v1/startups/{slug}.json', '/api/alerts/subscribe', '/api/alerts/status', '/mcp']) {
  t(`openapi.json documents ${p}`, !!spec?.paths?.[p]);
}
t('openapi.json does NOT document any /api/admin/* route', !Object.keys(spec?.paths ?? {}).some((p) => p.startsWith('/api/admin')));
t('openapi.json does NOT document any /api/billing/* route', !Object.keys(spec?.paths ?? {}).some((p) => p.startsWith('/api/billing')));

/* ---- Per-country public CSV: public fields only ---- */
const PUBLIC_FIELDS = ['slug', 'name', 'funder', 'country', 'grant_type', 'status', 'closes_at', 'page_url'];
const PAID_FIELDS = ['application_url', 'documents', 'procedure', 'source_snippet'];
let csvCountriesChecked = 0;
for (const c of manifest.countries) {
  const rel = `api/v1/csv/startups-${c.slug}.csv`;
  if (!exists(rel)) continue;
  csvCountriesChecked += 1;
  const csv = read(rel);
  const header = csv.split(/\r?\n/)[0];
  t(`startups-${c.slug}.csv header is exactly the public fields`, header === PUBLIC_FIELDS.join(','));
  for (const f of PAID_FIELDS) t(`startups-${c.slug}.csv header never mentions ${f}`, !header.toLowerCase().includes(f));
}
t('at least one per-country CSV was checked', csvCountriesChecked > 0);

/* CSV status column must be the derived effectiveStatus, not the raw stored
   field — check one country's file against a fresh computation. */
{
  const cc = manifest.countries[0].slug;
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${cc}.json`), 'utf8'));
  const csv = read(`api/v1/csv/startups-${cc}.csv`);
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const bySlug = new Map(rows.map((r) => {
    // naive split is fine here: none of the public fields legitimately contain a comma except a quoted funder name
    const cols = r.match(/(".*?"|[^,]+)(?=,|$)/g) ?? [];
    return [cols[0], cols[5]];
  }));
  let allMatch = true;
  for (const p of raw.programmes.slice(0, 20)) {
    const want = effectiveStatus(p, Date.now());
    if (bySlug.get(p.slug) !== want) allMatch = false;
  }
  t(`startups-${cc}.csv status column matches effectiveStatus()`, allMatch);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
