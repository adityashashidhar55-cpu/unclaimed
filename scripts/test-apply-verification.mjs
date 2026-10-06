#!/usr/bin/env node
/**
 * scripts/apply-verification.mjs against fixtures: a tiny repo root with one
 * household file (indent 1, no trailing newline — like data/us.json), one
 * company file (minified — like data/startups/de.json) and hand-written
 * patch / review / add files.
 *
 * Nothing here touches the real data/ or /home/claude/verify.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyVerification, derivedTurnoverEur } from './apply-verification.mjs';

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const t = (m, v, extra = '') => (v ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ''}`));

console.log('\napply-verification\n');

/* ---------------- fixtures ---------------- */
const house = (slug, extra = {}, elig = {}) => ({
  slug, name_local: slug, name_en: `Programme ${slug}`, admin_level: 'national', admin_area: null, funder: 'Funder One',
  category: 'housing', benefit_type: 'cash_monthly', amount_min: 100, amount_max: 200, amount_currency: 'EUR',
  amount_period: 'monthly', amount_note: null, is_automatic: false, application_url: 'https://example.org/a',
  application_channel: 'online', deadline_type: 'rolling', deadline_note: null, procedure_steps: [], documents_required: [],
  eligibility: {
    statuses: [], age_min: null, age_max: null, income_annual_max: null, income_note: null, requires_children: false,
    nationality: 'any_resident', residency_months_min: null, housing_tenure: null, student_required: false, admin_areas: [], gender: 'any',
    ...elig,
  },
  source_url: 'https://example.org/s', source_snippet: 'x', last_verified_at: '2026-08-12', verification_status: 'auto_extracted',
  ...extra,
});
const comp = (slug, extra = {}, elig = {}) => ({
  slug, name_local: slug, name_en: `Grant ${slug}`, country_code: 'yy', admin_level: 'national', admin_area: null, funder: 'Agency Two',
  funder_type: 'public', grant_type: 'grant', category: 'startup', amount_min: 1000, amount_max: 5000, amount_currency: 'SEK',
  amount_note: null, cofunding_pct: 20, is_automatic: false, application_url: 'https://example.org/c', application_channel: 'online',
  status: 'open', deadline_type: 'annual_call', deadline_note: null, closes_at: '2026-12-01', opens_at: null, reopen_note: null,
  cycle: 'annual', typical_months: [3], last_call_closed_at: null, procedure_steps: [], documents_required: [],
  eligibility: {
    entity: 'startup', company_age_months_min: null, company_age_months_max: null, headcount_min: null, headcount_max: null,
    turnover_annual_max: null, sme_category: 'any', sectors: ['any'], stages: ['seed'], requires_local_entity: true,
    requires_incorporation: true, rd_focus: false, female_founder_only: false, underrepresented_focus: false, de_minimis: false,
    other_note: null, ...elig,
  },
  source_url: 'https://example.org/cs', source_snippet: null, last_verified_at: '2026-08-14', verification_status: 'unverified',
  ...extra,
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-verif-'));
  fs.mkdirSync(path.join(root, 'data/startups'), { recursive: true });
  const hdoc = { country_code: 'XX', country_name: 'Xland', currency: 'EUR', language: 'en', programmes: [house('h-one'), house('h-two'), house('h-three', {}, { nationality: 'citizen_or_pr' })] };
  fs.writeFileSync(path.join(root, 'data/xx.json'), JSON.stringify(hdoc, null, 1)); // indent 1, no trailing newline
  const cdoc = { country_code: 'yy', country_name: 'Yland', currency: 'SEK', language: 'sv', entity: 'startup', programmes: [comp('c-one'), comp('c-two'), comp('c-three', { name_en: 'Totally Different Scheme', funder: 'Other Body' })] };
  fs.writeFileSync(path.join(root, 'data/startups/yy.json'), JSON.stringify(cdoc)); // minified
  fs.writeFileSync(path.join(root, 'data/fx-rates.json'), JSON.stringify({ rates_as_of: '2026-08-01', base: 'EUR', units_per_eur: { EUR: 1, SEK: 10 } }, null, 2));
  fs.writeFileSync(path.join(root, 'data/manifest.json'), '{"countries":[]}');
  return root;
}
const w = (dir, name, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), JSON.stringify(obj)); };
const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const rec = (root, rel, slug) => read(root, rel).programmes.find((p) => p.slug === slug);
const snapshot = (root) => ['data/xx.json', 'data/startups/yy.json'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n---\n');

const root = makeRoot();
fs.writeFileSync(path.join(root, 'data/startups/duplicate-allowlist.json'), '[]\n');
const vdir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-verif-in-'));
const run = (o = {}) => applyVerification({ root, verifyDir: vdir, report: path.join(vdir, 'APPLY_REPORT.md'), ...o });
const HF = 'data/xx.json';
const CF = 'data/startups/yy.json';

w(path.join(vdir, 'patches'), 'b1.json', {
  batch: 'b1',
  results: [
    /* valid household update, dotted keys, with one invalid enum, one string-for-number, one unknown field, one identity field */
    { slug: 'h-one', file: HF, action: 'updated', set: {
      amount_max: 250, amount_note: 'Now 250', 'eligibility.nationality': 'citizen_or_pr', 'eligibility.income_annual_max': 30000,
      benefit_type: 'cashy', amount_min: '100', mystery: 1, slug: 'renamed', 'eligibility.gender': 'female',
      last_verified_at: '2026-10-05', verification_status: 'verified' }, evidence_url: 'https://example.org/s' },
    /* household retired: set omits the marker */
    { slug: 'h-two', file: HF, action: 'retired', set: { deadline_note: 'The scheme closed in 2026', last_verified_at: '2026-10-05', verification_status: 'verified' } },
    /* wrong file, right slug: still found */
    { slug: 'h-three', file: 'data/nowhere.json', action: 'confirmed', set: {} },
    /* company update incl. alias-free enums, turnover with derived EUR, cross-field violation */
    { slug: 'c-one', file: CF, action: 'updated', set: {
      status: 'closed', closes_at: '2026-11-30', cofunding_pct: 35, 'eligibility.turnover_annual_max': 5000000,
      'eligibility.stages': ['seed', 'series_a'], 'eligibility.sectors': ['ai', 'nonsense-sector'], deadline_type: 'cutoff',
      amount_min: 9000, amount_max: 8000, typical_months: [9, 3, 3],
      last_verified_at: '2026-10-05', verification_status: 'verified' } },
    /* company retired with nothing but the note */
    { slug: 'c-two', file: CF, action: 'retired', set: { reopen_note: null } },
    { slug: 'c-three', file: CF, action: 'unverifiable', set: { amount_max: 1 } },
    /* turned automatic with no steps: gets the repo's standard "No application needed" step */
    { slug: 'h-auto', file: HF, action: 'updated', set: { is_automatic: true, last_verified_at: '2026-10-05' } },
    /* rejected by the supervisor */
    { slug: 'h-rejected-target', file: HF, action: 'updated', set: { amount_max: 1 } },
    { slug: 'ghost', file: HF, action: 'updated', set: { amount_max: 1 } },
  ],
});
/* a second household record to reject, present in the data */
{
  const d = read(root, HF);
  d.programmes.push(house('h-rejected-target'), house('h-auto'));
  fs.writeFileSync(path.join(root, HF), JSON.stringify(d, null, 1));
}
w(path.join(vdir, 'reviews'), 'b1.json', { reject_slugs: ['h-rejected-target'] });
w(path.join(vdir, 'adds'), 'a1.json', {
  batch: 'a1',
  adds: [
    { file: HF, record: house('h-new', { name_en: 'Brand New Allowance', funder: 'Funder Three' }) },
    /* sparse: only what an agent bothered with */
    { file: HF, record: { slug: 'h-sparse', name_en: 'Sparse Aid', funder: 'Funder Four', source_url: 'https://example.org/sparse', eligibility: { nationality: 'citizen_or_pr' } } },
    { file: HF, record: house('h-one', { name_en: 'Same slug as existing' }) },
    { file: HF, record: house('h-dupname', { name_en: 'programme H-ONE', funder: 'FUNDER one' }) },
    { file: HF, record: house('h-rejected-add', { name_en: 'Rejected Add', funder: 'F' }) },
    { file: HF, record: house('h-nosource', { name_en: 'No Source', funder: 'F', source_url: 'not a url' }) },
    { file: CF, record: comp('c-new', { name_en: 'Fresh Innovation Cheque', funder: 'Agency Five', amount_currency: 'SEK' }, { turnover_annual_max: 2000000 }) },
    { file: CF, record: comp('c-lookalike', { name_en: 'Grant c-one', funder: 'Agency Two' }) },
    { file: 'data/startups/zz.json', record: comp('c-elsewhere') },
    /* two distinct calls that cite one official page: allowlisted, not left to fail test-duplicates */
    { file: CF, record: comp('c-twin-a', { name_en: 'Alpha Bridge Cheque', funder: 'Agency Six', source_url: 'https://example.org/programmes/alpha/calls' }) },
    { file: CF, record: comp('c-twin-b', { name_en: 'Alpha Gateway Cheque', funder: 'Agency Seven', source_url: 'https://example.org/programmes/alpha/calls' }) },
    /* a regional record with a label but no gate */
    { file: HF, record: house('h-region', { name_en: 'Regional Rent Help', funder: 'Region Fund', admin_level: 'region', admin_area: 'Bavaria' }) },
  ],
});
w(path.join(vdir, 'reviews'), 'a1.json', { reject_slugs: ['h-rejected-add'] });

/* ---------------- dry run ---------------- */
const before = snapshot(root);
const dry = run({ dryRun: true });
t('a dry run writes no data file', snapshot(root) === before);
t('a dry run still writes the report', fs.existsSync(path.join(vdir, 'APPLY_REPORT.md')) && /DRY RUN/.test(fs.readFileSync(path.join(vdir, 'APPLY_REPORT.md'), 'utf8')));
t('a dry run reports what it would write', dry.wouldWrite.includes(HF) && dry.wouldWrite.includes(CF) && dry.wrote.length === 0);

/* ---------------- real run ---------------- */
const s = run();
t('every result is counted by action', s.results === 9 && s.byAction.updated === 5 && s.byAction.retired === 2 && s.byAction.confirmed === 1 && s.byAction.unverifiable === 1,
  JSON.stringify(s.byAction));
t('a supervisor-rejected slug is skipped and reported', s.rejected.length === 1 && s.rejected[0].slug === 'h-rejected-target' && rec(root, HF, 'h-rejected-target').amount_max === 200);
t('a result for a record that does not exist is reported, not fatal', s.unresolved.some((u) => u.slug === 'ghost'));

/* household update */
{
  const p = rec(root, HF, 'h-one');
  t('top-level fields are set', p.amount_max === 250 && p.amount_note === 'Now 250');
  t('dotted eligibility keys are set on the nested object', p.eligibility.nationality === 'citizen_or_pr' && p.eligibility.income_annual_max === 30000 && p.eligibility.gender === 'female');
  t('the verification stamp is applied', p.last_verified_at === '2026-10-05' && p.verification_status === 'verified');
  t('an out-of-vocabulary enum is dropped, the old value kept', p.benefit_type === 'cash_monthly');
  t('a string where a number belongs is dropped', p.amount_min === 100);
  t('an unknown field is not added', !('mystery' in p));
  t('an identity field is never patched', p.slug === 'h-one');
  const fields = s.invalid.filter((i) => i.slug === 'h-one').map((i) => i.field).sort();
  t('each dropped value is in the report', JSON.stringify(fields) === JSON.stringify(['amount_min', 'benefit_type', 'mystery', 'slug']), fields.join(','));
}
{
  const p = rec(root, HF, 'h-two');
  t('an automatic record with no steps gets the standard "No application needed" step', /^No application needed/.test(rec(root, HF, 'h-auto').procedure_steps[0]?.detail ?? ''));
  t('a retired household record says "Ended:" in deadline_note', /^Ended:/.test(p.deadline_note), p.deadline_note);
  t('and the original wording is kept', /closed in 2026/.test(p.deadline_note));
  t('a record found by slug when `file` is wrong is still updated', rec(root, HF, 'h-three').last_verified_at === '2026-10-05');
}
/* company */
{
  const p = rec(root, CF, 'c-one');
  t('company status and dates are set', p.status === 'closed' && p.closes_at === '2026-11-30' && p.cofunding_pct === 35);
  t('stages are set from the fixed vocabulary', JSON.stringify(p.eligibility.stages) === '["seed","series_a"]');
  t('a sector the data has never used is dropped, the list kept as it was', JSON.stringify(p.eligibility.sectors) === '["any"]');
  t('the other record type\'s deadline word is mapped, not dropped, for a company', p.deadline_type === 'cutoff');
  t('typical_months are de-duplicated and sorted', JSON.stringify(p.typical_months) === '[3,9]');
  t('amount_min above amount_max is rolled back', p.amount_min === 1000 && p.amount_max === 5000);
  t('the derived EUR turnover ceiling follows the local one (5,000,000 SEK at 10/EUR)', p.eligibility.turnover_annual_max === 5000000 && p.eligibility.turnover_annual_max_eur === 500000);
  const c2 = rec(root, CF, 'c-two');
  t('a retired company record is closed on both fields', c2.status === 'closed' && c2.deadline_type === 'closed');
  t('and the script reports that it had to enforce them', s.retireEnforced.some((r) => r.slug === 'c-two'));
  t('unverifiable changes nothing, whatever `set` says', rec(root, CF, 'c-three').amount_max === 5000 && rec(root, CF, 'c-three').last_verified_at === '2026-08-14');
}
t('derivedTurnoverEur refuses a currency with no rate', derivedTurnoverEur({ amount_currency: 'XXX', eligibility: { turnover_annual_max: 5 } }, 'XXX', { units_per_eur: { EUR: 1 } }) === undefined);

/* serialisation */
{
  const raw = fs.readFileSync(path.join(root, CF), 'utf8');
  t('a minified file stays on one line', !raw.includes('\n'));
  const h = fs.readFileSync(path.join(root, HF), 'utf8');
  t('an indent-1 file keeps its indent and has no trailing newline', /^\{\n "country_code"/.test(h) && !h.endsWith('\n'));
}

/* adds */
{
  const hp = read(root, HF).programmes;
  const added = (slug) => hp.find((p) => p.slug === slug) || rec(root, CF, slug);
  t('a complete add is appended', !!added('h-new') && hp[hp.length - 1].slug.startsWith('h-s') || !!added('h-new'));
  const sparse = added('h-sparse');
  t('a sparse add has every field the file\'s records have', sparse && Object.keys(hp[0]).every((k) => k in sparse), sparse ? Object.keys(hp[0]).filter((k) => !(k in sparse)).join(',') : 'missing');
  t('and every eligibility field', sparse && Object.keys(hp[0].eligibility).every((k) => k in sparse.eligibility));
  t('a missing nullable field is null', sparse && sparse.amount_note === null && sparse.application_url === null && sparse.amount_min === null);
  t('a missing array/boolean/enum takes the neutral default, not null', sparse && Array.isArray(sparse.procedure_steps) && sparse.is_automatic === false && sparse.eligibility.gender === 'any' && Array.isArray(sparse.eligibility.statuses));
  t('the supplied nationality is kept', sparse && sparse.eligibility.nationality === 'citizen_or_pr');
  t('keys are in the same order as the file\'s own records', sparse && JSON.stringify(Object.keys(sparse)) === JSON.stringify(Object.keys(hp[0])));
  t('an add whose slug exists is skipped', s.adds.skippedDuplicate.some((d) => d.slug === 'h-one' && /slug/.test(d.reason)));
  t('an add with the same normalised name + funder is skipped', s.adds.skippedDuplicate.some((d) => d.slug === 'h-dupname'));
  t('a supervisor-rejected add is skipped', !added('h-rejected-add') && s.adds.skippedRejected.some((d) => d.slug === 'h-rejected-add'));
  t('an add with no usable source_url is refused', !added('h-nosource') && s.adds.invalid.some((d) => d.slug === 'h-nosource'));
  t('an add to a file that does not exist is refused', s.adds.unknownFile.some((d) => d.slug === 'c-elsewhere'));
  const cn = added('c-new');
  t('a company add is appended with country_code from its file', cn && cn.country_code === 'yy');
  t('a company add gets its derived EUR turnover', cn && cn.eligibility.turnover_annual_max_eur === 200000);
  t('a company look-alike (same funder, near-identical name) is skipped', !added('c-lookalike') && s.adds.skippedDuplicate.some((d) => d.slug === 'c-lookalike'));
  t('adds are counted per file', s.adds.byFile[HF] === 3 && s.adds.byFile[CF] === 3, JSON.stringify(s.adds.byFile));
  const reg = added('h-region');
  t('a regional add\'s own admin_area is folded into eligibility.admin_areas', reg && reg.eligibility.admin_areas.includes('Bavaria'));
  t('two distinct programmes citing one official page are auto-allowlisted, with a reason',
    s.duplicates.allowlisted.some((d) => d.a === 'c-twin-a' && d.b === 'c-twin-b')
    && read(root, 'data/startups/duplicate-allowlist.json').some((e) => e.a === 'c-twin-a' && /auto-allowlisted/.test(e.reason)));
  t('and nothing probable-duplicate is left unmerged', s.duplicates.needMerge.length === 0, JSON.stringify(s.duplicates.needMerge));
}

/* report */
{
  const r = fs.readFileSync(path.join(vdir, 'APPLY_REPORT.md'), 'utf8');
  t('the report has counts per action', /\| updated \| 5 \|/.test(r) && /\| retired \| 2 \|/.test(r));
  t('the report has per-file rows', r.includes(`| ${HF} |`) && r.includes(`| ${CF} |`));
  t('the report lists rejected slugs', /h-rejected-target/.test(r));
  t('the report lists invalid values dropped', /benefit_type/.test(r) && /cashy/.test(r));
}

/* idempotence */
{
  const afterFirst = snapshot(root);
  const again = run();
  t('a second run changes no byte of any data file', snapshot(root) === afterFirst);
  t('and reports nothing changed and nothing added', again.recordsChanged === 0 && again.adds.added === 0, `${again.recordsChanged} changed, ${again.adds.added} added`);
}

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(vdir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
