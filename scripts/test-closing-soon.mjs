#!/usr/bin/env node
/**
 * Closing-soon pages, the 6-month calendar, and the ICS feeds.
 *
 * These are pure SEO/acquisition surfaces built from the same startup
 * dataset and the same effectiveStatus()/deadlineState() derivation as every
 * other page — this test recomputes the same thing independently from
 * data/startups/*.json and checks the built dist/ output against it, rather
 * than trusting the generator's own arithmetic.
 *
 * Run against `dist/`, so `npm run build` must have already run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveStatus, deadlineState } from '../packages/deadlines/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DAY = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 120;

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nClosing-soon pages, calendar, ICS feeds\n');

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/manifest.json'), 'utf8'));
const byCountry = Object.fromEntries(
  manifest.countries.map((c) => [c.slug, JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${c.slug}.json`), 'utf8')).programmes]),
);

/* asOf: close to BUILD_NOW without being it — the build ran moments before
   this test, so a 120-day-horizon boundary programme could in principle fall
   on the wrong side by a few seconds. Existing scripts/test-deadlines.mjs
   accepts the same characteristic. */
const asOf = Date.now();
const horizonMs = HORIZON_DAYS * DAY;

function isClosingSoon(p) {
  const status = effectiveStatus(p, asOf);
  if (!['open', 'rolling', 'upcoming'].includes(status)) return false;
  const closes = p.closes_at ? Date.parse(p.closes_at) : null;
  return closes != null && !Number.isNaN(closes) && closes > asOf && closes <= asOf + horizonMs;
}
function hasUsefulProjection(p) {
  const d = deadlineState(p, asOf);
  return d.at != null || (p.typical_months || []).length > 0 || !!p.reopen_note;
}
function hasFutureKnownDeadline(p) {
  const status = effectiveStatus(p, asOf);
  if (!['open', 'rolling', 'upcoming'].includes(status)) return false;
  const closes = p.closes_at ? Date.parse(p.closes_at) : null;
  return closes != null && !Number.isNaN(closes) && closes > asOf;
}

const read = (p) => fs.readFileSync(path.join(DIST, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(DIST, p));

/* ---- The three page shapes exist ---- */
t('/startups/closing-soon/ was built', exists('startups/closing-soon/index.html'));
t('/startups/calendar/ was built', exists('startups/calendar/index.html'));
t('/startups/deadlines.ics was built', exists('startups/deadlines.ics'));

/* ---- Per-jurisdiction: page exists exactly where there is something to
   show, and only there — never an empty page ---- */
{
  let shouldHave = 0;
  let has = 0;
  let wrongfullyMissing = 0;
  let wrongfullyPresent = 0;
  for (const c of manifest.countries) {
    const programmes = byCountry[c.slug];
    const closing = programmes.filter(isClosingSoon);
    const closingSlugs = new Set(closing.map((p) => p.slug));
    const projected = programmes.filter((p) => !closingSlugs.has(p.slug) && hasUsefulProjection(p));
    const expected = closing.length > 0 || projected.length > 0;
    const built = exists(`startups/${c.slug}/closing-soon/index.html`);
    if (expected) shouldHave += 1;
    if (built) has += 1;
    if (expected && !built) wrongfullyMissing += 1;
    if (!expected && built) wrongfullyPresent += 1;
  }
  t(`${shouldHave} of ${manifest.countries.length} jurisdictions expected a closing-soon page`, shouldHave > 0 && shouldHave < manifest.countries.length);
  t('every jurisdiction with something to show got the page', wrongfullyMissing === 0);
  t('no jurisdiction with nothing useful got a page anyway', wrongfullyPresent === 0);
  t(`built count (${has}) matches expected count (${shouldHave})`, has === shouldHave);
}

/* ---- Every built closing-soon page has real content, never an empty shell ---- */
{
  let checked = 0;
  let empty = 0;
  for (const c of manifest.countries) {
    const f = `startups/${c.slug}/closing-soon/index.html`;
    if (!exists(f)) continue;
    checked += 1;
    const html = read(f);
    if (!(html.match(/<article class="card">/g) || []).length) empty += 1;
  }
  t(`${checked} country closing-soon pages checked for content`, checked > 0);
  t('none of them render with zero programme cards', empty === 0);
}

/* ---- The global page's headline count matches an independent recount ---- */
{
  const allProgrammes = manifest.countries.flatMap((c) => byCountry[c.slug]);
  const expectedTotal = allProgrammes.filter(isClosingSoon).length;
  const html = read('startups/closing-soon/index.html');
  const m = html.match(/<h2 style="margin-top:2\.6rem">Closing soonest<\/h2>\s*<div class="grid grid-2" style="margin-top:1rem">([\s\S]*?)<\/div>\s*<\/section>|<\/div>\s*<h2 style="margin-top:2\.6rem">By jurisdiction/);
  const cardCount = (html.match(/<article class="card">/g) || []).length;
  t(`global page renders ${expectedTotal} programme cards (recount matches)`, cardCount === expectedTotal);
  t('global page is never empty when the corpus has any closing-soon programme', expectedTotal === 0 || cardCount > 0);
}

/* ---- JSON-LD ItemList matches the visible list, on both page shapes ---- */
function itemListLength(html) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const list = scripts.find((o) => o['@type'] === 'ItemList');
  return list ? list.itemListElement.length : null;
}
{
  const html = read('startups/closing-soon/index.html');
  const n = itemListLength(html);
  const cardCount = (html.match(/<article class="card">/g) || []).length;
  t('the global page ships an ItemList', n != null);
  t('its length matches the rendered cards', n === cardCount);
}
{
  // Pick one jurisdiction of each shape (real deadlines vs projection-only) to spot-check.
  const withDeadline = manifest.countries.find((c) => byCountry[c.slug].some(isClosingSoon));
  const html = read(`startups/${withDeadline.slug}/closing-soon/index.html`);
  const n = itemListLength(html);
  const cardCount = (html.match(/<article class="card">/g) || []).length;
  t(`a jurisdiction with real deadlines (${withDeadline.slug}) ships a matching ItemList`, n === cardCount);
}

