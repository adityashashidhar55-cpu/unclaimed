#!/usr/bin/env node
/**
 * "Email me this result" and its follow-ups: validation, the one transactional
 * email, consent handling, unsubscribe, the day 2/5/10/21 sequence and the
 * weekly digest. Real migrations on node:sqlite (scripts/lib/d1-memory.mjs),
 * the Worker's real handlers, and the real built dataset behind a stubbed
 * ASSETS — needs `npm run build` first. `fetch` is stubbed so no test run can
 * mail a real address.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { __test } from '../worker/index.js';
import {
  validateResultsEmailInput, buildShareLink, dueStep, resultSignature, SEQUENCE_DAYS, DAY,
  householdHeadline, resultEmail, sequenceEmail, digestEmail,
} from '../packages/lifecycle/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(DIST, 'api/v1/countries.json'))) {
  console.error('test-results-email: dist/ is missing — run `npm run build` first');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\n"Email me this result"\n');

const MIGRATIONS = allMigrations(ROOT);
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    sent.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, init);
};

const ASSETS = {
  fetch: async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    let f = path.join(DIST, p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'content-type': f.endsWith('.json') ? 'application/json' : 'text/html' } });
  },
};
const makeEnv = (extra = {}) => ({ DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com', RESEND_API_KEY: 'test-key', ASSETS, ...extra });
const req = (url, { method = 'POST', body, ip = '203.0.113.9' } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { 'cf-connecting-ip': ip, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const HOUSE = {
  country_code: 'GB', admin_area: null, status: 'employee', age: 34, income_band: null, income_annual: 18000,
  household_size: 3, children_count: 2, housing_tenure: 'renting', nationality_group: 'citizen_or_pr',
  residency_months: 120, circumstances: [],
};
const COMPANY = {
  country_code: 'gb', incorporated: true, incorporation_date: '2026-01-01', headcount: 3,
  turnover_annual_eur: 50000, stage: 'seed', sectors: ['software'], rd_active: true, has_local_entity: true,
};
const post = (env, body, ip) => __test.handleResultsEmail(req('/api/results/email', { body, ip }), env);

/* ---- validation ------------------------------------------------------ */

no(validateResultsEmailInput({ email: 'nope', audience: 'household', profile: HOUSE }).ok, 'a malformed email is refused');
no(validateResultsEmailInput({ email: 'a@b.com', audience: 'nonsense', profile: HOUSE }).ok, 'an unknown audience is refused');
no(validateResultsEmailInput({ email: 'a@b.com', audience: 'household' }).ok, 'a missing profile is refused');
no(validateResultsEmailInput({ email: 'a@b.com', audience: 'household', profile: { age: 3 } }).ok, 'a profile with no country is refused');
no(validateResultsEmailInput({ email: 'a@b.com', audience: 'household', profile: { country_code: 'gb', junk: 'x'.repeat(5000) } }).ok, 'an oversized profile is refused');
{
  const v = validateResultsEmailInput({ email: ' A@B.com ', audience: 'household', profile: HOUSE, consent: 'yes', locale: 'xx' });
  yes(v.ok, 'a well-formed request is accepted');
  is(v.email, 'a@b.com', 'email is trimmed and lowercased');
  is(v.country, 'gb', 'country is lowercased');
  is(v.marketing, false, 'a truthy string is not a ticked box — only boolean true is');
  is(v.locale, 'en', 'an unknown locale falls back to en');
  is(validateResultsEmailInput({ email: 'a@b.com', audience: 'company', profile: COMPANY, consent: true, locale: 'fr' }).marketing, true, 'boolean true is a ticked box');
}

