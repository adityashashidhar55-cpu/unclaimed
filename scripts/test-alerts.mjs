#!/usr/bin/env node
/**
 * Deadline email alerts: the vocabulary, the digest rule, and the door.
 *
 * Same shape as test-grants.mjs — real migrations on node:sqlite, the
 * Worker's actual handlers, no regex over the source. `fetch` is stubbed for
 * the duration of this file rather than left to hit api.resend.com: a test
 * suite that silently mails real addresses on every run is a worse bug than
 * the one it would be checking for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import {
  FREE_JURISDICTION_LIMIT, normaliseJurisdictions, validateSubscribeInput,
  genToken, dayKeyUTC, planDigest, digestEmailText, confirmEmailText,
} from '../packages/alerts/index.js';
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

console.log('\nDeadline alerts\n');

/* ---- validation ---------------------------------------------------- */

is(FREE_JURISDICTION_LIMIT, 1, 'free accounts get exactly one jurisdiction');
is(normaliseJurisdictions(['GB', ' fr ', 'gb', '', null, 'eu']).join(','), 'gb,fr,eu', 'jurisdictions are lowercased, trimmed and deduped');
no(validateSubscribeInput({ email: 'not-an-email', audience: 'companies', jurisdictions: ['gb'] }, false).ok, 'a malformed email is refused');
no(validateSubscribeInput({ email: 'a@b.com', audience: 'nonsense', jurisdictions: ['gb'] }, false).ok, 'an unknown audience is refused');
no(validateSubscribeInput({ email: 'a@b.com', audience: 'companies', jurisdictions: [] }, false).ok, 'no jurisdiction at all is refused');

const capped = validateSubscribeInput({ email: 'a@b.com', audience: 'companies', jurisdictions: ['gb', 'fr'] }, false);
no(capped.ok, 'a free caller asking for two jurisdictions is refused');
is(capped.error, 'jurisdiction_limit', 'and says which rule it hit');

const entitledTwo = validateSubscribeInput({ email: 'a@b.com', audience: 'companies', jurisdictions: ['gb', 'fr', 'de'] }, true);
yes(entitledTwo.ok, 'an entitled caller can watch more than one jurisdiction');
is(entitledTwo.jurisdictions.length, 3, 'and all of them are kept');

const oneIsFine = validateSubscribeInput({ email: 'A@B.com', audience: 'individuals', jurisdictions: ['GB'] }, false);
yes(oneIsFine.ok, 'a free caller asking for exactly one jurisdiction is accepted');
is(oneIsFine.email, 'a@b.com', 'and the email is normalised');

/* ---- tokens and day keys ------------------------------------------- */

is(genToken().length, 64, 'a token is 32 bytes of hex');
yes(genToken() !== genToken(), 'two tokens are not the same one');
is(dayKeyUTC(Date.UTC(2026, 8, 25, 23, 59)), '2026-09-25', 'the day key is the UTC calendar date');

/* ---- the digest rule: which programmes make today's email ---------- */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 25);

{
  const closesIn14 = { slug: 'a', status: 'open', closes_at: new Date(NOW + 14 * DAY).toISOString() };
  const closesIn3 = { slug: 'b', status: 'open', closes_at: new Date(NOW + 3 * DAY).toISOString() };
  const closesIn10 = { slug: 'c', status: 'open', closes_at: new Date(NOW + 10 * DAY).toISOString() };
  const alreadyClosed = { slug: 'd', status: 'closed', closes_at: new Date(NOW - 1 * DAY).toISOString() };
  const rolling = { slug: 'e', status: 'rolling' };

  const items = planDigest([closesIn14, closesIn3, closesIn10, alreadyClosed, rolling], { asOf: NOW });
  const slugs = items.map((i) => i.programme.slug).sort();
  is(slugs.join(','), 'a,b', 'only the 14-day and 3-day nudges fire, not every open programme');
  is(items.find((i) => i.programme.slug === 'a').reason, 'closing_14', 'and each carries why it is in the email');

  const none = planDigest([closesIn10, rolling], { asOf: NOW });
  is(none.length, 0, 'nothing due in 14 or 3 days means an empty plan, not a filler email');
}

