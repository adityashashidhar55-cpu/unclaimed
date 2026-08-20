#!/usr/bin/env node
/**
 * What the built HTML actually says.
 *
 * scripts/verify.mjs checks that pages exist and that the data behind them is
 * sane. This one reads the rendered text of every file in dist/ and asserts
 * properties of it, because the whole failure mode of this codebase is that
 * nothing errors: a template interpolates `undefined` into body copy on 3,462
 * pages, a stale manifest prints a count that disagrees with the list under
 * it, a canonical points at a host nobody owns, a doc page promises a field
 * the payload does not carry. Every one of those renders perfectly.
 *
 * Rules for anything added here:
 *   - Test the property, not the markup. "The hero count equals the sum of the
 *     category counts on the same page" survives a copy change; "the page
 *     contains the string 89" does not.
 *   - Name the first offending file. A count of failures is not actionable at
 *     5,900 pages.
 *
 * Run: node scripts/verify-render.mjs   (needs a current dist/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };

if (!fs.existsSync(DIST)) {
  console.error('dist/ is not built. Run the build first.');
  process.exit(1);
}

/* ---------- helpers ---------------------------------------------------- */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.html')) out.push(f);
  }
  return out;
}

const PAGES = walk(DIST);
const rel = (f) => path.relative(DIST, f);

/** Visible text: script, style, template and comments removed. */
function textOf(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

const read = (f) => fs.readFileSync(f, 'utf8');
const cache = new Map();
const html = (f) => {
  if (!cache.has(f)) cache.set(f, read(f));
  return cache.get(f);
};

/* ---------- A1: no stringified `undefined` in body copy ---------------- */
/* One template called with too few arguments prints the word at the reader.
   This single check covers the whole class, in all seven locales. */
{
  const offenders = [];
  for (const f of PAGES) {
    if (/\bundefined\b/.test(textOf(html(f)))) offenders.push(rel(f));
    if (offenders.length > 3) break;
  }
  offenders.length
    ? bad(`"undefined" is rendered as text on ${offenders.length}+ pages, first: ${offenders[0]}`)
    : ok(`no rendered text node contains "undefined" (${PAGES.length} pages)`);
}

/* ---------- A13: canonicals and hreflangs point at this site ----------- */
{
  const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://unclaimedgrant.com').replace(/\/$/, '');
  const HOST = new URL(ORIGIN).host;
  const offenders = [];
  for (const f of PAGES) {
    const s = html(f);
    for (const m of s.matchAll(/<link[^>]+rel="(?:canonical|alternate)"[^>]*href="(https?:\/\/[^"]+)"/g)) {
      const h = new URL(m[1]).host;
      if (h !== HOST) offenders.push(`${rel(f)} → ${h}`);
    }
    if (offenders.length) break;
  }
  offenders.length
    ? bad(`canonical/hreflang points at a foreign host: ${offenders[0]}`)
    : ok(`every canonical and hreflang is on ${HOST}`);
}

/* ---------- A19: no heading-level skips -------------------------------- */
{
  const offenders = [];
  for (const f of PAGES) {
    const levels = [...html(f).matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
    let prev = 0;
    for (const l of levels) {
      if (prev && l > prev + 1) { offenders.push(`${rel(f)}: h${prev} → h${l}`); break; }
      prev = l;
    }
    if (offenders.length > 3) break;
  }
  offenders.length
    ? bad(`heading level skipped on ${offenders.length}+ pages, first: ${offenders[0]}`)
    : ok('no page skips a heading level');
}

/* ---------- A6: one class for every withheld value --------------------- */
{
  const offenders = [];
  for (const f of PAGES) {
    const s = html(f);
    for (const m of s.matchAll(/class="([^"]*\b(?:locked__row|lock-chip)\b[^"]*)"/g)) {
      if (!/\bwithheld\b/.test(m[1])) { offenders.push(`${rel(f)}: class="${m[1]}"`); break; }
    }
    if (offenders.length) break;
  }
  offenders.length
    ? bad(`a withheld value is drawn without the shared class: ${offenders[0]}`)
    : ok('every withheld value carries .withheld');
}

/* ---------- A7: a price is never quoted without a control -------------- */
/* The property, not the markup: from anywhere the site names a price there is
   something to click that acts on it. `.locked` panels used to quote €50
   three times on one page and offer a button once. */
{
  const MONEY = /(?:€|£|\$)\s?\d[\d.,]*/;
  const offenders = [];
  for (const f of PAGES) {
    const s = html(f);
    for (const m of s.matchAll(/<section class="locked-bucket[^"]*"[\s\S]*?<\/section>/g)) {
      const panel = m[0];
      if (!MONEY.test(textOf(panel))) continue;
      const hasControl = /<a\b[^>]*href="[^"]*(?:\/pricing\/|\/account\/)"/.test(panel) ||
                         /data-checkout/.test(panel) ||
                         /class="[^"]*bucket__unlock/.test(panel);
      if (!hasControl) { offenders.push(rel(f)); break; }
    }
    if (offenders.length) break;
  }
  offenders.length
    ? bad(`a locked panel names a price with no adjacent control: ${offenders[0]}`)
    : ok('no locked panel quotes a price without a control beside it');
}

