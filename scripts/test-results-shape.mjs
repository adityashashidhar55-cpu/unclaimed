#!/usr/bin/env node
/**
 * The results screen, measured as a reader meets it.
 *
 * This is the screen the whole product exists to produce, and nothing in the
 * suite had ever measured its composition. Every number in the round-4 backlog
 * was obtained by hand, which is why three rounds of "shipped" turned out not
 * to be, and why two of them reported figures that did not reproduce.
 *
 * REACHING THE SCREEN IS THE HARD PART, and both non-obvious steps fail
 * SILENTLY, i.e. by rendering a different, plausible screen:
 *
 *   1. `/api/me` must answer the NESTED shape,
 *      {signed_in:true, entitlement:{entitled:true, plan:'personal'}}.
 *      The client reads `data.entitlement.entitled`. A flat `{entitled:true}`
 *      yields the FREE screen — zero cards, "Unlock the full list" — and
 *      every assertion below then measures the paywall by mistake.
 *
 *   2. `/api/v1/programmes/*.json` must be fulfilled from
 *      dist/api/v1/full/programmes/. The browser fetches the STRIPPED public
 *      asset; in production the Worker swaps in the full file for an entitled
 *      session. Without the route the page renders cards with empty titles —
 *      which is the DEGRADED state, asserted separately at the end, not the
 *      normal one.
 *
 * `/api/check` is deliberately NOT stubbed: the browser client never calls it.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { englishShare } from './lib/english-share.mjs';
import { drivePersonal } from './lib/wizard-drive.mjs';
import { settle } from './lib/settle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');
const PORT = 8207;
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

let pass = 0, fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const check = (cond, good, wrong) => (cond ? ok(good) : bad(wrong));

const QA_PROFILE = {
  country_code: 'GB', admin_area: null, status: 'employee', age: 40, income_band: null,
  income_annual: 18000, household_size: 2, children_count: 1, housing_tenure: 'renting',
  nationality_group: 'citizen_or_pr', residency_months: 240, circumstances: [],
};
const QA_HASH = Buffer.from(JSON.stringify(QA_PROFILE), 'utf8')
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const browser = await chromium.launch({ args: ['--no-sandbox'] });

/**
 * @param full  route the client's dataset fetch to the unstripped file
 *              (the production behaviour for a paying reader)
 */
async function openResults({ width = 1536, height = 900, locale = '', full = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**/api/me*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signed_in: true, entitlement: { entitled: true, plan: 'personal' } }),
    }));
  if (full) {
    await ctx.route('**/api/v1/programmes/*.json', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const f = path.join(DIST, 'api/v1/full/programmes', name);
      if (!fs.existsSync(f)) return route.continue();
      route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(f, 'utf8') });
    });
  }
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${locale}/check/#r=${QA_HASH}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.results', { timeout: 15000 }).catch(() => {});
  await settle(page);
  return { ctx, page };
}

const text = (page, sel = '.results') => page.evaluate((s) => document.querySelector(s)?.innerText || '', sel);

/* The run-on this guard exists to forbid is ONE text node reading
   "a · b · c · d · e · f". Testing /·[^·]+·…/ against innerText does not test
   that: `[^·]` matches newlines, so the regex happily spans the whole page and
   reports a run-on whenever six unrelated nodes each carry a middot. Measured
   on the current screen, 52 nodes carry a middot and the busiest carries ONE
   (an eyebrow, a section count chip, or a card's "programme · funder" line) —
   all legitimate. So: split on line breaks first, and ask the question of a
   single line. Do not "fix" this by changing the card separator. */
const RUN_ON = /·[^·\n]+·[^·\n]+·[^·\n]+·[^·\n]+·/;
const hasRunOn = (body) => body.split('\n').some((line) => RUN_ON.test(line));
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

