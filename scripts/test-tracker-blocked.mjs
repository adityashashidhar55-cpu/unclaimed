#!/usr/bin/env node
/**
 * A visitor whose browser blocks our analytics can still sign in, pay and run
 * the check.
 *
 * The outage this exists for: beacon.js was a static import of auth.js,
 * checkout.js, app.js and the account page. Tracker blockers (NordVPN Threat
 * Protection, uBlock, AdGuard, Brave) stop files with names like that, a
 * failed static import abandons every module that depends on it, and the
 * sign-in form quietly fell back to a plain HTML submit — page reload, email
 * in the URL, no code requested, no email sent, no error anywhere.
 *
 * This loads the BUILT pages in Chromium with beacon.js blocked exactly the
 * way NordVPN blocks it (an empty 204), and asserts the behaviour a person
 * would notice, not the markup: the form talks to the API instead of
 * reloading, and the next step appears.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try next */ }
}
if (!chromium) { console.log('  - playwright not installed; skipping'); process.exit(0); }

let pass = 0, fail = 0;
const t = (ok, m) => (ok ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)));

const ORIGIN = 'https://unclaimedgrant.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function fileFor(pathname) {
  let p = path.join(DIST, decodeURIComponent(pathname));
  if (pathname.endsWith('/')) p = path.join(p, 'index.html');
  return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

console.log('\nA blocked tracker does not take the product down\n');

const browser = await chromium.launch();
const ctx = await browser.newContext();
const authRequests = [];
const pageErrors = [];

await ctx.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.fulfill({ status: 204, body: '' }); // fonts, third parties: irrelevant here
  /* Exactly what NordVPN Threat Protection served in the owner's browser. */
  if (url.pathname === '/beacon.js') return route.fulfill({ status: 204, body: '' });
  if (url.pathname === '/api/v1/event') return route.abort('blockedbyclient');
  if (url.pathname === '/auth/request') {
    authRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sent: true, expires_in: 600 }) });
  }
  if (url.pathname.startsWith('/api/') && !fileFor(url.pathname)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signed_in: false, entitlement: { entitled: false } }) });
  }
  const f = fileFor(url.pathname);
  if (!f) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && /does not provide an export|Failed to fetch dynamically imported module|SyntaxError/i.test(m.text())) pageErrors.push(m.text()); });

await page.goto(`${ORIGIN}/account/`, { waitUntil: 'load' });
await page.waitForTimeout(800);

await page.fill('#auth-email', 'someone@example.com');
await page.click('#auth-send');
await page.waitForTimeout(800);

const url = new URL(page.url());
t(!url.searchParams.has('email'), 'pressing "Send me a code" does not reload the page with the email in the URL');
t(authRequests.length === 1, `the form asked the API for a code (${authRequests.length} request)`);
t(authRequests[0]?.email === 'someone@example.com', 'for the address that was typed');
t(await page.isVisible('#step-code'), 'and the code step is showing');
t(pageErrors.length === 0, `no module failed to load${pageErrors.length ? ` — ${pageErrors[0].slice(0, 140)}` : ''}`);

/* The check is the product's front door; it imports the same analytics. */
const errorsBefore = pageErrors.length;
await page.goto(`${ORIGIN}/check/`, { waitUntil: 'load' });
await page.waitForTimeout(1000);
const controls = await page.evaluate(() => document.querySelectorAll('button, select, input').length);
t(controls >= 3, `the check page built its controls with analytics blocked (${controls})`);
t(pageErrors.length === errorsBefore, `and no module on it failed to load${pageErrors.length > errorsBefore ? ` — ${pageErrors[errorsBefore].slice(0, 200)}` : ""}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