/* ---------- A11: every priced tier has a real, primary checkout -------- */
{
  const plans = new Set(
    [...read(path.join(ROOT, 'src/pwa/checkout.js'))
      .slice(read(path.join(ROOT, 'src/pwa/checkout.js')).indexOf('export const PLANS'))
      .matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]),
  );
  const pricingPages = PAGES.filter((f) => /(^|\/)pricing\/index\.html$/.test(rel(f)));
  const offenders = [];
  for (const f of pricingPages) {
    for (const m of html(f).matchAll(/data-plan="([a-z_]+)"/g)) {
      if (!plans.has(m[1])) offenders.push(`${rel(f)}: data-plan="${m[1]}" is not in PLANS`);
    }
    /* The two self-serve annual/monthly pairs both have to be buyable: the
       business_annual price existed in checkout.js and wrangler.jsonc and
       nowhere in the interface, while the personal tier had the control. */
    for (const key of ['personal_annual', 'personal_monthly', 'business_monthly', 'business_annual']) {
      if (!html(f).includes(`data-plan="${key}"`)) offenders.push(`${rel(f)}: no control for ${key}`);
    }
    if (!/data-checkout[^>]*class="[^"]*btn-primary|class="[^"]*btn-primary[^"]*"[^>]*data-checkout/.test(html(f)))
      offenders.push(`${rel(f)}: no checkout control carries btn-primary`);
  }
  offenders.length
    ? bad(`${offenders.length} pricing-control problems, first: ${offenders[0]}`)
    : ok(`${pricingPages.length} pricing pages: every plan key is real and buyable`);
}

