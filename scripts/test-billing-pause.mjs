#!/usr/bin/env node
/**
 * Pricing & billing quick wins: the 14-day Startup trial, promotion codes on
 * checkout, pause-instead-of-cancel, and the account page's own quota read.
 *
 * Same shape as test-alerts.mjs and test-quota.mjs — real migrations on
 * node:sqlite, the Worker's actual handlers, `fetch` stubbed for the
 * duration of the file so nothing here ever reaches api.stripe.com.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
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

console.log('\nPricing & billing quick wins\n');

/* Stub Stripe. Every checkout/pause/resume call in this file goes through
   here, and each call is recorded so the assertions can read exactly what
   was sent, form-decoded. */
const stripeCalls = [];
let stripeResponse = () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/test' });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.stripe.com/')) {
    const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
    stripeCalls.push({ url: String(url), body });
    return new Response(JSON.stringify(stripeResponse(String(url), body)), { status: 200 });
  }
  return realFetch(url, init);
};

function makeEnv(extra = {}) {
  return {
    DB: memoryD1(MIGRATIONS),
    APP_ORIGIN: 'https://unclaimedgrant.com',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PRICE_PERSONAL_MONTHLY: 'price_pm',
    STRIPE_PRICE_PERSONAL_ANNUAL: 'price_pa',
    STRIPE_PRICE_BUSINESS_MONTHLY: 'price_bm',
    STRIPE_PRICE_BUSINESS_ANNUAL: 'price_ba',
    ...extra,
  };
}

const req = (url, { method = 'GET', body, cookie } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function seedUser(env, { accountType = 'individual' } = {}) {
  const uid = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, locale, account_type, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, `u-${uid.slice(0, 6)}@example.com`, 'en', accountType, Date.now()).run();
  const cookie = `ua_session=${await __test.signSession(env, { uid, email: 'u@example.com', typ: accountType, exp: Date.now() + 3600e3 })}`;
  return { uid, cookie };
}

async function seedSubscription(env, uid, { plan = 'business_monthly', paused_until = null } = {}) {
  await env.DB.prepare(
    'INSERT INTO entitlements (user_id, status, plan, stripe_customer_id, stripe_subscription_id, current_period_end, paused_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(uid, 'active', plan, 'cus_x', 'sub_x', Math.floor((Date.now() + 300 * 864e5) / 1000), paused_until, Date.now()).run();
}

/* ==================================================================== */
/* 1. Checkout: 14-day trial on business plans only, never personal      */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });

  stripeCalls.length = 0;
  const res = await __test.handleCheckout(
    req('/api/billing/checkout', { method: 'POST', body: { plan: 'business_monthly', country: 'gb' }, cookie }),
    env,
  );
  is(res.status, 200, 'business checkout succeeds');
  const call = stripeCalls.find((c) => c.url.includes('checkout/sessions'));
  is(call.body['subscription_data[trial_period_days]'], '14', 'a business checkout carries a 14-day trial');
  is(call.body['allow_promotion_codes'], 'true', 'and allows a promotion code');

  stripeCalls.length = 0;
  const res2 = await __test.handleCheckout(
    req('/api/billing/checkout', { method: 'POST', body: { plan: 'personal_annual', country: 'gb' }, cookie }),
    env,
  );
  is(res2.status, 200, 'personal checkout succeeds');
  const call2 = stripeCalls.find((c) => c.url.includes('checkout/sessions'));
  is(call2.body['subscription_data[trial_period_days]'], undefined, 'a personal checkout carries no trial at all');
  is(call2.body['allow_promotion_codes'], 'true', 'but still allows a promotion code');
}

/* ==================================================================== */
/* 2. entitlementFor: paused reads as not entitled, resumed reads as     */
/*    active again — without a second event ever arriving                */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid } = await seedUser(env, { accountType: 'business' });
  const future = Date.now() + 30 * 864e5;
  await seedSubscription(env, uid, { plan: 'business_monthly', paused_until: future });

  const ent = await __test.entitlementFor(env, { uid }, 'gb');
  is(ent.entitled, false, 'a subscription paused into the future is not entitled');
  is(ent.reason, 'paused', 'and says why');
  is(ent.paused_until, future, 'carrying the resume date so the account page can print it');

  /* Once the date has passed, the SAME row (nobody had to fire a webhook)
     reads as active again — paused_until is a fact about time, not a state
     machine transition. */
  await env.DB.prepare('UPDATE entitlements SET paused_until = ? WHERE user_id = ?').bind(Date.now() - 1000, uid).run();
  const after = await __test.entitlementFor(env, { uid }, 'gb');
  is(after.entitled, true, 'once the resume date has passed, entitlement resumes on its own');
  is(after.reason, 'active', 'with the ordinary "active" reason, not a leftover "paused"');
}

