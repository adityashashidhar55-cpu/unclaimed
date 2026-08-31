#!/usr/bin/env node
/**
 * The brief a generated document is written from.
 *
 * The model is the part you cannot test. The brief is the part you can, and it
 * is where the quality actually lives: a deck that answers the funder's
 * published criteria in the funder's own order beats a beautifully written one
 * that answers nobody's. So this asserts the assembly, not the prose.
 *
 * Two failures matter more than the rest:
 *   1. A brief that carries a number the funder never published. The model
 *      will use it, and somebody will plan around it.
 *   2. A brief produced for a programme the applicant plainly cannot win.
 *      Charging for a document that cannot succeed is the thing this product
 *      exists to be better than.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrief, briefText, OUTLINES, RULES, companyFacts, funderFacts } from '../packages/brief/index.js';
import { testProgramme } from '../src/engine/startup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nGeneration brief\n');

const PROFILE = {
  name: 'Kestrel Robotics GmbH',
  country_code: 'de',
  incorporation_date: '2023-04-01',
  headcount: 11,
  stage: 'seed',
  sectors: ['robotics'],
  turnover_annual_eur: 410000,
  rd_active: true,
  has_local_entity: true,
  summary: 'Warehouse pick-and-place arms.',
  /* Deliberately present and empty — these must not reach the brief. */
  balance_sheet_eur: null,
  female_founder: undefined,
  notes: '',
};

const PRICED = {
  slug: 'x-priced', name_en: 'Priced Programme', funder: 'Agency', country_code: 'de',
  grant_type: 'grant', status: 'open', amount_min: 10000, amount_max: 50000,
  amount_currency: 'EUR', amount_period: 'one_off', amount_note: 'Between €10,000 and €50,000.',
  source_snippet: 'Grants of between EUR 10,000 and EUR 50,000 are available.',
  procedure_steps: [{ step: 1, detail: 'Submit online', url: 'https://x/apply' }],
  documents_required: [{ doc: 'Project plan', mandatory: true, note: null }],
  eligibility: {},
};

const UNPRICED = {
  ...PRICED, slug: 'x-unpriced', amount_min: null, amount_max: null,
  amount_note: 'Support is provided as advisory services; the page states no figure.',
  grant_type: 'in_kind',
  source_snippet: 'Applicants receive mentoring worth an unspecified amount.',
};

/* ---- assembly ----------------------------------------------------- */

is(buildBrief({ type: 'nope', programme: PRICED, profile: PROFILE }).error, 'unknown_type', 'an unknown output type is refused');
is(buildBrief({ type: 'deck', programme: null, profile: PROFILE }).error, 'no_programme', 'a brief needs a programme');

const deck = buildBrief({ type: 'deck', programme: PRICED, profile: PROFILE });
is(deck.ok, true, 'a normal brief assembles');
is(deck.outline, OUTLINES.deck, 'and carries the outline for its type');
is(deck.rules, RULES, 'and the rules, in the payload rather than only in a system prompt');

/* ---- money -------------------------------------------------------- */

is(deck.funder.amount_stated.min, 10000, 'a published figure travels as structured money');
const unpriced = buildBrief({ type: 'deck', programme: UNPRICED, profile: PROFILE });
is(unpriced.funder.amount_stated, null, 'an unpublished one travels as null, not as a number from the prose');
yes(unpriced.funder.amount_described, 'and is described in words instead');
no(/\b(10,?000|50,?000)\b/.test(briefText(unpriced)), 'no figure from another record leaks into the text');

/* The rules must actually say the thing the rest of the codebase enforces. */
yes(RULES.some((r) => /amount_stated is null/.test(r)), 'the rules tell the model what to do with a missing amount');
yes(RULES.some((r) => /never guess/i.test(r)), 'and forbid guessing a missing fact');
yes(RULES.some((r) => /will succeed|decision is the funder/i.test(r)), 'and forbid claiming the application will win');

/* ---- eligibility -------------------------------------------------- */

const failing = { ...PRICED, slug: 'x-fail', eligibility: { stages: ['series_a'], headcount_max: 5 } };
const verdict = testProgramme(failing, PROFILE, Date.now());
const refused = buildBrief({ type: 'deck', programme: failing, profile: PROFILE, verdict });
is(refused.ok, false, 'a company that fails the funder’s own rules gets no document');
is(refused.error, 'not_eligible', 'and is told why');
yes((refused.fails ?? []).length > 0, 'naming the rule it fails, not just refusing');

/* Unknowns are not failures — they are questions, and they become placeholders. */
const partial = buildBrief({
  type: 'narrative', programme: PRICED, profile: PROFILE,
  verdict: { verdict: 'needs_answer', fails: [], unknowns: ['headcount', 'rd_active'] },
});
is(partial.ok, true, 'an unanswered question does not block the document');
yes(partial.missing.includes('headcount'), 'it becomes something the applicant must supply');
yes(/placeholder/i.test(briefText(partial)), 'and the text says to mark it rather than guess it');

/* ---- the profile -------------------------------------------------- */

const facts = companyFacts(PROFILE);
no('balance_sheet_eur' in facts, 'a null field is left out rather than sent as null');
no('female_founder' in facts, 'so is an undefined one');
no('notes' in facts, 'and an empty string');
no('secret_field' in companyFacts({ ...PROFILE, secret_field: 'x' }), 'and anything not on the allow-list');
is(facts.headcount, 11, 'while real values come through');

/* ---- rendering ---------------------------------------------------- */

const text = briefText(deck);
no(/\[object Object\]/.test(text), 'steps and documents render as text, not as [object Object]');
yes(/Submit online/.test(text), 'the funder’s own steps appear');
yes(/Project plan/.test(text), 'so do the required documents');
yes(/> Grants of between/.test(text), 'and the funder’s own words are quoted as theirs');
no(/not published/i.test(briefText(buildBrief({ type: 'deck', programme: { ...PRICED, status: 'unknown' }, profile: PROFILE }))),
  'a deadline module saying "status not published" is dropped rather than passed through');

/* A closed call is written for, not refused — the next round is a date. */
const closed = buildBrief({ type: 'deck', programme: { ...PRICED, status: 'closed', closes_at: '2020-01-01' }, profile: PROFILE });
is(closed.ok, true, 'a closed call still gets a document');
is(closed.write_for_next_round, true, 'flagged as being for the next round');
yes(/next round/i.test(briefText(closed)), 'and the text says so');

/* ---- against the real corpus -------------------------------------- */

{
  const dir = path.join(ROOT, 'data/startups');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).programmes || []);
  let objectLeak = 0;
  let moneyLeak = 0;
  let built = 0;
  for (const p of all.slice(0, 400)) {
    const b = buildBrief({ type: 'deck', programme: p, profile: PROFILE });
    if (!b.ok) continue;
    built += 1;
    const t = briefText(b);
    if (/\[object Object\]/.test(t)) objectLeak += 1;
    /* If the record publishes no structured amount, the "The award" section
       must not contain a currency figure. */
    if (!b.funder.amount_stated) {
      const award = t.split('## The award')[1]?.split('##')[0] ?? '';
      if (/[€£$]\s?\d|\d[\d.,]*\s?(EUR|USD|GBP)/.test(award)) moneyLeak += 1;
    }
  }
  yes(built > 100, `${built} briefs assembled from real records`);
  is(objectLeak, 0, 'none render an object where text belongs');
  is(moneyLeak, 0, 'and none put a currency figure in the award section of an unpriced record');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