/* ---------- A12: the counts on a page agree with each other ------------ */
{
  const api = path.join(DIST, 'api/v1/countries.json');
  if (!fs.existsSync(api)) bad('dist/api/v1/countries.json missing');
  else {
    const idx = JSON.parse(read(api));
    const byCc = new Map(idx.countries.map((c) => [c.slug, c]));
    const offenders = [];

    /* the file the API index describes must actually hold that many records */
    for (const c of idx.countries) {
      const f = path.join(DIST, `api/v1/programmes/${c.slug}.json`);
      if (!fs.existsSync(f)) { offenders.push(`no payload for ${c.slug}`); continue; }
      const n = JSON.parse(read(f)).programmes.length;
      if (n !== c.programme_count) offenders.push(`${c.slug}: index says ${c.programme_count}, payload holds ${n}`);
    }

    /* /countries/ headline total equals the sum of its own rows */
    const ci = path.join(DIST, 'countries/index.html');
    if (fs.existsSync(ci)) {
      const rows = [...read(ci).matchAll(/<span class="list-row__amount">(\d[\d,]*)<\/span>/g)]
        .map((m) => Number(m[1].replace(/,/g, '')));
      const sum = rows.reduce((a, b) => a + b, 0);
      const head = read(ci).match(/<h1[^>]*>([^<]*)<\/h1>/);
      const nums = head ? [...head[1].matchAll(/([\d][\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, ''))) : [];
      const total = nums.length ? Math.max(...nums) : null;
      if (total !== sum) offenders.push(`/countries/ headline ${total} vs rows summing to ${sum}`);
      if (rows.length !== idx.countries.length) offenders.push(`/countries/ lists ${rows.length} rows, API has ${idx.countries.length}`);
    }

    /* each /<cc>/ hero count equals the sum of its own category chips */
    for (const [cc, c] of byCc) {
      const f = path.join(DIST, `${cc}/index.html`);
      if (!fs.existsSync(f)) continue;
      const chips = [...read(f).matchAll(/<span class="tag__n">(\d+)<\/span>/g)].map((m) => Number(m[1]));
      if (!chips.length) continue;
      const sum = chips.reduce((a, b) => a + b, 0);
      const hero = read(f).match(/<p class="lede"[^>]*>\s*([\d,]+)/);
      const shown = hero ? Number(hero[1].replace(/,/g, '')) : null;
      if (shown !== sum) offenders.push(`/${cc}/ hero says ${shown}, its categories sum to ${sum}`);
      if (shown !== c.programme_count) offenders.push(`/${cc}/ hero says ${shown}, API says ${c.programme_count}`);
    }
    offenders.length
      ? bad(`${offenders.length} count disagreements, first: ${offenders[0]}`)
      : ok('country counts agree across the page, /countries/ and the API');
  }
}

/* ---------- A15: /api/ cannot claim a field the payload lacks ---------- */
{
  const f = path.join(DIST, 'api/v1/programmes/gb.json');
  const doc = path.join(DIST, 'api/index.html');
  if (!fs.existsSync(f) || !fs.existsSync(doc)) bad('gb.json or /api/ missing');
  else {
    const recs = JSON.parse(read(f)).programmes;
    const locked = recs.filter((r) => r.locked);
    const union = new Set(recs.flatMap((r) => Object.keys(r)));
    const inLocked = new Set(locked.flatMap((r) => Object.keys(r)));
    /* Anything the doc page prints in <code> and calls a field of this
       endpoint has to be a field of this endpoint. */
    const claimed = [...read(doc).matchAll(/<code>([a-z_]{3,})<\/code>/g)].map((m) => m[1]);
    const missing = claimed.filter((k) => /^[a-z][a-z_]*$/.test(k) && !union.has(k) &&
      ['name_en', 'funder', 'source_url', 'procedure_steps', 'documents_required', 'slug', 'category',
       'benefit_type', 'amount_min', 'amount_max', 'amount_currency', 'amount_period', 'admin_level',
       'admin_area', 'eligibility', 'is_automatic', 'verification_status', 'derived', 'locked'].includes(k));
    /* And the page must not promise "full records": it does not serve them. */
    const t = textOf(read(doc));
    const overclaim = /full records/i.test(t) || /whole dataset/i.test(t);
    if (missing.length) bad(`/api/ documents a field gb.json never carries: ${missing[0]}`);
    else if (overclaim) bad('/api/ still claims "full records" or "the whole dataset"');
    else if (locked.length && [...inLocked].some((k) => ['name_en', 'funder', 'source_url'].includes(k)))
      bad('a locked record in gb.json still carries a name, funder or source_url');
    else ok(`/api/ matches its payload (${recs.length} records, ${locked.length} stripped)`);
  }
}

/* ---------- A14: no claim we cannot point at running code -------------- */
/* Paired with scripts/test-reachability.mjs, which comes at it from the
   Worker side. Each entry stays here until the feature ships; when it does,
   delete the line here and switch the matching assertion on there. */
{
  const UNSHIPPED = [
    ['A14/1 client-side document encryption', /scrambled bytes|[Ee]ncrypted on your device/],
    ['A14/2 SSO', /\bSSO\b/],
    ['A14/2 audit log', /audit log/i],
    ['A14/2 role-based visibility', /role-based visibility/i],
    ['A14/3 CRM sync', /to your CRM/i],
    ['A14/3 webhooks', /[Ww]ebhooks? (?:fire|for)/],
    ['A14/4 reopen alerts', /[Rr]eopen alerts/],
    ['A14/4 weekly digest', /weekly digest/i],
    ['A14/5 store listings', /The Android and iOS app\b/],
  ];
  const offenders = [];
  for (const f of PAGES) {
    const t = textOf(html(f));
    for (const [id, re] of UNSHIPPED) if (re.test(t)) { offenders.push(`${id} on ${rel(f)}`); break; }
    if (offenders.length > 2) break;
  }
  offenders.length
    ? bad(`${offenders.length}+ pages sell something that does not exist, first: ${offenders[0]}`)
    : ok('no page sells a feature with no implementation');
}

/* ---------- A20(d): an eyebrow that repeats its own heading ------------ */
{
  const offenders = [];
  for (const f of PAGES) {
    const s = html(f);
    for (const m of s.matchAll(
      /<span class="eyebrow[^"]*">([^<]{2,})<\/span>\s*<h([1-6])[^>]*>([^<]{2,})<\/h\2>/g,
    )) {
      const eyebrow = m[1].trim().toLowerCase();
      const heading = m[3].trim().toLowerCase();
      if (eyebrow === heading) { offenders.push(`${rel(f)}: "${m[1].trim()}"`); break; }
    }
    if (offenders.length > 2) break;
  }
  offenders.length
    ? bad(`an eyebrow repeats its own heading: ${offenders[0]}`)
    : ok('no eyebrow repeats the heading beneath it');
}

/* ---------- A20(b): one binary, one pair of labels per locale ---------- */
{
  const offenders = [];
  const byLocale = new Map();
  for (const f of PAGES) {
    const m = html(f).match(/<html lang="([a-z]{2})"/);
    if (!m) continue;
    const set = byLocale.get(m[1]) ?? new Set();
    for (const t of html(f).matchAll(/data-aud-set="(?:me|biz)"[^>]*>([^<]+)</g)) set.add(t[1].trim());
    for (const t of html(f).matchAll(/<label for="acct-(?:me|biz)" class="audience__tab">([^<]+)</g)) set.add(t[1].trim());
    byLocale.set(m[1], set);
  }
  for (const [lg, set] of byLocale) {
    if (set.size > 2) offenders.push(`${lg}: ${set.size} labels — ${[...set].join(' / ')}`);
  }
  offenders.length
    ? bad(`the audience switch is labelled more than two ways: ${offenders[0]}`)
    : ok('the audience switch has exactly two labels in every locale');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
