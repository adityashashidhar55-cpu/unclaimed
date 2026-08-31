#!/usr/bin/env node
/**
 * What the page says when there is no figure.
 *
 * The sentence this replaces was "Set by <funder>", printed on 2,432 of 3,900
 * programme pages — the majority of the thing people pay for. The tests here
 * are mostly about what must NOT happen: the classifier reads prose, and prose
 * is exactly where a plausible-looking wrong number comes from.
 *
 * In order of what a failure costs:
 *   1. A monetary amount must never come out of prose. A means test read as a
 *      payment tells somebody they are owed the threshold they failed.
 *   2. An in-kind award must never be chased for a figure, or the harvest
 *      budget goes on free schooling and metro discounts.
 *   3. No page may render an empty or template-looking sentence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amountShape, amountSentence, needsFigure, shapeCounts, KIND, awardType } from '../packages/amounts/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nAmount shape\n');

/* ---- a figure always wins ---------------------------------------- */

is(amountShape({ amount_min: 100, amount_max: 100, benefit_type: 'cash_one_off' }).kind, KIND.FLAT, 'one figure is flat');
is(amountShape({ amount_min: 100, amount_max: 500, benefit_type: 'grant' }).kind, KIND.RANGE, 'two different figures are a range');
is(amountShape({ amount_min: null, amount_max: 500, benefit_type: 'grant' }).kind, KIND.FLAT, 'a ceiling alone is still a figure');
is(amountSentence({ amount_min: 100, amount_max: 500 }), null, 'money is the caller’s job, not this module’s');

/* ---- prose never becomes money ----------------------------------- */

/* The dangerous case, stated as data: a means test in the note, no figure in
   the fields. Nothing in the returned shape may carry a monetary value. */
const meansTested = {
  benefit_type: 'cash_monthly',
  funder: 'DWP',
  amount_note: 'Paid if your household income is under £16,190 a year and you have savings below £6,000.',
};
const ms = amountShape(meansTested);
no('value' in ms || 'min' in ms || 'max' in ms, 'a means test in prose produces no monetary field');
no(/16,190|6,000/.test(amountSentence(meansTested)), 'and the threshold is never printed as the award');

const priced = {
  benefit_type: 'cash_one_off',
  funder: 'Rail Delivery Group',
  amount_note: 'A Senior Railcard costs £30 a year and gives a third off most fares.',
};
no('value' in amountShape(priced), 'a price in prose does not become an award');

/* ---- in-kind is not a gap ---------------------------------------- */

const school = { benefit_type: 'in_kind', funder: 'MoE', amount_note: 'Free public schooling and tuition-free undergraduate study for citizens.' };
is(amountShape(school).kind, KIND.IN_KIND, 'an in-kind award is in-kind');
no(needsFigure(school), 'and is never sent to the harvester — there is no figure to find');
yes(/free public schooling/i.test(amountSentence(school)), 'the sentence says what you actually get');
no(/Set by/i.test(amountSentence(school)), 'and not who set it');

/* An in-kind record whose prose mentions loans must not be flatly denied. */
const loans = { benefit_type: 'in_kind', funder: 'ADHA', amount_note: 'Interest-free housing loans repayable over 25 years; grants for the poorest groups.' };
no(/not a cash payment/i.test(amountSentence(loans)), 'the page does not say "not a cash payment" over a sentence about loans');

/* ---- rates -------------------------------------------------------- */

is(amountShape({ grant_type: 'grant', cofunding_pct: 70 }).kind, KIND.RATE, 'a structured co-funding rate is a rate');
is(amountShape({ benefit_type: 'discount', funder: 'RTA', amount_note: '50% off metro fares for students.' }).pct, 50, 'a discount quotes its own percentage');
yes(/full exemption/i.test(amountSentence({ benefit_type: 'tax_credit', funder: 'FTA', amount_note: 'Qualifying persons pay 0% corporate tax.' })),
  'zero per cent reads as an exemption, not as a broken template');

/* A discount with no percentage is a thing you get, not a rate withheld. */
const card = { benefit_type: 'free_slab', funder: 'MOHAP', amount_note: 'Health card giving free or heavily subsidised treatment at public hospitals.' };
is(amountShape(card).kind, KIND.IN_KIND, 'a free allocation with no percentage is in-kind, not an unpublished rate');
no(/A percentage/i.test(amountSentence(card)), 'and is not described as a percentage nobody published');

/* ---- the sentence has to survive the corpus's prose --------------- */

