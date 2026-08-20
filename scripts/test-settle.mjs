#!/usr/bin/env node
/**
 * The geometry guards must read a page that has stopped moving.
 *
 * qa-screens reports distances between boxes. For three rounds it took that
 * reading 200ms after the reveal observer fired, while transitions were still
 * running — so its numbers changed between two runs of the same command on
 * the same bytes, and nobody could act on them.
 *
 * This asserts the property directly, on the worst page in the suite
 * (/enterprise/ carries 44 animations, six of them infinite):
 *
 *   1. after settle(), the page's geometry is the same as it is 600ms later;
 *   2. settle() returns promptly on a page whose animations never end.
 *
 * (2) is not a performance nicety. The two obvious implementations of (1) —
 * awaiting `getAnimations().finished`, or waiting for every transform to
 * reach 'none' — hang forever and stall for the full timeout respectively,
 * because of those six infinite keyframes. A settle that never returns is
 * worse than no settle at all, so both halves are asserted together.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settle, geometryKey } from './lib/settle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');
const PORT = 8214;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

/* Set by the proof run that reintroduces the bug: measure the way the guard
   used to, so the failure can be seen rather than argued about. */
const NAIVE = process.env.SETTLE_NAIVE === '1';

const PAGES = ['/enterprise/', '/', '/pricing/'];
const fails = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const url of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(400);
  /* Same reader-shaped scroll qa-screens performs, so the reveal observer has
     fired on everything below the first viewport. */
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  await page
    .waitForFunction(() => !document.querySelector('.reveal:not(.in), .blur-word:not(.in)'), null, { timeout: 6000 })
    .catch(() => {});

  let ms;
  if (NAIVE) { await page.waitForTimeout(200); ms = 200; } else { ms = await settle(page); }

  const before = await geometryKey(page);
  await page.waitForTimeout(600);
  const after = await geometryKey(page);

  if (before !== after) {
    const a = before.split('|'), b = after.split('|');
    const moved = a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0);
    fails.push(`${url}: still moving when measured — ${moved} of ${a.length} boxes changed position in the 600ms after the guard took its reading`);
  }
  /* Anything at or above the 6s ceiling means the wait gave up rather than
     observed stability, which is the stall the infinite keyframes cause. */
  if (ms >= 3000) fails.push(`${url}: waited ${ms}ms for the page to settle — a page with infinite decorative animations must not stall the suite`);

  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  if (!NAIVE && url === '/enterprise/' && running === 0)
    fails.push('/enterprise/: expected infinite decorative animations to still be running here; if they are gone this guard no longer proves the wait tolerates them');

  await ctx.close();
}

await browser.close();
server.close();

if (fails.length) {
  console.error('settle: FAIL');
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log(`settle: OK — geometry stable at the moment of measurement on ${PAGES.length} pages`);
