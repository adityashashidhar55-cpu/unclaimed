#!/usr/bin/env node
/**
 * The /check/ wizard, driven in a real browser.
 *
 * verify.mjs reads static HTML out of dist/ and therefore cannot see any of
 * this: /check/ is an empty <div id="app"> until a module runs. Every failure
 * on this screen is a runtime one, and every one of them is silent — an
 * uncaught TypeError in an async handler leaves a blank page, exit code 0,
 * and nothing in the build log.
 *
 * So this asserts the properties a person would check by looking:
 *   - the page always has exactly one h1, whatever the URL says
 *   - no uncaught error ever fires
 *   - a value the user cannot type is never stored as if they had
 *   - every step you can reach with an answer already given has a way forward
 *   - searching the country list never leaves the screen empty and silent
 *   - the accessible name of a tile is not its text content run together
 *
 * SRC_OVERRIDE=1 serves src/ over the top of dist/ for the client modules, so
 * the test can be run against an edit before the next build. CI runs it
 * without the flag, against what actually shipped.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8207;
const OVERRIDE = process.env.SRC_OVERRIDE === '1';

/* dist/ flattens the client modules; map them back when overlaying src. */
const SRC_MAP = {
  '/app.js': 'src/app.js',
  '/engine/matcher.js': 'src/engine/matcher.js',
  '/engine/startup.js': 'src/engine/startup.js',
  '/startup-check.js': 'src/pwa/startup-check.js',
  '/audience.js': 'src/pwa/audience.js',
  '/beacon.js': 'src/pwa/beacon.js',
  '/app/checkout.js': 'src/pwa/checkout.js',
  '/app/auth.js': 'src/pwa/auth.js',
  '/app/unlock.js': 'src/pwa/unlock.js',
};

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, p);
  if (OVERRIDE && SRC_MAP[p] && fs.existsSync(path.join(ROOT, SRC_MAP[p]))) f = path.join(ROOT, SRC_MAP[p]);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
let checks = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => { checks += 1; console.log(`  ✓ ${m}`); };
const assert = (cond, m) => (cond ? ok(m) : fail(m));

const b64url = (o) =>
  Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const browser = await chromium.launch();

/** Open a page, collect uncaught errors, return { page, errors, close }. */
async function open(url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return { page, errors, close: () => ctx.close() };
}

console.log('\nThe /check/ wizard, in a browser\n');

/* ------------------------------------------------------------------ *
 * 1. A hash from a URL must never be able to blank the page.
 *
 * A stale shared link naming a country we dropped used to render #app as
 * the empty string with one uncaught TypeError: no heading, no control,
 * no way out but editing the address bar.
 * ------------------------------------------------------------------ */
const HASHES = [
  ['an unknown country', `#r=${b64url({ country_code: 'ZZ' })}`],
  ['a malformed base64 hash', '#r=not_base64!!!!'],
  ['a hash naming no country', `#r=${b64url({ age: 41 })}`],
  ['a valid hash', `#r=${b64url({ country_code: 'GB', status: 'employee', age: 41 })}`],
  ['no hash at all', ''],
];
for (const [label, hash] of HASHES) {
  const { page, errors, close } = await open(`/check/${hash}`);
  const h1s = await page.$$eval('#app h1', (n) => n.map((e) => e.textContent.trim()));
  assert(h1s.length >= 1, `${label}: #app has a heading (got ${h1s.length})`);
  assert(errors.length === 0, `${label}: no uncaught error (got ${errors.length}${errors[0] ? `: ${errors[0].slice(0, 90)}` : ''})`);
  await close();
}

/* Exactly one h1, not several — a document with two top-level headings is as
   broken for a screen reader as one with none. */
for (const [label, hash] of HASHES) {
  const { page, close } = await open(`/check/${hash}`);
  const n = await page.$$eval('h1', (e) => e.length);
  assert(n === 1, `${label}: exactly one h1 in the document (got ${n})`);
  await close();
}

