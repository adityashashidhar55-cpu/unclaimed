#!/usr/bin/env node
/**
 * Is the thing we built reachable from the thing we shipped?
 *
 * Every other test in scripts/ asks whether an implementation is CORRECT.
 * None of them asks whether any client can get to it, and that is how three
 * paid features shipped with a working, tested backend and no control anywhere
 * in the UI: /api/apply/plan and /api/apply/consent have zero callers,
 * /api/startups/plan has zero callers, and the company auto-fill route was
 * described to Startup subscribers in a passive sentence with no button beside
 * it. scripts/test-autoapply.mjs is the largest file in scripts/ at 41KB and
 * the string "dist" does not appear in it once — 664 lines of green over a
 * feature no user could open.
 *
 * So this test asks the other question, in three parts:
 *
 *   1. every Worker route that backs a promise on /pricing/ has a caller in
 *      the shipped client bundle or the mobile app;
 *   2. every analytics step a client emits is one the Worker will accept —
 *      a step outside FUNNEL is answered 400 and silently dropped;
 *   3. every plan key a client can ask for is one the Worker will sell.
 *
 * Reads dist/ deliberately: what is in src/ is not what a browser downloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MOBILE = path.join(ROOT, 'mobile/src');

let failures = 0;
let checks = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => { checks += 1; console.log(`  ✓ ${m}`); };

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Source with comments removed, so a route named only in a comment does not
 * count as a caller.
 *
 * HTML comments too, and that is not pedantry: this file printed
 * "✓ /api/apply/plan has a caller in a shipped client" for months on the
 * strength of an HTML comment inside a template literal at dist/app.js:1002 —
 * the comment that says the feature used to be unreachable. A JS comment
 * stripper does not touch `<!-- ... -->` inside a string, and every page in
 * this product is built out of template literals full of them.
 */
function code(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* mobile/src/lib/api.js is the fetch wrapper. It names every route by
   definition, so counting it as a caller is how three unreachable features
   passed a reachability check the first time this was written: the wrapper
   exported applyPlan and recordConsent and not one screen ever called them. A
   route is reachable when something that draws a screen asks for it. */
const API_CLIENT = path.join(MOBILE, 'lib/api.js');

const clientFiles = [
  ...walk(DIST).filter((f) => /\.(js|mjs|html)$/.test(f)),
  ...walk(MOBILE).filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && f !== API_CLIENT),
];
const clientSrc = clientFiles.map(code).join('\n');

/**
 * Does any shipped client ask for this route?
 *
 * Clients build URLs two ways: the whole path as a literal, or a prefix plus a
 * variable segment (`fetch(\`/api/enterprise/${'${path}'}\`)` with 'applications'
 * passed in). Both count; only matching the first would report a live feature
 * as dead, which is the way a guard gets deleted rather than fixed.
 */
/* A mention is not a call. `clientSrc.includes(route)` counted the route
   appearing anywhere at all — in prose, in a data attribute, in an HTML
   comment. What makes a route reachable is a call that actually issues it:
   `fetch(<route>)`, or a thin transport helper (`post`, `jsonFetch`, `call`)
   that does the fetch and is handed the route. Both are resolved here; a bare
   substring is not accepted. */
const CALL_WINDOW = 300;

/** Names of functions in the shipped client whose body performs a fetch. */
const fetchingHelpers = (() => {
  const names = new Set(['fetch']);
  const decl =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  for (const f of clientFiles) {
    const src = code(f);
    for (const m of src.matchAll(decl)) {
      const name = m[1] || m[2];
      if (!name) continue;
      /* The body, approximately: from the declaration to the next one. */
      const body = src.slice(m.index, m.index + 900);
      if (/\bfetch\s*\(/.test(body)) names.add(name);
    }
  }
  return names;
})();

/**
 * Every (file, callee) where this route is passed to something that fetches.
 */
function callSites(route) {
  const i = route.lastIndexOf('/');
  const prefix = route.slice(0, i + 1);
  const segment = route.slice(i + 1);
  const out = [];
  for (const f of clientFiles) {
    const src = code(f);
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$.]*)\s*\(/g)) {
      const callee = m[1].split('.').pop();
      if (!fetchingHelpers.has(callee)) continue;
      /* `async function filingFetch(path, init)` contains the token
         `filingFetch(` — a declaration, not a call. Counting it put the call
         site 46 characters early, which put it before its own function
         header, which named the PREVIOUS function as the enclosing one. */
      if (/\b(?:function|class)\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
      const arg = src.slice(m.index, m.index + CALL_WINDOW);
      const direct = arg.includes(route);
      const built = arg.includes(prefix) && new RegExp(`['"\`]${segment}['"\`]`).test(src);
      if (direct || built) { out.push({ file: f, src, at: m.index }); break; }
    }
  }
  return out;
}

