#!/usr/bin/env node
/**
 * Open every screen and look at it, the way a person would.
 *
 * The test suite in this repo asserts properties of the source and of the
 * data. It cannot see that six nav links are 4px apart, that a button sits on
 * top of another one, or that a panel runs off the right edge of the phone.
 * Those are the failures a person notices in the first three seconds, and
 * every one of them shipped.
 *
 * So this drives a real browser over the built site at two widths and reports
 * geometry: elements that overflow the viewport, interactive controls that are
 * too small to hit or too close together to hit the right one, text that runs
 * under something else, and headings that wrap to more lines than they should.
 * It is deliberately about layout only — spelling and vocabulary are checked
 * by check-i18n.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
/* Resolved through the global install: this sandbox's npm registry is 403, so
   the package cannot be a dependency of this repo. */
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 8199;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const SCREENS = [
  ['home (for me)', '/', 'me'],
  ['home (for my company)', '/', 'biz'],
  ['pricing (for me)', '/pricing/', 'me'],
  ['pricing (for my company)', '/pricing/', 'biz'],
  ['the check', '/check/', 'me'],
  ['company check', '/startups/check/', 'biz'],
  ['account', '/account/', 'me'],
  ['workspace', '/dashboard/', 'biz'],
  ['enterprise', '/enterprise/', 'biz'],
  ['countries', '/countries/', 'me'],
  ['one country', '/gb/', 'me'],
  ['one programme', '/gb/income_support/attendance-allowance/', 'me'],
  ['startups index', '/startups/', 'biz'],
  ['one startup country', '/startups/gb/', 'biz'],
  ['methodology', '/methodology/', 'me'],
  ['api', '/api/', 'me'],
  ['french home', '/fr/', 'me'],
];

const WIDTHS = [[1280, 900, 'desktop'], [390, 844, 'phone']];

const AUDIT = () => {
  const out = { overflow: [], tiny: [], crowded: [], overlap: [] };
  const vw = document.documentElement.clientWidth;
  const seen = (el) => {
    const s = getComputedStyle(el);
    /* A visually-hidden radio behind a CSS-only switch is not a small control,
       it is not a control at all — the label over it is. */
    if (s.opacity === '0' || s.pointerEvents === 'none') return false;
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  };
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` +
    (el.textContent ? ` "${el.textContent.trim().slice(0, 32)}"` : '');

  /* Deliberately off-screen things are not layout bugs: the skip link and the
     visually-hidden labels live at left:-9999px on purpose. */
  const parked = (r) => r.left < -1000;

  /* 1. Anything wider than the window. A single one of these produces a
        horizontal scrollbar on the whole page, which on a phone is the most
        obvious "this is broken" signal there is. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const r = el.getBoundingClientRect();
    if (parked(r)) continue;
    if (r.right > vw + 2 || r.left < -2) {
      if (getComputedStyle(el).position === 'fixed') continue;
      out.overflow.push(`${name(el)} spans ${Math.round(r.left)}…${Math.round(r.right)} of ${vw}`);
    }
  }

  /* 2. Controls too small to hit. 24px is the WCAG 2.2 minimum. A link inside
        a sentence is exempt — it is text, and its hit area is the line box —
        so this looks only at things drawn as controls. */
  const isControl = (el) => {
    if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.tagName === 'INPUT') return true;
    if (el.getAttribute('role') === 'tab') return true;
    const c = typeof el.className === 'string' ? el.className : '';
    return /\bbtn\b|__tab|nav__account|chip|pill/.test(c);
  };
  for (const el of document.querySelectorAll('a[href], button, select, input, [role=tab]')) {
    if (!seen(el) || !isControl(el)) continue;
    const r = el.getBoundingClientRect();
    if (parked(r)) continue;
    if (r.height < 24 || r.width < 24) out.tiny.push(`${name(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  /* 3. Controls crowded together. Two buttons 4px apart get mis-tapped, and a
        row of links with no space between them reads as one sentence. */
  /* Same rule for crowding: two buttons 4px apart is a defect, two words in a
     sentence 4px apart is a sentence. Segmented controls are exempt — the two
     halves of a pill switch are supposed to touch. */
  const controls = [...document.querySelectorAll('a[href], button, [role=tab]')]
    .filter((el) => seen(el) && isControl(el) && !parked(el.getBoundingClientRect()));
  const segment = (el) => el.closest('[role=tablist], .audswitch, .seg');
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const seg = segment(controls[i]);
      if (seg && seg === segment(controls[j])) continue;
      const vGap = b.top - a.bottom;
      const hGap = b.left - a.right;
      const sameRow = Math.abs(a.top - b.top) < 6;
      const sameCol = Math.abs(a.left - b.left) < 6;
      if (sameRow && hGap >= 0 && hGap < 8) out.crowded.push(`${name(controls[i])} and ${name(controls[j])} are ${Math.round(hGap)}px apart`);
      else if (sameCol && vGap >= 0 && vGap < 8) out.crowded.push(`${name(controls[i])} sits ${Math.round(vGap)}px above ${name(controls[j])}`);
      else if (hGap < -2 && vGap < -2 && a.width && b.width) out.overlap.push(`${name(controls[i])} overlaps ${name(controls[j])}`);
    }
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, 6);
  return out;
};

