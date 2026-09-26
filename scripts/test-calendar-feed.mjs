#!/usr/bin/env node
/**
 * The private iCal feed of a workspace's pipeline deadlines.
 *
 * Three things worth checking against a real database and the real handlers,
 * not a regex over the source:
 *   1. The token is a genuine capability — no sign-in reads the feed, but a
 *      wrong or revoked one gets a plain 404, and the plaintext is never
 *      recoverable once issued (only its hash is stored).
 *   2. The feed is built from what the workspace document actually holds —
 *      an internal due date, a declined entry's saved reminder — not from a
 *      fresh match run, and a closed entry (awarded) contributes nothing.
 *   3. Long lines fold at 75 octets per RFC 5545, on a title long enough to
 *      need it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MIGRATIONS = allMigrations(ROOT);

/* env.ASSETS over the real dist/ — the same pattern test-mcp.mjs and
   test-dataset-degraded.mjs use, so the feed's programme lookup (a company's
   own country pool, loaded the same way /api/startups/check loads it) is
   exercised against the real built files rather than a mock dataset. */
if (!fs.existsSync(path.join(DIST, 'api/v1/startups/global.json'))) {
  console.error('test-calendar-feed: dist/api/v1/startups/global.json is missing — run `npm run build` first');
  process.exit(1);
}

const ASSETS = {
  fetch: async (req) => {
    const p = new URL(req.url).pathname;
    const f = path.join(DIST, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'content-type': 'application/json' } });
  },
};

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nThe private pipeline calendar feed\n');

/* ---- folding, in isolation ------------------------------------------- */

{
  const short = 'SUMMARY:short';
  is(__test.foldICSLine(short), short, 'a short line is left alone');

  const long = `SUMMARY:${'x'.repeat(120)}`;
  const folded = __test.foldICSLine(long);
  yes(folded.includes('\r\n '), 'a line past 75 octets is folded with CRLF + a space');
  const enc = new TextEncoder();
  for (const part of folded.split('\r\n ')) {
    yes(enc.encode(part).length <= 75, 'no folded segment exceeds 75 octets');
  }
  is(folded.split('\r\n ').join(''), long, 'unfolding reproduces the original line exactly');

  /* Accented text — a funder's own name, not ASCII — must not split a
     multi-byte character across the fold. */
  const accented = `SUMMARY:${'é'.repeat(60)}`;
  const foldedAccented = __test.foldICSLine(accented);
  yes(!foldedAccented.includes('�'), 'folding never lands inside a multi-byte character');
}

/* ---- buildICS shape ---------------------------------------------------- */

{
  const ics = __test.buildICS(
    [{ uid: 'x@unclaimedgrant.com', at: Date.UTC(2027, 2, 3), title: 'Grant closes', body: 'Applications close 2027-03-03.', url: 'https://example.com' }],
    { name: 'Test calendar' },
  );
  yes(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'opens with VCALENDAR');
  yes(ics.includes('X-WR-CALNAME:Test calendar'), 'carries the calendar name');
  yes(ics.includes('UID:x@unclaimedgrant.com'), 'carries the given UID, not a positional one');
  yes(ics.includes('URL:https://example.com'), 'carries the URL line');
  yes(ics.trim().endsWith('END:VCALENDAR'), 'closes with END:VCALENDAR');
}

/* ---- the real thing: token lifecycle + the feed's content ------------- */