/* ==================================================================== */
/* 3. POST /api/billing/pause                                            */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });
  await seedSubscription(env, uid);

  const badMonths = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 4 }, cookie }), env);
  is(badMonths.status, 400, 'a pause outside 1/2/3 months is refused');

  const noAuth = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 1 } }), env);
  is(noAuth.status, 401, 'pausing without a session is refused');

  stripeCalls.length = 0;
  const res = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 2 }, cookie }), env);
  is(res.status, 200, 'a valid pause succeeds');
  const body = await res.json();
  yes(body.paused_until > Date.now(), 'and returns a future resume date');

  const call = stripeCalls.find((c) => c.url.includes('subscriptions/sub_x'));
  yes(call != null, 'the subscription was updated at Stripe');
  is(call.body['pause_collection[behavior]'], 'void', 'billing is paused with `void` — no invoice is ever generated while paused');
  yes(Number(call.body['pause_collection[resumes_at]']) > Date.now() / 1000, 'and a resume date was sent');

  const row = await env.DB.prepare('SELECT paused_until FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(row.paused_until, body.paused_until, 'the row is updated immediately, not only once the webhook lands');

  const again = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 1 }, cookie }), env);
  is(again.status, 409, 'pausing an already-paused subscription is refused rather than silently re-pausing');

  const ent = await __test.entitlementFor(env, { uid }, 'gb');
  is(ent.entitled, false, 'and the account is genuinely not entitled while paused');
  is(ent.reason, 'paused', 'reported as paused, not as a lapsed or cancelled subscription');
}

/* No subscription at all: nothing to pause. */
{
  const env = makeEnv();
  const { cookie } = await seedUser(env);
  const res = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 1 }, cookie }), env);
  is(res.status, 404, 'a free account has nothing to pause');
}

/* ==================================================================== */
/* 4. POST /api/billing/resume                                           */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });
  await seedSubscription(env, uid, { paused_until: Date.now() + 30 * 864e5 });

  {
    const env2 = makeEnv();
    const { uid: uid2, cookie: cookie2 } = await seedUser(env2, { accountType: 'business' });
    await seedSubscription(env2, uid2, { paused_until: null });
    const res = await __test.handleBillingResume(req('/api/billing/resume', { method: 'POST', cookie: cookie2 }), env2);
    is(res.status, 409, 'resuming a subscription that is not paused is refused');
  }

  stripeCalls.length = 0;
  const res = await __test.handleBillingResume(req('/api/billing/resume', { method: 'POST', cookie }), env);
  is(res.status, 200, 'resuming a paused subscription succeeds');

  const call = stripeCalls.find((c) => c.url.includes('subscriptions/sub_x'));
  is(call.body['pause_collection'], '', 'pause_collection is cleared with an empty value, which Stripe reads as "remove it"');

  const row = await env.DB.prepare('SELECT paused_until FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(row.paused_until, null, 'the row is cleared immediately');

  const ent = await __test.entitlementFor(env, { uid }, 'gb');
  is(ent.entitled, true, 'entitlement is restored the moment resume succeeds');
}