/* 28 in-kind notes open by saying money is NOT involved, and the answer is in
   the clause after. Taking the first clause answered the question with its own
   premise: "What you get — no standard grant". */
yes(/paid pilot projects/i.test(amountSentence({ benefit_type: 'in_kind', grant_type: 'in_kind', funder: 'Bosch', amount_note: 'No standard grant. Provides paid pilot projects and commercial contracts with Bosch business units.' })),
  'a clause saying there is no cash is skipped for the one saying what there is');

/* But a negation about the READER's costs is the benefit itself. */
yes(/no childcare fees/i.test(amountSentence({ benefit_type: 'in_kind', funder: 'BMBWF', amount_note: 'No childcare fees from the kindergarten year after the 4th birthday until school entry.' })),
  'a negation about what you stop paying is kept — it is the award');

/* Lowercasing the first letter to make the phrase read as a continuation
   turned "BAS provides" into "bAS provides" on a real page. */
yes(/— BAS provides/.test(amountSentence({ benefit_type: 'in_kind', funder: 'BAS', amount_note: 'BAS provides in-kind support: coaching and mentoring.' })),
  'an acronym at the start of the phrase is not lowercased');
yes(/— housing loans/.test(amountSentence({ benefit_type: 'in_kind', funder: 'ADHA', amount_note: 'Housing loans and land grants for citizens.' })),
  'an ordinary word still is');

/* A long list is trimmed at a word boundary rather than dropped for the
   generic sentence, which named the funder and nothing else. */
{
  const long = { benefit_type: 'in_kind', funder: 'X', amount_note: 'Provides coaching, mentoring, expertise and training, access to global corporate partners, investor matchmaking, ecosystem access, peer learning and showcase opportunities at demo days.' };
  const sentence = amountSentence(long);
  yes(/coaching/.test(sentence), 'a long list keeps its beginning');
  yes(sentence.length < 200, 'and is trimmed rather than printed whole');
  no(/,…|:…/.test(sentence), 'and does not trim mid-punctuation');
}

/* ---- the harvest worklist ---------------------------------------- */

yes(needsFigure({ benefit_type: 'cash_monthly', funder: 'X', amount_note: 'Monthly support for eligible families.' }),
  'a cash benefit with no figure needs somebody to read the funder’s page');
no(needsFigure({ benefit_type: 'cash_monthly', amount_max: 200 }), 'a cash benefit that already has a figure does not');
no(needsFigure({ grant_type: 'equity', funder: 'X', amount_note: 'Equity investment.' }),
  'an equity programme is not chased for a grant figure');
no(needsFigure({ benefit_type: 'in_kind', funder: 'X', amount_note: 'Free training.' }), 'nor is an in-kind one');

/* ---- over the real corpus ---------------------------------------- */

function load(dir, skip) {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && !skip.includes(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')).programmes || []);
}
const ind = load('data', ['manifest.json', 'mcp-tools.json', 'fx-rates.json']);
const st = load('data/startups', ['manifest.json']);
const all = [...ind, ...st];

is(all.length, 3900, 'the whole corpus is classified');

let empty = 0;
let leftovers = 0;
let template = 0;
for (const p of all) {
  const shape = amountShape(p);
  if (shape.kind === KIND.FLAT || shape.kind === KIND.RANGE) continue;
  const s = amountSentence(p);
  if (!s || !s.trim()) { empty += 1; continue; }
  if (/^Set by /.test(s)) leftovers += 1;
  /* A sentence that is only punctuation and a funder name, or that still has
     an unfilled slot in it. */
  if (/undefined|null|\{\w+\}|— \.$|^— /.test(s)) template += 1;
}
is(empty, 0, 'every record without a figure still gets a sentence');
is(leftovers, 0, 'no page still says "Set by <funder>" and nothing else');
is(template, 0, 'no sentence renders an unfilled slot');

const counts = shapeCounts(all);
yes(counts.needs_figure > 0 && counts.needs_figure < counts.unpublished + counts.discretionary + counts.rate + 1,
  `the harvest worklist is ${counts.needs_figure} records, not all ${counts.unpublished + counts.rate + counts.in_kind + counts.discretionary} without a figure`);
is(all.filter((p) => needsFigure(p) && awardType(p) === 'in_kind').length, 0,
  'no in-kind record is on the harvest worklist');
is(all.filter((p) => needsFigure(p) && (p.amount_min != null || p.amount_max != null)).length, 0,
  'no already-priced record is on it either');

console.log(`\n  corpus shape: ${JSON.stringify(counts)}`);
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