/* ==================================================================== *
 * The entitled screen, at the width most readers use.
 * ==================================================================== */
{
  const { ctx, page } = await openResults({});

  const cards = await count(page, '.prog-card');
  check(cards > 0, `the entitled reader is on the paid screen (${cards} programme cards)`,
    'the harness did not reach the entitled results screen — everything below would measure the wrong page');

  /* 1. One claim, not a paragraph of hedges. */
  const heroParas = await count(page, '.result-hero p:not(.tiny):not(.btn-row)');
  check(heroParas === 1, 'the hero makes exactly one claim', `the hero carries ${heroParas} full paragraphs where one is the whole point`);

  /* 2. Something to do, without scrolling. */
  const primary = await page.evaluate(() => {
    const b = document.querySelector('.result-hero .btn-primary');
    return { n: document.querySelectorAll('.result-hero .btn-primary').length, bottom: b ? Math.round(b.getBoundingClientRect().bottom + window.scrollY) : null };
  });
  check(primary.n === 1, 'the hero offers exactly one filled control', `the hero offers ${primary.n} primary buttons`);
  check(primary.bottom !== null && primary.bottom <= 700,
    `the primary action is above the fold (bottom y=${primary.bottom})`,
    `the reader must scroll to ${primary.bottom}px before anything advances their claim`);

  /* 3. No sentence that tells the reader their money is not their money. */
  const body = await text(page);
  check(!/is not your real total|counts? as zero|count as zero/i.test(body),
    'the screen does not talk the reader out of its own total',
    'the screen still says the total it just printed is not the real total');

  /* 4. The six-clause run-on is gone. */
  check(!hasRunOn(body),
    'the accounting is navigation, not a six-clause sentence',
    'a single line still strings six counts together with middots');

  /* 5. Every index row goes somewhere, and the numbers add up to the corpus. */
  const index = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.result-index a[href^="#"]')].map((a) => ({
      href: a.getAttribute('href'),
      resolves: !!document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))),
      n: a.querySelector('b') ? Number(a.querySelector('b').textContent.replace(/\D+/g, '')) : null,
    }));
    const totalRow = document.querySelector('.result-index__total');
    const total = totalRow ? Number((totalRow.textContent.match(/[\d.,\s]+/g) || []).pop()?.replace(/\D+/g, '')) : null;
    return { rows, total };
  });
  if (!index.rows.length) {
    bad('there is no index of the page — a 14,800px screen with no map of itself');
  } else {
    const dead = index.rows.filter((r) => !r.resolves).map((r) => r.href);
    check(dead.length === 0, `all ${index.rows.length} index rows land on a section that exists`, `index rows point at nothing: ${dead.join(', ')}`);
    const sum = index.rows.reduce((a, r) => a + (r.n || 0), 0);
    check(index.total != null && sum === index.total,
      `the index's own numbers add up: ${sum} = ${index.total} programmes`,
      `the index counts ${sum} programmes against a stated total of ${index.total} — a row is counting a different noun`);
  }

  /* 6. The bucket the reader did not ask about comes last. */
  const order = await page.evaluate(() => {
    const box = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY) }; };
    return { ask: box('ask'), lead: ['apply', 'automatic', 'taper', 'rights', 'documents'].map((id) => [id, box(id)]).filter(([, b]) => b) };
  });
  if (!order.ask) {
    ok('no "answer one more thing" section on this persona — nothing to order');
  } else {
    const above = order.lead.filter(([, b]) => b.bottom > order.ask.top).map(([id]) => id);
    check(above.length === 0, 'everything the reader can act on today comes before the things that need another answer',
      `#ask starts at ${order.ask.top}px, above the bottom of #${above.join(', #')}`);
  }

  /* 7. A card that asks one question is dressed like one question. */
  if (await count(page, '#ask .prog-card')) {
    const askBadges = await count(page, '#ask .prog-card .badge');
    const askCards = await count(page, '#ask .prog-card');
    const askBtns = await count(page, '#ask .prog-card .btn');
    check(askBadges === 0, 'the one-question cards carry no chips', `${askBadges} chips on cards that say one thing`);
    check(askBtns === askCards, 'each one-question card offers exactly one control', `${askCards} cards carry ${askBtns} buttons`);
  }

  /* 8. Chips belong to the cards that carry money. */
  const chips = await page.evaluate(() => {
    const lead = ['apply', 'automatic', 'taper', 'rights'].reduce((n, id) => n + (document.getElementById(id)?.querySelectorAll('.prog-card').length || 0), 0);
    return { lead, all: document.querySelectorAll('.prog-card .badge').length, ruledCards: document.querySelectorAll('#ruled-out .prog-card').length };
  });
  check(chips.all <= 3 * chips.lead, `chips are rationed to the cards that carry money (${chips.all} for ${chips.lead} lead cards)`,
    `${chips.all} chips against ${chips.lead} lead cards — the page is chips`);
  check(chips.ruledCards === 0, 'what would have to change is a list of rules, not a wall of application cards',
    `${chips.ruledCards} full programme cards inside the ruled-out list`);

  /* 9. The same sentence is not printed on every card. */
  const repeated = await page.evaluate(() => {
    const seen = new Map();
    for (const c of document.querySelectorAll('.prog-card')) {
      for (const s of new Set((c.innerText || '').split(/[.\n]/).map((x) => x.trim()).filter((x) => x.length >= 30))) {
        seen.set(s, (seen.get(s) || 0) + 1);
      }
    }
    return [...seen.entries()].filter(([, n]) => n > 3).map(([s, n]) => `${n}× "${s.slice(0, 48)}"`);
  });
  check(repeated.length === 0, 'no sentence is repeated across more than three cards', `boilerplate on every card: ${repeated.slice(0, 3).join('; ')}`);

  /* 11. The page is a page, not a scroll. */
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  check(h <= 8500, `the whole answer is ${h}px tall`, `the answer is ${h}px tall — more than nine screens`);

  /* 12. The page's own arithmetic. No markup in this one at all: the heading
     states a number of programmes and the sentence beneath it breaks that
     number down, so the breakdown must total the heading.

     Two things must be handled before the digits mean anything, and the first
     draft of this check handled neither, so it could not pass against the copy
     the spec itself prescribes:

       · MONEY IS NOT A COUNT. "up to £2,000 a year is what one of them
         publishes" carries the digits 2000, which are pounds, not programmes.
         Every currency figure is dropped before summing. (Measured: without
         this the check reported the sentence "accounts for 27006" against a
         heading of 8.)
       · ENGLISH WRITES ONE AS A WORD. The singular clauses read "one of them
         publishes" and "One is borrowing", never "1". A count-the-digits
         parser sees a breakdown of 6 under a heading of 8 and calls it a lie
         when it is exactly right: 1 + 6 + 1 = 8.

     English-only by design — this runs on the default locale; the localised
     screens are covered by the index-sum check (5), whose numbers are digits
     in every language, and by test-results-i18n. */
  const nums = await page.evaluate(() => {
    const CURRENCY = /(?:[£$€¥₹]\s?\d[\d.,\s]*|\d[\d.,\s]*\s?(?:[£$€¥₹]|kr|zł|Kč|CHF|SEK|USD|EUR|GBP))/g;
    const WORD_ONE = /\bone\b/gi;
    const digits = (s) => [...(s || '').matchAll(/\d[\d.,\s]*/g)]
      .map((m) => Number(m[0].replace(/\D+/g, ''))).filter((n) => Number.isFinite(n));
    const claimEl = document.querySelector('.hero-claim');
    const raw = claimEl?.textContent || '';
    const noMoney = raw.replace(CURRENCY, ' ');
    return {
      head: digits(document.querySelector('.result-hero h1')?.textContent),
      claim: digits(noMoney),
      ones: (noMoney.match(WORD_ONE) || []).length,
      raw,
    };
  });
  if (nums.head.length && (nums.claim.length || nums.ones)) {
    const headline = Math.max(...nums.head);
    const total = nums.claim.reduce((a, b) => a + b, 0) + nums.ones;
    check(total === headline,
      `the sentence under the heading accounts for all ${headline} of them`,
      `the heading says ${headline} and the sentence below it accounts for ${total} — "${nums.raw.slice(0, 140)}"`);
  } else {
    /* The all-unpriced and arithmetic-failed fallbacks state no breakdown at
       all, which is honest; there is nothing to add up. */
    ok('the hero states no breakdown, so there is none to contradict');
  }

  /* 10. A card head is a name and a number, not a name and a gulf. */
  for (const [w, limit] of [[1536, 320], [1280, 320], [1024, 260]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await settle(page);
    const gap = await page.evaluate(() => {
      let worst = 0;
      for (const h of document.querySelectorAll('.prog-card__head')) {
        const kids = [...h.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width);
        if (kids.length < 2) continue;
        worst = Math.max(worst, Math.round(kids[1].left - kids[0].right));
      }
      return worst;
    });
    check(gap <= limit, `card heads hold together at ${w}px (widest gap ${gap}px)`, `a card head at ${w}px has a ${gap}px hole in it`);
  }
  await ctx.close();
}