/* ---- share link round-trips ------------------------------------------ */
{
  const v = validateResultsEmailInput({ email: 'a@b.com', audience: 'company', profile: COMPANY, locale: 'fr' });
  const link = buildShareLink('https://unclaimedgrant.com', v);
  yes(link.startsWith('https://unclaimedgrant.com/fr/startups/check/'), 'the company link points at the localised company check');
  const b64 = link.split('#r=')[1].replace(/-/g, '+').replace(/_/g, '/');
  const back = JSON.parse(decodeURIComponent(escape(atob(b64))));
  is(back.stage, 'seed', 'and its #r= fragment decodes to the profile, the same encoding the wizards use');
  yes(buildShareLink('https://unclaimedgrant.com', { audience: 'household', locale: 'en', profileJson: '{}' }).includes('/check/?utm_source=result_email'), 'the household link carries a result_email utm tag');
}

/* ---- sequence timing --------------------------------------------------- */
{
  const t0 = Date.UTC(2026, 9, 1);
  is(dueStep(t0, 0, t0 + 1 * DAY), 0, 'nothing is due on day 1');
  is(dueStep(t0, 0, t0 + 2 * DAY), 1, 'step 1 is due on day 2');
  is(dueStep(t0, 1, t0 + 4 * DAY), 0, 'and not again');
  is(dueStep(t0, 1, t0 + 5 * DAY), 2, 'step 2 on day 5');
  is(dueStep(t0, 0, t0 + 12 * DAY), 3, 'a subscriber the cron missed jumps to the latest due step, not a stale day-2 email');
  is(dueStep(t0, 3, t0 + 21 * DAY), 4, 'step 4 on day 21');
  is(dueStep(t0, 4, t0 + 90 * DAY), 0, 'and the sequence ends there');
  is(SEQUENCE_DAYS.join(','), '2,5,10,21', 'the days are 2, 5, 10, 21');
}

/* ---- the endpoint: no key, bad input, unknown country ------------------ */
{
  const r = await post(makeEnv({ RESEND_API_KEY: undefined }), { email: 'a@b.com', audience: 'household', profile: HOUSE });
  is(r.status, 503, 'with no mail key the endpoint says so (503), rather than pretending to send');
  const env = makeEnv();
  is((await post(env, { email: 'bad', audience: 'household', profile: HOUSE })).status, 422, 'bad input is a 422');
  is((await post(env, { email: 'a@b.com', audience: 'household', profile: { country_code: 'ZZ' } })).status, 404, 'an uncovered country is a 404');
  is(sent.length, 0, 'and none of those sent anything');
}

