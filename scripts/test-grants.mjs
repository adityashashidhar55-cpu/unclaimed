#!/usr/bin/env node
/**
 * Granted access: the vocabulary, the rule, and the door.
 *
 * This is the first test in the repo that runs the Worker's real handlers
 * against a real database. node:sqlite ships with Node 22, so the actual
 * migration files are applied to an in-memory SQLite and `worker/index.js` is
 * imported unmodified. That matters here more than anywhere else: the thing
 * being tested is "who can see the paid product", and a regex over the source
 * can only ever confirm that some string is present.
 *
 * The negative tests are the ones that count. In order of what they cost if
 * they fail:
 *
 *   1. A request with no operator session must not be able to grant anything.
 *      If that inverts, anyone on the internet can give themselves the product.
 *   2. Revoking must actually close the door again, not merely write a row.
 *   3. An expired grant must stop counting without anyone running a job.
 *   4. A missing `grants` table — the migration not yet applied in production —
 *      must fail closed and must not 500 the site for paying customers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import {
  normaliseGrant, isLive, pickLive, daysLeft, describeGrant,
  isGrantablePlan, planLabel, GRANTABLE_PLANS, MAX_GRANT_DAYS, MAX_SEATS,
} from '../packages/grants/index.js';
import { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = allMigrations(ROOT);

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nGranted access\n');

/* ---- the vocabulary --------------------------------------------- */

is(new Set(GRANTABLE_PLANS.map((p) => p.plan)).size, GRANTABLE_PLANS.length, 'no duplicate plan keys');
yes(isGrantablePlan('enterprise'), 'enterprise is grantable — it is the tier with no Stripe price');
no(isGrantablePlan('free'), 'a plan that does not exist is not grantable');
is(planLabel('business_annual'), 'Startup — annual', 'plans carry the label the pricing page uses');

/* ---- validation -------------------------------------------------- */

const NOW = 1_700_000_000_000;

no(normaliseGrant({ plan: 'gold', reason: 'because' }, NOW).ok, 'an unknown plan is refused, not mapped to the nearest one');
no(normaliseGrant({ plan: 'enterprise' }, NOW).ok, 'a grant with no reason is refused');
no(normaliseGrant({ plan: 'enterprise', reason: ' x ' }, NOW).ok, 'a one-character reason is refused');
is(normaliseGrant({ plan: 'enterprise', reason: '' }, NOW).error, 'reason_required', 'and says which field it wants');

const seated = normaliseGrant({ plan: 'enterprise', reason: 'closed on a call', seats: 9999 }, NOW);
is(seated.grant.seats, MAX_SEATS, 'seats are clamped, not trusted — an unbounded seat count is an unbounded licence');
const unseated = normaliseGrant({ plan: 'personal_annual', reason: 'refund goodwill', seats: 40 }, NOW);
is(unseated.grant.seats, 1, 'a personal plan is one seat whatever was asked for');

const forever = normaliseGrant({ plan: 'enterprise', reason: 'partner' }, NOW);
is(forever.grant.expires_at, null, 'no days means no end date');
const month = normaliseGrant({ plan: 'enterprise', reason: 'pilot', days: 30 }, NOW);
is(month.grant.expires_at, NOW + 30 * 864e5, 'days become an absolute expiry at grant time');
is(normaliseGrant({ plan: 'enterprise', reason: 'x forever', days: 99999 }, NOW).grant.expires_at,
  NOW + MAX_GRANT_DAYS * 864e5, 'an absurd number of days is clamped');
is(normaliseGrant({ plan: 'enterprise', reason: 'neg', days: -5 }, NOW).grant.expires_at, null,
  'a negative number of days is not an expiry in the past');

/* ---- which grant counts ------------------------------------------ */

const live = { id: 'a', plan: 'enterprise', granted_at: NOW, expires_at: null, revoked_at: null };
const revoked = { id: 'b', plan: 'enterprise', granted_at: NOW + 1, expires_at: null, revoked_at: NOW + 2 };
const expired = { id: 'c', plan: 'enterprise', granted_at: NOW + 3, expires_at: NOW - 1, revoked_at: null };

yes(isLive(live, NOW), 'an unrevoked grant with no end date is live');
no(isLive(revoked, NOW), 'a revoked grant is not live');
no(isLive(expired, NOW), 'an expired grant is not live — nothing has to run for that to be true');
is(pickLive([live, revoked, expired], NOW)?.id, 'a', 'the newest LIVE grant wins, not the newest row');
is(pickLive([], NOW), null, 'no grants is null, not undefined');
is(daysLeft(live, NOW), null, 'a grant with no end date has no days left to report');
is(daysLeft({ expires_at: NOW + 36 * 3600e3 }, NOW), 2, 'part days round up, so "1 day left" never means "gone in an hour"');
yes(/Enterprise/.test(describeGrant(live, NOW)), 'the description names the plan');
no(/pilot/.test(describeGrant({ ...live, reason: 'pilot' }, NOW)), "the customer's copy does not repeat the operator's private reason");
yes(/pilot/.test(describeGrant({ ...live, reason: 'pilot' }, NOW, { includeReason: true })), 'the operator can ask for it');

