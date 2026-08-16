/* Exercise the OTP logic that the Worker will run: uniformity of the code,
   hash+salt, and the constant-time compare. Pulled out of worker/index.js by
   text so the test cannot drift from the shipped implementation. */
import fs from 'node:fs';



const src = fs.readFileSync('/home/claude/unclaimed/worker/index.js', 'utf8');
const grab = (name) => {
  let i = src.indexOf(`async function ${name}(`);
  if (i < 0) i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing ${name}`);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
};
const enc = new TextEncoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const mod = await import('data:text/javascript,' + encodeURIComponent(`
const enc = new TextEncoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
${grab('sha256Hex')}
${grab('timingSafeEqual')}
${grab('sixDigitCode')}
${grab('hashCode')}
export { sixDigitCode, hashCode, timingSafeEqual };
`));

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}`)); };

const codes = Array.from({ length: 20000 }, () => mod.sixDigitCode());
t('every code is exactly six digits', codes.every((c) => /^\d{6}$/.test(c)));
t('leading zeros are preserved', codes.some((c) => c[0] === '0'));

/* Uniformity: 20k draws over 10 buckets by first digit. A folded 32-bit draw
   would skew the low buckets; rejection sampling must not. */
const buckets = Array(10).fill(0);
for (const c of codes) buckets[+c[0]]++;
const expected = codes.length / 10;
const maxDev = Math.max(...buckets.map((b) => Math.abs(b - expected) / expected));
t(`first digit is uniform (max deviation ${(maxDev * 100).toFixed(1)}% < 8%)`, maxDev < 0.08);

const uniq = new Set(codes).size;
t(`codes are not repeating a small cycle (${uniq} distinct of 1e6 possible)`, uniq > 15000);

/* Salting: the same code under two salts must not collide. */
const h1 = await mod.hashCode('123456', 'salt-a');
const h2 = await mod.hashCode('123456', 'salt-b');
t('same code with different salts gives different hashes', h1 !== h2);
t('same code with same salt is stable', h1 === (await mod.hashCode('123456', 'salt-a')));
t('a wrong code does not match', !mod.timingSafeEqual(await mod.hashCode('123457', 'salt-a'), h1));
t('the right code matches', mod.timingSafeEqual(await mod.hashCode('123456', 'salt-a'), h1));
t('length mismatch is rejected without throwing', !mod.timingSafeEqual('abc', h1));

/* ------------------------------------------------------------------ */
/* The wire contract between /api/me and the client                    */
/* ------------------------------------------------------------------ */

/* This is the bug class that made "sign-in does not work for anyone" true
   without a single error anywhere: the client read `data.user`, /api/me sends
   `signed_in` and `email`, so a valid session parsed to signedIn:false and the
   account page kept showing the sign-in form. Nothing throws when two sides of
   a JSON contract disagree — it just silently behaves as signed out, which is
   the worst possible default to fail into and the hardest to spot.

   So both sides are pinned here, read out of the source rather than guessed. */
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const worker = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'src/pwa/auth.js'), 'utf8');

  /* What the Worker actually puts in the /api/me body. */
  const meBody = worker.slice(worker.indexOf('async function handleMe'));
  const sends = new Set(
    [...meBody.slice(0, 900).matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]),
  );
  for (const field of ['signed_in', 'email', 'admin', 'entitlement']) {
    t(`/api/me sends ${field}`, sends.has(field));
  }

  /* What the client reads back out of it. */
  /* Comments mention the old field by name on purpose, so strip them before
     scanning — otherwise this test fails on its own explanation. */
  const meFn = client
    .slice(client.indexOf('export async function me()'))
    .slice(0, 1600)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const reads = [...meFn.matchAll(/data\.(\w+)/g)].map((m) => m[1]);
  t('the client reads signed_in, not a field that does not exist', reads.includes('signed_in'));
  const unknown = [...new Set(reads)].filter((f) => !sends.has(f));
  t(`the client reads no field /api/me never sends (saw: ${unknown.join(', ') || 'none'})`, unknown.length === 0);

  /* An operator session has a role and no user id. Testing for uid alone
     reported a signed-in operator as signed out. */
  t(
    'an operator session counts as signed in',
    /if \(!session \|\| \(!session\.uid && !session\.adm\)\) return json\(\{ signed_in: false \}\);/.test(meBody),
  );

  /* Caching. /api/me is per-user by definition; an edge cache that keeps one
     answer and replays it is at best "sign-in appears not to work" and at
     worst one subscriber's entitlement handed to the next visitor through the
     same colo. Asserted on the shared header block, so it covers every JSON
     response rather than the one endpoint that got caught. */
  const headers = worker.slice(worker.indexOf('const JSON_HEADERS'), worker.indexOf('const json ='));
  t('JSON responses are marked private', /private/.test(headers));
  t('JSON responses are marked no-store', /no-store/.test(headers));
  t('JSON responses vary on Cookie', /vary:\s*'Cookie'/i.test(headers));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
