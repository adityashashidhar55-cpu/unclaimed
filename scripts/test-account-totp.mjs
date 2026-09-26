#!/usr/bin/env node
/**
 * Optional TOTP for account holders — the same primitive the operator door
 * already has (packages/totp), offered to a signed-in user.
 *
 * The three things worth checking, in order:
 *   1. With nothing enrolled, the email code alone still signs someone in —
 *      shipping this cannot lock an existing account out.
 *   2. Once enrolled, /auth/verify stops at a "totp_required" answer rather
 *      than a session, and the pending token it hands back is the only thing
 *      that can complete the sign-in at /auth/totp.
 *   3. A recovery code works exactly once, then is spent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { __test } from '../worker/index.js';
import { totp as code6, STEP_SECONDS } from '../packages/totp/index.js';

/* Every call below runs within the same 30-second window in real wall-clock
   time, and the accepting step is Date.now() itself — the handler cannot be
   handed a fake clock. So a second and third code that must NOT replay the
   one already consumed at enrolment are drawn one step ahead: DRIFT_STEPS=1
   still accepts it as "one step early", and it lands on a step the door has
   not seen, exactly the way a phone whose clock has drifted forward would. */
const freshCode = (secret) => code6(secret, Date.now() + STEP_SECONDS * 1000);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = allMigrations(ROOT);

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));

console.log('\nOptional two-factor for account holders\n');

function makeEnv() {
  return { DB: memoryD1(MIGRATIONS), APP_ORIGIN: 'https://unclaimedgrant.com' };
}

