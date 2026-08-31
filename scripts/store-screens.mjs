#!/usr/bin/env node
/**
 * The store screenshots, taken from the app that will actually ship.
 *
 * Not mockups. This serves `native/www` — the exact bundle Capacitor wraps —
 * drives the real wizard with a real answer set, and photographs what comes
 * back. A screenshot of a mockup is a promise the app has to keep; a
 * screenshot of the build is a description of it.
 *
 * The query-string server from test-native-boot.mjs is reused deliberately:
 * it 404s anything with a `?v=`, exactly as a packaged app does, so these
 * cannot be taken of a bundle that would open to a blank screen on a phone.
 *
 * Sizes are the stores' own requirements:
 *   Play phone       1080 × 1920   (9:16, min 320px a side)
 *   iPhone 6.9"      1320 × 2868   (required for App Store Connect)
 *   iPhone 6.5"      1242 × 2688   (still required alongside 6.9")
 *
 * Captured at a device scale factor rather than a huge viewport, so text is
 * laid out at phone width and rendered at store resolution — a 1320px-wide
 * viewport would produce a tablet layout at phone dimensions, which reviewers
 * notice and users find baffling.
 *
 * Usage:
 *   node scripts/store-screens.mjs            → store/screenshots/
 *   node scripts/store-screens.mjs --only play
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
function loadChromium() {
  for (const spec of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright/index.js']) {
    try { return require_(spec).chromium; } catch { /* next */ }
  }
  console.error('playwright is not installed.');
  process.exit(1);
}
const chromium = loadChromium();

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drivePersonal } from './lib/wizard-drive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'native', 'www');
const OUT = path.join(ROOT, 'store', 'screenshots');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

if (!fs.existsSync(WWW)) {
  console.error('native/www is missing — run `node native/prepare.mjs` first.');
  process.exit(1);
}

/* Phone layout width, rendered up to store resolution by deviceScaleFactor.
   390 is the iPhone 15/16 CSS width and close enough to a modern Android. */
const CSS_W = 390;

const DEVICES = [
  { id: 'play', label: 'Play phone', w: 1080, h: 1920 },
  { id: 'ios-6.9', label: 'iPhone 6.9"', w: 1320, h: 2868 },
  { id: 'ios-6.5', label: 'iPhone 6.5"', w: 1242, h: 2688 },
].filter((d) => !only || d.id.startsWith(only));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const [rawPath, query] = req.url.split('?');
  if (query) { res.writeHead(404); res.end(); return; }
  const file = path.join(WWW, decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath));
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/**
 * The six screens, in the order the store shows them.
 *
 * Each one is a function rather than a URL because most of them only exist
 * after somebody has answered questions — the results screen cannot be linked
 * to, which is exactly why a mockup is the tempting shortcut here.
 */
/**
 * The five screens, in the order the store shows them.
 *
 * Each is a function rather than a URL because most only exist after somebody
 * has answered a question — the results screen cannot be linked to, which is
 * exactly why a mockup is the tempting shortcut here.
 *
 * The app's own check screen is one long form of selects and choice buttons,
 * not the stepped web wizard, so lib/wizard-drive.mjs does not apply.
 */
/**
 * Answer the whole form, not just the country.
 *
 * Answering only the country produces "0 programmes match you / 20 waiting",
 * which is a truthful screen and a terrible screenshot: it advertises the
 * product's empty state. Every question gets an answer so the results screen
 * shows a real number, which is what the listing is actually claiming.
 */
async function fillCheck(page) {
  await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const start = await page.$('[data-nav="check"]');
  if (start) { await start.click(); await page.waitForTimeout(700); }

  await page.selectOption('select[data-q="country_code"]', 'gb').catch(() => {});
  await page.waitForTimeout(600);

  /* An age, so the age-gated programmes resolve rather than sitting in
     "waiting". */
  const age = await page.$('input[type="number"][data-q]');
  if (age) { await age.fill('38'); await page.waitForTimeout(200); }

  /* One answer per remaining question. The first choice is arbitrary and that
     is fine — a screenshot needs a plausible answer set, not a specific one. */
  await page.evaluate(() => {
    const asked = new Set();
    for (const b of document.querySelectorAll('.choice[data-q]')) {
      if (asked.has(b.dataset.q)) continue;
      if (b.dataset.v === '') continue;
      asked.add(b.dataset.q);
      b.click();
    }
  });
  await page.waitForTimeout(500);
}

async function answerAndSee(page) {
  await fillCheck(page);
  const see = await page.$('[data-nav="results"]');
  if (see) { await see.click(); await page.waitForTimeout(1800); }
}

/** Back to the home screen, where the four tiles live. */
async function home(page) {
  await page.evaluate(() => {
    const back = document.querySelector('[data-nav="home"], .shell__back, [data-act="back"]');
    if (back) back.click();
  });
  await page.waitForTimeout(600);
  if (!(await page.$('[data-nav="deadlines"]'))) {
    await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  }
}

const SHOTS = [
  {
    name: '1-home',
    caption: 'The money you are owed',
    async go(page) {
      await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
    },
  },
  {
    name: '2-check',
    caption: 'Answer a few questions — on your device',
    go: fillCheck,
  },
  {
    name: '3-results',
    caption: 'See the number, free forever',
    go: answerAndSee,
  },
  {
    name: '4-deadlines',
    caption: 'Never miss a closing date',
    async go(page) {
      await answerAndSee(page);
      await home(page);
      const tile = await page.$('[data-nav="deadlines"]');
      if (tile) { await tile.click(); await page.waitForTimeout(1800); }
    },
  },
  {
    name: '5-documents',
    caption: 'Gather each paper once',
    async go(page) {
      await answerAndSee(page);
      await home(page);
      const tile = await page.$('[data-nav="documents"]');
      if (tile) { await tile.click(); await page.waitForTimeout(1400); }
    },
  },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const taken = [];

for (const device of DEVICES) {
  const scale = device.w / CSS_W;
  const cssH = Math.round(device.h / scale);
  const context = await browser.newContext({
    viewport: { width: CSS_W, height: cssH },
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
  });
  /* Stubbed before anything evaluates: isNative is read at import time, and
     the screens say different things inside the app than on the web. A
     screenshot taken without this shows web copy in a store listing. */
  await context.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
  });
  const page = await context.newPage();

  for (const shot of SHOTS) {
    try {
      await shot.go(page);
      const dir = path.join(OUT, device.id);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      const bytes = fs.statSync(file).size;
      taken.push({ device: device.label, name: shot.name, file: path.relative(ROOT, file), bytes });
      console.log(`  ✓ ${device.label.padEnd(12)} ${shot.name.padEnd(12)} ${(bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error(`  ✗ ${device.label} ${shot.name}: ${String(err?.message ?? err)}`);
    }
  }
  await context.close();
}

await browser.close();
server.close();

console.log(`\n${taken.length} screenshots in ${path.relative(ROOT, OUT)}\n`);