/**
 * Reachable = a real call site exists AND something can reach it.
 *
 * If the call sits inside an exported function, that function has to be
 * invoked from somewhere other than its own definition — otherwise it is
 * exactly the shape of the bug this file exists to catch: mobile's api.js
 * exported applyPlan() and recordConsent() and no screen ever called either.
 */
function hasCaller(route) {
  const sites = callSites(route);
  if (!sites.length) return false;
  for (const { file, src, at } of sites) {
    const decl = [
      ...src
        .slice(0, at)
        .matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g),
    ].pop();
    const name = decl ? decl[1] || decl[2] : null;
    if (!name) return true; // inline in a handler or at module top level
    const invoked = new RegExp(`\\b${name}\\s*\\(`, 'g');
    for (const other of clientFiles) {
      const s2 = code(other);
      const calls = [...s2.matchAll(invoked)].length;
      if (calls > (other === file ? 1 : 0)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * data-act ↔ handler.
 *
 * The check that would have caught "Prepare my applications": src/app.js
 * rendered `data-act="prepare"` and its click handler had no `prepare`
 * branch, so the only paid-only control on the results screen produced no
 * request, no error and no change on screen. A control the client emits and
 * cannot handle is a dead button by construction.
 * ------------------------------------------------------------------ */
function actAudit(file) {
  const src = code(file);
  const emitted = new Set([...src.matchAll(/data-act="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
  const handled = new Set([
    ...[...src.matchAll(/act === '([a-z0-9-]+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/case '([a-z0-9-]+)'\s*:/g)].map((m) => m[1]),
    ...[...src.matchAll(/dataset\.act\s*===\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
  ]);
  /* Values consumed by a lookup table rather than a branch. */
  const tabled = /attrMap|ACTIONS|HANDLERS/.test(src);
  return { emitted, handled, tabled, missing: [...emitted].filter((a) => !handled.has(a)) };
}

console.log('\nCan a user reach what we built?\n');

/* ------------------------------------------------------------------ *
 * 1. Routes that back a pricing promise
 *
 * Only routes that /pricing/ sells. An internal route with no caller is a
 * housekeeping matter; a SOLD route with no caller is a refund.
 * ------------------------------------------------------------------ */
const workerSrc = code(path.join(ROOT, 'worker/index.js'));
const declared = [...workerSrc.matchAll(/pathname === '(\/api\/[^']+)'/g)].map((m) => m[1]);
const declaredSet = new Set(declared);

/** route → the sentence on /pricing/ it is the implementation of. */
const SOLD = {
  '/api/check': 'the personalised eligibility result',
  '/api/apply/plan': 'prepared applications / "we fill the forms"',
  '/api/apply/consent': 'the consent record that gates a hand-off',
  /* /api/startups/check is deliberately absent: the company check runs
     entirely in the browser off the public pool, so the route exists for API
     and mobile consumers rather than for the web wizard. */
  /* Was excluded with a note saying the company check had no notion of
     entitlement client-side. It has one now (src/pwa/startup-check.js), and a
     sold route stays in this map whether or not it is convenient. */
  '/api/startups/plan': 'prepared applications for a company',
  '/api/startups/autofill': 'Company auto-fill from public registers',
  '/api/workspace': 'the shared workspace',
  '/api/enterprise/authorisations': 'Auto-file: the mandate',
  '/api/enterprise/applications': 'Auto-file: the filing queue',
  '/api/billing/checkout': 'buying any plan at all',
  '/api/billing/portal': 'cancel any time',
};

for (const [route, promise] of Object.entries(SOLD)) {
  if (!declaredSet.has(route)) {
    fail(`${route} is sold ("${promise}") but the Worker declares no such route`);
    continue;
  }
  hasCaller(route)
    ? ok(`${route} has a caller in a shipped client`)
    : fail(`${route} has NO caller in dist/ or mobile/src — "${promise}" is sold and unreachable`);
}

/* Report, without failing, on routes that exist and nobody calls. Not every
   route is a promise, but an unlisted one is worth a human's eye. */
{
  /* Deduplicate ONCE and use the same list for the count and the sentence.
     This counted `declared`, which lists a route again for each method the
     Worker declares it under, and then printed the deduplicated set — so it
     said "3 non-sold routes have no client caller: /api/vault, /api/profile"
     and left a reader looking for a third route that does not exist. */
  const orphans = [...new Set(declared.filter((r) => !SOLD[r] && !hasCaller(r) && !r.startsWith('/api/admin')))];
  if (orphans.length) console.log(`  · ${orphans.length} non-sold routes have no client caller: ${orphans.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 1b. Every data-act a client emits has a branch in that same client.
 * ------------------------------------------------------------------ */
{
  for (const rel of ['app.js', 'startup-check.js']) {
    const f = path.join(DIST, rel);
    if (!fs.existsSync(f)) { fail(`${rel} is not in dist/`); continue; }
    const { emitted, missing } = actAudit(f);
    missing.length === 0
      ? ok(`every data-act in dist/${rel} has a handler branch (${emitted.size} actions)`)
      : fail(`dist/${rel} renders controls nothing handles: ${missing.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * 2. Every analytics step a client emits must be one the Worker accepts.
 *
 * checkout.js fired track('checkout_redirect'), which is not in FUNNEL, so
 * handleEvent answered 400 and dropped it on EVERY checkout attempt. It cost
 * nothing and told us nothing, for months, without one error anywhere.
 * ------------------------------------------------------------------ */
{
  const { FUNNEL } = await import(new URL('../packages/analytics/index.js', import.meta.url));
  const allowed = new Set(FUNNEL.map((f) => f.step));
  const emitted = new Set();
  for (const f of [...walk(path.join(ROOT, 'src')), ...walk(MOBILE)].filter((x) => /\.(js|mjs|jsx|ts|tsx)$/.test(x))) {
    for (const m of code(f).matchAll(/\btrack\(\s*['"]([a-z0-9_]+)['"]/g)) emitted.add(m[1]);
  }
  const rogue = [...emitted].filter((s) => !allowed.has(s));
  rogue.length === 0
    ? ok(`every analytics step a client emits is in FUNNEL (${emitted.size} steps)`)
    : fail(`${rogue.length} steps are emitted by a client and rejected by the Worker: ${rogue.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 3. Every plan key a client can ask for is one the Worker will sell.
 * ------------------------------------------------------------------ */
{
  const { PLANS } = await import(new URL('../src/pwa/checkout.js', import.meta.url)).catch(() => ({ PLANS: null }));
  /* The Worker's table is built inside handleCheckout from env vars, so it is
     read from the source rather than imported. */
  const block = workerSrc.slice(workerSrc.indexOf('const PLANS = {'));
  const workerPlans = new Set([...block.slice(0, block.indexOf('};')).matchAll(/^\s*([a-z_]+):\s*\{/gm)].map((m) => m[1]));

  workerPlans.size >= 4
    ? ok(`the Worker's plan table has ${workerPlans.size} plans`)
    : fail(`could not read the Worker's plan table (found ${workerPlans.size})`);

  if (PLANS) {
    const clientOnly = Object.keys(PLANS).filter((k) => !workerPlans.has(k));
    clientOnly.length === 0
      ? ok('every plan the client advertises is one the Worker sells')
      : fail(`the client advertises plans the Worker will reject: ${clientOnly.join(', ')}`);
  }

  /* And every data-plan actually rendered into the shipped HTML/JS. 'auto' is
     legal — the Worker resolves it from the session. */
  const rendered = new Set(
    [...clientSrc.matchAll(/data-plan="([a-z_]+)"/g)].map((m) => m[1]),
  );
  const unsellable = [...rendered].filter((k) => k !== 'auto' && !workerPlans.has(k));
  unsellable.length === 0
    ? ok(`every data-plan rendered in dist/ resolves to a real plan (${[...rendered].join(', ') || 'none'})`)
    : fail(`controls in dist/ ask for plans the Worker does not sell: ${unsellable.join(', ')}`);
}

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
