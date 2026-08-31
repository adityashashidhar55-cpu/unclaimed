#!/usr/bin/env node
/**
 * The packaged app actually boots.
 *
 * This exists because it did not, and nothing said so. `?v=` cache-busting was
 * stripped from index.html but not from the module specifiers inside the
 * bundle, so `app/app.js` imported `../engine/matcher.js?v=1788159185479`.
 * Over HTTP the query is ignored and the file loads. Inside the binary it is
 * part of the path, the file is not found, and ONE failed import in a
 * `<script type="module">` takes down the whole graph — the app opens to a
 * blank screen, with no error anywhere a store reviewer would look.
 *
 * verify-native.mjs walks the module graph statically, which catches that
 * particular shape. This runs the thing. It serves `native/www` over a server
 * that refuses any request carrying a query string, which is how a file:// or
 * capacitor:// origin behaves — a specifier with `?v=` 404s rather than being
 * quietly forgiven — and then asserts the app rendered something a person
 * could use.
 *
 * Needs Chromium:
 *   NODE_PATH=/home/claude/.npm-global/lib/node_modules node scripts/test-native-boot.mjs
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
/* Two homes for playwright, because there are two places this runs.
 *
 * In CI it is installed into the job (`npm install --no-save playwright`), so
 * a plain resolve finds it. In the sandbox the npm registry answers 403 and it
 * cannot be a dependency of this repo at all, so it is resolved out of the
 * global install the way qa-screens.mjs does. Trying the normal path first
 * means CI does not depend on a path that only exists on one machine.
 *
 * NODE_PATH is not an option: it applies to require(), not to ESM imports. */
function loadChromium() {
  for (const spec of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright/index.js']) {
    try {
      return require_(spec).chromium;
    } catch { /* try the next one */ }
  }
  console.error('playwright is not installed. In CI: npm install --no-save playwright && npx playwright install chromium');
  process.exit(1);
}
const chromium = loadChromium();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'native', 'www');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));

if (!fs.existsSync(WWW)) {
  console.error('native/www is missing — run `node native/prepare.mjs` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/* Deliberately strict about query strings. A real bundle has no server to be
   lenient for it: `matcher.js?v=123` is a filename that does not exist. A
   dev server that ignores the query would pass this test and ship the bug. */
let servedWithQuery = 0;

const server = http.createServer((req, res) => {
  const [rawPath, query] = req.url.split('?');
  if (query) {
    servedWithQuery += 1;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no such file — inside the binary a query string is part of the name');
    return;
  }
  const rel = decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath);
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

console.log('\nThe packaged app boots\n');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(r.url()));
page.on('response', (r) => { if (r.status() === 404) failedRequests.push(r.url()); });

await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

/* 1. Nothing local 404s. This is the assertion that would have caught the
      blank screen, because every one of the five broken specifiers is a 404.

      Requests to OUR OWN API are expected — the app asks who is signed in on
      launch — and this sandbox has no egress, so they fail here for a reason
      that has nothing to do with the bundle. They are split out and asserted
      separately below. */
const localFailures = failedRequests.filter((u) => u.startsWith(origin));
const remote = failedRequests.filter((u) => !u.startsWith(origin));
is(localFailures.length, 0, `every asset the app asks for exists${localFailures.length ? ` — missing: ${localFailures.slice(0, 4).join(', ')}` : ''}`);
is(servedWithQuery, 0, 'nothing is requested with a cache-busting query string — inside the binary that is a different filename');

/* 2. No third party, at all.
      theme.css opened with an @import of Google Fonts. On the web that is
      fine; in a packaged app it breaks the airplane-mode claim in the store
      listing, and it hands the user's IP to Google on every launch while the
      Play Data Safety form says no data is shared with third parties. Our own
      origin is allowed; nothing else is. */
const thirdParty = remote.filter((u) => !u.startsWith('https://unclaimedgrant.com'));
is(thirdParty.length, 0, `no third-party host is contacted on launch${thirdParty.length ? ` — ${[...new Set(thirdParty.map((u) => new URL(u).host))].join(', ')}` : ''}`);

/* 2. The module graph actually ran. A dead `<script type="module">` leaves the
      DOM exactly as the HTML shipped it, so the test is that something the
      SCRIPT builds is present, not that the markup is. */
const bodyText = await page.evaluate(() => document.body.innerText.trim());
yes(bodyText.length > 200, `the app rendered ${bodyText.length} characters of text`);

const scriptBuilt = await page.evaluate(() => {
  /* Anything the shipped HTML could not have contained. The check screen and
     its controls are built by app.js at boot. */
  const controls = document.querySelectorAll('button, [role="button"], a[href]');
  return { controls: controls.length, hasApp: !!document.querySelector('#app, main, [data-view], .app') };
});
yes(scriptBuilt.controls >= 3, `the boot script built the interface (${scriptBuilt.controls} controls)`);

/* 3. No uncaught errors. A module that throws after loading takes the rest of
      the graph with it just as thoroughly as one that 404s. */
/* Errors caused by this sandbox having no egress are not the bundle's fault:
   the app calling its own API on launch is correct behaviour. Anything else
   is a module that threw, which takes the graph down as thoroughly as a 404. */
const realErrors = consoleErrors.filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(e));
is(realErrors.length, 0, `no console errors on boot${realErrors.length ? ` — first: ${realErrors[0].slice(0, 160)}` : ''}`);

/* 4. Nothing points at the live site for its code. The app has to work in
      airplane mode, which is the claim the store listing makes. */
const external = await page.evaluate(() =>
  [...document.querySelectorAll('script[src], link[rel=stylesheet]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))
    .filter((u) => /^https?:/i.test(u)));
is(external.length, 0, `no script or stylesheet is loaded from the network${external.length ? ` — ${external.join(', ')}` : ''}`);

/* 5. The API base is stamped in, or every signed-in call resolves to a file
      inside the app, 404s, and the client concludes "signed out" forever. */
const apiBase = await page.evaluate(() => window.__UA_API__ ?? null);
yes(typeof apiBase === 'string' && /^https:\/\//.test(apiBase), `the API base is an absolute URL (${apiBase})`);

/* 6. The offline dataset is really there. */
const bundled = fs.existsSync(path.join(WWW, 'api/v1/programmes'))
  ? fs.readdirSync(path.join(WWW, 'api/v1/programmes')).filter((f) => f.endsWith('.json')).length
  : 0;
yes(bundled >= 20, `${bundled} country datasets are bundled, so the check works with no network`);

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