/* ---- the real thing: handlers against a real database ------------ */

const enc = new TextEncoder();

function makeEnv(migrations = MIGRATIONS) {
  return { DB: memoryD1(migrations) };
}

async function operatorCookie(env, email = 'owner@unclaimedgrant.com') {
  const token = await __test.signSession(env, { adm: true, email, exp: Date.now() + 3600e3 });
  return `ua_session=${token}`;
}

const req = (url, { cookie, method = 'GET', body } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function newUser(env, email, type = 'individual') {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, locale, account_type, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, 'en', type, Date.now())
    .run();
  return id;
}

{
  const env = makeEnv();
  const cookie = await operatorCookie(env);
  const uid = await newUser(env, 'founder@example.com', 'business');
  const session = { uid, email: 'founder@example.com', typ: 'business' };

  const before = await __test.entitlementFor(env, session, 'gb');
  is(before.entitled, false, 'a new account is not entitled');
  is(before.reason, 'no_subscription', 'and says why');

  /* The door, before anything else. */
  const anon = await __test.handleAdminGrant(
    req('/api/admin/grant', { method: 'POST', body: { email: 'founder@example.com', plan: 'enterprise', reason: 'stolen' } }),
    env,
  );
  is(anon.status, 403, 'a request with no operator session cannot grant a plan');
  const leaked = await env.DB.prepare('SELECT COUNT(*) AS n FROM grants').first();
  is(leaked.n, 0, 'and wrote no grant row while being refused');

  const stillOut = await __test.entitlementFor(env, session, 'gb');
  is(stillOut.entitled, false, 'the refused grant did not entitle anyone');

  /* Grant it properly. */
  const res = await __test.handleAdminGrant(
    req('/api/admin/grant', {
      cookie, method: 'POST',
      body: { email: 'founder@example.com', plan: 'enterprise', seats: 12, days: 90, reason: 'closed on a call, invoice to follow' },
    }),
    env,
  );
  is(res.status, 200, 'an operator can grant a plan');
  const granted = await res.json();

  const after = await __test.entitlementFor(env, session, 'gb');
  is(after.entitled, true, 'and the account is entitled straight away, with no Stripe involved');
  is(after.reason, 'granted', 'reported as granted, so it never counts as revenue');
  is(after.plan, 'enterprise', 'on the plan that was granted');
  is(after.granted.seats, 12, 'carrying the seats it was granted with');

  /* Nothing was written to the table Stripe owns. */
  const ent = await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements').first();
  is(ent.n, 0, 'granting wrote nothing into entitlements — the revenue tables stay clean');

  /* Revoking must close the door, not merely file a row. */
  const rev = await __test.handleAdminRevoke(
    req('/api/admin/revoke', { cookie, method: 'POST', body: { grant_id: granted.grant.id, reason: 'pilot ended' } }),
    env,
  );
  is(rev.status, 200, 'an operator can revoke');
  const gone = await __test.entitlementFor(env, session, 'gb');
  is(gone.entitled, false, 'and the paid product closes again');

  const twice = await __test.handleAdminRevoke(
    req('/api/admin/revoke', { cookie, method: 'POST', body: { grant_id: granted.grant.id } }),
    env,
  );
  is(twice.status, 200, 'revoking twice is not an error');
  const who = await env.DB.prepare('SELECT revoke_reason FROM grants WHERE id = ?').bind(granted.grant.id).first();
  is(who.revoke_reason, 'pilot ended', 'and does not overwrite who revoked it the first time');

  const anonRevoke = await __test.handleAdminRevoke(
    req('/api/admin/revoke', { method: 'POST', body: { grant_id: granted.grant.id } }),
    env,
  );
  is(anonRevoke.status, 403, 'and a stranger cannot revoke either');
}

/* ---- expiry needs no cron ---------------------------------------- */

{
  const env = makeEnv();
  const uid = await newUser(env, 'expired@example.com');
  await env.DB.prepare(
    `INSERT INTO grants (id, user_id, plan, seats, reason, granted_by, granted_at, expires_at)
     VALUES (?, ?, 'personal_annual', 1, 'trial', 'owner@x', ?, ?)`,
  )
    .bind(crypto.randomUUID(), uid, Date.now() - 60 * 864e5, Date.now() - 1000)
    .run();
  const ent = await __test.entitlementFor(env, { uid, email: 'expired@example.com' }, 'gb');
  is(ent.entitled, false, 'a grant whose expiry has passed stops working with nothing scheduled');
}

/* ---- superseding ------------------------------------------------- */