/* The promise, at the width most people carry. */
{
  const { ctx, page } = await openResults({ width: 390, height: 844 });
  const bottom = await page.evaluate(() => {
    const b = document.querySelector('.result-hero .btn-primary');
    return b ? Math.round(b.getBoundingClientRect().bottom + window.scrollY) : null;
  });
  check(bottom !== null && bottom <= 800, `on a phone the primary action is at ${bottom}px`,
    `on a phone the primary action is at ${bottom}px — more than two screens down`);
  await ctx.close();
}

/* ==================================================================== *
 * The degraded read. This one needs no stub of the dataset at all: a
 * plain static dist/ IS the state a paying reader hits when the build
 * forgot the full files, and for three rounds it rendered dozens of
 * nameless cards with two dead links each and no sentence anywhere.
 * ==================================================================== */
for (const locale of ['', '/fr']) {
  const { ctx, page } = await openResults({ locale, full: false });
  const notice = await count(page, '.results .notice--error');
  check(notice > 0, `${locale || '/en'}: a paying reader is told the list did not load`,
    `${locale || '/en'}: nameless cards and no explanation — indistinguishable from the free tier the reader just paid to leave`);
  const stale = await count(page, '.prog-card a[href^="/gb/"]');
  check(stale === 0, `${locale || '/en'}: no card offers a link that goes nowhere`, `${locale || '/en'}: ${stale} links into pages that do not exist`);
  const prim = await count(page, '.result-hero .btn-primary');
  check(prim === 0, `${locale || '/en'}: nothing invites the reader to start something the server will refuse`,
    `${locale || '/en'}: the hero still offers a primary action the Worker answers 503`);
  if (locale === '/fr' && notice) {
    const t = await page.evaluate(() => document.querySelector('.results .notice--error')?.innerText || '');
    const { share } = englishShare(t, { minWords: 12, lang: 'fr' });
    check(share < 0.06, `/fr: the failure is explained in French (${(share * 100).toFixed(1)}% English)`,
      `/fr: the failure is explained in English (${(share * 100).toFixed(1)}%)`);
  }
  await ctx.close();
}