const req = (url, { method = 'GET', body, cookie } = {}) =>
  new Request(`https://unclaimedgrant.com${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), 'cf-connecting-ip': '198.51.100.9' },
    body: body ? JSON.stringify(body) : undefined,
  });

/* A signed-in user, the way /auth/verify would actually produce one: through
   the OTP flow with ALLOW_DEV_CODE_ECHO, not by hand-minting a cookie, so
   this test cannot drift from what a real sign-in does. */
async function signIn(env, email) {
  const reqRes = await __test.handleAuthRequest(req('/auth/request', { method: 'POST', body: { email } }), {
    ...env, ALLOW_DEV_CODE_ECHO: 'true',
  });
  const { dev_code } = await reqRes.json();
  const verifyRes = await __test.handleAuthVerify(req('/auth/verify', { method: 'POST', body: { email, code: dev_code } }), env);
  return verifyRes;
}

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

{
  const env = makeEnv();

  /* ---- nothing enrolled: sign-in works exactly as it always has ------ */
  const first = await signIn(env, 'founder@example.com');
  is(first.status, 200, 'with no second factor enrolled, the email code alone still signs in');
  const firstBody = await first.json();
  yes(!firstBody.totp_required, 'and does not ask for a TOTP code');
  yes(!!cookieFrom(first), 'and a real session cookie is set');

  const uid = firstBody.user.id;
  const cookie = cookieFrom(first);

  /* ---- enrolling ------------------------------------------------------ */
  const status0 = await (await __test.handleAccountTotpStatus(req('/api/account/totp', { cookie }), env)).json();
  is(status0.enrolled, false, 'nothing is enrolled yet');
  yes(typeof status0.secret === 'string' && status0.secret.length > 20, 'and a fresh secret is offered');

  const noSession = await __test.handleAccountTotpStatus(req('/api/account/totp'), env);
  is(noSession.status, 401, 'a stranger cannot even ask whether 2FA is on');

  const wrongEnrol = await __test.handleAccountTotpEnable(
    req('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: status0.secret, code: '000000' } }),
    env,
  );
  is(wrongEnrol.status, 400, 'a wrong code does not enrol it');

  const goodCode = await code6(status0.secret);
  const enrol = await __test.handleAccountTotpEnable(
    req('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: status0.secret, code: goodCode } }),
    env,
  );
  is(enrol.status, 200, 'the right code enrols it');
  const enrolBody = await enrol.json();
  is(enrolBody.recovery_codes.length, 10, 'ten recovery codes come back, once');
  yes(new Set(enrolBody.recovery_codes).size === 10, 'and they are all different');

  const status1 = await (await __test.handleAccountTotpStatus(req('/api/account/totp', { cookie }), env)).json();
  is(status1.enrolled, true, 'now it reports enrolled');

  const doubleEnrol = await __test.handleAccountTotpEnable(
    req('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: status0.secret, code: goodCode } }),
    env,
  );
  is(doubleEnrol.status, 409, 'enrolling a second time while one is already on is refused');

  /* ---- sign-in now stops at a pending step ---------------------------- */
  const second = await signIn(env, 'founder@example.com');
  is(second.status, 200, 'the OTP step itself still succeeds — the code was right');
  const secondBody = await second.json();
  yes(secondBody.totp_required === true, 'but the answer says a TOTP code is still owed');
  yes(typeof secondBody.pending === 'string' && !cookieFrom(second), 'and no session cookie is set yet — only a pending token');

  const badTotp = await __test.handleAuthTotp(req('/auth/totp', { method: 'POST', body: { pending: secondBody.pending, code: '000000' } }), env);
  is(badTotp.status, 401, 'a wrong TOTP code does not complete the sign-in');

  const expiredPending = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending: 'garbage.notasignature', code: '000000' } }),
    env,
  );
  is(expiredPending.status, 401, 'a pending token that does not verify is refused outright');

  const finish = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending: secondBody.pending, code: await freshCode(status0.secret) } }),
    env,
  );
  is(finish.status, 200, 'the right TOTP code finishes the sign-in');
  const finishBody = await finish.json();
  is(finishBody.user.id, uid, 'as the same account the OTP step verified');
  yes(!!cookieFrom(finish), 'and now a real session cookie is set');

  /* ---- a recovery code works once, then is spent --------------------- */
  const third = await signIn(env, 'founder@example.com');
  const thirdBody = await third.json();
  const spareCode = enrolBody.recovery_codes[0];

  const badRecovery = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending: thirdBody.pending, recovery_code: 'not-a-real-one' } }),
    env,
  );
  is(badRecovery.status, 401, 'a made-up recovery code does not work');

  const recovered = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending: thirdBody.pending, recovery_code: spareCode } }),
    env,
  );
  is(recovered.status, 200, 'a real recovery code completes the sign-in');

  const fourth = await signIn(env, 'founder@example.com');
  const fourthBody = await fourth.json();
  const reused = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending: fourthBody.pending, recovery_code: spareCode } }),
    env,
  );
  is(reused.status, 401, 'the same recovery code cannot be used a second time');

  /* ---- disabling requires proof, not just the session ---------------- */
  const disableNoCode = await __test.handleAccountTotpDisable(req('/api/account/totp/disable', { method: 'POST', cookie, body: {} }), env);
  is(disableNoCode.status, 400, 'turning it off needs a current code, even from a signed-in session');

  /* A recovery code works here too — a lost phone is exactly when a TOTP
     code from it is unavailable, and re-deriving a fresh non-replayed one
     from a fixed real clock is a test artefact this codebase should not have
     to route around. */
  const anotherSpare = enrolBody.recovery_codes[1];
  const disable = await __test.handleAccountTotpDisable(
    req('/api/account/totp/disable', { method: 'POST', cookie, body: { recovery_code: anotherSpare } }),
    env,
  );
  is(disable.status, 200, 'a recovery code also turns it off');

  const status2 = await (await __test.handleAccountTotpStatus(req('/api/account/totp', { cookie }), env)).json();
  is(status2.enrolled, false, 'and the door is back to one factor');

  const fifth = await signIn(env, 'founder@example.com');
  const fifthBody = await fifth.json();
  yes(!fifthBody.totp_required, 'sign-in no longer asks for a TOTP code');
}

/* ---- supervisor hardening: weak secrets and per-account guessing ------ */
{
  const env = makeEnv();
  const first = await signIn(env, 'guess@example.com');
  const cookie = cookieFrom(first);

  const weak = await __test.handleAccountTotpEnable(
    req('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: 'AAAA', code: await code6('AAAA') } }),
    env,
  );
  is(weak.status, 400, 'a hand-picked short secret is refused at enrolment');

  const offered = await (await __test.handleAccountTotpStatus(req('/api/account/totp', { cookie }), env)).json();
  await __test.handleAccountTotpEnable(
    req('/api/account/totp/enable', { method: 'POST', cookie, body: { secret: offered.secret, code: await code6(offered.secret) } }),
    env,
  );

  const pendingRes = await signIn(env, 'guess@example.com');
  const { pending } = await pendingRes.json();
  let lastStatus = 0;
  for (let i = 0; i < 11; i += 1) {
    const ipReq = new Request('https://unclaimedgrant.com/auth/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${i + 1}` },
      body: JSON.stringify({ pending, code: '000000' }),
    });
    lastStatus = (await __test.handleAuthTotp(ipReq, env)).status;
  }
  is(lastStatus, 429, 'guessing from rotating IPs still hits a per-account limit');

  const correctButLimited = await __test.handleAuthTotp(
    req('/auth/totp', { method: 'POST', body: { pending, code: await freshCode(offered.secret) } }),
    env,
  );
  is(correctButLimited.status, 429, 'and once limited, even a right code waits out the hour');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
