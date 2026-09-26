#!/usr/bin/env node
/**
 * One meaning for `cofunding_pct`, everywhere it is read.
 *
 * The field is the APPLICANT'S OWN SHARE of the project, not the grant
 * intensity. That is settled by the data, not by a comment: records whose
 * amount_note states a funding rate ("Funding rate is 80% of eligible costs",
 * "Covers 75% of advisory costs") carry 100 minus that rate, and records that
 * state a match ("A 20% non-federal match is required") carry the match.
 *
 * Every consumer has to agree, because they sit on the same page:
 *   - programme pages say "You must co-fund N%" and link the calculator
 *     with ?pct=N (src/build.mjs);
 *   - the calculator turns ?pct=N into a (100 - N)% intensity
 *     (src/pwa/cofunding.js + packages/rdcalc);
 *   - packages/amounts renders an unpriced co-funded record as
 *     "(100 - N)% of eligible costs" — it used to print N, i.e. "20% of
 *     eligible costs" on an 80% grant;
 *   - the brief says "Applicant must co-fund: N%" — it used to print 100 - N;
 *   - scoring and the pipeline nudge quote the same own-money figure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amountShape, amountSentence, KIND } from '../packages/amounts/index.js';
import { buildBrief, briefText } from '../packages/brief/index.js';
import { feasibility } from '../packages/scoring/index.js';
import { computeCofunding } from '../packages/rdcalc/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUPS = path.join(ROOT, 'data', 'startups');
const DIST = path.join(ROOT, 'dist');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m, extra = '') => (v ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ''}`));

console.log('\ncofunding_pct means the applicant\'s own share\n');

const SUPPORT = new Set(['manifest.json', 'duplicate-allowlist.json', 'dedupe-log.json', 'redirects.json']);
const all = [];
for (const f of fs.readdirSync(STARTUPS)) {
  if (!f.endsWith('.json') || SUPPORT.has(f)) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(STARTUPS, f), 'utf8')).programmes ?? []) all.push(p);
}
const byslug = (s) => all.find((p) => p.slug === s);

/* ---- 1. what the data says ------------------------------------------ */
{
  /* Records whose note carries percentages: does the field equal 100 - one
     of them (applicant share) or one of them (intensity)? 50 fits both and
     proves nothing, so it is left out. */
  let asShare = 0;
  let asIntensity = 0;
  for (const p of all) {
    const c = p.cofunding_pct;
    if (c == null || c <= 0 || c === 50) continue;
    const pcts = [...String(p.amount_note ?? '').matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 100);
    const share = pcts.includes(100 - c);
    const intensity = pcts.includes(c);
    if (share && !intensity) asShare += 1;
    if (intensity && !share) asIntensity += 1;
  }
  yes(asShare >= 50 && asShare > asIntensity * 5,
    `the dataset records the applicant's share (${asShare} records read as 100 - rate, ${asIntensity} as the rate itself — and those are "N% match required" notes)`);

  /* Anchors, quoted from the records themselves. */
  const anchors = [
    ['at-sfg-startklar-plus', /Up to 80% of eligible project costs/, 20],
    ['be-wal-cheque-cybersecurite', /Covers 75% of the cost/, 25],
    ['at-ffg-innovationsscheck', /Up to 80% funding rate/, 20],
    ['us-usda-rise', /A 20% non-federal match is required/, 20],
  ];
  for (const [slug, re, want] of anchors) {
    const p = byslug(slug);
    if (!p) { bad(`${slug} is missing from the dataset`); continue; }
    yes(re.test(p.amount_note ?? ''), `${slug}: the note still says ${re.source}`);
    is(p.cofunding_pct, want, `${slug}: cofunding_pct is the applicant's ${want}%`);
  }
}

/* ---- 2. packages/amounts -------------------------------------------- */
{
  const shape = amountShape({ grant_type: 'grant', cofunding_pct: 20, funder: 'SFG' });
  is(shape.kind, KIND.RATE, 'an unpriced co-funded grant is a rate');
  is(shape.pct, 80, 'and the rate is the award (100 - 20), not the applicant\'s share');
  const sentence = amountSentence({ grant_type: 'grant', cofunding_pct: 20, funder: 'SFG' });
  yes(/\b80% of eligible costs/.test(sentence), `and it reads "80% of eligible costs" (got "${sentence}")`);
  yes(!/\b20% of eligible costs/.test(sentence), 'never "20% of eligible costs"');
  is(amountShape({ grant_type: 'grant', cofunding_pct: 0 }).pct, 100, 'no co-funding means the award covers all eligible costs');
}

/* ---- 3. the brief --------------------------------------------------- */
{
  const programme = {
    slug: 'x', name_en: 'X', funder: 'F', grant_type: 'grant', status: 'open', cofunding_pct: 30,
    amount_max: 100000, amount_currency: 'EUR', documents_required: [], procedure_steps: [],
  };
  const brief = buildBrief({ type: 'deck', programme, profile: { name: 'Co', summary: 'Does things', turnover_annual_eur: 1e6 } });
  const text = briefText(brief);
  yes(/Applicant must co-fund: 30%/.test(text), 'the brief says the applicant co-funds 30%', text.split('\n').find((l) => /co-fund/.test(l)) ?? '');
  yes(!/Applicant must co-fund: 70%/.test(text), 'and not 70%');
}

/* ---- 4. the calculator prefill -------------------------------------- */
{
  const src = fs.readFileSync(path.join(ROOT, 'src/pwa/cofunding.js'), 'utf8');
  yes(/100 - ownPctParam/.test(src), 'the calculator turns ?pct=N (own share) into a 100 - N intensity');
  const r = computeCofunding({ projectCostEur: 100000, intensityPct: 100 - 25, paidInArrears: false });
  is(Math.round(r.grantAmountEur), 75000, 'at ?pct=25 a €100k project gets a €75k grant');
  is(Math.round(r.ownCashContributionEur), 25000, 'and the company puts in €25k — the 25% the programme page quoted');

  const page = path.join(DIST, 'startups/be/be-wal-cheque-cybersecurite/index.html');
  if (fs.existsSync(page)) {
    const html = fs.readFileSync(page, 'utf8');
    yes(/You must co-fund 25%/.test(html), 'the programme page quotes the applicant\'s 25%');
    yes(/tools\/co-funding\/\?pct=25"/.test(html), 'and links the calculator with ?pct=25, the same number');
  } else {
    bad('dist/ is missing — run `npm run build` first');
  }
}

/* ---- 5. scoring and the pipeline nudge quote the same money ----------- */
{
  const f = feasibility({ grant_type: 'grant', amount_max: 70000, amount_currency: 'EUR', cofunding_pct: 30 }, { cash_available_eur: 1000 });
  /* Grant €70k is the 70%; the company's 30% of a €100k project is €30k. */
  yes(f.reasons.some((r) => /€30,000 of your own money/.test(r)), 'a €70k grant at 30% own share needs €30,000 of the company\'s own money', f.reasons.join(' | '));
  const dash = fs.readFileSync(path.join(ROOT, 'src/pwa/dashboard.js'), 'utf8');
  yes(/amountEur\(p\) \* cofunding\) \/ \(100 - cofunding\)/.test(dash), 'the pipeline nudge uses the same grant x N / (100 - N)');
}

console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
