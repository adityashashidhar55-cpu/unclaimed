#!/usr/bin/env node
/**
 * Free-tier conversion: showcase selection + named locked rows.
 *
 * scripts/test-gating.mjs already asserts the invariants that predate this
 * feature (the free total cannot move, the sold fields still strip). This
 * file is scoped to what changed: src/pages/free-tier.mjs's ranking, and the
 * client screens that render a locked row from a record that now carries a
 * name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickHouseholdShowcase,
  pickStartupShowcase,
  lockedHouseholdRecord,
  lockedStartupRecord,
} from '../src/pages/free-tier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };

const opaqueId = (s) => `p_${s}`; // identity-ish stand-in, good enough to key rows in this file

/* ------------------------------------------------------------------ */
/* 1. Ranking, on synthetic fixtures                                    */
/* ------------------------------------------------------------------ */

const NOW = Date.parse('2026-06-01');

{
  /* The exact shape of the bug the audit found: a closed record listed
     first, an open one listed second. The showcase must prefer the open
     one and must not include the closed one while the open one exists. */
  const programmes = [
    { name_en: 'Wound-down grant', status: 'closed', verification_status: 'unverified', benefit_type: 'in_kind', amount_max: 50000, eligibility: {} },
    { name_en: 'Open cash grant', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 500, eligibility: {} },
  ];
  const showcase = pickHouseholdShowcase(programmes, NOW, 1);
  showcase.has(1) && !showcase.has(0)
    ? ok('household showcase prefers an open record over a closed one listed first')
    : bad(`household showcase picked indices ${[...showcase]} — expected {1}`);
}

{
  /* Two open records: verified beats unverified, all else equal. */
  const programmes = [
    { name_en: 'Unverified', status: 'open', verification_status: 'unverified', benefit_type: 'cash_monthly', amount_max: 9000, eligibility: {} },
    { name_en: 'Verified', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 100, eligibility: {} },
  ];
  const showcase = pickHouseholdShowcase(programmes, NOW, 1);
  showcase.has(1)
    ? ok('household showcase prefers verified over a higher unverified amount')
    : bad(`expected the verified record, got indices ${[...showcase]}`);
}

{
  /* Same status and verification: a broadly-eligible cash programme beats a
     narrowly-restricted, non-cash one. */
  const broad = { name_en: 'Broad cash', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 100, eligibility: {} };
  const narrow = {
    name_en: 'Narrow in-kind', status: 'open', verification_status: 'verified', benefit_type: 'in_kind', amount_max: 9000,
    eligibility: { age_min: 60, age_max: 65, income_annual_max: 12000, requires_children: true, nationality: 'citizen', residency_months_min: 60, student_required: true, admin_areas: ['one-region'] },
  };
  const showcase = pickHouseholdShowcase([narrow, broad], NOW, 1);
  showcase.has(1)
    ? ok('household showcase prefers eligible-to-many cash over a narrow in-kind record')
    : bad(`expected the broad cash record, got indices ${[...showcase]}`);
}

{
  /* Highest amount is only the tiebreak, after status/verified/cash/breadth
     are equal. */
  const programmes = [
    { name_en: 'Smaller', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 100, eligibility: {} },
    { name_en: 'Larger', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 900, eligibility: {} },
  ];
  const showcase = pickHouseholdShowcase(programmes, NOW, 1);
  showcase.has(1)
    ? ok('household showcase breaks a tie on the higher amount_max')
    : bad(`expected the higher amount, got indices ${[...showcase]}`);
}

{
  /* A record with no published amount at all must not out-rank one that has
     one, once every other key is equal. */
  const programmes = [
    { name_en: 'No amount', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: null, eligibility: {} },
    { name_en: 'Has an amount', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 1, eligibility: {} },
  ];
  const showcase = pickHouseholdShowcase(programmes, NOW, 1);
  showcase.has(1)
    ? ok('a missing amount never out-ranks a published one on the tiebreak')
    : bad(`expected the record with a published amount, got indices ${[...showcase]}`);
}

{
  /* The startup showcase: same status/verified order, isFreeMoney (grant,
     not equity) as the cash proxy, amount as the tiebreak. Mirrors the exact
     US/India audit finding: a closed record first, an open one second. */
  const programmes = [
    { name_en: 'Wound-down accelerator', status: 'closed', verification_status: 'unverified', grant_type: 'equity', amount_max: 200000 },
    { name_en: 'Open grant', status: 'open', verification_status: 'verified', grant_type: 'grant', amount_max: 10000 },
  ];
  const showcase = pickStartupShowcase(programmes, NOW, 1);
  showcase.has(1) && !showcase.has(0)
    ? ok('startup showcase prefers an open grant over a closed equity deal listed first')
    : bad(`startup showcase picked indices ${[...showcase]} — expected {1}`);
}

{
  const programmes = [
    { name_en: 'Equity', status: 'open', verification_status: 'verified', grant_type: 'equity', amount_max: 900000 },
    { name_en: 'Grant', status: 'open', verification_status: 'verified', grant_type: 'grant', amount_max: 5000 },
  ];
  const showcase = pickStartupShowcase(programmes, NOW, 1);
  showcase.has(1)
    ? ok('startup showcase prefers non-dilutive cash (isFreeMoney) over a bigger equity deal')
    : bad(`expected the grant, got indices ${[...showcase]}`);
}

