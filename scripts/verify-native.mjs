#!/usr/bin/env node
/**
 * Verify the native bundle before it is packaged into a binary.
 *
 * A broken path here does not fail loudly: Capacitor shows a white screen on
 * device with the error buried in a Safari or Chrome remote inspector that
 * nobody opens until the app is already rejected. So every one of these is
 * checked on the machine that builds it.
 *
 * Run after `node src/build.mjs && node native/prepare.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'native', 'www');

let failures = 0;
let checks = 0;
const ok = (m) => { checks += 1; console.log(`  ✓ ${m}`); };
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };

if (!fs.existsSync(WWW)) {
  console.error('native/www missing — run `node native/prepare.mjs`.');
  process.exit(1);
}

console.log('\nNative bundle');

/* Capacitor loads /index.html from the bundle root, not /app/. */
fs.existsSync(path.join(WWW, 'index.html'))
  ? ok('index.html is at the bundle root where Capacitor looks for it')
  : fail('index.html is NOT at the bundle root — the app would show a white screen');

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');

/* Absolute paths work on a web server and break inside a binary. */
const abs = [...html.matchAll(/(?:href|src)="\/(?!\/)[^"]*"/g)].map((m) => m[0]);
abs.length === 0 ? ok('no absolute asset paths (they break inside the binary)') : fail(`${abs.length} absolute paths: ${abs.slice(0, 3).join(', ')}`);

/* A service worker over already-local files can only serve a stale copy
   after an app update. */
!/serviceWorker/.test(html) && !/serviceWorker/.test(fs.readFileSync(path.join(WWW, 'app/app.js'), 'utf8'))
  ? ok('service worker removed from the native build')
  : fail('service worker still registered — it can serve stale assets after an update');

/* Every referenced local asset must exist. */
let missing = 0;
for (const m of html.matchAll(/(?:href|src)="(?!https?:|data:|mailto:|#)([^"]+)"/g)) {
  if (!fs.existsSync(path.join(WWW, m[1]))) { missing += 1; fail(`referenced but missing: ${m[1]}`); }
}
missing === 0 ? ok('every asset referenced by index.html exists') : null;

/* The module graph must resolve entirely inside the bundle. */
const seen = new Set();
let escapes = 0;
let absent = 0;
(function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!fs.existsSync(file)) { absent += 1; return; }
  if (!file.startsWith(WWW + path.sep)) { escapes += 1; return; }
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    walk(path.resolve(path.dirname(file), m[1]));
  }
})(path.join(WWW, 'app', 'app.js'));
escapes === 0 && absent === 0
  ? ok(`module graph resolves inside the bundle (${seen.size} modules)`)
  : fail(`${escapes} imports escape the bundle, ${absent} missing`);

/* The dataset must be bundled, or "works offline" is a lie. */
const countries = path.join(WWW, 'api/v1/countries.json');
if (fs.existsSync(countries)) {
  const man = JSON.parse(fs.readFileSync(countries, 'utf8'));
  const pools = fs.readdirSync(path.join(WWW, 'api/v1/programmes'));
  pools.length >= man.countries.length
    ? ok(`programme data bundled for all ${man.countries.length} countries — the check works offline`)
    : fail(`only ${pools.length} of ${man.countries.length} country files bundled`);
} else {
  fail('no bundled programme data — the app could not work offline');
}

/* Icons: Safari ignores an SVG apple-touch-icon and substitutes a screenshot. */
['icon-180.png', 'icon-192.png', 'icon-512.png'].every((f) => fs.existsSync(path.join(WWW, f)))
  ? ok('raster icons present for the home screen')
  : fail('missing raster icons — Safari would show a page screenshot instead');

/* Size sanity. */
const bytes = (function du(d) {
  let b = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    b += e.isDirectory() ? du(p) : fs.statSync(p).size;
  }
  return b;
})(WWW);
const mb = bytes / 1024 / 1024;
mb < 100 ? ok(`bundle is ${mb.toFixed(1)} MB`) : fail(`bundle is ${mb.toFixed(1)} MB — too large to install on mobile data`);

/* Store assets. */
console.log('\nStore assets');
for (const f of ['icon.png', 'icon-foreground.png', 'icon-background.png', 'splash.png', 'play-feature-graphic.png']) {
  fs.existsSync(path.join(ROOT, 'native/resources', f)) ? ok(`${f} generated`) : fail(`${f} MISSING`);
}
fs.existsSync(path.join(ROOT, 'native/STORE.md')) ? ok('store listing copy and runbook present') : fail('STORE.md missing');

