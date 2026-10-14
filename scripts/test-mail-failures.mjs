#!/usr/bin/env node
/**
 * A refused email is recorded and reported, never swallowed.
 *
 * Every sender used to end in `return res.ok`. When the provider refused —
 * revoked key, domain out of verification, quota — sign-in codes, digests,
 * results emails and lead notifications all stopped together, with an empty
 * log and /api/alerts/status still answering {"configured":true}. These tests
 * drive the real handlers against a real (in-memory) D1 and a stubbed
 * provider, and assert the property: after a refusal, the deployment can say
 * what went wrong and when.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = allMigrations(ROOT);

let pass = 0, fail = 0;
const is = (a, b, m) => (a === b ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)));
const yes = (c, m) => is(!!c, true, m);

console.log('\nMail failures are recorded, not swallowed\n');

const env = () => ({ DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com', RESEND_API_KEY: 'test-key' });
const req = (url, body) => new Request(`https://unclaimedgrant.com${url}`, {
  method: body ? 'POST' : 'GET',
  headers: body ? { 'content-type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
});

/* The provider's answer, switched per scenario. */
let provider = () => new Response('{"id":"x"}', { status: 200 });
const realFetch = globalThis.fetch;
const silence = console.error;
globalThis.fetch = async (url, init) =>
  String(url).startsWith('https://api.resend.com/') ? provider(url, init) : realFetch(url, init);
const status = async (e) => (await __test.handleAlertsStatus(req('/api/alerts/status'), e)).json();
const signIn = async (e) => (await __test.handleAuthRequest(req('/auth/request', { email: 'someone@example.com' }), e)).json();

{
  const e = env();
  const before = await status(e);
  is(before.configured, true, 'a key is set, so the form renders');
  is(before.mail.healthy, false, 'but with no send on record yet, mail is not claimed healthy');
}

{
  const e = env();
  const r = await signIn(e);
  is(r.sent, true, 'an accepted sign-in code reports sent: true');
  const s = await status(e);
  yes(s.mail.last_ok_at, 'and the success is on record');
  is(s.mail.healthy, true, 'so mail reports healthy');
}

/* The outage that went unnoticed: key set, provider refusing. */
const refusals = [
  [401, 'missing_api_key', 'a revoked key'],
  [403, 'validation_error', 'an unverified sending domain'],
  [429, 'daily_quota_exceeded', 'a quota'],
];
for (const [code, name, what] of refusals) {
  const e = env();
  provider = () => new Response(JSON.stringify({ statusCode: code, name, message: 'refused' }), { status: code });
  console.error = () => {};
  const r = await signIn(e);
  console.error = silence;
  is(r.sent, false, `${what}: the sign-in response says the code was not sent`);
  const s = await status(e);
  is(s.mail.healthy, false, `${what}: status no longer says mail is fine`);
  is(s.mail.last_error_status, code, `${what}: and reports the provider's status (${code})`);
  is(s.mail.last_error_name, name, `${what}: and its error name, which is the diagnosis`);
}

{
  /* Unreachable is a different failure from refused, and should read so. */
  const e = env();
  provider = () => { throw new Error('network down'); };
  console.error = () => {};
  const r = await signIn(e);
  console.error = silence;
  is(r.sent, false, 'an unreachable provider is reported as not sent');
  is((await status(e)).mail.last_error_name, 'unreachable', 'and named as unreachable, not as a refusal');
}

{
  /* Recovery: a later success clears "unhealthy" but keeps the failure on file. */
  const e = env();
  provider = () => new Response('{"name":"validation_error"}', { status: 403 });
  console.error = () => {};
  await signIn(e);
  console.error = silence;
  await new Promise((r) => setTimeout(r, 5));
  provider = () => new Response('{"id":"x"}', { status: 200 });
  await signIn(e);
  const s = await status(e);
  is(s.mail.healthy, true, 'after a later success mail reads healthy again');
  is(s.mail.last_error_status, 403, 'but the earlier failure is still on record — "works now" is not "always worked"');
}

{
  /* Nothing about a user is exposed by the status endpoint. */
  const e = env();
  provider = () => new Response('{"name":"validation_error","message":"someone@example.com refused"}', { status: 403 });
  console.error = () => {};
  await signIn(e);
  console.error = silence;
  const raw = JSON.stringify(await status(e));
  yes(!raw.includes('someone@example.com'), 'the status endpoint never carries a recipient address');
  yes(!raw.includes('test-key'), 'or the key');
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
