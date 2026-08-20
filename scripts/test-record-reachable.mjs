#!/usr/bin/env node
/**
 * Every programme in the dataset must be reachable by SOME reader.
 *
 * The suite has always asked whether a record is well-formed. It never asked
 * the only question the reader cares about — can anybody get this money? —
 * and two whole classes of dead record lived behind green tests for rounds:
 *
 *   · 74 nationwide private offers (railcards, water-company social tariffs,
 *     the SBB Half Fare travelcard, a UAE-wide phone tariff) were flagged
 *     `geography_unknown` because round 1 read `admin_level: "private"` as a
 *     kind of place. Driven against the real matcher, ch/halbtax-sbb answered
 *     "Which part of Switzerland do you live in?" and then matched none of
 *     the sixteen cantons the wizard offers. Every profile, every locale.
 *
 *   · records whose `student_required` contradicts their own `statuses`:
 *     ie/back-to-education-allowance listed unemployed, jobseeker and parent
 *     and also demanded student, so all four answers were refused — three
 *     "requires you to be a student", the fourth "is for people who are out
 *     of work". A hard fail, which is money denied rather than merely hidden.
 *
 * Both are asserted here through match(), not by re-reading the fields: the
 * bug in both cases was that two correct-looking fields disagreed, which only
 * shows up when something runs them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/engine/matcher.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };

/* Every answer the wizard offers to "what is your situation". A record that
   refuses all of them refuses everyone. */
const STATUSES = ['student', 'employee', 'self_employed', 'unemployed', 'retired', 'parent', 'jobseeker'];

const NOW = Date.parse('2026-06-01');
/* Deliberately thin on everything except status: an unanswered attribute
   yields "unknown" (a question), never "fail", so this isolates the gates
   that refuse rather than the ones that ask. children_count is set because
   satisfiesStatus() treats having a child as being a parent. */
const profileFor = (status) => ({
  status,
  age: null,
  income_band: null,
  housing_tenure: null,
  nationality_group: 'citizen_or_pr',
  children_count: status === 'parent' ? 1 : 0,
  admin_area: null,
});

/* The two sentences the status rule and the student rule emit. Matched
   narrowly on purpose: an early draft used /^This programme is for / alone
   and swept up the NATIONALITY rule's "This programme is for refugees and
   asylum seekers", reporting eight asylum programmes with no status rule at
   all as dead. */
const STATUS_LABELS = ['students', 'employed people', 'self-employed people', 'people who are out of work',
  'retired people', 'parents', 'jobseekers'];
const isStatusRefusal = (s) =>
  /requires you to be a student/.test(s) ||
  (/^This programme is for /.test(s) && STATUS_LABELS.some((l) => s.includes(l)));

const deadOnStatus = [];
const asksWhereWithNowhere = [];
let records = 0;

for (const entry of manifest.countries) {
  const file = path.join(DATA, `${entry.slug}.json`);
  if (!fs.existsSync(file)) continue;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byslug = new Map(doc.programmes.map((p) => [p.slug, p]));
  records += doc.programmes.length;

  /* slug → did any answer to "your situation" avoid a flat refusal? */
  const survived = new Set();
  const askedWhere = new Map();

  for (const status of STATUSES) {
    const r = match(profileFor(status), doc, NOW);
    const refused = new Set();
    for (const m of r.not_eligible || []) {
      if ((m.rules_failed || []).some(isStatusRefusal)) refused.add(m.programme.slug);
    }
    for (const p of doc.programmes) if (!refused.has(p.slug)) survived.add(p.slug);
    for (const m of r.needs_one_more_answer || []) {
      if (m.blocking_attribute === 'admin_area') askedWhere.set(m.programme.slug, true);
    }
  }

  for (const p of doc.programmes) {
    if (!survived.has(p.slug)) deadOnStatus.push(`${entry.slug}/${p.slug}`);
    /* Asking where someone lives is fine when the record knows which places
       it covers. Asking when it holds no places at all is a question with no
       right answer — the reader picks a region and is refused, or picks
       nothing and is never told. */
    /* Scoped to records that HAVE no locality to record: national schemes and
       private nationwide offers. A record marked region/city/state with an
       empty area list is a different, known state — the locality genuinely
       has not been researched yet, and "we have not recorded which parts of
       France this covers" is the honest thing to say. Widening this to those
       35 would be asserting that unfinished research is a bug in the code. */
    const areas = p.eligibility?.admin_areas || [];
    const nowhereToBe = p.admin_level === 'national' || p.admin_level === 'private' || !p.admin_level;
    if (askedWhere.has(p.slug) && areas.length === 0 && nowhereToBe) {
      asksWhereWithNowhere.push(`${entry.slug}/${p.slug} (${p.admin_level})`);
    }
  }
}

const show = (list) => list.slice(0, 5).join(', ') + (list.length > 5 ? `, +${list.length - 5} more` : '');

deadOnStatus.length === 0
  ? ok(`no record refuses all ${STATUSES.length} answers to "what is your situation" (${records} records)`)
  : bad(`${deadOnStatus.length} records refuse every situation the wizard offers, so no reader can ever claim them: ${show(deadOnStatus)}`);

asksWhereWithNowhere.length === 0
  ? ok('no record asks the reader where they live without holding a list of places it covers')
  : bad(`${asksWhereWithNowhere.length} records ask "which part of the country" and hold no answer that works: ${show(asksWhereWithNowhere)}`);

/* The specific shape round 1 created, asserted directly so it cannot come
   back under a different flag: a private funder is not a place. */
{
  const strays = [];
  for (const entry of manifest.countries) {
    const file = path.join(DATA, `${entry.slug}.json`);
    if (!fs.existsSync(file)) continue;
    for (const p of JSON.parse(fs.readFileSync(file, 'utf8')).programmes) {
      if (p.admin_level === 'private' && p.eligibility?.rule_source === 'geography_unknown' && !(p.eligibility.admin_areas || []).length) {
        strays.push(`${entry.slug}/${p.slug}`);
      }
    }
  }
  strays.length === 0
    ? ok('no nationwide private offer is filed as a place we have not identified')
    : bad(`${strays.length} private offers are gated on a geography they do not have: ${show(strays)}`);
}

console.log(`record-reachable: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