/* The listing quotes counts. Both stores treat a wrong number in the
   description as a misrepresentation, and a description written once and
   never revisited goes stale the first time the dataset grows — so the
   figures are checked against the data rather than trusted. */
{
  const counts = { total: 0, jurisdictions: new Set(), closed: 0 };
  const tally = (dir, files) => {
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      /* Count datasets, not filenames. data/ also holds support files —
         manifest.json, mcp-tools.json, and now fx-rates.json — and the old
         name-based skip list silently promoted the next one added to a
         jurisdiction with nothing in it. A jurisdiction is a file that carries
         a programmes array; anything else is not one, whatever it is called. */
      if (!Array.isArray(d.programmes)) continue;
      const list = d.programmes;
      counts.total += list.length;
      counts.jurisdictions.add(f.replace('.json', ''));
      for (const p of list) if (p.status === 'closed') counts.closed += 1;
    }
  };
  const DATA = path.join(ROOT, 'data');
  tally(DATA, fs.readdirSync(DATA));
  tally(path.join(DATA, 'startups'), fs.readdirSync(path.join(DATA, 'startups')));

  const store = fs.readFileSync(path.join(ROOT, 'native/STORE.md'), 'utf8');
  const claimed = {
    total: Number((store.match(/collects ([\d,]+) programmes/) ?? [])[1]?.replace(/,/g, '')),
    jurisdictions: Number((store.match(/across (\d+) jurisdictions/) ?? [])[1]),
    closed: Number((store.match(/we track ([\d,]+) closed/) ?? [])[1]?.replace(/,/g, '')),
  };
  const round = (n) => Math.round(n / 100) * 100; // the listing rounds the headline
  claimed.total === counts.total || claimed.total === round(counts.total)
    ? ok(`listing programme count matches the data (${counts.total})`)
    : fail(`STORE.md claims ${claimed.total} programmes, data has ${counts.total}`);
  claimed.jurisdictions === counts.jurisdictions.size
    ? ok(`listing jurisdiction count matches the data (${counts.jurisdictions.size})`)
    : fail(`STORE.md claims ${claimed.jurisdictions} jurisdictions, data has ${counts.jurisdictions.size}`);
  claimed.closed === counts.closed
    ? ok(`listing closed-programme count matches the data (${counts.closed})`)
    : fail(`STORE.md claims ${claimed.closed} closed, data has ${counts.closed}`);
}

fs.existsSync(path.join(ROOT, 'dist/privacy/index.html'))
  ? ok('privacy policy page built (both stores require a live URL)')
  : fail('no privacy policy page — neither store will accept the listing');

/* ------------------------------------------------------------------ */
/* Accounts on a device                                                */
/* ------------------------------------------------------------------ */

/* Every failure mode in this section is silent, which is why it is tested
   rather than eyeballed. Capacitor serves the bundle from https://localhost.
   A relative /api/me therefore resolves to a file inside the app, 404s, and
   the client concludes "signed out" — the app would never log anyone in and
   nothing would say why. And once the URL is absolute the call is
   cross-origin, where a SameSite=Lax cookie is not attached at all, so a
   cookie-only client is signed out a second time for a second reason. */
{
  const shell = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const authJs = fs.readFileSync(path.join(WWW, 'app', 'auth.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');

  shell.includes('window.__UA_API__="https://unclaimedgrant.com"')
    ? ok('the bundle knows where the API is')
    : fail('no API base in the native shell — every account call would 404 inside the app');

  /a relative `\/api\/me` resolves to a file/.test(shell) || /__UA_API__/.test(authJs)
    ? ok('auth.js reads the stamped API base')
    : fail('auth.js ignores the API base');

  /const API = \(typeof window !== 'undefined' && window\.__UA_API__\) \|\| '';/.test(authJs)
    ? ok('the web build is unchanged when the base is absent')
    : fail('the API base does not fall back to same-origin on the web');

  /credentials: NATIVE \? 'omit' : 'same-origin'/.test(authJs)
    ? ok('the app does not rely on a cookie that cross-origin will not send')
    : fail('the app still sends credentials as if it were same-origin');

  /if \(NATIVE && data\.session\) writeToken\(data\.session\);/.test(authJs)
    ? ok('the app stores the session it is given')
    : fail('the app would be signed in for exactly one function call');

  /* Only the app gets a token. A browser that can hold an HttpOnly cookie must
     never be handed an XSS-readable copy of the same credential. */
  /const native = body\.client === 'native';/.test(worker) &&
  /\.\.\.\(native \? \{ session: cookie \} : \{\}\)/.test(worker)
    ? ok('the session is only put in the body when the app asks')
    : fail('the web response may be leaking a bearer token');

  /* CORS must not be a wildcard, and must not reflect. Reflecting Origin with
     credentials lets any page on the internet make authenticated calls. */
  /const APP_ORIGINS = new Set\(\[/.test(worker)
    ? ok('cross-origin access is an allow-list')
    : fail('no CORS allow-list — the app cannot call the API, or anyone can');

  const corsFn = worker.slice(worker.indexOf('function corsHeaders'), worker.indexOf('function corsHeaders') + 600);
  /!APP_ORIGINS\.has\(origin\)/.test(corsFn)
    ? ok('an unknown origin gets no CORS headers at all')
    : fail('CORS reflects whatever origin arrives');
  /allow-origin': '\*'/.test(corsFn)
    ? fail('wildcard CORS cannot carry credentials and would break the app')
    : ok('no wildcard origin');

  worker.includes("readSession(env, request.headers.get('cookie'), request.headers.get('authorization'))")
    ? ok('the Worker reads the bearer token the app sends')
    : fail('the Worker ignores the app\'s bearer token');
}

console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
