#!/usr/bin/env node
/**
 * The results screen, in a real browser, in every language we publish.
 *
 * Everything else that measures translation measures built HTML. The results
 * screen is not in the built HTML: it is drawn into #app by src/app.js after
 * load, from a dictionary shipped in <script id="i18n-wizard">. So the page
 * that the whole product exists to show was the one page no guard had ever
 * looked at, and it shipped substantially English in all six locales.
 *
 * The guard that was supposed to catch that (qa-screens' sentinel list) could
 * not, by construction: it only reported a sentence as untranslated if the
 * dictionary already contained a translation for it. A sentence assembled by
 * interpolation is never a dictionary key, so the sentences that were broken
 * were exactly the ones it switched itself off for.
 *
 * This asserts the property instead, and the property needs no dictionary:
 *
 *   Drive the wizard to its result in locale X. Read what is on the screen.
 *   Almost none of it may be English.
 *
 * It cannot tell good French from bad, and it does not try. It tells English
 * from not-English, which is the failure we keep shipping.
 *
 * Run: NODE_PATH=/home/claude/.npm-global/lib/node_modules node scripts/test-results-i18n.mjs
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
import { englishShare, englishRuns } from './lib/english-share.mjs';
import { drivePersonal, driveCompany } from './lib/wizard-drive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');
const PORT = 8203;

/* A page whose visible words are more than this share English marker words is
   not translated. Real translated prose lands near zero; English prose on this
   screen measures 0.18-0.25. The number is the same one check-i18n uses on
   built pages, for the same reason: it is far above translated and far below
   English, so nothing lands near it by accident. */
const THRESHOLD = 0.06;

/* Locale → the country to answer step 1 with. A reader in a locale checks
   their own country, and it keeps the dataset under test different per run. */
const LOCALES = [
  ['fr', 'fr'],
  ['de', 'de'],
  ['es', 'es'],
  ['it', 'it'],
  ['pt', 'pt'],
  ['hi', 'in'],
];

/* A GB earner, encoded exactly the way src/app.js encodes a shared result —
   the third way onto this screen, and the one a reader arrives on from a link
   somebody sent them. */
const SHARED_PROFILE = {
  country_code: 'GB', admin_area: null, status: 'employee', age: 40, income_band: null,
  income_annual: 18000, household_size: 2, children_count: 1, housing_tenure: 'renting',
  nationality_group: 'citizen_or_pr', residency_months: 240, circumstances: [],
};
const SHARED_HASH = Buffer.from(JSON.stringify(SHARED_PROFILE), 'utf8')
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

/**
 * The words on the results screen that we wrote.
 *
 * Programme names and funder-published prose are legitimately in the language
 * the funder published them in — the same exemption check-i18n applies to
 * built pages. Everything else on this screen is ours, and ours is what is
 * being measured. Text nodes the reader cannot see are skipped, so a locked
 * bucket's hidden contents cannot flatter or damn the score.
 */
const EXEMPT = ['.prog-card__title', '.list-row__name', '.list-row__meta',
  '.source-block', '.rule-table', 'code', 'pre'];

const readScreen = (page) => page.evaluate((exempt) => {
  const app = document.getElementById('app');
  if (!app) return null;
  const out = [];
  const walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const el = n.parentElement;
    if (!el) continue;
    if (exempt.some((sel) => el.closest(sel))) continue;
    if (el.checkVisibility ? !el.checkVisibility() : !el.getClientRects().length) continue;
    out.push(s);
  }
  return out;
}, EXEMPT);

const browser = await chromium.launch();
const open = async (url) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'ua_aud', value: 'me', url: `http://localhost:${PORT}` }]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle', timeout: 20000 });
  return { ctx, page };
};

const rows = [];
const errors = [];

for (const [lg, cc] of LOCALES) {
  const routes = [
    [`/${lg}/check/`, 'personal wizard, walked', async (page) => {
      if (!(await drivePersonal(page, cc))) throw new Error('never reached a result');
    }],
    [`/${lg}/check/#r=${SHARED_HASH}`, 'personal result, shared link', async (page) => {
      await page.waitForSelector('.result-hero', { timeout: 8000 });
    }],
    [`/${lg}/startups/check/`, 'company wizard, walked', async (page) => {
      await driveCompany(page, cc);
    }],
  ];
  for (const [url, label, drive] of routes) {
    if (!fs.existsSync(path.join(DIST, url.split('#')[0], 'index.html'))) {
      errors.push(`${url} is not in the build`);
      continue;
    }
    const { ctx, page } = await open(url);
    try {
      await drive(page);
      await page.waitForTimeout(400);
      const chunks = await readScreen(page);
      if (chunks === null) throw new Error('the page has no #app');
      const text = chunks.join(' ');
      /* 'any' script, so Devanagari counts in the denominator. Under a
         Latin-only count a Hindi screen with four English sentences and
         nothing else scores 100% on four words — or, worse, falls under the
         minimum-words floor and is waved through without being measured. */
      const { share, words, hits } = englishShare(text, { script: 'any', minWords: 30, lang: lg });
      if (words < 30) throw new Error(`the results screen shows only ${words} words — it did not render`);
      const runs = englishRuns(chunks, { lang: lg });
      rows.push({ lg, label, url, share, words, runs, sample: [...new Set(hits)].slice(0, 8) });
    } catch (e) {
      errors.push(`/${lg}/ ${label}: ${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();

rows.sort((a, b) => b.share - a.share);
console.log(`\nThe results screen, rendered — ${rows.length} screens in ${LOCALES.length} locales\n`);
for (const r of rows) {
  const ok = r.share <= THRESHOLD && !r.runs.length;
  console.log(
    `  ${ok ? '✓' : '✗'} ${(r.share * 100).toFixed(1).padStart(5)}% English  /${r.lg}/ ${r.label.padEnd(28)}` +
    ` ${String(r.words).padStart(4)} words` +
    (ok ? '' : `   ${r.runs.length} English run${r.runs.length === 1 ? '' : 's'}, e.g. ${r.sample.join(', ')}`),
  );
  /* Naming the sentences, not just the score: a share tells you something is
     wrong, a sentence tells you what to translate. */
  for (const run of (ok ? [] : r.runs.slice(0, 3))) console.log(`        · ${run.text}`);
}
const bad = rows.filter((r) => r.share > THRESHOLD || r.runs.length);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log('');

if (bad.length || errors.length) {
  if (bad.length) {
    console.error(`  ✗ ${bad.length} of ${rows.length} results screens are still substantially English.`);
    console.error('    The reader answered in their language and got the answer in ours.');
  }
  if (errors.length) console.error(`  ✗ ${errors.length} screens could not be measured at all.`);
  console.error('');
  process.exit(1);
}
console.log(`  ✓ all ${rows.length} results screens are under the ${(THRESHOLD * 100).toFixed(0)}% English threshold\n`);
