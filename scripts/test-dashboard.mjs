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

/* ------------------------------------------------------------------ */
/* The workspace gate                                                  */
/* ------------------------------------------------------------------ */

/* The workspace is the paid product. Two separate things have to hold and only
   one of them is the UI:
     - the page must not render the workspace to someone who is not entitled —
       a courtesy, removable with devtools, and still worth having, because
       otherwise the whole product looks free and empty;
     - /api/workspace must refuse to read or write for that same person — the
       real gate, and the only one that counts.
   Asserting only the first is the classic mistake, so both are here. */
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');
  const dash = read('src/pwa/dashboard.js');
  const worker = read('worker/index.js');
  const syncSrc = read('src/pwa/workspace-sync.js');
  const ck = (name, cond) => test(name, () => assert.ok(cond, name));

  ck('render() refuses to draw the workspace before the gate opens',
    /if \(gate !== sync\.STATUS\.READY && !bypass\) \{[\s\S]{0,140}gateScreen\(gate\)/.test(dash));
  ck('the gate starts closed, not open', /let gate = sync\.STATUS\.CHECKING;/.test(dash));
  ck('boot asks the server before rendering the workspace',
    /async function boot\(\)[\s\S]{0,500}await sync\.open\(\)/.test(dash));

  /* A failed check must close the gate, not open it. This is the single
     inversion that would turn the paywall back into a free product. */
  ck('an unreachable API leaves the gate closed',
    /catch\(\(\) => \(\{ status: sync\.STATUS\.OFFLINE/.test(dash));

  /* Server side. */
  ck('the workspace API checks entitlement server-side',
    /async function workspaceGate[\s\S]{0,900}if \(!ent\.entitled\)[\s\S]{0,140}402/.test(worker));
  ck('a signed-out caller gets 401 from the workspace API',
    /async function workspaceGate[\s\S]{0,400}if \(!session\?\.uid\) return \{ error: json\(\{ error: 'signed_out' \}, 401\) \}/.test(worker));
  for (const fn of ['handleWorkspaceGet', 'handleWorkspacePut']) {
    const body = worker.slice(worker.indexOf(`async function ${fn}`));
    ck(`${fn} goes through the gate before touching the database`,
      /const gate = await workspaceGate\(request, env\);\s*\n\s*if \(gate\.error\) return gate\.error;/.test(body.slice(0, 400)));
  }
  ck('an operator session gets no workspace of its own',
    /Returns null for an operator session/.test(worker));

  /* Concurrency. Without the revision check a second tab silently erases the
     first tab's work, and the only evidence is a missing pipeline row. */
  ck('a PUT with a stale revision is refused', /if \(rev !== currentRev\)[\s\S]{0,240}409/.test(worker));
  ck('a conflict hands back the current document so the client can reconcile',
    /error: 'conflict'[\s\S]{0,240}doc: current \? JSON\.parse\(current\.doc\) : null/.test(worker));
  ck('a conflict is surfaced, not silently merged',
    /onConflict/.test(dash) && /Merging two portfolios/.test(syncSrc));

  /* Never strand the anonymous workspace: someone who built a portfolio and
     then paid must not be shown an empty board as the reward. */
  ck('a local workspace with content is adopted on first sign-in',
    /if \(hasContent\(local\)\)[\s\S]{0,240}await push\(local, 0\)/.test(syncSrc));
  ck('an empty local workspace is not pushed over the server copy',
    /export function hasContent/.test(syncSrc));

  /* Saving must never sit between a keystroke and the screen. */
  ck('commit writes locally first, then queues the server write',
    /sync\.writeLocal\(ws\);[\s\S]{0,140}saver\.queue/.test(dash));
  ck('the last edit is flushed when the tab goes away',
    /pagehide[\s\S]{0,140}flushNow\(\)/.test(dash));
  ck('a failed save is visible rather than silent',
    /syncState === 'error'/.test(dash) && /Not saved to your account/.test(dash));
}

/* ------------------------------------------------------------------ */
/* Data loss in the sync layer                                         */
/* ------------------------------------------------------------------ */

/* These are behavioural, not source greps: the conflict path is where work
   actually disappears, and the failure is a sequence of states rather than a
   line of code. The saver is driven for real against a fake server. */
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ck = (name, cond) => test(name, () => assert.ok(cond, name));

  /* A minimal browser for the module: localStorage and fetch. */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const server = { rev: 1, doc: { v: 1, companies: [{ id: 'theirs' }] } };
  let puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (String(url).startsWith('/api/workspace') && (init.method === 'PUT' || init.method === 'POST')) {
      puts += 1;
      /* Slow on purpose. The bug only exists when the user types WHILE a save
         is in flight, so an instant server never reproduces it — which is how
         the first version of this test passed against the broken code. */
      await new Promise((r) => setTimeout(r, 200));
      if (body.rev !== server.rev) {
        return { ok: false, status: 409, json: async () => ({ error: 'conflict', rev: server.rev, doc: server.doc }) };
      }
      server.rev += 1;
      server.doc = body.doc;
      return { ok: true, status: 200, json: async () => ({ ok: true, rev: server.rev }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const sync = await import('../src/pwa/workspace-sync.js');

  /* The scenario that erased a colleague's work: we are on a stale revision,
     the user keeps typing during the in-flight save, the PUT 409s. The old
     code adopted the server's revision and then re-sent the local document at
     it — succeeding, and wiping the other person's board while the screen
     showed theirs. */
  const states = [];
  let handedServerDoc = null;
  let handedLosing = null;
  store.set('unclaimed.workspace.rev', '0'); // stale on purpose
  const saver = sync.createSaver({
    onState: (s2) => states.push(s2),
    onConflict: (serverDoc, _rev, losing) => {
      handedServerDoc = serverDoc;
      handedLosing = losing;
    },
  });

  saver.queue({ v: 1, companies: [{ id: 'mine' }] });
  /* Past the debounce, so the PUT is in flight and stuck in that 200ms... */
  await new Promise((r) => setTimeout(r, 1300));
  /* ...and NOW the user types. This is the edit the broken code re-sent at the
     server's revision, erasing the other person's board. */
  saver.queue({ v: 1, companies: [{ id: 'mine' }, { id: 'mine2' }] });
  await new Promise((r) => setTimeout(r, 2500));

  ck('a conflict is reported', states.includes('conflict'));
  ck(
    'a conflict does not force the local copy over the server copy',
    server.doc.companies.length === 1 && server.doc.companies[0].id === 'theirs',
  );
  ck('and does not silently retry after losing', !states.slice(states.indexOf('conflict') + 1).includes('saved'));
  ck('the server document is handed to the UI', handedServerDoc?.companies?.[0]?.id === 'theirs');
  ck('so is the document that lost, so it can be exported', handedLosing != null);

  /* The anonymous board must never be discarded without trace. */
  store.set('unclaimed.workspace.v1', JSON.stringify({ v: 1, companies: [{ id: 'anon' }] }));
  const src = fs.readFileSync(path.join(ROOT, 'src/pwa/workspace-sync.js'), 'utf8');
  ck('a displaced anonymous board is stashed, not overwritten', /STRANDED_KEY/.test(src) && /export function readStranded/.test(src));
  ck('and the UI offers it back', /dismiss-stranded/.test(fs.readFileSync(path.join(ROOT, 'src/pwa/dashboard.js'), 'utf8')));

  /* A failed (non-conflict) push must keep the document for the next attempt. */
  ck('a failed push re-queues rather than dropping the edit', /if \(pending === null\) pending = doc;/.test(src));

  /* And a background save must not rebuild the DOM under the user's cursor. */
  const dash = fs.readFileSync(path.join(ROOT, 'src/pwa/dashboard.js'), 'utf8');
  ck(
    'a sync state change patches the banner instead of re-rendering',
    /const el = \$\('#sync-banner'\);/.test(dash) && /el\.innerHTML = syncBanner\(\)/.test(dash),
  );

  /* Figures labelled "pipeline" must exclude what has left it. */
  ck('open pipeline excludes awarded and declined', /const openEntries = /.test(dash) && /CLOSED_STAGES/.test(dash));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
