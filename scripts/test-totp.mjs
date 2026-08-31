#!/usr/bin/env node
/**
 * The second factor on the operator door.
 *
 * Checked against RFC 6238's own published vectors, because a TOTP
 * implementation that is subtly wrong does not look wrong — it produces six
 * plausible digits that no authenticator app agrees with, and the first person
 * to find out is the owner locked out of their own admin panel.
 *
 * The three failures that would matter, in order:
 *   1. A wrong code opens the door.
 *   2. A used code opens the door a second time. A six-digit code lives for up
 *      to 90 seconds across the drift window, and anything that can read it
 *      once can replay it inside that window.
 *   3. The maths disagrees with every authenticator app on the planet, so
 *      enrolment appears to work and signing in never does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  base32Encode, base32Decode, hotp, totp, verify, newSecret, otpauthUri,
  isReplay, stepFor, STEP_SECONDS, DIGITS, DRIFT_STEPS,
} from '../packages/totp/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nThe operator second factor\n');

/* ---- RFC 4226 appendix D: HOTP against the published vectors ------ */

/* The RFC's secret is the ASCII string "12345678901234567890". */
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const RFC_HOTP = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
for (let c = 0; c < RFC_HOTP.length; c += 1) {
  is(await hotp(RFC_SECRET, c), RFC_HOTP[c], `RFC 4226 counter ${c} → ${RFC_HOTP[c]}`);
}

/* ---- RFC 6238 appendix B: TOTP at published times ----------------- */

/* Only the SHA-1 rows: that is the algorithm every authenticator app uses,
   and the one otpauthUri() declares. */
const B32 = base32Encode(RFC_SECRET);
for (const [seconds, expected] of [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
]) {
  is(await totp(B32, seconds * 1000), expected, `RFC 6238 t=${seconds} → ${expected}`);
}

/* That last one is past 2038. A 32-bit counter would have wrapped and
   produced a confident wrong answer, which is why the counter is a BigInt. */

/* ---- base32 round trip -------------------------------------------- */

