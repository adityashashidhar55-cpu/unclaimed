#!/usr/bin/env node
/**
 * "Get expert help" leads: validation, storage, rate limiting, and the admin
 * list. Same shape as scripts/test-alerts.mjs — real migrations on
 * node:sqlite, the Worker's actual handlers, no regex over the source.
 * `fetch` is stubbed for the duration of this file rather than left to hit
 * api.resend.com — a test suite that silently mails real addresses on every
 * run is a worse bug than the one it would be checking for.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { validateLeadInput, leadNotificationText } from '../packages/leads/index.js';
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

console.log('\n"Get expert help" leads\n');

/* ---- validation ------------------------------------------------------ */

no(validateLeadInput({ name: '', email: 'a@b.com', consent: true }).ok, 'an empty name is refused');
no(validateLeadInput({ name: 'A', email: 'not-an-email', consent: true }).ok, 'a malformed email is refused');
no(validateLeadInput({ name: 'A', email: 'a@b.com', consent: false }).ok, 'no consent is refused');
no(validateLeadInput({ name: 'A', email: 'a@b.com', consent: true, programme_slug: '../../etc' }).ok, 'a programme slug with path traversal characters is refused');

{
  const v = validateLeadInput({
    name: '  Priya  ', email: 'PRIYA@Example.com ', country: ' GB ', audience: 'company',
    programme_slug: 'gb/some-grant', message: '  Need help with my R&D claim  ', consent: true,
  });
  yes(v.ok, 'a well-formed lead is accepted');
  is(v.name, 'Priya', 'name is trimmed');
  is(v.email, 'priya@example.com', 'email is trimmed and lowercased');
  is(v.country, 'gb', 'country is trimmed and lowercased');
  is(v.audience, 'company', 'audience is kept');
  is(v.programme_slug, 'gb/some-grant', 'programme slug is kept');
  is(v.message, 'Need help with my R&D claim', 'message is trimmed');
}

{
  const noAudience = validateLeadInput({ name: 'A', email: 'a@b.com', consent: true, audience: 'nonsense' });
  yes(noAudience.ok, 'an unrecognised audience value does not fail the whole submission');
  is(noAudience.audience, '', 'it is just dropped rather than stored as-is');
}

/* ---- notification copy: never a success fee -------------------------- */

{
  const text = leadNotificationText({ name: 'Priya', email: 'p@example.com', country: 'gb', audience: 'company', programme_slug: 'gb/x', message: 'Help please' });
  yes(text.includes('Priya'), 'the notification names the lead');
  yes(/flat.fee/i.test(text), 'and states this is a flat-fee referral');
  yes(/never a success fee/i.test(text), 'and explicitly disclaims a success fee');
  no(/\d+\s*%|\bcommission\b/i.test(text), 'and never quotes a numeric percentage or commission');
}

/* ---- the real thing: handler against a real database ----------------- */

function makeEnv(extra = {}) {
  return { DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com', RESEND_API_KEY: 'test-key', LEADS_TO: 'owner@example.com', ...extra };
}

const req = (url, { method = 'POST', body, headers = {} } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

const sentEmails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    sentEmails.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, init);
};

{
  const env = makeEnv();
  const bodyIn = { name: 'Founder', email: 'founder@example.com', country: 'gb', audience: 'company', programme_slug: 'gb/x', message: 'Need help', consent: true };

  const missing = await __test.handleLeadsSubmit(req('/api/leads', { body: { ...bodyIn, consent: false } }), env);
  is(missing.status, 422, 'submitting without consent is refused');

  sentEmails.length = 0;
  const res = await __test.handleLeadsSubmit(req('/api/leads', { body: bodyIn }), env);
  is(res.status, 200, 'a well-formed lead is accepted');
  const data = await res.json();
  yes(data.notified === true, 'and reports that a notification was sent, since LEADS_TO and RESEND_API_KEY are both set');
  is(sentEmails.length, 1, 'exactly one notification email was sent');
  yes(sentEmails[0].to === 'owner@example.com', 'sent to LEADS_TO');

  const row = await env.DB.prepare('SELECT * FROM leads WHERE email = ?').bind('founder@example.com').first();
  yes(row != null, 'the lead is stored in D1');
  is(row.consent, 1, 'consent is recorded');
  yes(row.notified_at != null, 'and the notified_at timestamp is set');
}

{
  /* Degrade to store-only with no mail key or no LEADS_TO — the lead is not
     lost, it is just not emailed to anyone. */
  const env = makeEnv({ RESEND_API_KEY: undefined });
  const res = await __test.handleLeadsSubmit(
    req('/api/leads', { body: { name: 'A', email: 'noreply@example.com', consent: true } }),
    env,
  );
  is(res.status, 200, 'a lead still succeeds with no mail key configured');
  const data = await res.json();
  is(data.notified, false, 'but reports that nothing was emailed');
  const row = await env.DB.prepare('SELECT * FROM leads WHERE email = ?').bind('noreply@example.com').first();
  yes(row != null, 'and the lead is still stored');
  is(row.notified_at, null, 'with no notified_at, since nothing was sent');
}

{
  const env = makeEnv({ RESEND_API_KEY: undefined });
  const res = await __test.handleLeadsSubmit(
    req('/api/leads', { body: { name: 'B', email: 'noleadsto@example.com', consent: true } }),
    { ...env, LEADS_TO: undefined },
  );
  is(res.status, 200, 'a lead succeeds with no LEADS_TO configured either');
  is((await res.json()).notified, false, 'and is not notified');
}

/* ---- rate limiting ----------------------------------------------------*/

{
  const env = makeEnv();
  for (let i = 0; i < 5; i += 1) {
    await __test.handleLeadsSubmit(req('/api/leads', { body: { name: 'A', email: `flood${i}@example.com`, consent: true } }), { ...env, headers: {} });
  }
  const capped = await __test.handleLeadsSubmit(
    req('/api/leads', { body: { name: 'A', email: 'flood-extra@example.com', consent: true } }),
    env,
  );
  /* MAX_SENDS_PER_HOUR.ip is 20 in worker/index.js; five requests from the
     same (unset) IP bucket must not trip it, so this is really asserting the
     endpoint is rate-limited at all, via the email bucket below. */
  yes(capped.status === 200 || capped.status === 429, 'the ip-rate-limit path runs without throwing');

  const sameEmail = { name: 'A', email: 'repeat@example.com', consent: true };
  let lastStatus = 200;
  for (let i = 0; i < 6; i += 1) {
    const r = await __test.handleLeadsSubmit(req('/api/leads', { body: sameEmail }), env);
    lastStatus = r.status;
  }
  is(lastStatus, 429, 'submitting the same email repeatedly within an hour eventually hits the per-email rate limit');
}

/* ---- admin listing ----------------------------------------------------*/

{
  const env = makeEnv();
  await __test.handleLeadsSubmit(req('/api/leads', { body: { name: 'Visible', email: 'visible@example.com', consent: true } }), env);

  const anon = await __test.handleAdminLeads(req('/api/admin/leads', { method: 'GET' }), env);
  is(anon.status, 403, 'listing leads with no admin session is refused');

  const admin = await __test.handleAdminLeads(req('/api/admin/leads', { method: 'GET', headers: { authorization: `Bearer ${await __test.signSession(env, { uid: 'u1', adm: true })}` } }), env);
  is(admin.status, 200, 'an admin session can list leads');
  const list = await admin.json();
  yes(Array.isArray(list.leads) && list.leads.some((l) => l.email === 'visible@example.com'), 'and the submitted lead is in the list');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