/* ==================================================================== *
 * The same claims on a screen the reader DROVE, not one restored from a
 * link. The hash path and the answered path build the result through
 * different code, and only one of them has ever been measured.
 * ==================================================================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  await ctx.route('**/api/me*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signed_in: true, entitlement: { entitled: true, plan: 'personal' } }) }));
  await ctx.route('**/api/v1/programmes/*.json', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const f = path.join(DIST, 'api/v1/full/programmes', name);
    if (!fs.existsSync(f)) return route.continue();
    route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(f, 'utf8') });
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/check/`, { waitUntil: 'networkidle', timeout: 30000 });
  const driven = await drivePersonal(page, 'gb').catch((e) => ({ error: String(e) }));
  if (driven !== true) {
    bad(`the wizard could not be driven to its results screen: ${String(driven?.error || driven).slice(0, 120)}`);
  } else {
    await settle(page);
    const body = await text(page);
    check((await count(page, '.result-hero p:not(.tiny):not(.btn-row)')) === 1, 'answered live: the hero makes one claim', 'answered live: the hero is a paragraph of hedges');
    check((await count(page, '.result-hero .btn-primary')) <= 1, 'answered live: at most one filled control in the hero', 'answered live: the hero offers several primary actions');
    check(!hasRunOn(body), 'answered live: no six-clause run-on', 'answered live: the six-count sentence is still there');
    check(!/is not your real total|counts? as zero/i.test(body), 'answered live: the total is not undermined', 'answered live: the screen contradicts its own total');
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`results-shape: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