/* ---- household: result email, no consent ------------------------------- */
{
  const env = makeEnv();
  sent.length = 0;
  const r = await post(env, { email: 'Visitor@Example.com', audience: 'household', profile: HOUSE, consent: false, locale: 'en' });
  is(r.status, 200, 'a request with the box unticked succeeds');
  is((await r.json()).follow_ups, false, 'and says no follow-ups are on');
  is(sent.length, 1, 'exactly one email goes out');
  const m = sent[0];
  is(m.to, 'visitor@example.com', 'to the normalised address');
  yes(/List-Unsubscribe/.test(Object.keys(m.headers ?? {}).join()), 'with a List-Unsubscribe header');
  yes(m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'and the RFC 8058 one-click header');
  yes(m.text.includes('https://unclaimedgrant.com/check/?utm_source=result_email'), 'it carries the shareable result link');
  yes(m.text.includes('/pricing/'), 'and a link to unlock the full list');
  yes(/€50 a year/.test(m.text), 'which states the Personal price plainly');
  yes(!/follow-ups over the next three weeks/.test(m.text), 'and promises no follow-ups when none were asked for');

  /* The numbers are the free check's own. */
  const free = await (await __test.handleCheck(req('/api/check', { body: HOUSE }), env)).json();
  const eligible = free.counts.eligible;
  yes(m.text.includes(`${eligible} programme`), `the headline count matches /api/check (${eligible})`);
  if (free.total_max > 0) {
    const fmt = (n) => new Intl.NumberFormat('en', { style: 'currency', currency: free.currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(n);
    yes(m.text.includes(fmt(free.total_max)), `and the per-year ceiling matches /api/check (${fmt(free.total_max)})`);
  }

  /* Never the locked names. */
  const full = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/full/programmes/gb.json'), 'utf8'));
  const names = full.programmes.map((p) => p.name_en).filter((n) => n && n.length > 12);
  const leaked = names.filter((n) => m.text.includes(n));
  is(leaked.length, 0, `no programme name appears in the email (checked ${names.length})`);

  const row = await env.DB.prepare('SELECT * FROM result_subscribers WHERE email = ?').bind('visitor@example.com').first();
  yes(row != null, 'a row is stored');
  is(row.consent_at, null, 'with no consent_at');
  is(row.profile, '{}', 'the answers are wiped as soon as the email is sent');
  is(row.share_link, '', 'and so is the link that encodes them');
  yes(row.sent_at != null, 'sent_at is recorded');
}

/* ---- household: consent keeps the answers ------------------------------ */
{
  const env = makeEnv();
  sent.length = 0;
  const r = await post(env, { email: 'keen@example.com', audience: 'household', profile: HOUSE, consent: true });
  is((await r.json()).follow_ups, true, 'ticking the box turns follow-ups on');
  yes(/follow-ups over the next three weeks/.test(sent[0].text), 'and the email says so');
  const row = await env.DB.prepare('SELECT * FROM result_subscribers WHERE email = ?').bind('keen@example.com').first();
  yes(row.consent_at != null, 'consent_at is set');
  is(JSON.parse(row.profile).age, 34, 'the answers are kept as entered');
  is(row.audience, 'household', 'audience is stored');
  is(row.country, 'gb', 'country is stored');

  const token = row.token;
  await post(env, { email: 'keen@example.com', audience: 'household', profile: { ...HOUSE, age: 40 }, consent: false });
  const again = await env.DB.prepare('SELECT * FROM result_subscribers WHERE email = ?').bind('keen@example.com').first();
  is(again.token, token, 're-submitting keeps the unsubscribe token (it is in earlier emails)');
  yes(again.consent_at != null, 'and an unticked re-submit does not silently revoke consent');
  is(JSON.parse(again.profile).age, 40, 'but the answers are refreshed');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM result_subscribers').first();
  is(n.n, 1, 'one row per (email, audience)');
}

/* ---- company ------------------------------------------------------------ */
{
  const env = makeEnv();
  sent.length = 0;
  const r = await post(env, { email: 'founder@example.com', audience: 'company', profile: COMPANY, consent: true });
  is(r.status, 200, 'a company result can be emailed');
  const free = await (await __test.handleStartupCheck(req('/api/startups/check', { body: COMPANY }), env)).json();
  yes(sent[0].text.includes(`${free.counts.eligible} programme`), 'its count matches /api/startups/check');
  yes(/14-day trial/.test(sent[0].text) && /€490 a year/.test(sent[0].text), 'and the offer is the Startup trial');
  yes(sent[0].text.includes('/startups/check/'), 'with the company result link');
}

/* ---- rate limiting ------------------------------------------------------ */
{
  const env = makeEnv();
  let last = 200;
  for (let i = 0; i < 21; i += 1) {
    last = (await post(env, { email: `flood${i}@example.com`, audience: 'household', profile: HOUSE }, '198.51.100.7')).status;
  }
  is(last, 429, 'the 21st request from one IP in an hour is refused');
  let e = 200;
  for (let i = 0; i < 6; i += 1) e = (await post(env, { email: 'same@example.com', audience: 'household', profile: HOUSE }, `192.0.2.${i}`)).status;
  is(e, 429, 'and the 6th to the same address, from different IPs, is refused too');
}

/* ---- unsubscribe ---------------------------------------------------------- */
{
  const env = makeEnv();
  await post(env, { email: 'leaver@example.com', audience: 'household', profile: HOUSE, consent: true });
  const row = await env.DB.prepare('SELECT token FROM result_subscribers WHERE email = ?').bind('leaver@example.com').first();
  const unsub = await __test.handleResultsUnsubscribe(req(`/api/results/unsubscribe?token=${row.token}`, { method: 'POST' }), env);
  is(unsub.status, 200, 'one-click POST unsubscribe answers 200');
  const after = await env.DB.prepare('SELECT * FROM result_subscribers WHERE email = ?').bind('leaver@example.com').first();
  yes(after.unsubscribed_at != null, 'the row is marked unsubscribed');
  is(after.profile, '{}', 'and the saved answers are deleted');
  const page = await __test.handleResultsUnsubscribe(req(`/api/results/unsubscribe?token=${row.token}`, { method: 'GET' }), env);
  yes((await page.text()).includes('Unsubscribed'), 'the link clicked as a page says so');
  is((await __test.handleResultsUnsubscribe(req('/api/results/unsubscribe?token=nope', { method: 'GET' }), env)).status, 200, 'an unknown token does not error');

  sent.length = 0;
  const cron = await __test.runResultsCron(env, { asOf: Date.now() + 30 * DAY, loadJurisdictionProgrammes: () => [] });
  is(cron.sent, 0, 'the cron never writes to an unsubscribed address');

  /* Re-opting in with the box ticked is a fresh start. */
  await post(env, { email: 'leaver@example.com', audience: 'household', profile: HOUSE, consent: true }, '203.0.113.50');
  const back = await env.DB.prepare('SELECT * FROM result_subscribers WHERE email = ?').bind('leaver@example.com').first();
  is(back.unsubscribed_at, null, 'ticking the box again after unsubscribing re-subscribes');
  is(back.seq_step, 0, 'and restarts the sequence');
}

/* ---- the cron: sequence ----------------------------------------------------- */
{
  const env = makeEnv();
  const T0 = Date.UTC(2026, 9, 1);
  const programmes = [
    { slug: 'x', status: 'open', closes_at: new Date(T0 + 12 * DAY + 20 * DAY).toISOString() },
    { slug: 'y', status: 'open', closes_at: new Date(T0 + 12 * DAY + 90 * DAY).toISOString() },
  ];
  const load = () => programmes;
  const mk = async (email, consent, extra = {}) => {
    await post(env, { email, audience: 'household', profile: HOUSE, consent });
    await env.DB.prepare('UPDATE result_subscribers SET created_at = ?, sent_at = ? WHERE email = ?').bind(T0, T0, email).run();
    if (extra.seq_step != null) await env.DB.prepare('UPDATE result_subscribers SET seq_step = ?, last_mail_at = ? WHERE email = ?').bind(extra.seq_step, extra.last_mail_at ?? null, email).run();
  };
  await mk('seq@example.com', true);
  await mk('noconsent@example.com', false);
  await mk('late@example.com', true);

  sent.length = 0;
  let r = await __test.runResultsCron(env, { asOf: T0 + 1 * DAY, loadJurisdictionProgrammes: load });
  is(r.sent, 0, 'day 1: nothing is sent');

  r = await __test.runResultsCron(env, { asOf: T0 + 2 * DAY + 3600e3, loadJurisdictionProgrammes: load });
  is(r.sent, 2, 'day 2: the two consenting subscribers get step 1 — and not the one who did not tick the box');
  yes(sent.every((m) => m.to !== 'noconsent@example.com'), 'no marketing to a non-consenting address, ever');
  const s1 = sent.find((m) => m.to === 'seq@example.com');
  yes(/Deadlines in/.test(s1.subject), 'step 1 is the deadlines email');
  yes(/1 programme in .* closes within the next 60 days|within the next 60 days/.test(s1.text), 'and counts what closes in 60 days from the dataset it was given');
  yes(s1.text.includes('/api/results/unsubscribe?token='), 'every follow-up carries the unsubscribe link');
  yes(s1.headers['List-Unsubscribe'].includes('/api/results/unsubscribe?token='), 'and the List-Unsubscribe header');
  yes(s1.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'and one-click');

  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 2 * DAY + 2 * 3600e3, loadJurisdictionProgrammes: load });
  is(r.sent, 0, 'running the cron twice the same day sends nothing the second time');

  r = await __test.runResultsCron(env, { asOf: T0 + 5 * DAY + 3600e3, loadJurisdictionProgrammes: load });
  is(r.sent, 2, 'day 5: step 2');
  yes(sent.every((m) => /How to read/.test(m.subject)), 'which is how to read the result');

  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 10 * DAY + 3600e3, loadJurisdictionProgrammes: load });
  is(r.sent, 2, 'day 10: step 3');
  yes(sent.every((m) => /pricing/.test(m.text) && /€50 a year/.test(m.text)), 'the unlock offer, with the price stated');
  yes(sent.every((m) => !/\bguarantee|secure your|we will get you\b/i.test(m.text)), 'and no promise that we obtain anything');

  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 21 * DAY + 3600e3, loadJurisdictionProgrammes: load });
  is(r.sent, 2, 'day 21: step 4, the last reminder');
  yes(sent.every((m) => /Last note/.test(m.subject)), 'which says it is the last');

  const row = await env.DB.prepare('SELECT seq_step FROM result_subscribers WHERE email = ?').bind('seq@example.com').first();
  is(row.seq_step, 4, 'the sequence has recorded all four steps');
  const nc = await env.DB.prepare('SELECT seq_step, last_mail_at FROM result_subscribers WHERE email = ?').bind('noconsent@example.com').first();
  is(nc.seq_step, 0, 'and the non-consenting row was never touched');

  /* A subscriber at step 0 who is 12 days old gets the day-10 email, not a stale day-2. */
  await env.DB.prepare("INSERT INTO result_subscribers (id, email, audience, country, profile, share_link, token, consent_at, created_at, sent_at) VALUES ('z','stale@example.com','household','gb',?, 'https://x', 'tok-stale', ?, ?, ?)")
    .bind(JSON.stringify(HOUSE), T0, T0, T0).run();
  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 12 * DAY, loadJurisdictionProgrammes: load });
  const stale = sent.find((m) => m.to === 'stale@example.com');
  yes(stale && /See which programmes/.test(stale.subject), 'a subscriber the cron missed jumps straight to the day-10 email');
}