{
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 64]);
  is([...base32Decode(base32Encode(bytes))].join(','), [...bytes].join(','), 'base32 round-trips exactly');
  is(base32Encode(new TextEncoder().encode('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'and matches the RFC secret’s known encoding');

  /* Apps print secrets in groups of four and people paste them back as-is. */
  const spaced = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq';
  is([...base32Decode(spaced)].join(','), [...base32Decode(B32)].join(','), 'a secret pasted with spaces and in lower case still decodes');
  is(base32Decode('not!valid'), null, 'a string that is not base32 decodes to null, not to garbage');
  is(base32Decode(''), null, 'and so does an empty one');
}

/* ---- verify -------------------------------------------------------- */

const SECRET = newSecret();
const NOW = 1_700_000_000_000;

{
  const code = await totp(SECRET, NOW);
  is(await verify(SECRET, code, { at: NOW }), stepFor(NOW), 'the current code verifies, and reports its step');
  no(await verify(SECRET, '000000', { at: NOW }) === stepFor(NOW), 'a wrong code does not');
  is(await verify(SECRET, '', { at: NOW }), null, 'an empty code does not');
  is(await verify(SECRET, '12345', { at: NOW }), null, 'a five-digit code does not');
  is(await verify(SECRET, 'abcdef', { at: NOW }), null, 'letters do not');
  is(await verify(SECRET, `${code} `, { at: NOW }), stepFor(NOW), 'a trailing space is forgiven — apps put one there');

  /* Drift, in both directions, and no further. */
  is(await verify(SECRET, code, { at: NOW + STEP_SECONDS * 1000 }), stepFor(NOW), 'a code one step old still works — phones drift');
  is(await verify(SECRET, code, { at: NOW - STEP_SECONDS * 1000 }), stepFor(NOW), 'so does one step early');
  is(await verify(SECRET, code, { at: NOW + 3 * STEP_SECONDS * 1000 }), null, 'three steps late does not');
  is(DRIFT_STEPS, 1, 'the window is one step either side — wider is a longer replay window, not more convenience');

  is(await verify('not a secret', code, { at: NOW }), null, 'an unreadable stored secret refuses rather than throwing');
}

/* ---- replay -------------------------------------------------------- */

{
  const step = stepFor(NOW);
  no(isReplay(step, null), 'the first code ever used is not a replay');
  yes(isReplay(step, step), 'the same code used twice is');
  yes(isReplay(step - 1, step), 'and so is an older one');
  no(isReplay(step + 1, step), 'while the next step is fine');
}

/* ---- the enrolment URI --------------------------------------------- */

{
  const uri = otpauthUri({ secret: SECRET, account: 'owner@unclaimedgrant.com' });
  yes(uri.startsWith('otpauth://totp/'), 'the URI is an otpauth one');
  yes(uri.includes(`secret=${SECRET}`), 'carrying the secret');
  yes(/issuer=Unclaimed(\+|%20)Grants/.test(uri), 'and the issuer as a parameter');
  yes(uri.includes(encodeURIComponent('Unclaimed Grants:owner@unclaimedgrant.com')), 'and in the label, for apps that only read that');
  yes(uri.includes('algorithm=SHA1') && uri.includes(`digits=${DIGITS}`) && uri.includes(`period=${STEP_SECONDS}`),
    'with the algorithm, digits and period stated rather than left to a default');
}

/* ---- secrets --------------------------------------------------------- */

{
  const a = newSecret();
  const b = newSecret();
  yes(a !== b, 'two secrets differ');
  is(base32Decode(a).length, 20, 'a secret is 20 bytes, as RFC 4226 recommends');
  yes(/^[A-Z2-7]+$/.test(a), 'and is printable base32');
}

/* ---- the door, against a real database ------------------------------- */

/* The source assertions below check the shape. This drives the actual handler
   and asserts the behaviour, which is the only thing that matters: with a
   factor enrolled, does the right password alone still open it? */
{
  const { memoryD1, allMigrations } = await import('./lib/d1-memory.mjs');
  const { __test } = await import('../worker/index.js');
  const { totp: code6, newSecret: fresh, stepFor: step6, STEP_SECONDS: S } = await import('../packages/totp/index.js');

  const env = { DB: memoryD1(allMigrations(ROOT)) };
  const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const PASSWORD = 'correct horse battery staple';

  /* The same derivation the Worker uses, written out rather than imported, so
     a change to the Worker's parameters fails this test rather than following
     it silently. */
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSWORD), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16))), iterations: 100000, hash: 'SHA-256' },
    key, 256,
  );
  const hashHex = toHex(bits);

  for (const [k, v] of [['admin_email', 'owner@unclaimedgrant.com'], ['admin_password_salt', saltHex], ['admin_password_hash', hashHex]]) {
    await env.DB.prepare('INSERT INTO worker_config (key, value, created_at) VALUES (?, ?, ?)').bind(k, v, Date.now()).run();
  }

  const login = (payload) => __test.handleAdminLogin(
    new Request('https://unclaimedgrant.com/auth/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
      body: JSON.stringify(payload),
    }),
    env,
  );

  /* Nothing enrolled: the door works exactly as it did. */
  is((await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD })).status, 200,
    'with no second factor enrolled, the password alone still opens the door');
  is((await login({ email: 'owner@unclaimedgrant.com', password: 'wrong' })).status, 401, 'and a wrong password still does not');

  /* Enrol, the way the panel does. */
  const cookie = `ua_session=${await __test.signSession(env, { adm: true, email: 'owner@unclaimedgrant.com', exp: Date.now() + 3600e3 })}`;
  const offer = await (await __test.handleAdminTotpStatus(
    new Request('https://unclaimedgrant.com/api/admin/totp', { headers: { cookie } }), env)).json();
  is(offer.enrolled, false, 'the panel offers a secret when nothing is enrolled');
  yes(typeof offer.secret === 'string' && offer.secret.length > 20, 'and the secret is a real one');

  /* The offered secret must not be stored yet — a QR code that fails to scan
     must not leave the owner locked out. */
  const storedYet = await env.DB.prepare("SELECT value FROM worker_config WHERE key = 'admin_totp_secret'").first();
  is(storedYet, null, 'the offered secret is not stored until a code proves the app has it');

  const enrol = (payload) => __test.handleAdminTotpEnable(
    new Request('https://unclaimedgrant.com/api/admin/totp/enable', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), env);

  is((await enrol({ secret: offer.secret, code: '000000' })).status, 400, 'a wrong code does not enrol it');
  is((await __test.handleAdminTotpEnable(new Request('https://unclaimedgrant.com/api/admin/totp/enable', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: offer.secret, code: '000000' }),
  }), env)).status, 403, 'and a stranger cannot enrol one at all');

  const enrolCode = await code6(offer.secret);
  is((await enrol({ secret: offer.secret, code: enrolCode })).status, 200, 'the right code enrols it');

  /* Now the door wants both. */
  const attempt = await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD });
  is(attempt.status, 401, 'the password alone no longer opens the door');
  is((await attempt.json()).error, 'code_required', 'and it says a code is wanted — only after the password checked out');

  const wrongPw = await login({ email: 'owner@unclaimedgrant.com', password: 'wrong', code: enrolCode });
  is((await wrongPw.json()).error, 'invalid', 'a wrong password with a right code says nothing about the code');

  is((await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD, code: '000000' })).status, 401, 'a wrong code does not open it');

  /* The enrolling code was burned, so it cannot also be a sign-in. */
  is((await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD, code: enrolCode })).status, 401,
    'the code used to enrol cannot then be used to sign in');

  /* A fresh code, from the next step. */
  const later = Date.now() + 2 * S * 1000;
  const fresh1 = await code6(offer.secret, later);
  /* handleAdminLogin reads the clock itself, so the test moves the clock. */
  const realNow = Date.now;
  Date.now = () => later;
  try {
    is((await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD, code: fresh1 })).status, 200,
      'a current code opens it');
    is((await login({ email: 'owner@unclaimedgrant.com', password: PASSWORD, code: fresh1 })).status, 401,
      'and the same code a second time does not — a code anyone can read once cannot be replayed');
  } finally {
    Date.now = realNow;
  }

  /* Turning it off needs a code, not just a session. */
  const disable = (payload, withCookie = true) => __test.handleAdminTotpDisable(
    new Request('https://unclaimedgrant.com/api/admin/totp/disable', {
      method: 'POST',
      headers: { ...(withCookie ? { cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), env);

  is((await disable({})).status, 400, 'a stolen session cannot switch the second factor off without a code');
  Date.now = () => later + 2 * S * 1000;
  try {
    is((await disable({ code: await code6(offer.secret, Date.now()) })).status, 200, 'a current code turns it off');
  } finally {
    Date.now = realNow;
  }
  const gone = await env.DB.prepare("SELECT COUNT(*) AS n FROM worker_config WHERE key LIKE 'admin_totp%'").first();
  is(gone.n, 0, 'and both rows are removed, so the door is back to one factor deliberately');
}

/* ---- the door itself ------------------------------------------------- */

{
  const worker = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  const login = worker.slice(worker.indexOf('async function handleAdminLogin'), worker.indexOf('/** Every /api/admin/* route goes through this. */'));

  /* Opt-in, and the opt-in has to be the stored secret rather than a flag
     somebody can forget to set. */
  /await adminTotp\(env\)/.test(login)
    ? ok('the login reads whether a second factor is enrolled')
    : bad('the login never looks for an enrolled second factor');

  /* The order that matters: the password must be checked before the code, and
     a failed code must still cost an attempt. Otherwise the code field is a
     free oracle for guessing the password. */
  const passIdx = login.indexOf('passOk');
  const totpIdx = login.search(/verify\(|totpOk/);
  passIdx > 0 && totpIdx > passIdx
    ? ok('the password is checked before the code')
    : bad('the code is checked before, or instead of, the password');

  /idx|INSERT INTO admin_attempts/.test(login.slice(totpIdx))
    ? ok('a failed second factor still costs a rate-limited attempt')
    : bad('a wrong code is free to retry');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