/* ------------------------------------------------------------------ *
 * 2. The step counter must not move under the reader.
 *
 * steps() only spliced the region step in once a country was chosen, so the
 * caption went "Step 1 of 6" then "Step 2 of 7" on the very first click and
 * the rail gained a segment. A progress indicator that changes its own
 * denominator is not a progress indicator.
 * ------------------------------------------------------------------ */
{
  const { page, errors, close } = await open('/check/');
  const denominators = [];
  const readCaption = async () => {
    const t = await page.evaluate(() => (document.querySelector('#app')?.innerText || ''));
    const m = t.match(/Step\s+\d+\s+of\s+(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const d0 = await readCaption();
  if (d0 !== null) denominators.push(d0);

  const gb = await page.$('[data-act="country"][data-cc="gb"]');
  if (gb) {
    await gb.click();
    await page.waitForTimeout(400);
    const d1 = await readCaption();
    if (d1 !== null) denominators.push(d1);
    /* Walk a few steps forward, taking whatever the first option is. */
    for (let i = 0; i < 4; i += 1) {
      const opt = await page.$('#app .opt');
      if (!opt) break;
      await opt.click();
      await page.waitForTimeout(250);
      const d = await readCaption();
      if (d !== null) denominators.push(d);
    }
  }
  const distinct = [...new Set(denominators)];
  assert(
    denominators.length === 0 || distinct.length === 1,
    `the step denominator is constant across the flow (saw ${JSON.stringify(distinct)})`,
  );
  assert(errors.length === 0, `walking the wizard raises no uncaught error (got ${errors.length}${errors[0] ? `: ${errors[0].slice(0, 90)}` : ''})`);

  /* The rail is the other half of the same promise: a progress bar with no
     height tells the reader nothing, and a CSS rule can be deleted without
     anything erroring. */
  const railH = await page.evaluate(() => {
    const el = document.querySelector('.progress-rail');
    return el ? el.getBoundingClientRect().height : -1;
  });
  assert(railH !== 0, `the progress rail has height (${railH}px)`);
  await close();
}

/* ------------------------------------------------------------------ *
 * 3. A number the input itself refuses must not reach the stored profile.
 *
 * readInputs did Number(el.value) with no clamp, and the inputs are not in a
 * form, so age 999 and household size -3 were persisted and produced a
 * confident verdict off them.
 * ------------------------------------------------------------------ */
{
  const { page, errors, close } = await open('/check/');
  const gb = await page.$('[data-act="country"][data-cc="gb"]');
  if (gb) {
    await gb.click();
    await page.waitForTimeout(400);
    /* Walk until a numeric input appears. */
    let found = null;
    for (let i = 0; i < 8; i += 1) {
      found = await page.$('#app input[type="number"]');
      if (found) break;
      const opt = await page.$('#app .opt');
      if (!opt) break;
      await opt.click();
      await page.waitForTimeout(250);
    }
    if (found) {
      const fields = await page.$$eval('#app input[type="number"]', (els) =>
        els.map((e) => ({ id: e.id, min: e.min, max: e.max })));
      for (const f of fields) {
        if (!f.id) continue;
        const hi = f.max === '' ? 100000 : Number(f.max) + 500;
        const lo = f.min === '' ? -50 : Number(f.min) - 50;
        for (const v of [hi, lo]) {
          await page.fill(`#${f.id}`, String(v));
          await page.waitForTimeout(60);
          /* Advance so readInputs runs and the profile is persisted. */
          const next = await page.$('.wizard-nav button:not([data-act="back"])');
          if (next) { await next.click(); await page.waitForTimeout(250); }
          const stored = await page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('unclaimed.check.profile.v1') || '{}'); }
            catch { return {}; }
          });
          const bad = Object.entries(stored).some(([, val]) => val === v);
          assert(!bad, `#${f.id} = ${v} (outside its own min/max) never reaches the stored profile`);
          const back = await page.$('.wizard-nav button[data-act="back"]');
          if (back) { await back.click(); await page.waitForTimeout(200); }
        }
      }
    } else {
      ok('no numeric input reachable in eight steps — nothing to clamp here');
    }
  }
  assert(errors.length === 0, 'clamping raises no uncaught error');
  await close();
}

