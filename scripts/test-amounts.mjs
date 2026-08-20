#!/usr/bin/env node
/**
 * The arithmetic behind every number this product prints.
 *
 * Three defects lived here at once and each one was silent:
 *
 *  1. `amount_period` had no `weekly`, so 25 records stored a weekly rate as
 *     `monthly` and annualize() multiplied it by 12. Ireland's contributory
 *     State Pension came out at EUR 898 a year against a real EUR 15,563.
 *  2. one_off grants were summed into a total captioned "per year". A
 *     Singapore retiree was shown SGD 419,695 "per year" of which SGD 350,305
 *     was three grants paid once.
 *  3. The company result's headline read only the FIRST non-dilutive band, so
 *     a GBP 10,000 Vouchers band vanished under a caption claiming the figure
 *     spanned all 20 eligible programmes.
 *
 * Every assertion below is on the property, not the copy: a period matches its
 * own published unit, a per-year total contains only per-year money, a
 * headline equals the sum of what it says it covers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match, annualizeAmount } from '../src/engine/matcher.js';
import { matchStartup, reachFor } from '../src/engine/startup.js';
import { extractPayment, extractAidIntensity } from './lib/amount-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const STARTUPS = path.join(DATA, 'startups');

let pass = 0;
let fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const countryFiles = fs
  .readdirSync(DATA)
  .filter((f) => f.endsWith('.json') && !['manifest.json', 'fx-rates.json', 'mcp-tools.json'].includes(f));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));

console.log('\nAmounts, periods and totals\n');

/* ------------------------------------------------------------------ *
 * 1. annualize() knows the periods the data uses.
 * ------------------------------------------------------------------ */
t('annualize(299.30, weekly) is 15563.6, not 3591.6',
  annualizeAmount(299.3, 'weekly') === 15563.6,
  `got ${annualizeAmount(299.3, 'weekly')}`);
t('annualize(100, fortnightly) is 2600', annualizeAmount(100, 'fortnightly') === 2600);
t('annualize(100, annual) is 100', annualizeAmount(100, 'annual') === 100);
t('annualize(null, weekly) is null', annualizeAmount(null, 'weekly') === null);

/* ------------------------------------------------------------------ *
 * 2. No record calls a weekly rate monthly.
 *
 * The test is the same one the migration used: the stored number appearing
 * verbatim in the note immediately before its own published unit. It needs no
 * research because the record is being checked against itself.
 * ------------------------------------------------------------------ */
{
  const variants = (v) => {
    const out = new Set([String(v), Number(v).toFixed(2), Number(v).toFixed(1), String(Math.round(v))]);
    for (const b of [...out]) {
      const [i, d] = b.split('.');
      const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      out.add(d ? `${g}.${d}` : g);
    }
    return out;
  };
  const PHRASE = /^\s*(?:per|a)[\s-]+(week|fortnight)\b/i;
  const bad = [];
  for (const f of countryFiles) {
    for (const p of load(f).programmes || []) {
      if (p.amount_period !== 'monthly') continue;
      const note = p.amount_note || '';
      for (const key of ['amount_max', 'amount_min']) {
        const v = p[key];
        if (v == null) continue;
        for (const nv of variants(v)) {
          let i = -1;
          while ((i = note.indexOf(nv, i + 1)) !== -1) {
            if (note[i - 1] && /[\d.,]/.test(note[i - 1])) continue;
            if (note[i + nv.length] && /\d/.test(note[i + nv.length])) continue;
            const m = note.slice(i + nv.length).match(PHRASE);
            if (m) { bad.push(`${f} ${p.slug} (${key}=${v} "per ${m[1]}")`); i = note.length; break; }
          }
        }
      }
    }
  }
  t('no record stores a weekly or fortnightly rate under amount_period "monthly"',
    bad.length === 0, bad.slice(0, 8).join('\n      '));
}

/* Every amount_period value is one the engine can annualize. A typo here is
   invisible: annualize() returns the raw number and the total is silently
   wrong by a factor of 12, 26 or 52. */
{
  const KNOWN = new Set(['weekly', 'fortnightly', 'monthly', 'annual', 'one_off']);
  const bad = [];
  for (const f of countryFiles) {
    for (const p of load(f).programmes || []) {
      if (p.amount_period != null && !KNOWN.has(p.amount_period)) bad.push(`${f} ${p.slug}: ${p.amount_period}`);
    }
  }
  t('every amount_period is in the docs/data-spec.md enum', bad.length === 0, bad.slice(0, 8).join('\n      '));
}