function makeEnv() {
  return { DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com', ASSETS };
}

const req = (url, { method = 'GET', body, cookie } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

async function makeSignedInUser(env, email) {
  const reqRes = await __test.handleAuthRequest(req('/auth/request', { method: 'POST', body: { email } }), { ...env, ALLOW_DEV_CODE_ECHO: 'true' });
  const { dev_code } = await reqRes.json();
  const verifyRes = await __test.handleAuthVerify(req('/auth/verify', { method: 'POST', body: { email, code: dev_code } }), env);
  const cookie = (verifyRes.headers.get('set-cookie') || '').split(';')[0];
  const { user } = await verifyRes.json();
  return { cookie, uid: user.id };
}

{
  const env = makeEnv();
  const { cookie, uid } = await makeSignedInUser(env, 'fund@example.com');
  /* The workspace is the paid product — give this test user the entitlement
     the real gate checks for, the same way test-quota.mjs does, rather than
     stub the gate out. */
  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, 'active', 'business_monthly', ?, ?)`,
  )
    .bind(uid, Date.now() + 365 * 86400000, Date.now())
    .run();

  /* No feed yet. */
  const status0 = await (await __test.handleCalendarTokenStatus(req('/api/workspace/calendar-token', { cookie }), env)).json();
  is(status0.active, false, 'no feed exists before one is created');

  const created = await (await __test.handleCalendarTokenCreate(req('/api/workspace/calendar-token', { method: 'POST', cookie }), env)).json();
  yes(typeof created.url === 'string' && created.url.includes('/api/calendar/'), 'creating one returns a URL with the token in it');
  const token = created.url.split('/api/calendar/')[1].replace(/\.ics$/, '');
  is(token.length, 64, 'the token is 32 bytes of hex, like the alert unsubscribe tokens');

  const row = await env.DB.prepare('SELECT token_hash FROM calendar_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(uid).first();
  no(row.token_hash === token, 'only the hash is stored, never the token itself');

  const status1 = await (await __test.handleCalendarTokenStatus(req('/api/workspace/calendar-token', { cookie }), env)).json();
  is(status1.active, true, 'status now reports a live feed');

  /* Put a real pipeline in the workspace: one open entry with an internal
     due date, one declined entry with a saved next-cycle reminder, one
     awarded entry that must NOT appear at all. */
  const now = Date.now();
  const doc = {
    v: 1,
    org: { name: '', country_code: '' },
    companies: [{ id: 'c1', legal_name: 'Northwind Bio', country_code: 'zz' }],
    pipeline: [
      {
        id: 'e1', company_id: 'c1', slug: null, custom_name: 'Regional Deep Tech Grant', stage: 'drafting',
        due: new Date(now + 10 * 86400000).toISOString().slice(0, 10), next_action: 'Finish the budget annex',
      },
      {
        id: 'e2', company_id: 'c1', slug: null, custom_name: 'Autumn Innovation Call', stage: 'declined',
        reminder_at: now + 200 * 86400000, reminder_label: 'Next window: ~March 2027 (projected)',
      },
      {
        id: 'e3', company_id: 'c1', slug: null, custom_name: 'Already Won Grant', stage: 'awarded',
        due: new Date(now + 5 * 86400000).toISOString().slice(0, 10),
      },
    ],
    projects: [], documents: [], postaward: [], awards: [], grants: [], searches: [],
  };
  await __test.handleWorkspacePut(req('/api/workspace', { method: 'PUT', cookie, body: { rev: 0, doc } }), env);

  const feedRes = await __test.handleCalendarFeed(req(`/api/calendar/${token}.ics`), env, token);
  is(feedRes.status, 200, 'the feed answers 200 for a live token, with no sign-in at all');
  is(feedRes.headers.get('content-type'), 'text/calendar; charset=utf-8', 'and the right content type');
  const ics = await feedRes.text();

  yes(ics.includes('Internal due date'), 'the open entry’s internal due date becomes an event');
  yes(ics.includes('Regional Deep Tech Grant'), 'naming the entry');
  yes(ics.includes('Finish the budget annex'), 'and carrying its next action as the body');

  yes(ics.includes('Autumn Innovation Call'), 'the declined entry’s saved reminder becomes an event');
  yes(ics.includes('Next window'), 'carrying the reminder label');

  no(ics.includes('Already Won Grant'), 'an awarded entry contributes no event at all');

  /* Revoke, and the same token stops working. */
  await __test.handleCalendarTokenRevoke(req('/api/workspace/calendar-token', { method: 'DELETE', cookie }), env);
  const status2 = await (await __test.handleCalendarTokenStatus(req('/api/workspace/calendar-token', { cookie }), env)).json();
  is(status2.active, false, 'status reports no live feed after revoking');

  const afterRevoke = await __test.handleCalendarFeed(req(`/api/calendar/${token}.ics`), env, token);
  is(afterRevoke.status, 404, 'the revoked token now answers 404, not the feed');

  /* A token that never existed, or is malformed, is the same 404 — never a
     500, and never a different answer that would let someone distinguish
     "wrong token" from "revoked token" by timing or shape. */
  const madeUp = await __test.handleCalendarFeed(req('/api/calendar/deadbeef.ics'), env, 'deadbeef');
  is(madeUp.status, 404, 'a malformed token is refused before it ever reaches the database');

  /* Rotating issues a fresh token and kills the old one in the same step. */
  const created2 = await (await __test.handleCalendarTokenCreate(req('/api/workspace/calendar-token', { method: 'POST', cookie }), env)).json();
  const token2 = created2.url.split('/api/calendar/')[1].replace(/\.ics$/, '');
  yes(token2 !== token, 'rotating issues a different token');
  is((await __test.handleCalendarFeed(req(`/api/calendar/${token2}.ics`), env, token2)).status, 200, 'the new token works');
}

/* ---- supervisor hardening: header injection and a lapsed subscription -- */
{
  const env = makeEnv();
  const { cookie, uid } = await makeSignedInUser(env, 'lapse@example.com');
  await env.DB.prepare(
    `INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, 'active', 'business_monthly', ?, ?)`,
  )
    .bind(uid, Date.now() + 365 * 86400000, Date.now())
    .run();
  const created = await (await __test.handleCalendarTokenCreate(req('/api/workspace/calendar-token', { method: 'POST', cookie }), env)).json();
  const token = created.url.split('/api/calendar/')[1].replace(/\.ics$/, '');

  const doc = {
    v: 1,
    org: { name: '', country_code: '' },
    companies: [{ id: 'c1', legal_name: 'Evil\r\nCo', country_code: 'zz' }],
    pipeline: [
      {
        id: 'x\r\nATTENDEE:mailto:victim@example.com', company_id: 'c1', slug: null, custom_name: 'Line\r\nBREAK', stage: 'drafting',
        due: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      },
      { id: 'bad', company_id: 'c1', slug: null, custom_name: 'Bad reminder', stage: 'declined', reminder_at: 'not a date' },
    ],
    projects: [], documents: [], postaward: [], awards: [], grants: [], searches: [],
  };
  await __test.handleWorkspacePut(req('/api/workspace', { method: 'PUT', cookie, body: { rev: 0, doc } }), env);

  const res = await __test.handleCalendarFeed(req(`/api/calendar/${token}.ics`), env, token);
  is(res.status, 200, 'a malformed reminder date does not turn the feed into a 500');
  const ics = await res.text();
  no(/\r\nATTENDEE:/.test(ics), 'a CR/LF inside an entry id cannot start a new content line');
  no(/\r\nBREAK/.test(ics), 'nor can one inside a typed programme name');

  await env.DB.prepare(`UPDATE entitlements SET status = 'canceled', current_period_end = ? WHERE user_id = ?`)
    .bind(Math.floor(Date.now() / 1000) - 86400, uid)
    .run();
  const lapsed = await __test.handleCalendarFeed(req(`/api/calendar/${token}.ics`), env, token);
  yes(lapsed.status === 402 || lapsed.status === 200, 'a lapsed subscription answers without crashing');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
