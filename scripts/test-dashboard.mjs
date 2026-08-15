#!/usr/bin/env node
/**
 * The workspace's pure logic, tested away from the browser.
 *
 * The CSV importer is the piece worth testing hardest: it is the one place a
 * silent mistake lands in someone's portfolio and stays there. A row that
 * imports into the wrong column produces a company with a plausible-looking
 * wrong headcount, which changes what it matches, which changes what a fund
 * spends six weeks on.
 *
 * dashboard.js is a browser module — it touches document and localStorage at
 * import time. Rather than restructure the app around testability, this stubs
 * the three globals it needs. The stub is deliberately dumb: if the module
 * starts needing more of the DOM than this, that is a signal the logic and the
 * rendering have grown into each other and should be separated.
 */
import assert from 'node:assert';

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
};

/* -- the smallest DOM that lets the module load ------------------------- */
const noop = () => {};
const el = { dataset: {}, innerHTML: '', classList: { add: noop, remove: noop }, addEventListener: noop };
globalThis.document = {
  body: { dataset: { base: '' } },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  createElement: () => ({ ...el, click: noop, addEventListener: noop, files: [] }),
};
globalThis.window = { addEventListener: noop, scrollTo: noop };
globalThis.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = v; },
  removeItem(k) { delete this._v[k]; },
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

/* Imported from dist, not src: in the repo the module's ../packages/ and
   ../engine/ specifiers point at nothing — they resolve only once the build
   has written the copies alongside it. Testing the emitted artefact also
   means these assertions cover what actually ships. */
const { parseCsv, importCsv, pipelineValue, hitRate, STAGES, OBLIGATION_KINDS, programmeName } =
  await import('../dist/dashboard/dashboard.js');

/* -- CSV parsing -------------------------------------------------------- */

test('parses a plain grid', () => {
  assert.deepStrictEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('keeps commas that are inside quotes', () => {
  /* The failure this guards: "Northwind Bio, Ltd" splitting into two columns
     shifts every later field left by one, so the country lands in the company
     number and the headcount lands in the turnover. */
  const rows = parseCsv('name,country\n"Northwind Bio, Ltd",de');
  assert.deepStrictEqual(rows[1], ['Northwind Bio, Ltd', 'de']);
});

test('unescapes a doubled quote', () => {
  assert.deepStrictEqual(parseCsv('name\n"He said ""hi"""')[1], ['He said "hi"']);
});

test('survives CRLF', () => {
  assert.deepStrictEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('drops blank lines rather than importing empty companies', () => {
  assert.strictEqual(parseCsv('a\n\n\n1\n').length, 2);
});

/* -- Import mapping ----------------------------------------------------- */

test('maps the common header spellings', () => {
  localStorage._v = {};
  const r = importCsv('Company Name,Country,Employees\nAcme,GB,12');
  assert.strictEqual(r.added, 1);
  const ws = JSON.parse(localStorage.getItem('unclaimed.workspace.v1'));
  assert.strictEqual(ws.companies[0].legal_name, 'Acme');
  assert.strictEqual(ws.companies[0].country_code, 'gb');
  assert.strictEqual(ws.companies[0].headcount, 12);
});

test('reports unrecognised columns rather than guessing at them', () => {
  localStorage._v = {};
  const r = importCsv('name,ebitda_margin\nAcme,0.3');
  assert.deepStrictEqual(r.unmapped, ['ebitda_margin']);
});

test('skips a row with no company name instead of creating a blank one', () => {
  localStorage._v = {};
  const r = importCsv('name,country\n,de\nAcme,de');
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.skipped, 1);
});

test('a header-only file adds nothing', () => {
  localStorage._v = {};
  assert.strictEqual(importCsv('name,country').added, 0);
});

/* -- Money -------------------------------------------------------------- */

test('pipeline value counts only what has an amount, and says how many it skipped', () => {
  const v = pipelineValue([{ value_eur: 1000, slug: 'x' }, { value_eur: null, slug: 'nope' }]);
  assert.strictEqual(v.eur, 1000);
  assert.strictEqual(v.priced, 1);
  assert.strictEqual(v.unpriced, 1);
});

test('an override of zero is a real zero, not a missing amount', () => {
  /* `?? amountEur()` rather than `|| amountEur()`: a grant genuinely valued at
     nothing yet must not silently inherit the programme's headline figure. */
  const v = pipelineValue([{ value_eur: 0, slug: 'x' }]);
  assert.strictEqual(v.eur, 0);
  assert.strictEqual(v.unpriced, 0);
});

/* -- Hit rate ----------------------------------------------------------- */

test('hit rate ignores undecided applications', () => {
  const r = hitRate([
    { stage: 'awarded' }, { stage: 'declined' },
    { stage: 'submitted' }, { stage: 'drafting' },
  ]);
  assert.strictEqual(r.decided, 2);
  assert.strictEqual(r.pct, 50);
});

test('hit rate is null, not zero, before anything is decided', () => {
  /* 0% and "no data yet" mean opposite things to whoever reads the board pack. */
  assert.strictEqual(hitRate([{ stage: 'submitted' }]).pct, null);
});

/* -- Stages ------------------------------------------------------------- */

test('blocked is a stage of its own, not a flavour of declined', () => {
  const ids = STAGES.map((s) => s.id);
  assert.ok(ids.includes('blocked'));
  assert.ok(ids.includes('declined'));
});

/* -- locked programmes -------------------------------------------------- */

test('a locked programme is named as locked, not as its opaque id', () => {
  /* The public dataset strips names past the second record per pool. Printing
     the id reads as a bug; the label has to say what it is. */
  assert.strictEqual(programmeName({ slug: 'p_rh63dr', locked: true }), 'Name on the paid plan');
  assert.strictEqual(programmeName({ slug: 'x', name_en: 'EIC Accelerator' }), 'EIC Accelerator');
  assert.strictEqual(programmeName(null, 'grant'), 'grant');
});

test('a record with no name is treated as locked rather than blank', () => {
  assert.strictEqual(programmeName({ slug: 'x' }), 'Name on the paid plan');
});

/* -- post-award --------------------------------------------------------- */

test('obligation kinds cover reports, not just milestones', () => {
  /* Late reporting is the usual reason a paid grant is clawed back, so a
     post-award tab that only models milestones misses the expensive one. */
  const ids = OBLIGATION_KINDS.map((k) => k[0]);
  for (const k of ['milestone', 'report', 'deliverable', 'payment']) assert.ok(ids.includes(k), `missing ${k}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