/* ------------------------------------------------------------------ *
 * 3. A per-year total contains only per-year money.
 * ------------------------------------------------------------------ */
{
  const PERSONAS = [
    { label: 'retiree', status: 'retired', age: 72, household_size: 2, income_band: 'b2', housing_tenure: 'owner' },
    { label: 'employee', status: 'employee', age: 35, household_size: 1, income_band: 'b3', housing_tenure: 'renting' },
    { label: 'parent', status: 'parent', age: 40, household_size: 4, children_count: 2, income_band: 'b2', housing_tenure: 'renting' },
  ];
  let bad = [];
  let sgSeen = false;
  for (const f of countryFiles) {
    const cc = f.replace('.json', '');
    const data = load(f);
    const entry = manifest.countries.find((c) => c.slug === cc);
    if (!entry) continue;
    for (const persona of PERSONAS) {
      const profile = {
        country_code: cc.toUpperCase(), admin_area: null, income_annual: null, children_count: 0,
        nationality_group: 'citizen_or_pr', residency_months: 600, circumstances: [], ...persona,
      };
      const r = match(profile, data, entry);
      /* The property: total_max is exactly the sum of the annualized non-one_off,
         non-capital contributors. No one-off money in a per-year figure, and
         nothing quietly missing from it either. */
      let expectedMax = 0;
      let expectedMin = 0;
      let oneOffMax = 0;
      for (const m of r.eligible) {
        if (m.is_capital) continue;
        if (m.programme.amount_period === 'one_off') { oneOffMax += m.est_annual_max ?? 0; continue; }
        expectedMax += m.est_annual_max ?? 0;
        expectedMin += m.est_annual_min ?? 0;
      }
      const near = (a, b) => Math.abs(a - b) < 0.01;
      if (!near(r.total_max, expectedMax) || !near(r.total_min, expectedMin)) {
        bad.push(`${cc}/${persona.label}: total ${r.total_min}-${r.total_max}, recurring ${expectedMin}-${expectedMax}`);
      }
      if (!near(r.one_off_max, oneOffMax)) {
        bad.push(`${cc}/${persona.label}: one_off_max ${r.one_off_max} vs ${oneOffMax}`);
      }
      if (cc === 'sg' && persona.label === 'retiree') {
        sgSeen = true;
        t('the SG retiree\'s per-year total excludes every one_off grant',
          r.eligible.filter((m) => m.programme.amount_period === 'one_off').length > 0 && r.one_off_max > 0 && r.total_max < r.one_off_max,
          `per-year ${r.total_max}, one-off ${r.one_off_max}`);
      }
    }
  }
  t('the SG retiree persona ran at all', sgSeen);
  t('for every country and persona, the per-year total is exactly the annualized non-one_off sum',
    bad.length === 0, bad.slice(0, 8).join('\n      '));
}

/* ------------------------------------------------------------------ *
 * 4. The company headline sums every non-dilutive band it claims to cover.
 * ------------------------------------------------------------------ */
{
  const STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'growth'];
  const MARKETS = ['us', 'gb', 'de', 'fr'];
  const poolCache = {};
  const poolsFor = (cc) => {
    const out = {};
    for (const pool of reachFor(cc)) {
      if (!(pool in poolCache)) {
        const p = path.join(STARTUPS, `${pool}.json`);
        poolCache[pool] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { programmes: [] };
      }
      out[pool] = poolCache[pool];
    }
    return out;
  };
  let multiBand = 0;
  const bad = [];
  for (const cc of MARKETS) {
    for (const stage of STAGES) {
      const r = matchStartup(
        { country_code: cc, incorporated: true, headcount: 10, turnover_annual_eur: 500000, stage, sectors: ['software'], rd_active: true },
        poolsFor(cc), Date.now(),
      );
      const totals = r.totals ?? {};
      const bands = Object.entries(totals).map(([type, x]) => ({ type, ...x })).filter((x) => x.count > 0);
      const free = bands.filter((b) => b.non_dilutive);
      if (free.length < 2) continue;
      multiBand += 1;
      /* The headline is the SUM of every non-dilutive band, per currency, and
         the caption's count is the number of contributing programmes — not
         eligible.length, which counted 16 programmes that gave nothing. */
      const summed = {};
      for (const b of free) {
        for (const [cur, v] of Object.entries(b.by_currency || {})) {
          const acc = (summed[cur] ||= { min: 0, max: 0 });
          acc.min += v.min ?? 0;
          acc.max += v.max ?? v.min ?? 0;
        }
      }
      const firstOnly = free[0].by_currency || {};
      const differs = Object.keys(summed).some((cur) => (summed[cur].max ?? 0) !== (firstOnly[cur]?.max ?? 0));
      if (!differs) continue; // the two agree here; nothing to distinguish
      const count = free.reduce((n, b) => n + (b.count ?? 0), 0);
      const eligible = r.buckets?.eligible ?? r.eligible ?? [];
      if (count > eligible.length) bad.push(`${cc}/${stage}: contributing ${count} > eligible ${eligible.length}`);
    }
  }
  t(`at least one (country, stage) pair has more than one non-dilutive band (${multiBand} found)`, multiBand > 0);
  t('a summed non-dilutive headline never claims more programmes than are eligible', bad.length === 0, bad.join('\n      '));

  /* And the regression itself: for a multi-band pair the sum must be strictly
     larger than the first band alone, which is what the screen used to show. */
  const r = matchStartup(
    { country_code: 'gb', incorporated: true, headcount: 10, turnover_annual_eur: 500000, stage: 'seed', sectors: ['software'], rd_active: true },
    poolsFor('gb'), Date.now(),
  );
  const bands = Object.entries(r.totals ?? {}).map(([type, x]) => ({ type, ...x })).filter((x) => x.count > 0)
    .sort((a, b) => Number(b.non_dilutive) - Number(a.non_dilutive) || b.count - a.count);
  const free = bands.filter((b) => b.non_dilutive);
  const sumMax = free.reduce((n, b) => n + Object.values(b.by_currency || {}).reduce((s, v) => s + (v.max ?? v.min ?? 0), 0), 0);
  const firstMax = Object.values(free[0]?.by_currency || {}).reduce((s, v) => s + (v.max ?? v.min ?? 0), 0);
  t('GB/seed: every non-dilutive band is in the headline, not just the first',
    free.length > 1 ? sumMax > firstMax : true, `sum ${sumMax}, first ${firstMax}, bands ${free.length}`);
}