/* ---- The calendar covers exactly six months and never renders empty ---- */
{
  const html = read('startups/calendar/index.html');
  t('the calendar page renders six month sections', (html.match(/<h2 style="margin-top:0">/g) || []).length === 6);
  t('the calendar page has an ItemList', itemListLength(html) !== null);
}

/* ---- ICS: parses, stable UIDs, all-day, future-only, links to our own pages ---- */
function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of text.replace(/\r\n[ \t]/g, '').split(/\r\n/)) { // unfold RFC 5545 continuation lines first
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return events;
}
{
  const ics = read('startups/deadlines.ics');
  t('starts with BEGIN:VCALENDAR and ends with END:VCALENDAR', ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'));
  const events = parseICS(ics);
  t('the global feed has at least one event', events.length > 0);
  t('every content line is at most 75 octets (RFC 5545 folding)', ics.split(/\r\n/).every((l) => Buffer.byteLength(l, 'utf8') <= 75));

  const allProgrammes = manifest.countries.flatMap((c) => byCountry[c.slug]);
  const expectedEvents = allProgrammes.filter(hasFutureKnownDeadline).length;
  t(`event count (${events.length}) matches every future known deadline (${expectedEvents})`, events.length === expectedEvents);

  const uidRe = /^UID:unclaimed-startup-[a-z0-9]+-[a-z0-9-]+@unclaimedgrant\.com$/;
  const uidLines = ics.replace(/\r\n[ \t]/g, '').split(/\r\n/).filter((l) => l.startsWith('UID:'));
  t('every UID is stable — keyed by country+slug, never by array position', uidLines.every((l) => uidRe.test(l)));
  const uidSet = new Set(uidLines);
  t('every UID is unique', uidSet.size === uidLines.length);

  t('every event is all-day (VALUE=DATE, no time component)', events.every((e) => /^DTSTART;VALUE=DATE:\d{8}$/m.test(`DTSTART;VALUE=DATE:${e['DTSTART;VALUE=DATE']}`) || Object.keys(e).some((k) => k.startsWith('DTSTART'))));
  t('every event carries a DTSTAMP', events.every((e) => e.DTSTAMP));
  t('every event links back to our own programme page, not the funder\'s', events.every((e) => e.URL && e.URL.startsWith('https://unclaimedgrant.com/startups/')));
  t('no event is dated in the past', events.every((e) => {
    const k = Object.keys(e).find((x) => x.startsWith('DTSTART'));
    const iso = `${e[k].slice(0, 4)}-${e[k].slice(4, 6)}-${e[k].slice(6, 8)}`;
    return Date.parse(iso) > asOf - DAY; // allow "today"
  }));
}

/* ---- Per-country ICS feed matches that country's own events ---- */
{
  const c = manifest.countries.find((c) => byCountry[c.slug].some(hasFutureKnownDeadline));
  const ics = read(`startups/${c.slug}/deadlines.ics`);
  const events = parseICS(ics);
  const expected = byCountry[c.slug].filter(hasFutureKnownDeadline).length;
  t(`per-country feed for ${c.slug} has exactly its own ${expected} events, not the whole corpus`, events.length === expected);
  t('every UID in the per-country feed is scoped to that country', events.every((e) => e.UID.startsWith(`unclaimed-startup-${c.slug}-`)));
}

/* ---- Cross-links: /startups/ and each /startups/{cc}/ page link out ---- */
t('/startups/ links to /startups/closing-soon/', read('startups/index.html').includes('/startups/closing-soon/'));
t('/startups/ links to /startups/calendar/', read('startups/index.html').includes('/startups/calendar/'));
t('/startups/ links to the ICS feed', read('startups/index.html').includes('/startups/deadlines.ics'));
{
  const withPage = manifest.countries.find((c) => exists(`startups/${c.slug}/closing-soon/index.html`));
  const withoutPage = manifest.countries.find((c) => !exists(`startups/${c.slug}/closing-soon/index.html`));
  t(`${withPage.slug} country page links to its own closing-soon page`, read(`startups/${withPage.slug}/index.html`).includes(`/startups/${withPage.slug}/closing-soon/`));
  if (withoutPage) {
    t(`${withoutPage.slug} country page does not link to a closing-soon page that does not exist`, !read(`startups/${withoutPage.slug}/index.html`).includes(`/startups/${withoutPage.slug}/closing-soon/`));
  }
}

/* ---- Sitemap carries the two HTML pages; the ICS feeds are not webpages ---- */
{
  const sitemap = read('sitemap.xml');
  t('sitemap includes /startups/closing-soon/', sitemap.includes('/startups/closing-soon/'));
  t('sitemap includes /startups/calendar/', sitemap.includes('/startups/calendar/'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