/* ==================================================================== */
/* 5. applyStripeEvent: pause_collection is synced from Stripe's own      */
/*    subscription object, not only written by our own endpoints         */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid } = await seedUser(env, { accountType: 'business' });
  await seedSubscription(env, uid, { paused_until: null });

  /* A pause made by hand in the Stripe Dashboard, never through our own
     /api/billing/pause — applyStripeEvent is the only thing that will ever
     hear about it. */
  const resumesAt = Math.floor(Date.now() / 1000) + 60 * 86400;
  await __test.applyStripeEvent({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_x', status: 'active', customer: 'cus_x', metadata: { user_id: uid, plan: 'business_monthly' }, pause_collection: { behavior: 'void', resumes_at: resumesAt } } },
  }, env);
  const paused = await env.DB.prepare('SELECT paused_until FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(paused.paused_until, resumesAt * 1000, 'a dashboard pause is picked up from the subscription object');

  /* And a dashboard resume — pause_collection simply absent on the next
     update — has to clear it, not leave the stale date sitting there
     forever because COALESCE would keep it. */
  await __test.applyStripeEvent({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_x', status: 'active', customer: 'cus_x', metadata: { user_id: uid, plan: 'business_monthly' } } },
  }, env);
  const resumed = await env.DB.prepare('SELECT paused_until FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(resumed.paused_until, null, 'a dashboard resume clears paused_until — COALESCE would have kept the stale date');

  /* A cancellation must not leave a stale pause behind either. */
  await env.DB.prepare('UPDATE entitlements SET paused_until = ? WHERE user_id = ?').bind(Date.now() + 864e5, uid).run();
  await __test.applyStripeEvent({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_x', status: 'canceled', customer: 'cus_x', metadata: { user_id: uid } } },
  }, env);
  const cancelled = await env.DB.prepare('SELECT status, paused_until FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(cancelled.status, 'canceled', 'a cancellation is recorded as cancelled');
  is(cancelled.paused_until, null, 'and does not leave a stale pause date on a cancelled row');
}

/* ==================================================================== */
/* 6. GET /api/quota — the account page's own read, no workspace required */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'individual' });
  /* Personal plans carry no generation allowance at all — this is a product
     decision, not a bug, and the endpoint has to say so rather than error. */
  await env.DB.prepare('INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, 'active', 'personal_annual', Math.floor((Date.now() + 300 * 864e5) / 1000), Date.now()).run();

  const res = await __test.handleAccountQuota(req('/api/quota', { cookie }), env);
  is(res.status, 200, 'a personal account can read its own quota with no workspace or org');
  const body = await res.json();
  is(body.quota.allowance, 0, 'a personal plan has a zero allowance');
  is(body.quota.credits, 0, 'and no credits unless it bought a pack');

  const noAuth = await __test.handleAccountQuota(req('/api/quota'), env);
  is(noAuth.status, 401, 'reading quota while signed out is refused');
}

/* A business owner with an org reads through the same `quotaFor` the
   workspace dashboard's /api/enterprise/quota already uses — one function,
   two doors in, so a fix to one reaches the other.

   NB seats: `entitlementFor()` does not currently attach a seat count to an
   `active` (paying, non-granted) entitlement — only a comped `granted` one
   carries `seats` — so both this endpoint and /api/enterprise/quota read a
   real multi-seat subscriber's allowance as a single seat's worth until that
   is wired up. Asserted here as the current, honest behaviour rather than
   silently masked by a hand-built `ent` the way test-quota.mjs's direct
   `quotaFor` tests do. */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });
  const orgId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO orgs (id, name, owner_id, seats, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(orgId, 'Kestrel Robotics', uid, 3, Date.now()).run();
  await env.DB.prepare('INSERT INTO org_members (org_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .bind(orgId, uid, 'owner', Date.now()).run();
  await env.DB.prepare('INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, 'active', 'business_annual', Math.floor((Date.now() + 300 * 864e5) / 1000), Date.now()).run();

  const res = await __test.handleAccountQuota(req('/api/quota', { cookie }), env);
  const body = await res.json();
  is(body.quota.plan, 'business_annual', 'the account page reads the right plan for a business subscriber');
  is(body.quota.allowance, 20, 'and the seat-1 allowance for that plan (see the seats note above)');
}

/* ==================================================================== */
/* 7. Supervisor fixes: no repeat trial, no pause of a dead subscription, */
/*    no allowance promised while paused                                  */
/* ==================================================================== */
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });
  await seedSubscription(env, uid);
  await env.DB.prepare("UPDATE entitlements SET status = 'canceled' WHERE user_id = ?").bind(uid).run();

  stripeCalls.length = 0;
  const res = await __test.handleCheckout(
    req('/api/billing/checkout', { method: 'POST', body: { plan: 'business_monthly', country: 'gb' }, cookie }),
    env,
  );
  is(res.status, 200, 'a returning business customer can still check out');
  const call = stripeCalls.find((c) => c.url.includes('checkout/sessions'));
  is(call.body['subscription_data[trial_period_days]'], undefined, 'but does not get a second free trial');

  stripeCalls.length = 0;
  const p = await __test.handleBillingPause(req('/api/billing/pause', { method: 'POST', body: { months: 1 }, cookie }), env);
  is(p.status, 409, 'a cancelled subscription cannot be paused');
  is(stripeCalls.length, 0, 'and Stripe is never called for it');
}
{
  const env = makeEnv();
  const { uid, cookie } = await seedUser(env, { accountType: 'business' });
  await seedSubscription(env, uid, { plan: 'business_annual', paused_until: Date.now() + 30 * 864e5 });
  const res = await __test.handleAccountQuota(req('/api/quota', { cookie }), env);
  const body = await res.json();
  is(body.quota.allowance, 0, 'a paused subscriber is not shown a monthly allowance they cannot spend');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