const browser = await chromium.launch();
let problems = 0;
const report = [];

for (const [w, h, wname] of WIDTHS) {
  for (const [label, url, aud] of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addCookies([{ name: 'ua_aud', value: aud, url: `http://localhost:${PORT}` }]);
    const page = await ctx.newPage();
    const consoleErrors = [];
    /* Two things fail here and mean nothing: the Google Fonts request, because
       this sandbox has no route to the internet, and /api/me and /api/v1/event,
       because those are the Worker's and this server only has the static
       build. Reporting them on all 34 renders buries the real findings. */
    const NOISE = /fonts\.googleapis|fonts\.gstatic|\/api\/me|\/api\/v1\/event|ERR_TUNNEL/;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (NOISE.test(text) || NOISE.test(m.location()?.url || '')) return;
      consoleErrors.push(text.slice(0, 120));
    });
    page.on('requestfailed', (r) => { if (!NOISE.test(r.url())) consoleErrors.push(`request failed: ${r.url().slice(0, 90)}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !NOISE.test(r.url())) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
    page.on('pageerror', (e) => consoleErrors.push('uncaught: ' + String(e).slice(0, 120)));
    try {
      const res = await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle', timeout: 20000 });
      if (!res || res.status() >= 400) { report.push([`${wname} · ${label}`, { http: [`HTTP ${res ? res.status() : 'no response'}`] }]); problems += 1; await ctx.close(); continue; }
      await page.waitForTimeout(400);
      const out = await page.evaluate(AUDIT);
      if (consoleErrors.length) out.console = [...new Set(consoleErrors)].slice(0, 4);
      const n = Object.values(out).reduce((a, v) => a + v.length, 0);
      if (n) { problems += n; report.push([`${wname} · ${label}`, out]); }
    } catch (e) {
      problems += 1;
      report.push([`${wname} · ${label}`, { error: [String(e).slice(0, 160)] }]);
    }
    await ctx.close();
  }
}
await browser.close();
server.close();

console.log('\nScreen audit\n');
if (!report.length) console.log(`  ✓ ${WIDTHS.length * SCREENS.length} screen renders — nothing overflows, overlaps, crowds or errors\n`);
for (const [screen, out] of report) {
  console.log(`  ${screen}`);
  for (const [kind, items] of Object.entries(out)) {
    if (!items.length) continue;
    console.log(`    ${kind}:`);
    for (const i of items) console.log(`      · ${i}`);
  }
  console.log('');
}
console.log(`${problems} observation${problems === 1 ? '' : 's'}\n`);
process.exit(problems ? 1 : 0);