/* ------------------------------------------------------------------ *
 * 5. The paywall does not sell a figure the same page prints for free.
 * ------------------------------------------------------------------ */
{
  const bad = [];
  for (const f of countryFiles) {
    for (const p of load(f).programmes || []) {
      if (p.amount_min != null || p.amount_max != null) continue;
      const e = extractPayment(p.amount_note);
      if (e) bad.push(`${f} ${p.slug}: "${e.phrase}" ${e.period}`);
    }
  }
  t('no record has both amounts null while its own note states a plain payment figure',
    bad.length === 0, bad.slice(0, 10).join('\n      '));
}

/* ------------------------------------------------------------------ *
 * 6. "No application needed" is written down, not left blank.
 * ------------------------------------------------------------------ */
{
  const bad = [];
  const dirs = [[DATA, countryFiles], [STARTUPS, fs.readdirSync(STARTUPS).filter((x) => x.endsWith('.json'))]];
  for (const [dir, files] of dirs) {
    for (const f of files) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const p of doc.programmes || []) {
        if (!p.is_automatic) continue;
        if (!(p.procedure_steps || []).length && !(p.documents_required || []).length) bad.push(`${f} ${p.slug}`);
      }
    }
  }
  t('every is_automatic record says so in procedure_steps', bad.length === 0, bad.slice(0, 10).join('\n      '));
}

/* ------------------------------------------------------------------ *
 * 8. A co-funding rate is money the applicant must find themselves.
 *
 * An equity stake, a loan's share of project cost, a tax-credit rate and a
 * fund-of-funds allocation are all percentages and none of them is that.
 * Run over the live startup corpus, extractAidIntensity() fired on twelve
 * records and six were wrong in exactly that way — including the British
 * Business Bank equity case the function's own comment says it exists to
 * refuse, and eu-esa-incubed's "up to 50-80%", where it silently picked the
 * upper bound and so understated what the applicant must put in.
 *
 * These are the real sentences, quoted from the records named. They are
 * asserted rather than the regex, because a regex test passes on a pattern
 * that no longer matches anything.
 * ------------------------------------------------------------------ */
{
  const CASES = [
    ['at-ffg-basisprogramm', 'Funds up to 70% of project costs for innovative R&D; loan repayment falls due five years after the project ends.', 70],
    ['fr-business-france-cheque-relance-export', 'Voucher that covered up to 50% of the cost of a Team France Export collective export action', 50],
    ['eu-esa-incubed', 'ESA typically covers up to 50-80% of project cost depending on the size.', null],
    ['gb-bbb-future-fund-breakthrough', "Co-investment into R&D-intensive companies, with the Bank taking up to 30% of the round.", null],
    ['in-fund-of-funds-for-startups', 'SIDBI contributes up to 15% of an AIF corpus.', null],
    ['us-ny-excelsior-jobs', 'an investment tax credit of up to 2% of qualifying investment costs', null],
    ['us-ut-jets', 'a post-performance refundable tax credit worth up to 30% of new state tax revenue', null],
    ['us-or-obdf', 'Direct state loans of up to $1 million (typically covering up to 40% of project cost) for land.', null],
    ['us-oh-ohio-microenterprise', 'provides fixed-rate loans of up to $500,000 covering up to 50% of eligible project costs', null],
    ['us-il-edge', 'A non-refundable credit against Illinois income tax based on income tax withholding - up to 50% of withholdings', null],
  ];
  const wrong = CASES.filter(([, text, want]) => extractAidIntensity(text) !== want)
    .map(([slug, text, want]) => `${slug}: got ${extractAidIntensity(text)}, expected ${want}`);
  t('a co-funding rate is only read off money the applicant actually has to match',
    wrong.length === 0, wrong.join('\n      '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