/* ---- the cron: paying customers are left alone ------------------------------ */
{
  const env = makeEnv();
  const T0 = Date.UTC(2026, 9, 1);
  await post(env, { email: 'payer@example.com', audience: 'household', profile: HOUSE, consent: true });
  await env.DB.prepare('UPDATE result_subscribers SET created_at = ?, sent_at = ?').bind(T0, T0).run();
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES ('u-pay','payer@example.com', ?)").bind(T0).run();
  await env.DB.prepare("INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES ('u-pay','active','personal_annual', ?, ?)")
    .bind(Math.floor((Date.now() + 200 * DAY) / 1000), T0).run();
  sent.length = 0;
  const r = await __test.runResultsCron(env, { asOf: T0 + 5 * DAY, loadJurisdictionProgrammes: () => [] });
  is(r.sent, 0, 'someone who already pays gets no sales sequence');
  is(r.skipped_paid, 1, 'and the run says why');
}

/* ---- the cron: weekly digest -------------------------------------------------- */
{
  const env = makeEnv();
  const T0 = Date.UTC(2026, 9, 1);
  await post(env, { email: 'weekly@example.com', audience: 'household', profile: HOUSE, consent: true });
  const mailed = T0 + 21 * DAY;
  await env.DB.prepare('UPDATE result_subscribers SET created_at = ?, sent_at = ?, seq_step = 4, last_mail_at = ?').bind(T0, T0, mailed).run();
  const none = () => [];

  sent.length = 0;
  let r = await __test.runResultsCron(env, { asOf: mailed + 3 * DAY, loadJurisdictionProgrammes: none });
  is(r.sent, 0, 'no digest less than a week after the last email');

  r = await __test.runResultsCron(env, { asOf: T0 + 29 * DAY, loadJurisdictionProgrammes: none });
  is(r.sent, 0, 'a week on, with an unchanged result and nothing new open, no email — never an empty digest');

  const sig = (await env.DB.prepare('SELECT result_sig FROM result_subscribers').first()).result_sig;
  yes(typeof sig === 'string' && sig.length > 5, 'the signature of the result last emailed was recorded at signup');

  /* A programme that opened since the last email, though the result itself is unchanged. */
  const realProgs = (cc, aud) => (aud === 'individuals' ? [{ slug: 'new', name_en: 'A Brand New Scheme', status: 'upcoming', opens_at: new Date(mailed + 2 * DAY).toISOString() }] : []);
  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 30 * DAY, loadJurisdictionProgrammes: realProgs });
  is(r.digest, 1, 'a programme that opened since the last email sends the digest even if the result is unchanged');
  yes(/1 programme in .* has opened/.test(sent[0].text), 'and the digest says how many opened');
  yes(!sent[0].text.includes('A Brand New Scheme'), 'but never names one');
  await env.DB.prepare("UPDATE result_subscribers SET last_mail_at = ?").bind(mailed).run();

  /* Changed result: pretend the last email said something else. */
  await env.DB.prepare("UPDATE result_subscribers SET result_sig = 'old', last_mail_at = ?").bind(mailed).run();
  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 29 * DAY, loadJurisdictionProgrammes: none });
  is(r.digest, 1, 'a changed result sends the digest');
  yes(/has changed/.test(sent[0].subject), 'saying the result changed');
  yes(sent[0].headers['List-Unsubscribe'], 'with the unsubscribe header');
  const after = await env.DB.prepare('SELECT result_sig FROM result_subscribers').first();
  yes(after.result_sig !== 'old', 'and the new signature is recorded, so the next run is quiet again');
  sent.length = 0;
  r = await __test.runResultsCron(env, { asOf: T0 + 29 * DAY + 3600e3, loadJurisdictionProgrammes: none });
  is(r.sent, 0, 'which it is');
}