{
  /* A programme with no last_sent_at is a subscriber's first-ever digest —
     nothing can register as "newly" anything against a state we never saw. */
  const upcoming = { slug: 'f', status: 'upcoming', opens_at: new Date(NOW - DAY).toISOString() };
  const firstEver = planDigest([upcoming], { asOf: NOW, lastSentAt: null });
  is(firstEver.length, 0, "a brand-new subscriber's first digest is deadline-only, not a backlog dump");

  const sinceLastWeek = planDigest([upcoming], { asOf: NOW, lastSentAt: NOW - 7 * DAY });
  is(sinceLastWeek.length, 1, 'but the same programme is "newly open" against a real prior date');
  is(sinceLastWeek[0].reason, 'newly_open', 'labelled as newly open, not a deadline nudge');
}

{
  const stillClosed = { slug: 'g', status: 'closed', closes_at: new Date(NOW - 5 * DAY).toISOString() };
  const noChange = planDigest([stillClosed], { asOf: NOW, lastSentAt: NOW - DAY });
  is(noChange.length, 0, 'a programme that was already closed last time is not "newly" anything');
}

/* ---- email copy ------------------------------------------------------ */

{
  const item = { programme: { slug: 'x', name_en: 'Test Grant', closes_at: new Date(NOW + 3 * DAY).toISOString(), application_url: 'https://example.com' }, reason: 'closing_3', days_left: 3 };
  const { subject, text } = digestEmailText([item], { asOf: NOW, unsubscribeUrl: 'https://unclaimedgrant.com/api/alerts/unsubscribe?token=t' });
  yes(/Test Grant/.test(subject), 'a single-item digest names the programme in the subject');
  yes(/funder's own page/.test(text), 'the digest always repeats the "confirm on the funder\'s page" line');
  yes(/2026-09-25/.test(text), 'and states the as-of date');
  yes(text.includes('unsubscribe?token=t'), 'and carries the unsubscribe link in the body, not only the header');

  const { subject: confirmSubject, text: confirmText } = confirmEmailText('https://x/confirm?token=t', ['gb']);
  yes(/confirm/i.test(confirmSubject), 'the confirm email says what it is for');
  yes(confirmText.includes('https://x/confirm?token=t'), 'and carries the confirm link');
}

/* ---- the real thing: handlers against a real database -------------- */

function makeEnv(extra = {}) {
  return { DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com', RESEND_API_KEY: 'test-key', ...extra };
}

const req = (url, { method = 'GET', body, cookie } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

/* Stub the outbound mail call. Every test in this file that touches
   RESEND_API_KEY runs through this, so nothing here ever reaches the
   network, and each call is recorded for the assertions that need to know
   what was actually sent. */
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

  const noKey = await __test.handleAlertsSubscribe(
    req('/api/alerts/subscribe', { method: 'POST', body: { email: 'a@b.com', audience: 'companies', jurisdictions: ['gb'] } }),
    { ...env, RESEND_API_KEY: undefined },
  );
  is(noKey.status, 503, 'with no mail key configured, subscribe answers 503 rather than silently accepting');
  is((await noKey.json()).error, 'alerts_not_configured', 'and says why, so the UI can hide the form');

  sentEmails.length = 0;
  const sub = await __test.handleAlertsSubscribe(
    req('/api/alerts/subscribe', { method: 'POST', body: { email: 'founder@example.com', audience: 'companies', jurisdictions: ['gb'] } }),
    env,
  );
  is(sub.status, 200, 'a valid subscribe request succeeds');
  is(sentEmails.length, 1, 'and sends exactly one confirm email');
  yes(/confirm/i.test(sentEmails[0].subject), 'which is the confirm email, not a digest');

  const row = await env.DB.prepare('SELECT * FROM alert_subscriptions WHERE email = ?').bind('founder@example.com').first();
  yes(row != null, 'a subscription row exists');
  is(row.confirmed_at, null, 'and is not confirmed yet — nothing is subscribed until the link is clicked');

  const confirmMatch = sentEmails[0].text.match(/https:\/\/\S+/);
  const token = new URL(confirmMatch[0]).searchParams.get('token');
  is(token, row.token, 'the confirm link carries the same token stored on the row');

  const badConfirm = await __test.handleAlertsConfirm(req('/api/alerts/confirm?token=not-a-real-token'), env);
  is(badConfirm.status, 200, 'an unknown confirm token still renders a page rather than 500ing');
  yes((await badConfirm.text()).includes('expired'), 'and tells the visitor the link did not work');

  const confirm = await __test.handleAlertsConfirm(req(`/api/alerts/confirm?token=${token}`), env);
  is(confirm.status, 200, 'the real confirm link works');
  const confirmedRow = await env.DB.prepare('SELECT confirmed_at FROM alert_subscriptions WHERE id = ?').bind(row.id).first();
  yes(confirmedRow.confirmed_at != null, 'and the subscription is now confirmed');

  /* Clicking it twice must not error and must not disturb the first timestamp. */
  const confirmAgain = await __test.handleAlertsConfirm(req(`/api/alerts/confirm?token=${token}`), env);
  is(confirmAgain.status, 200, 'confirming twice is not an error');
  const stillSame = await env.DB.prepare('SELECT confirmed_at FROM alert_subscriptions WHERE id = ?').bind(row.id).first();
  is(stillSame.confirmed_at, confirmedRow.confirmed_at, 'and does not move the confirmation time');

  /* Re-subscribing (say, to switch country) must not rotate the token: it is
     also the unsubscribe token in every digest already in that inbox. */
  await __test.handleAlertsSubscribe(
    req('/api/alerts/subscribe', { method: 'POST', body: { email: 'founder@example.com', audience: 'companies', jurisdictions: ['fr'] } }),
    env,
  );
  const resub = await env.DB.prepare('SELECT token, confirmed_at, jurisdictions FROM alert_subscriptions WHERE id = ?').bind(row.id).first();
  is(resub.token, row.token, 're-subscribing keeps the token, so old List-Unsubscribe links still work');
  is(resub.confirmed_at, null, 'but a change of jurisdiction has to be confirmed again');
  is(resub.jurisdictions, '["fr"]', 'and the new jurisdiction is stored');
}

/* ---- the free cap, enforced server-side, not just in the UI --------- */

{
  const env = makeEnv();
  const twoJurisdictions = await __test.handleAlertsSubscribe(
    req('/api/alerts/subscribe', { method: 'POST', body: { email: 'greedy@example.com', audience: 'companies', jurisdictions: ['gb', 'fr'] } }),
    env,
  );
  is(twoJurisdictions.status, 422, 'a signed-out caller cannot subscribe to two jurisdictions');
  is((await twoJurisdictions.json()).error, 'jurisdiction_limit', 'and is told which rule stopped them');
}

/* ---- cron: sends once, never empty, never twice, respects unsubscribe */

{
  const env = makeEnv();
  const asOf = Date.UTC(2026, 8, 25);

  sentEmails.length = 0;
  await __test.handleAlertsSubscribe(
    req('/api/alerts/subscribe', { method: 'POST', body: { email: 'watcher@example.com', audience: 'companies', jurisdictions: ['gb'] } }),
    env,
  );
  const row = await env.DB.prepare('SELECT * FROM alert_subscriptions WHERE email = ?').bind('watcher@example.com').first();
  const token = new URL(sentEmails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  await __test.handleAlertsConfirm(req(`/api/alerts/confirm?token=${token}`), env);

  const fixture = [
    { slug: 'gb-closing-soon', name_en: 'Closing Soon Fund', status: 'open', closes_at: new Date(asOf + 14 * DAY).toISOString(), application_url: 'https://example.com/apply' },
    { slug: 'gb-mid-cycle', name_en: 'Mid Cycle Fund', status: 'open', closes_at: new Date(asOf + 40 * DAY).toISOString() },
  ];
  const loadJurisdictionProgrammes = async () => fixture;

  sentEmails.length = 0;
  const first = await __test.runAlertsCron(env, { asOf, loadJurisdictionProgrammes });
  is(first.sent, 1, 'the cron sends a digest to the one confirmed, due subscriber');
  is(sentEmails.length, 1, 'exactly one email went out');
  yes(sentEmails[0].headers['List-Unsubscribe'].includes(token), 'and it carries a List-Unsubscribe header with a working token');
  yes(sentEmails[0].text.includes('Closing Soon Fund'), 'naming the programme that is actually due');
  no(sentEmails[0].text.includes('Mid Cycle Fund'), 'and leaving out the one that is not due for another 40 days');

  const sendRow = await env.DB.prepare('SELECT * FROM alert_sends WHERE subscription_id = ?').bind(row.id).first();
  yes(sendRow != null, 'the send is logged for idempotency');
  is(sendRow.sent_date, dayKeyUTC(asOf), 'against today\'s UTC date');

  sentEmails.length = 0;
  const second = await __test.runAlertsCron(env, { asOf: asOf + 3600e3, loadJurisdictionProgrammes });
  is(second.sent, 0, 'running the cron again the same UTC day sends nothing more');
  is(sentEmails.length, 0, 'not one more email, even though the same programme is still due');

  const emptyFixture = async () => [{ slug: 'gb-mid-cycle', name_en: 'Mid Cycle Fund', status: 'open', closes_at: new Date(asOf + 40 * DAY).toISOString() }];
  const tomorrow = asOf + DAY;
  const third = await __test.runAlertsCron(env, { asOf: tomorrow, loadJurisdictionProgrammes: emptyFixture });
  is(third.sent, 0, 'and the next day, with nothing due, the cron sends no empty digest');

  /* Unsubscribe, then confirm the cron leaves them alone for good. */
  const unsub = await __test.handleAlertsUnsubscribe(req(`/api/alerts/unsubscribe?token=${token}`), env);
  is(unsub.status, 200, 'unsubscribing by token succeeds with no sign-in');
  const afterUnsub = await env.DB.prepare('SELECT unsubscribed_at FROM alert_subscriptions WHERE id = ?').bind(row.id).first();
  yes(afterUnsub.unsubscribed_at != null, 'and the row is marked unsubscribed');

  sentEmails.length = 0;
  const afterUnsubCron = await __test.runAlertsCron(env, {
    asOf: asOf + 14 * DAY,
    loadJurisdictionProgrammes: async () => fixture,
  });
  is(afterUnsubCron.sent, 0, 'an unsubscribed row is never mailed again, however due the programme is');
  is(sentEmails.length, 0, 'no mail went out');

  /* One-click unsubscribe (RFC 8058): a mail client POSTs the same URL with
     no confirmation page, and it must succeed even for an already-used
     token. */
  const oneClick = await __test.handleAlertsUnsubscribe(req(`/api/alerts/unsubscribe?token=${token}`, { method: 'POST' }), env);
  is(oneClick.status, 200, 'a POST one-click unsubscribe on an already-unsubscribed token still succeeds');
}

/* ---- the cron itself refuses to run with no mail key ---------------- */

{
  const env = makeEnv({ RESEND_API_KEY: undefined });
  const res = await __test.runAlertsCron(env, { asOf: Date.now() });
  is(res.sent, 0, 'with no mail key, the cron sends nothing');
  is(res.skipped, 'not_configured', 'and says why, rather than quietly doing nothing forever');
}

globalThis.fetch = realFetch;

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