/* ------------------------------------------------------------------ *
 * 4. Every step reachable with an answer already given has a way forward.
 *
 * viewStatus called navRow({}), so arriving there via Back showed a selected
 * option, a Back button, and no Continue: a dead end you could only leave by
 * re-answering.
 * ------------------------------------------------------------------ */
{
  const { page, errors, close } = await open('/check/');
  const gb = await page.$('[data-act="country"][data-cc="gb"]');
  if (gb) {
    await gb.click();
    await page.waitForTimeout(400);
    const visited = [];
    for (let i = 0; i < 6; i += 1) {
      const opt = await page.$('#app .opt');
      if (!opt) break;
      const heading = await page.evaluate(() => document.querySelector('#app h1')?.textContent?.trim() || '?');
      visited.push(heading);
      await opt.click();
      await page.waitForTimeout(250);
    }
    /* Now walk back the way we came. Every one of those steps has an answer. */
    for (let i = 0; i < visited.length; i += 1) {
      const back = await page.$('.wizard-nav button[data-act="back"]');
      if (!back) break;
      await back.click();
      await page.waitForTimeout(250);
      const labels = await page.$$eval('.wizard-nav button, .wizard-nav a', (els) =>
        els.map((e) => `${e.dataset.act || ''}:${e.textContent.trim()}`));
      const heading = await page.evaluate(() => document.querySelector('#app h1')?.textContent?.trim() || '?');
      const forward = labels.some((l) => !l.startsWith('back:'));
      assert(forward, `"${heading}" reached with an answer already given exposes a forward control (nav: ${JSON.stringify(labels)})`);
    }
  }
  assert(errors.length === 0, 'walking back raises no uncaught error');
  await close();
}

/* ------------------------------------------------------------------ *
 * 5. Searching the country list never leaves the screen blank.
 * ------------------------------------------------------------------ */
{
  const { page, close } = await open('/check/');
  const search = await page.$('#csearch');
  if (!search) {
    fail('#csearch is missing from the country step');
  } else {
    for (const q of ['united', 'zzzzz', '']) {
      await page.fill('#csearch', q);
      await page.waitForTimeout(200);
      const state = await page.evaluate(() => {
        const vis = (el) => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
        };
        return {
          opts: [...document.querySelectorAll('#app .opt')].filter(vis).length,
          empties: [...document.querySelectorAll('#app .dash__empty, #app [data-empty]')].filter(vis).length,
        };
      });
      assert(
        (state.opts >= 1 && state.empties === 0) || (state.opts === 0 && state.empties === 1),
        `search "${q}": ${state.opts} visible options / ${state.empties} empty states — exactly one of the two`,
      );
    }
  }
  await close();
}

/* ------------------------------------------------------------------ *
 * 6. Accessible names, and the heading sequence.
 *
 * The accessible name of the first tile was "🇦🇺 Australia83 programmes · 24
 * verified" — the visible fix (a column flex) hid the symptom and left the
 * name concatenated. And the eyebrow look is bound to <h4>, so /check/ went
 * h1 → h4 with nothing between.
 * ------------------------------------------------------------------ */
{
  const { page, close } = await open('/check/');
  const names = await page.$$eval('#app .opt', (els) =>
    els.slice(0, 5).map((e) => ({
      aria: e.getAttribute('aria-label'),
      text: (e.innerText || '').replace(/\s+/g, ' ').trim(),
    })));
  if (!names.length) fail('no country tiles rendered');
  for (const n of names) {
    /* A name is acceptable when it is explicit, or when the concatenation is
       separated — what is not acceptable is "Australia83 programmes". */
    const runTogether = /[a-zà-ÿ)][A-Z0-9]/.test((n.aria ?? n.text).replace(/\s+/g, ''));
    assert(!runTogether || Boolean(n.aria), `tile accessible name is not run together: ${JSON.stringify((n.aria ?? n.text).slice(0, 60))}`);
  }

  /* Heading sequence: no level may be skipped, on any step. */
  const gb = await page.$('[data-act="country"][data-cc="gb"]');
  if (gb) { await gb.click(); await page.waitForTimeout(400); }
  for (let i = 0; i < 8; i += 1) {
    const levels = await page.$$eval('#app h1,#app h2,#app h3,#app h4,#app h5,#app h6', (els) =>
      els.map((e) => Number(e.tagName[1])));
    let skipped = null;
    for (let k = 1; k < levels.length; k += 1) {
      if (levels[k] > levels[k - 1] + 1) { skipped = `h${levels[k - 1]} → h${levels[k]}`; break; }
    }
    const heading = await page.evaluate(() => document.querySelector('#app h1')?.textContent?.trim() || '?');
    assert(!skipped, `"${heading}": heading levels do not skip (${skipped || 'ok'})`);
    const opt = await page.$('#app .opt');
    if (!opt) break;
    await opt.click();
    await page.waitForTimeout(250);
  }
  await close();
}

await browser.close();
server.close();
console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