/* ---- copy hygiene ---------------------------------------------------------------- */
{
  const headline = householdHeadline({ country: 'United Kingdom', currency: 'GBP', total_min: 0, total_max: 5000, one_off_min: 0, one_off_max: 0, one_off_count: 0, counts: { eligible: 3, conditional: 1, needs_answer: 0 } });
  const all = [
    resultEmail({ audience: 'household', headline, shareLink: 'L', unlockUrl: 'U', unsubscribeUrl: 'X', marketing: true }),
    ...[1, 2, 3, 4].map((s) => sequenceEmail(s, { audience: 'household', headline, shareLink: 'L', unlockUrl: 'U', unsubscribeUrl: 'X', countryUrl: 'C', closing: 2, countryName: 'United Kingdom' })),
    digestEmail({ audience: 'household', headline, shareLink: 'L', unlockUrl: 'U', unsubscribeUrl: 'X', newlyOpen: 2, changed: true, countryName: 'United Kingdom' }),
  ];
  yes(all.every((m) => m.text.includes('Stop all emails from us: X')), 'every email ends with the unsubscribe link');
  yes(all.every((m) => /funder/.test(m.text)), 'and the check-the-funder reminder');
  yes(all.every((m) => !/commission|success fee|% of what/i.test(m.text)), 'and never mentions a commission or success fee');
  yes(all.every((m) => !m.text.includes('—')), 'and uses no em dashes');
}

/* ---- sig stability ------------------------------------------------------------------ */
{
  const f = { counts: { eligible: 2 }, total_min: 1, total_max: 2 };
  is(resultSignature(f, 'household'), resultSignature({ ...f }, 'household'), 'a result signature is stable');
  yes(resultSignature(f, 'household') !== resultSignature({ ...f, total_max: 3 }, 'household'), 'and moves when a total moves');
}

globalThis.fetch = realFetch;
console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