{
  /* Fewer than n eligible records: never throws, never invents an index. */
  const showcase = pickHouseholdShowcase([{ name_en: 'Only one', status: 'open', verification_status: 'verified', benefit_type: 'cash_monthly', amount_max: 1, eligibility: {} }], NOW);
  showcase.size === 1 && showcase.has(0)
    ? ok('a one-record country showcases exactly that record')
    : bad(`expected a single-index showcase, got ${[...showcase]}`);
  const empty = pickHouseholdShowcase([], NOW);
  empty.size === 0 ? ok('an empty programme list showcases nothing, without throwing') : bad('an empty list produced a non-empty showcase');
}

/* ------------------------------------------------------------------ */
/* 2. Locked-record shape: name/funder/url kept, sold fields still gone  */
/* ------------------------------------------------------------------ */

{
  const p = {
    slug: 'test-slug', name_en: 'Test Programme', name_local: 'Test Programme',
    funder: 'Test Funder', category: 'housing', benefit_type: 'cash_monthly',
    is_automatic: false, admin_level: 'national', admin_area: null,
    amount_min: 10, amount_max: 20, amount_period: 'monthly', amount_currency: 'GBP',
    verification_status: 'verified', status: 'open', closes_at: null, opens_at: null,
    eligibility: {}, application_url: 'https://example.gov/apply',
    documents_required: [{ doc: 'ID' }], procedure_steps: [{ step: 1, detail: 'x' }],
    source_snippet: 'quoted text', source_url: 'https://example.gov',
  };
  const locked = lockedHouseholdRecord(p, { cc: 'gb', base: '', opaqueId });
  locked.name_en === p.name_en ? ok('lockedHouseholdRecord keeps name_en') : bad('lockedHouseholdRecord dropped name_en');
  locked.funder === p.funder ? ok('lockedHouseholdRecord keeps funder') : bad('lockedHouseholdRecord dropped funder');
  locked.url === '/gb/housing/test-slug/' ? ok('lockedHouseholdRecord builds the public page url') : bad(`lockedHouseholdRecord url is ${locked.url}`);
  locked.amount_max === p.amount_max ? ok('lockedHouseholdRecord keeps amount_max unchanged') : bad('lockedHouseholdRecord moved amount_max');
  [locked.application_url, locked.documents_required, locked.procedure_steps, locked.source_snippet, locked.source_url]
    .every((v) => v == null)
    ? ok('lockedHouseholdRecord strips application_url, documents, procedure and source')
    : bad('lockedHouseholdRecord leaked a sold field');
  locked.slug !== p.slug ? ok('lockedHouseholdRecord still opaques the slug (name is public, the raw slug key is not the point of it)') : bad('lockedHouseholdRecord kept the raw slug');
}

{
  const p = {
    slug: 'co-slug', country_code: 'de', name_en: 'Co Programme', funder: 'Co Funder',
    category: 'grant', grant_type: 'grant', funder_type: 'public', admin_level: 'national',
    amount_min: 0, amount_max: 5000, amount_currency: 'EUR', cofunding_pct: 0, is_automatic: false,
    status: 'open', deadline_type: 'none', closes_at: null, opens_at: null,
    verification_status: 'verified', eligibility: {}, application_url: 'https://example.de/apply',
    documents_required: [{ doc: 'Plan' }],
  };
  const locked = lockedStartupRecord(p, { base: '', opaqueId });
  locked.name_en === p.name_en ? ok('lockedStartupRecord keeps name_en') : bad('lockedStartupRecord dropped name_en');
  locked.url === '/startups/de/co-slug/' ? ok('lockedStartupRecord builds the public page url') : bad(`lockedStartupRecord url is ${locked.url}`);
  locked.application_url == null && locked.documents_required == null
    ? ok('lockedStartupRecord strips application_url and documents')
    : bad('lockedStartupRecord leaked a sold field');
}

/* ------------------------------------------------------------------ */
/* 3. Against the real build, if it exists                             */
/* ------------------------------------------------------------------ */

if (fs.existsSync(DIST)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/countries.json'), 'utf8'));
  let checked = 0;
  for (const entry of manifest.countries) {
    const f = path.join(DIST, `api/v1/programmes/${entry.slug}.json`);
    if (!fs.existsSync(f)) continue;
    const pub = JSON.parse(fs.readFileSync(f, 'utf8'));
    checked += 1;
    const locked = pub.programmes.filter((p) => p.locked);
    const missingName = locked.filter((p) => !p.name_en);
    const missingUrl = locked.filter((p) => !p.url);
    if (missingName.length) bad(`${entry.slug}: ${missingName.length} locked records built without a name_en`);
    if (missingUrl.length) bad(`${entry.slug}: ${missingUrl.length} locked records built without a url`);
  }
  checked
    ? ok(`every locked household record in the built dist/ (${checked} countries) carries a name and a url`)
    : bad('no built country JSON found to check — did the build run?');

  for (const rel of ['us', 'in']) {
    const f = path.join(DIST, `api/v1/startups/${rel}.json`);
    if (!fs.existsSync(f)) continue;
    const pub = JSON.parse(fs.readFileSync(f, 'utf8'));
    const whole = pub.programmes.filter((p) => !p.locked);
    /* The audit's own finding, re-run against whatever data ships today: the
       showcase must not be entirely closed/paused/unknown while the pool
       has an open or rolling alternative. */
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${rel}.json`), 'utf8'));
    const anyOpen = source.programmes.some((p) => ['open', 'rolling'].includes(p.status));
    const showcaseOpen = whole.some((p) => ['open', 'rolling'].includes(p.status));
    !anyOpen || showcaseOpen
      ? ok(`${rel} startup showcase includes an open/rolling record (the exact case the audit flagged)`)
      : bad(`${rel} startup showcase is all closed/paused/unknown despite an open alternative existing`);
  }
} else {
  console.log('  (skipping dist/ checks — run `npm run build` first for the full picture)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
