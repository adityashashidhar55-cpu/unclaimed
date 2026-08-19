#!/usr/bin/env node
/**
 * Two datasets, two deadline shapes, one function.
 *
 * The bug this exists to stop had no error and no test: deadlineState() was
 * written for the startup dataset, which carries `status` and sometimes
 * `closes_at`. Benefit programmes carry neither — all of them describe their
 * calendar as a `deadline_type` plus a prose note. So every one of the 2,216
 * benefit records fell through to the terminal branch, every row in the
 * individual app read "Status not published", and the deadlines screen the
 * pricing page sells returned nothing at all. Nothing failed. It just said
 * nothing, everywhere, forever.
 *
 * So this asserts the property that actually matters: for every real record in
 * both datasets, the answer is something a person can act on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deadlineState } from '../packages/deadlines/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nDeadlines\n');

const read = (p) => JSON.parse(fs.readFileSync(path.join(DIST, p), 'utf8'));
const manifest = read('api/v1/countries.json');
const startups = read('api/v1/startups/index.json');

/* ---- benefits: prose-shaped, and none of it may read as missing ---- */
{
  let n = 0;
  let unknown = 0;
  let noHeadline = 0;
  let invented = 0;
  for (const c of manifest.countries) {
    /* The full copies under dist/ only exist when EMIT_FULL_DATASET=1, so read
       the source dataset when they are absent. Reading only the optional
       artefact is how this loop quietly ran over zero records. */
    const f = [
      path.join(DIST, `api/v1/full/programmes/${c.slug}.json`),
      path.join(ROOT, 'data', `${c.slug}.json`),
    ].find((x) => fs.existsSync(x));
    if (!f) continue;
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8')).programmes) {
      if (p.status) continue; // a startup-shaped record; covered below
      n += 1;
      const d = deadlineState(p);
      if (d.urgency === 'unknown') unknown += 1;
      if (!d.headline) noHeadline += 1;
      /* The hard rule: no date may be produced for a record that has none.
         A reminder for an invented deadline is worse than no reminder. */
      if (d.at != null) invented += 1;
    }
  }
  t(`every one of ${n} benefit records gets a headline`, n > 0 && noHeadline === 0);
  t('no benefit record reads as "status not published"', unknown === 0);
  t('no date is invented for a record that has none', invented === 0);
}

/* ---- startups: date-shaped, and must be untouched ---- */
{
  let n = 0;
  let dated = 0;
  let withDates = 0;
  for (const c of startups.countries) {
    const f = path.join(DIST, `api/v1/startups/${c.slug}.json`);
    if (!fs.existsSync(f)) continue;
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8')).programmes) {
      if (!p.status) continue;
      n += 1;
      const d = deadlineState(p);
      if (p.closes_at) {
        withDates += 1;
        if (d.at != null) dated += 1;
      }
    }
  }
  t(`${n} startup records still use the date path`, n > 0);
  t(`every one of the ${withDates} with a real closing date keeps it`, withDates === 0 || dated === withDates);
}

/* ---- the branch must not swallow a startup record ---- */
t(
  'a record with a status is never routed to the prose branch',
  deadlineState({ status: 'open', deadline_type: 'rolling' }).from_prose === undefined,
);
t(
  'a record with only a deadline_type takes the prose branch',
  deadlineState({ deadline_type: 'rolling' }).from_prose === true,
);
t(
  'an unrecognised deadline_type falls through rather than guessing',
  deadlineState({ deadline_type: 'nonsense' }).urgency === 'unknown',
);

/* The specific records that were hidden: announced, not open yet, and closing
   on a date the funder has published. They are the most actionable thing in
   the dataset and were reported as "Closed for now" with no date, so they
   reached no reminder and no calendar export. */
{
  const soon = deadlineState(
    { status: 'upcoming', closes_at: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) },
  );
  t('an upcoming programme with a future close date keeps its date', soon.at != null);
  t('and does not read as closed', !/Closed for now/.test(soon.headline));
  const past = deadlineState({ status: 'upcoming', closes_at: '2020-01-01' });
  t('a close date in the past is not resurrected', past.at == null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
