#!/usr/bin/env node
/**
 * Deploy before migrate: the Worker against a database that only has
 * migrations 0001-0009.
 *
 * Workers Builds ships the code on push; `wrangler d1 migrations apply` is a
 * separate step someone runs by hand. Between the two, the Worker is live
 * against a schema missing alert_subscriptions/alert_sends (0010), leads
 * (0011), calendar_tokens/user_totp/user_totp_recovery_codes (0012) and
 * entitlements.paused_until (0013). In that window sign-in, /api/me,
 * /api/check, checkout and /mcp must keep working exactly as before, and the
 * endpoints that exist only for the new features answer 503 — never 500.
 *
 * Everything goes through the Worker's real default fetch handler, the same
 * entry point Cloudflare calls, so the router's own error mapping is part of
 * what is tested. Needs `npm run build` first (ASSETS reads dist/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import worker, { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(DIST, 'api/v1/mcp-tools.json'))) {
  console.error('test-premigration: dist/ is missing — run `npm run build` first');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m, extra = '') => (v ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ''}`));

console.log('\nThe Worker before migrations 0010-0013 are applied\n');

/* Only 0001-0009. Selected by number rather than by count, so adding 0014
   later does not silently move this test's baseline. */
const PRE = allMigrations(ROOT).filter((f) => Number(path.basename(f).slice(0, 4)) <= 9);
is(PRE.length, 9, 'the baseline is exactly migrations 0001-0009');
const POST = allMigrations(ROOT).map((f) => path.basename(f)).filter((f) => Number(f.slice(0, 4)) >= 10);
is(
  POST.join(','),
  '0010_alerts.sql,0011_leads.sql,0012_calendar_tokens.sql,0013_billing_pause.sql',
  'and the migrations this test holds off are 0010-0013, in that order',
);

/* Stripe is stubbed for the duration: no test run should reach the real API. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.stripe.com/')) {
    return new Response(JSON.stringify({ id: 'cs_test_pre', url: 'https://checkout.stripe.com/pre' }), { status: 200 });
  }
  if (String(url).startsWith('https://api.resend.com/')) return new Response('{}', { status: 200 });
  return realFetch(url, init);
};

const env = {
  DB: memoryD1(PRE),
  APP_ORIGIN: 'https://unclaimedgrant.com',
  ALLOW_DEV_CODE_ECHO: 'true',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_PERSONAL_MONTHLY: 'price_pm',
  STRIPE_PRICE_PERSONAL_ANNUAL: 'price_pa',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_bm',
  STRIPE_PRICE_BUSINESS_ANNUAL: 'price_ba',
  ASSETS: {
    fetch: async (req) => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      let f = path.join(DIST, p);
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) return new Response('Not found', { status: 404 });
      const type = f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
      return new Response(fs.readFileSync(f), { headers: { 'content-type': type } });
    },
  },
};
const ctx = { waitUntil() {} };

/* Sanity: the schema really is the old one. */
{
  const tables = new Set(
    env.DB._raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );
  for (const t of ['alert_subscriptions', 'alert_sends', 'leads', 'calendar_tokens', 'user_totp', 'user_totp_recovery_codes']) {
    yes(!tables.has(t), `${t} does not exist yet`);
  }
  const cols = env.DB._raw.prepare('PRAGMA table_info(entitlements)').all().map((r) => r.name);
  yes(!cols.includes('paused_until'), 'entitlements has no paused_until column yet');
}