{
  const env = makeEnv();
  const cookie = await operatorCookie(env);
  const uid = await newUser(env, 'upgrade@example.com', 'business');

  await __test.handleAdminGrant(req('/api/admin/grant', { cookie, method: 'POST', body: { user_id: uid, plan: 'business_annual', reason: 'first' } }), env);
  const second = await (await __test.handleAdminGrant(req('/api/admin/grant', { cookie, method: 'POST', body: { user_id: uid, plan: 'enterprise', seats: 5, reason: 'upgraded' } }), env)).json();

  const all = await __test.grantsFor(env, uid);
  is(all.length, 2, 'the old grant is kept, not deleted — the trail is the point');
  is(all.filter((g) => !g.revoked_at).length, 1, 'but exactly one grant is live');
  is(second.superseded != null, true, 'and the response says which one it replaced');

  const ent = await __test.entitlementFor(env, { uid, email: 'upgrade@example.com' }, 'gb');
  is(ent.plan, 'enterprise', 'the account is on the newer plan');

  const trail = await (await __test.handleAdminAudit(req('/api/admin/audit', { cookie }), env)).json();
  const actions = trail.audit.map((a) => a.action);
  yes(actions.includes('grant'), 'the trail records the grant');
  yes(actions.includes('supersede'), 'and records the supersede as its own event, not as a second grant');
  is(trail.audit[0].actor, 'owner@unclaimedgrant.com', 'naming the operator who did it');
}

/* ---- paying beats granted ---------------------------------------- */

{
  const env = makeEnv();
  const cookie = await operatorCookie(env);
  const uid = await newUser(env, 'payer@example.com');
  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, 'active', 'personal_annual', ?, ?)`,
  )
    .bind(uid, Math.floor((Date.now() + 300 * 864e5) / 1000), Date.now())
    .run();
  await __test.handleAdminGrant(req('/api/admin/grant', { cookie, method: 'POST', body: { user_id: uid, plan: 'enterprise', reason: 'also comped' } }), env);

  const ent = await __test.entitlementFor(env, { uid, email: 'payer@example.com' }, 'gb');
  is(ent.reason, 'active', 'a paying subscriber is reported as paying, not as granted');
  is(ent.entitled, true, 'and is still entitled');
}

/* ---- an account that does not exist yet -------------------------- */

{
  const env = makeEnv();
  const cookie = await operatorCookie(env);

  const refused = await __test.handleAdminGrant(
    req('/api/admin/grant', { cookie, method: 'POST', body: { email: 'new@example.com', plan: 'enterprise', reason: 'signed today' } }),
    env,
  );
  is(refused.status, 404, 'granting to an address with no account is refused by default');
  const none = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  is(none.n, 0, 'and does not create the account as a side effect of a typo');

  const made = await __test.handleAdminGrant(
    req('/api/admin/grant', { cookie, method: 'POST', body: { email: 'new@example.com', plan: 'enterprise', reason: 'signed today', create: true } }),
    env,
  );
  is(made.status, 200, 'with an explicit flag, the account is created and granted');
  const u = await env.DB.prepare('SELECT account_type FROM users WHERE email = ?').bind('new@example.com').first();
  is(u.account_type, 'business', 'and gets the account type the plan implies');
  const trail = await (await __test.handleAdminAudit(req('/api/admin/audit', { cookie }), env)).json();
  yes(trail.audit.some((a) => a.action === 'create_user'), 'creating the account is its own audited event');
}

/* ---- search ------------------------------------------------------ */

{
  const env = makeEnv();
  const cookie = await operatorCookie(env);
  await newUser(env, 'a_b@example.com');
  await newUser(env, 'axb@example.com');

  const res = await (await __test.handleAdminCustomers(req('/api/admin/customers?q=a_b@', { cookie }), env)).json();
  is(res.customers.length, 1, "an underscore in a search is a literal underscore, not SQL's any-character");
  is(res.customers[0].email, 'a_b@example.com', 'and finds the address that was actually typed');

  const anon = await __test.handleAdminCustomers(req('/api/admin/customers?q=a', {}), env);
  is(anon.status, 403, 'the customer list is not readable without an operator session');

  const all = await (await __test.handleAdminCustomers(req('/api/admin/customers', { cookie }), env)).json();
  is(all.customers.length, 2, 'an empty search lists everyone');
  yes(Array.isArray(all.plans) && all.plans.length > 0, 'and the grantable plans come with it, so the form cannot drift from the Worker');
}

/* ---- the migration has not been applied yet ---------------------- */

{
  const withoutGrants = MIGRATIONS.filter((f) => !f.endsWith('0008_grants.sql'));
  const env = makeEnv(withoutGrants);
  const uid = await newUser(env, 'nomigration@example.com');
  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, 'active', 'personal_annual', ?, ?)`,
  )
    .bind(uid, Math.floor((Date.now() + 300 * 864e5) / 1000), Date.now())
    .run();

  let threw = false;
  let ent = null;
  try {
    ent = await __test.entitlementFor(env, { uid, email: 'nomigration@example.com' }, 'gb');
  } catch {
    threw = true;
  }
  no(threw, 'a missing grants table does not throw — an unapplied migration must not 500 the paywall');
  is(ent?.entitled, true, 'and a paying customer is unaffected by it');

  const unentitled = await __test.entitlementFor(env, { uid: 'ghost', email: 'g@example.com' }, 'gb');
  is(unentitled.entitled, false, 'while a missing table can never manufacture an entitlement');
}

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
