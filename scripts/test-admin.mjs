#!/usr/bin/env node
/**
 * The operator door and the funnel maths.
 *
 * Two classes of bug this exists to catch, and they are not equally bad.
 *
 * The funnel arithmetic being wrong produces a misleading chart on a private
 * page. Annoying.
 *
 * The door being wrong hands the whole paid product to the internet. The tests
 * that matter here are the negative ones: an unset secret must close the
 * endpoint rather than open it, and a session without `adm` must not become
 * entitled. Both are one inverted boolean away at all times.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FUNNEL, STEPS, isStep, funnelRows, worstDrop, stepLabel } from '../packages/analytics/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${a}, wanted ${b}`));

console.log('\nAdmin and analytics\n');

/* ---- the funnel contract ----------------------------------------- */

is(new Set(STEPS).size, STEPS.length, 'no duplicate step names');
is(isStep('nonsense'), false, 'an unknown step is rejected');
is(isStep('result'), true, 'a known step is accepted');
is(stepLabel('paywall_seen'), 'Reached the locked list', 'steps carry a human label');

const rows = funnelRows({ land: 1000, check_start: 400, country: 380, answers_1: 200, result: 40 });
is(rows[0].share, 1, 'the first step is 100% of itself');
is(rows[1].count, 400, 'counts come straight through');
is(rows[1].share, 0.4, 'share is measured against the first step');
is(rows[2].stepRate, 380 / 400, 'step rate is measured against the previous step');
is(rows[2].lost, 20, 'lost is the absolute difference from the previous step');
is(rows[5].count, 0, 'a step nobody reached is zero, not missing');
is(rows.length, FUNNEL.length, 'every step appears even with no data');

/* The headline picks absolute loss, not the worst rate. answers_1 → result
   loses 80% but only 160 people; land → check_start loses 60% and 600. */
const w = worstDrop(rows);
is(w.from.step, 'land', 'the biggest drop is ranked by people lost, not by rate');
is(w.lost, 600, 'and reports how many that is');

const empty = funnelRows({});
is(empty[0].share, 0, 'no traffic does not divide by zero');
is(worstDrop(empty).lost, 0, 'and names no drop-off');

/* ---- the door ---------------------------------------------------- */

const worker = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');

/* Fail-closed. If this assertion ever needs relaxing, the change is wrong.
   The credential now comes from secrets OR from worker_config, so the check is
   that a MISSING credential (either source) still refuses, rather than that a
   particular env var is read. */
const guard = worker.match(/const cred = await adminCredential\(env\);[\s\S]{0,200}?if \(!cred\)[\s\S]{0,200}?503/);
guard ? ok('a missing admin credential returns 503, it does not skip the check') : bad('admin login does not fail closed on a missing credential');
/without a full set/.test(worker) || /if \(!m\.admin_email \|\| !m\.admin_password_salt \|\| !m\.admin_password_hash\) return null;/.test(worker)
  ? ok('a partial credential in the database is treated as none')
  : bad('a partial admin credential would be accepted');
/* The password itself must never be stored — only the salt and the hash. */
/worker_config[\s\S]{0,300}admin_password(?!_salt|_hash)/.test(worker)
  ? bad('something writes an admin password, not just its hash')
  : ok('only the salt and hash are ever read back, never a password');

is(
  /if \(session\?\.adm\) return \{ entitled: true/.test(worker),
  true,
  'an operator session is entitled',
);

/* The signing key must never fall back to a constant. An empty or fixed key
   means every session cookie on the internet is forgeable, and it would not
   look broken — it would look like it worked. */
is(
  /crypto\.getRandomValues\(new Uint8Array\(32\)\)/.test(worker),
  true,
  'a missing signing key is generated at random, not defaulted',
);
is(
  /INSERT OR IGNORE INTO worker_config \(key, value, created_at\) VALUES \('session_signing_key'/.test(worker),
  true,
  'two isolates racing to create the key cannot sign users out',
);
is(
  /function requireAdmin[\s\S]{0,200}session\?\.adm \? session : null/.test(worker),
  true,
  'every admin endpoint goes through one check',
);
for (const route of ['/api/admin/overview', '/api/admin/funnel', '/api/admin/logins']) {
  const handler = worker.slice(worker.indexOf(`GET ${route}`));
  is(
    /if \(!\(await requireAdmin\(request, env\)\)\) return bad\('admin only', 403\);/.test(handler.slice(0, 500)),
    true,
    `${route} refuses a non-operator`,
  );
}

is(
  worker.includes("if (!isStep(step)) return bad('unknown step')"),
  true,
  'the beacon rejects step names the dashboard does not know',
);

/* No IP, no user agent, no referrer reaches the events table. */
const insert = worker.slice(worker.indexOf('INSERT INTO events'), worker.indexOf('INSERT INTO events') + 400);
is(
  /cf-connecting-ip|user-agent|referer/i.test(insert),
  false,
  'the events insert carries no IP, user agent or referrer',
);

/* ---- the password hash ------------------------------------------- */

/* The script and the Worker must agree on the KDF, or every login fails with
   a correct password — which reads as "the password is wrong" and costs an
   afternoon. Asserted by matching the iteration count in both files. */
const script = fs.readFileSync(path.join(ROOT, 'scripts/admin-password.mjs'), 'utf8');
const scriptIters = script.match(/const ITERATIONS = ([\d_]+)/)?.[1].replace(/_/g, '');
const workerIters = worker.match(/ADMIN_PBKDF2_ITERATIONS = ([\d_]+)/)?.[1].replace(/_/g, '');
is(scriptIters, workerIters, 'script and Worker use the same PBKDF2 iteration count');
/* Exactly the Workers ceiling. Higher is not "more secure" here — Workers'
   Web Crypto rejects it, so every operator login 500s with a correct
   password. Lower is a real weakening. Both directions are bugs. */
is(Number(workerIters), 100000, 'PBKDF2 runs at the Cloudflare Workers maximum, which is 100,000');

/* And that the hash the script prints is the one the Worker will compute. */
const salt = crypto.randomBytes(16).toString('hex');
const fromScript = crypto
  .pbkdf2Sync('correct horse battery staple', Buffer.from(salt, 'hex'), Number(scriptIters), 32, 'sha256')
  .toString('hex');
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode('correct horse battery staple'), 'PBKDF2', false, ['deriveBits'],
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: Uint8Array.from(salt.match(/.{2}/g).map((h) => parseInt(h, 16))), iterations: Number(workerIters), hash: 'SHA-256' },
  key,
  256,
);
const fromWorker = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
is(fromScript, fromWorker, 'the printed hash is byte-identical to what the Worker derives');

/* ---- the page ---------------------------------------------------- */

const adminHtml = path.join(ROOT, 'dist/admin/index.html');
if (fs.existsSync(adminHtml)) {
  const html = fs.readFileSync(adminHtml, 'utf8');
  is(/noindex/.test(html), true, '/admin/ is noindex');
  is(html.includes('id="admin-panel" hidden'), true, 'the dashboard starts hidden');
  /* The page must not contain a client-side gate that a devtools panel can
     flip into "entitled". Every figure has to come from the API. */
  is(
    /ADMIN_PASSWORD|adminPassword|=== ?['"]admin['"]/.test(html),
    false,
    'no password or client-side comparison is baked into the page',
  );
} else {
  ok('/admin/ not built in this run — skipped page checks');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
