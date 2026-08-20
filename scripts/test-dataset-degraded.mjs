#!/usr/bin/env node
/**
 * A paying reader must never be handed unusable rows with nothing saying why.
 *
 * When the build forgets EMIT_FULL_DATASET=1 the unstripped files are absent,
 * and the Worker answers an entitled request from the stripped public file:
 * the same rows with the names, funders and links removed. On screen that is
 * dozens of blank cards, each with an amount and two dead buttons, under a
 * heading promising money — indistinguishable from a bug, and worse,
 * indistinguishable from the free tier the reader just paid to leave.
 *
 * loadCountry() has marked that payload `dataset_degraded` for two rounds.
 * loadCountry() serves POST /api/check, WHICH THE BROWSER NEVER CALLS. The
 * site fetches GET /api/v1/programmes/{cc}.json, and that route fell through
 * to the stripped asset carrying no flag at all — so the read side had
 * nothing to read and the fix reported as shipped while changing nothing.
 *
 * So this asserts the property on the route the site actually uses, phrased
 * without reference to any field name on the way in:
 *
 *   IF the response an entitled caller receives cannot be rendered as usable
 *   cards (most rows have no name), THEN the response says so.
 *
 * and the converse, which is what stops the flag being hardcoded true:
 *   IF the rows are usable, the response does NOT claim to be degraded.
 *
 * It drives the real Worker's fetch handler. Nothing here re-implements it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`));
};

const SECRET = 'test-signing-key-not-a-real-one';
const enc = new TextEncoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Mint a session the Worker will accept, using the Worker's own scheme. */
async function token(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))));
  return `${body}.${sig}`;
}

/**
 * env.ASSETS over the real dist/. `fullPresent: false` is the whole point:
 * it is exactly what a build without EMIT_FULL_DATASET leaves behind, and it
 * is also what a plain checked-out dist/ is most of the time.
 */
const assetsEnv = ({ fullPresent }) => ({
  SESSION_SIGNING_KEY: SECRET,
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => ({ status: 'active', plan: 'personal_annual', current_period_end: null }) }),
      first: async () => null,
      run: async () => ({}),
      all: async () => ({ results: [] }),
    }),
  },
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (!fullPresent && p.startsWith('/api/v1/full/')) return new Response('Not found', { status: 404 });
      const f = path.join(DIST, p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('Not found', { status: 404 });
      return new Response(fs.readFileSync(f), { headers: { 'content-type': 'application/json' } });
    },
  },
});

const get = (env, cookie) =>
  worker.fetch(
    new Request('https://unclaimedgrant.com/api/v1/programmes/gb.json', cookie ? { headers: { cookie } } : undefined),
    env,
    { waitUntil() {} },
  );

/** The reader-facing question: could these rows be rendered as usable cards? */
const usableShare = (body) => {
  const rows = body?.programmes || [];
  if (!rows.length) return 0;
  return rows.filter((p) => p && typeof p.name_en === 'string' && p.name_en.trim()).length / rows.length;
};

const cookie = `ua_session=${await token({ uid: 'u_test', exp: Date.now() + 3600e3 })}`;

if (!fs.existsSync(path.join(DIST, 'api/v1/programmes/gb.json'))) {
  console.error('dataset-degraded: dist/api/v1/programmes/gb.json is missing; build first');
  process.exit(1);
}

/* 1. Full dataset absent, caller has paid — the R9 production state. */
{
  const res = await get(assetsEnv({ fullPresent: false }), cookie);
  const body = await res.json().catch(() => null);
  t('an entitled request still gets an answer when the full dataset is missing', res.status === 200 && !!body);
  const share = usableShare(body);
  t('and those rows are indeed unusable — most have no name', share < 0.5, `name share ${(share * 100).toFixed(0)}%`);
  t(
    'and the answer says so, instead of looking exactly like the free tier',
    body?.dataset_degraded === true,
    `dataset_degraded=${JSON.stringify(body?.dataset_degraded)}`,
  );
  t('and names the incident, so support can tell which failure it was', body?.dataset_degraded_reason === 'full_dataset_missing');
}

/* 2. Full dataset present — the normal state. The flag must not be sticky. */
if (fs.existsSync(path.join(DIST, 'api/v1/full/programmes/gb.json'))) {
  const res = await get(assetsEnv({ fullPresent: true }), cookie);
  const body = await res.json().catch(() => null);
  const share = usableShare(body);
  t('with the full dataset present an entitled reader gets usable rows', share > 0.9, `name share ${(share * 100).toFixed(0)}%`);
  t('and the response does not claim to be degraded', body?.dataset_degraded !== true);
} else {
  t('dist/ carries the full dataset to test the healthy case against', false, 'api/v1/full/programmes/gb.json absent');
}

/* 3. A signed-out caller gets the stripped file because that is the paywall,
      not because anything failed. Marking that degraded would cry wolf on
      every anonymous visit and train the reader to ignore the notice. */
{
  const res = await get(assetsEnv({ fullPresent: false }), null);
  const body = await res.json().catch(() => null);
  t('a signed-out visitor is not told the service is broken', body?.dataset_degraded !== true);
}

console.log(`dataset-degraded: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