const call = (url, { method = 'GET', body, cookie, headers = {}, envExtra = {} } = {}) =>
  worker.fetch(
    new Request(`https://unclaimedgrant.com${url}`, {
      method,
      headers: {
        'cf-connecting-ip': '198.51.100.23',
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { ...env, ...envExtra },
    ctx,
  );

/* With a mail key set, alerts get past "not configured" and reach the
   database — which is the path under test. Sign-in runs without one so the
   OTP is echoed back (ALLOW_DEV_CODE_ECHO) instead of mailed. */
const MAIL = { RESEND_API_KEY: 're_test' };

/* ---- sign-in (/auth/verify reads user_totp) ------------------------- */

const email = 'founder@example.com';
let cookie = '';
let uid = '';
{
  const r1 = await call('/auth/request', { method: 'POST', body: { email } });
  is(r1.status, 200, '/auth/request answers 200');
  const { dev_code } = await r1.json();
  yes(/^\d{6}$/.test(String(dev_code)), 'and issues a code');

  const r2 = await call('/auth/verify', { method: 'POST', body: { email, code: dev_code } });
  is(r2.status, 200, '/auth/verify signs in (a missing user_totp table is "no second factor")');
  const b2 = await r2.json();
  yes(!b2.totp_required, 'and does not ask for a TOTP code');
  cookie = (r2.headers.get('set-cookie') || '').split(';')[0];
  yes(cookie.startsWith('ua_session=') && cookie.length > 20, 'and sets a session cookie');
  uid = b2.user?.id;
  yes(!!uid, 'and returns the user');
}

/* ---- /api/me (entitlementFor reads paused_until) -------------------- */

{
  const r = await call('/api/me', { cookie });
  is(r.status, 200, '/api/me answers 200');
  const b = await r.json();
  is(b.signed_in, true, 'and reports the session as signed in');
  is(b.entitlement?.reason, 'no_subscription', 'with no subscription yet');
}

/* ---- /api/check ------------------------------------------------------ */

{
  const r = await call('/api/check', { method: 'POST', cookie, body: { country_code: 'gb', age: 34, household_size: 2 } });
  is(r.status, 200, '/api/check answers 200');
  const b = await r.json();
  yes(b && typeof b === 'object' && !b.error, 'with a result, not an error', JSON.stringify(b).slice(0, 160));
}

/* ---- checkout, and the webhook that completes it --------------------- */

{
  const r = await call('/api/billing/checkout', { method: 'POST', cookie, body: { plan: 'personal_annual', country: 'gb' } });
  is(r.status, 200, '/api/billing/checkout creates a checkout session');
  const b = await r.json();
  is(b.url, 'https://checkout.stripe.com/pre', 'and returns the Stripe URL');

  /* The purchase completes in the window: the entitlements upsert must not
     depend on paused_until existing, or someone pays and gets nothing. */
  let threw = null;
  try {
    await __test.applyStripeEvent({
      type: 'customer.subscription.created',
      data: { object: {
        id: 'sub_pre', status: 'active', customer: 'cus_pre',
        current_period_end: Math.floor((Date.now() + 30 * 864e5) / 1000),
        metadata: { user_id: uid, plan: 'personal_annual' },
      } },
    }, env);
  } catch (err) { threw = err; }
  yes(!threw, 'a subscription webhook writes the entitlement without paused_until', String(threw?.message ?? ''));

  const me = await (await call('/api/me', { cookie })).json();
  is(me.entitlement?.entitled, true, 'and /api/me then reports the subscriber as entitled');
  is(me.entitlement?.reason, 'active', 'as an active subscription, not paused');
}

/* ---- /mcp ------------------------------------------------------------ */

{
  const rpc = (body) => call('/mcp', { method: 'POST', body, headers: { accept: 'application/json, text/event-stream' } });
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  is(init.status, 200, '/mcp initialize answers 200');
  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  yes((list.result?.tools ?? []).length >= 9, '/mcp lists its tools', `got ${(list.result?.tools ?? []).length}`);
  const res = await rpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'check_company_eligibility', arguments: { jurisdiction: 'eu', stage: 'seed' } },
  });
  const body = await res.json();
  yes(res.status === 200 && !body.error && body.result, '/mcp tools/call answers', JSON.stringify(body).slice(0, 160));
}

/* ---- new-feature endpoints: "not in use", or 503 — never 500 ---------- */

{
  const leads = await call('/api/leads', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.com', country: 'gb', audience: 'company', consent: true, message: 'Hi' },
  });
  is(leads.status, 503, 'POST /api/leads answers 503 before migration 0011');

  const sub = await call('/api/alerts/subscribe', { method: 'POST', body: { email: 'a@example.com', audience: 'companies', jurisdictions: ['gb'] }, envExtra: MAIL });
  is(sub.status, 503, 'POST /api/alerts/subscribe answers 503 before migration 0010');
  const conf = await call(`/api/alerts/confirm?token=${'a'.repeat(64)}`);
  is(conf.status, 503, 'GET /api/alerts/confirm answers 503');
  const unsub = await call(`/api/alerts/unsubscribe?token=${'a'.repeat(64)}`);
  is(unsub.status, 503, 'GET /api/alerts/unsubscribe answers 503');

  const cron = await __test.runAlertsCron({ ...env, ...MAIL });
  is(cron.sent, 0, 'the alerts cron sends nothing and does not throw');

  const totp = await call('/api/account/totp', { cookie });
  is(totp.status, 200, 'GET /api/account/totp answers 200');
  const tb = await totp.json();
  is(tb.enrolled, false, 'and reports nobody enrolled');
  yes(!tb.secret, 'and offers no secret to enrol with, since enrolling could not be stored');
  const enable = await call('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: 'JBSWY3DPEHPK3PXP', code: '123456' } });
  yes([400, 401, 503].includes(enable.status), `POST /api/account/totp/enable is refused cleanly (got ${enable.status})`);

  const pendingBad = await call('/auth/totp', { method: 'POST', body: { pending: 'nope', code: '123456' } });
  is(pendingBad.status, 401, 'POST /auth/totp with no real pending sign-in is a 401');

  const cal = await call('/api/workspace/calendar-token', { cookie });
  yes([200, 402, 403].includes(cal.status), `GET /api/workspace/calendar-token answers without a 500 (got ${cal.status})`);
  if (cal.status === 200) is((await cal.json()).active, false, 'and reports no feed');
  const feed = await call(`/api/calendar/${'b'.repeat(64)}.ics`);
  is(feed.status, 404, 'a calendar feed URL is a 404, not a 500');

  const pause = await call('/api/billing/pause', { method: 'POST', cookie, body: { months: 1 } });
  is(pause.status, 503, 'POST /api/billing/pause answers 503 before migration 0013');
}

globalThis.fetch = realFetch;
console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
