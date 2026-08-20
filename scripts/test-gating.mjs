#!/usr/bin/env node
/**
 * The public dataset must not change the answer.
 *
 * /api/v1/programmes/{cc}.json ships stripped records past the second one, so
 * a signed-out client cannot download the directory. The whole design rests on
 * one claim: the free total computed from the stripped file equals the total
 * computed from the full one. If that ever stops being true we are quietly
 * lying to every free user about how much they are owed — the single worst
 * bug this product can have — so it is asserted per country, not spot-checked.
 *
 * It also asserts the negative: no name, no funder, no link and no quoted
 * source survives into a locked record.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/engine/matcher.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
/* Overridable so a pre-build dry run can point at a staged copy. Defaults to
   the real dist/, which is what CI reads. */
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/countries.json'), 'utf8'));

/* A profile deliberately light on answers, so plenty of programmes land in
   "needs one more answer" too — the buckets have to agree, not just the sum. */
const PROFILES = [
  { age: 34, status: 'employee', income_band: 'low', housing_tenure: 'renting', nationality_group: 'citizen_or_pr', household: 'alone' },
  { age: 68, status: 'retired', income_band: 'medium', housing_tenure: 'owner', nationality_group: 'citizen_or_pr' },
  { age: 21, status: 'student', nationality_group: 'eu_eea' },
];

let compared = 0;
let leaks = 0;
const LEAKY = ['name_en', 'name_local', 'funder', 'source_url', 'application_url', 'source_snippet',
               'amount_note', 'deadline_note', 'procedure_steps', 'documents_required'];

for (const entry of manifest.countries) {
  const cc = entry.slug;
  const fullPath = path.join(DATA, `${cc}.json`);
  const pubPath = path.join(DIST, `api/v1/programmes/${cc}.json`);
  if (!fs.existsSync(fullPath) || !fs.existsSync(pubPath)) continue;
  const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const pub = JSON.parse(fs.readFileSync(pubPath, 'utf8'));

  if (full.programmes.length !== pub.programmes.length) {
    bad(`${cc}: public file has ${pub.programmes.length} records, source has ${full.programmes.length} — the total cannot match`);
    continue;
  }

  for (const p of pub.programmes) {
    if (!p.locked) continue;
    for (const f of LEAKY) {
      if (p[f] != null && !(Array.isArray(p[f]) && !p[f].length)) {
        bad(`${cc}: locked record still carries ${f}`);
        leaks += 1;
      }
    }
  }

  for (const profile of PROFILES) {
    const a = match({ ...profile, country_code: cc }, full, entry);
    const b = match({ ...profile, country_code: cc }, pub, entry);
    compared += 1;
    if (a.total_min !== b.total_min || a.total_max !== b.total_max) {
      bad(`${cc}: total moved — full ${a.total_min}-${a.total_max}, public ${b.total_min}-${b.total_max}`);
    } else if (a.eligible.length !== b.eligible.length) {
      bad(`${cc}: eligible count moved — ${a.eligible.length} vs ${b.eligible.length}`);
    } else if (a.needs_one_more_answer.length !== b.needs_one_more_answer.length) {
      bad(`${cc}: pending count moved — ${a.needs_one_more_answer.length} vs ${b.needs_one_more_answer.length}`);
    }
  }
}

if (!failed) {
  ok(`free total identical across ${compared} country/profile pairs`);
  ok('no locked record leaks a name, funder, link or quoted source');
}

/* And the positive: the first two per country are whole, so the page and the
   API agree about what a signed-out visitor may see. */
{
  const gb = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/programmes/gb.json'), 'utf8'));
  const whole = gb.programmes.filter((p) => !p.locked);
  whole.length === gb.free_rows && whole.every((p) => p.name_en)
    ? ok(`the first ${gb.free_rows} records per country are whole`)
    : bad(`expected ${gb.free_rows} whole records, found ${whole.length}`);
}

/* The unstripped copies must not be published on a host that cannot refuse
   requests for them. This is the check that would have caught shipping
   /api/v1/full/ to GitHub Pages, where it was a complete, guessable copy of
   the directory the paywall exists to protect. */
{
  const fullDir = path.join(DIST, 'api/v1/full');
  const emitted = fs.existsSync(fullDir);
  /* The default flipped when the Worker went in front of the site: the copies
     now ship unless EMIT_FULL_DATASET=0 asks for a public-only build. Mirror
     src/build.mjs's predicate exactly rather than restating it — the assertion
     is "the build emitted what it was asked to emit, and nothing else", which
     holds in both directions and is what a static-host deploy would break. */
  const wanted = process.env.EMIT_FULL_DATASET !== '0';
  if (wanted) {
    emitted
      ? ok('full dataset emitted, as this build asked')
      : bad('no full dataset was written — every paid answer would serve stripped rows');
  } else {
    emitted
      ? bad('api/v1/full/ was written despite EMIT_FULL_DATASET=0 — a static host would publish the whole directory')
      : ok('no unstripped dataset in this public-only build');
  }
}

/* The startup dataset gets the same treatment, and the same assertion: the
   eligible/ineligible split must not move, because that split is what the free
   company check reports as a count. */
{
  const idx = JSON.parse(fs.readFileSync(path.join(DIST, 'api/v1/startups/index.json'), 'utf8'));
  const { matchStartup, reachFor } = await import('../src/engine/startup.js');
  const profile = { country_code: 'de', incorporated: true, incorporation_date: '2023-01-01', headcount: 8, turnover_annual_eur: 300000, stage: 'seed', sectors: [], rd_active: true };
  const load = (dir, pool) => {
    const f = path.join(DIST, dir, `${pool}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { programmes: [] };
  };
  const pools = reachFor('de');
  const pub = {};
  const full = {};
  for (const pool of pools) {
    pub[pool] = load('api/v1/startups', pool);
    full[pool] = load('api/v1/full/startups', pool);
  }
  /* Compare against the repo's own source when the full copies were not
     emitted — the assertion is about the stripping, not about the build flag. */
  const haveFull = Object.values(full).some((d) => (d.programmes || []).length);
  const source = haveFull
    ? full
    : Object.fromEntries(
        pools.map((pool) => {
          const f = path.join(ROOT, 'data/startups', `${pool}.json`);
          return [pool, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { programmes: [] }];
        }),
      );
  const a = matchStartup(profile, source, Date.parse('2026-06-01'));
  const b = matchStartup(profile, pub, Date.parse('2026-06-01'));
  a.eligible.length === b.eligible.length && a.not_eligible.length === b.not_eligible.length
    ? ok(`startup verdicts identical after stripping (${a.eligible.length} eligible)`)
    : bad(`startup verdicts moved: ${a.eligible.length}/${a.not_eligible.length} vs ${b.eligible.length}/${b.not_eligible.length}`);
  idx.countries.length ? ok(`startup index lists ${idx.countries.length} jurisdictions`) : bad('startup index empty');
}

/* The unstripped copies must never be linked from a page. They are only
   reachable through env.ASSETS inside the Worker, and the router 404s any
   external request — but a link in the HTML would invite a crawler to try. */
{
  const links = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'full') walk(f); }
      else if (e.name.endsWith('.html') && fs.readFileSync(f, 'utf8').includes('/api/v1/full/')) links.push(f);
    }
  })(DIST);
  links.length ? bad(`${links.length} pages link to /api/v1/full/`) : ok('no page links to the unstripped dataset');
}

/* Every call site that renders a programme CARD must be behind an entitlement
   check. Not because a nameless card leaks anything — it does not — but
   because forty boxes with empty titles is what the paywall looks like when
   someone forgets, and it reads as a broken page rather than a locked one.
   Asserted on the source, since the bug is a missing branch, not bad output. */
{
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const lines = app.split('\n');
  const stray = [];
  lines.forEach((line, i) => {
    if (!/progCard\(/.test(line) || /^function progCard/.test(line)) return;
    /* Walk back to the nearest function head and require a gate between. */
    let guarded = false;
    for (let j = i; j >= 0 && j > i - 60; j--) {
      if (/^function /.test(lines[j])) break;
      if (/gated\(|ENTITLED/.test(lines[j])) { guarded = true; break; }
    }
    if (!guarded) stray.push(i + 1);
  });
  stray.length
    ? bad(`programme cards rendered with no entitlement check at src/app.js:${stray.join(', ')}`)
    : ok('every programme card render is behind an entitlement check');
}

/* A paywall with no way through it.
   
   For most of this product's life the Worker's /api/billing/checkout was
   correct, tested, and completely unreachable: pricing's CTAs pointed at the
   free check, every locked panel pointed at /account/, and /account/ offered
   sign-in and sign-out and nothing else. A signed-in free user could not buy
   the product from the interface at all. Nothing errored — every button
   worked, they just all led back to the free half — so no test caught it.
   
   These assert the property that was missing: from each screen that shows a
   price or a lock, there is a control that starts checkout. */
{
  const readOut = (rel) => {
    const f = path.join(DIST, rel);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };

  /* ---------------------------------------------------------------- *
   * The property, not three hardcoded names.
   *
   * This used to assert that pricing contained data-plan="personal_annual",
   * "personal_monthly" and something starting with "business". Three string
   * memberships. They cannot see a plan key the Worker will reject, they
   * cannot see a locked screen with no checkout on it, and they passed all the
   * way through /startups/check/ shipping a paywall with no way to pay.
   *
   * So: every plan key any shipped screen can ask for must be one the Worker
   * sells, and every screen that shows a price or a lock must carry a control
   * that starts checkout — in both audiences and all seven locales.
   * ---------------------------------------------------------------- */
  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  const planBlock = workerSrc.slice(workerSrc.indexOf('const PLANS = {'));
  const WORKER_PLANS = new Set(
    [...planBlock.slice(0, planBlock.indexOf('};')).matchAll(/^\s*([a-z_]+):\s*\{/gm)].map((m) => m[1]),
  );
  WORKER_PLANS.size >= 4 ? ok(`the Worker's plan table holds ${WORKER_PLANS.size} plans`) : bad('could not read the Worker plan table');

  /* Cross-check the client's own table against it: a plan advertised on one
     side and absent from the other is a checkout that 400s. */
  {
    const co = fs.readFileSync(path.join(ROOT, 'src/pwa/checkout.js'), 'utf8');
    const clientBlock = co.slice(co.indexOf('export const PLANS = {'));
    const clientPlans = [...clientBlock.slice(0, clientBlock.indexOf('};')).matchAll(/^\s*([a-z_]+):\s*\{/gm)].map((m) => m[1]);
    const rogue = clientPlans.filter((k) => !WORKER_PLANS.has(k));
    rogue.length === 0
      ? ok(`every plan the client advertises is one the Worker sells (${clientPlans.length})`)
      : bad(`the client advertises plans the Worker will reject: ${rogue.join(', ')}`);
  }

  /* Every rendered plan key across the whole built site, in every locale. */
  {
    const files = [];
    const walkAll = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walkAll(f);
        else if (/\.(html|js)$/.test(e.name)) files.push(f);
      }
    };
    walkAll(DIST);
    const unsellable = new Map();
    const priced = new Map();
    for (const f of files) {
      const html = fs.readFileSync(f, 'utf8');
      for (const m of html.matchAll(/data-plan="([a-z_]+)"/g)) {
        /* 'auto' is legal by design: the Worker resolves it from the session's
           account type, which is the one place that knows. */
        if (m[1] !== 'auto' && !WORKER_PLANS.has(m[1])) unsellable.set(m[1], f);
      }
      /* B17: a control asking for 'auto' must not print a price, because the
         client cannot yet know which plan 'auto' will resolve to. The /check/
         panel said "Unlock — €50 a year" on a button that resolves to
         business_annual for a business session: a €490 checkout behind a €50
         label. */
      for (const m of html.matchAll(/<(button|a)[^>]*data-plan="auto"[^>]*>([\s\S]{0,120}?)<\/\1>/g)) {
        if (/[€$£¥]\s?\d|\d+\s?(a year|a month|per seat)/i.test(m[2])) priced.set(m[2].replace(/\s+/g, ' ').trim(), f);
      }
    }
    unsellable.size === 0
      ? ok(`every data-plan in dist/ resolves to a plan the Worker sells (${files.length} files)`)
      : bad(`controls ask for plans the Worker does not sell: ${[...unsellable].map(([k, f]) => `${k} in ${path.relative(DIST, f)}`).join(', ')}`);
    priced.size === 0
      ? ok('no data-plan="auto" control claims a price it cannot know')
      : bad(`data-plan="auto" controls carry a currency figure: ${[...priced.keys()].join(' | ')}`);
  }

  /* The behavioural version of this check lives in lockedScreenBehaviour()
     at the bottom of this file. What used to be here read src/app.js and
     src/pwa/startup-check.js as TEXT and asserted that if `locked-bucket`
     appears anywhere then `data-checkout` appears somewhere too — so it
     printed "✓ the company check offers checkout at its lock" over a screen
     whose paywall could not be lifted by paying, because viewResult() had no
     entitlement branch at all. It tested that a lock has a way to pay. It
     never tested that paying removes the lock, which is the entire product.
     It also read src/, while its sibling test-reachability.mjs makes the case
     that what is in src/ is not what a browser downloads. */

  const account = readOut('account/index.html');
  if (!account) bad('no account page built');
  else {
    /data-checkout/.test(account)
      ? ok('the account page can start checkout')
      : bad('the account page offers no way to subscribe');
    /data-portal/.test(account)
      ? ok('a subscriber can reach the billing portal')
      : bad('the account page offers no way to manage an existing subscription');
    /* The bug that made an annual subscriber read "Your monthly is active":
       the raw plan column, printed into a sentence. Assert the replacement —
       one state per entitlement reason, computed in one place — rather than
       the name of whichever helper happens to format the label today. */
    /accountState\(/.test(account)
      ? ok('the plan line comes from the entitlement state machine')
      : bad('the account page prints the raw plan column');
    /awaitEntitlement\(/.test(account)
      ? ok('a payment waits for its webhook instead of asking for a reload')
      : bad('the post-payment page renders whatever /api/me says at that instant');
    /data-portal/.test(account) && /acct-buy-year/.test(account)
      ? ok('both the buy and the manage controls exist to be switched between')
      : bad('the account page cannot show one state and hide the other');
  }

  /* Every localised account page too — these are the ones that quietly rot,
     because nobody clicks through /pt/account/ before a demo. */
  const locales = ['de', 'fr', 'es', 'it', 'pt', 'hi'];
  const missing = locales.filter((l) => {
    const h = readOut(`${l}/account/index.html`);
    return !h || !/data-checkout/.test(h);
  });
  missing.length
    ? bad(`localised account pages with no checkout control: ${missing.join(', ')}`)
    : ok('all 6 localised account pages can start checkout');

  /* The locked results panel. Asserted on source, because the markup only
     exists after a wizard run. */
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  /SIGNED_IN/.test(app) && /data-checkout/.test(app)
    ? ok('the locked results panel offers checkout to a signed-in visitor')
    : bad('the locked results panel still dead-ends at /account/');
}

/* The plan a subscriber bought must survive the webhook.
   Every branch wrote `fields.plan ?? 'monthly'` while nothing passed a plan,
   so the column read "monthly" for every subscriber on every tier. */
{
  const w = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  /planFrom\(o\)/.test(w)
    ? ok('the webhook reads the plan from Stripe metadata')
    : bad('the webhook never reads a plan — every subscriber is stored the same');
  /\?\?\s*'monthly'/.test(w)
    ? bad("the webhook still defaults the plan to 'monthly'")
    : ok('the webhook no longer invents a plan');
  /COALESCE\(excluded\.plan/.test(w)
    ? ok('a later event cannot erase a known plan')
    : bad('a second webhook event overwrites the stored plan with null');
}

/* The answers must survive signing in.
   
   They lived only in the location hash. Signing in navigates to /account/ and
   back, so country, age, income and household were all gone by the time the
   user returned — thrown away at the exact moment someone has decided to pay. */
{
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  /PROFILE_KEY/.test(app) && /localStorage\.setItem\(PROFILE_KEY/.test(app)
    ? ok('the wizard keeps the answers on the device')
    : bad('the answers exist only in the URL and are lost on any navigation');
  /const saved = loadProfile\(\)/.test(app)
    ? ok('and reads them back when there is no hash to restore from')
    : bad('saved answers are written and never read');
  /saved_at/.test(app) && /90 \* 864e5/.test(app)
    ? ok('stale answers expire rather than being silently reused')
    : bad('a year-old income figure would be reused without asking');
}

/* Auto-apply is a legal question with a different answer per country, and the
   product sells it. The page that says which is which must exist and must be
   generated from the policy table rather than written by hand. */
{
  const f = path.join(DIST, 'auto-apply/index.html');
  if (!fs.existsSync(f)) bad('there is no page saying where auto-apply is possible');
  else {
    const html = fs.readFileSync(f, 'utf8');
    /registered mandate/.test(html)
      ? ok('the auto-apply page names the mandate tier')
      : bad('the auto-apply page does not distinguish submit-for-you from prepare-only');
    const linked = (html.match(/class="link-underline" href="[^"]*\/[a-z]{2}\//g) || []).length;
    linked >= 25
      ? ok(`every one of the ${linked} countries is placed in a tier`)
      : bad(`only ${linked} countries appear on the auto-apply page`);
    /credential|password/i.test(html)
      ? ok('and it states plainly that we never use your portal credentials')
      : bad('the auto-apply page does not say what prepare-only means');
    /* The enterprise product IS filing on the company's behalf. A page that
       tells a company it must submit its own applications is selling the
       individual product to the wrong buyer. */
    /we file it/i.test(html)
      ? ok('the page says plainly that we file for companies')
      : bad('the auto-apply page applies the individual answer to companies');
    /consumer-protection/i.test(html)
      ? ok('and says why the individual answer is different')
      : bad('the two applicant types are not distinguished');
  }
}

/* ==================================================================== *
 * Does paying actually remove the lock?
 *
 * Driven in Chromium over dist/, the way scripts/qa-screens.mjs drives it,
 * because this is a question about what a browser renders after /api/me
 * answers — and neither half of that is visible in the source. The check it
 * replaces read src/ as text and asserted that a lock has a checkout button
 * beside it. It printed a tick over /startups/check/, whose viewResult() had
 * no entitlement branch at all: an entitled business subscriber, served the
 * unstripped pool byte-for-byte as the Worker hands it to a paying session,
 * still read "Which 15 programmes … are on the paid plan" with one control on
 * the screen, and clicking it sent them to the Stripe billing portal.
 *
 * The property, in both directions:
 *   entitled → zero .locked__row, and a real programme name from the dataset
 *              is on the page;
 *   free     → at least one .locked__row, and at least one [data-checkout].
 * ==================================================================== */
async function lockedScreenBehaviour() {
  const require_ = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require_('/home/claude/.npm-global/lib/node_modules/playwright/index.js'));
  } catch {
    bad('Playwright is not resolvable — run with NODE_PATH=/home/claude/.npm-global/lib/node_modules');
    return;
  }

  const TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(DIST, p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  const PORT = 8217;
  await new Promise((r) => server.listen(PORT, r));
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch();

  /* A GB earner, encoded the way src/app.js encodes a shared result, so the
     wizard computes a real result on load instead of being clicked through
     seven times per locale. */
  const profile = {
    country_code: 'GB', admin_area: null, status: 'employee', age: 40, income_band: null,
    income_annual: 18000, household_size: 2, children_count: 1, housing_tenure: 'renting',
    nationality_group: 'citizen_or_pr', residency_months: 240, circumstances: [],
  };
  const hash = Buffer.from(JSON.stringify(profile), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /* A name that is genuinely in the GB dataset and genuinely behind the wall,
     so "entitled sees names" is asserted against the data rather than against
     the absence of a CSS class. */
  const gb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/gb.json'), 'utf8'));
  const realNames = gb.programmes.map((p) => p.name_en).filter(Boolean);

  const LOCALES = ['', 'fr/', 'de/', 'es/', 'it/', 'pt/', 'hi/'];

  async function screen({ url, entitled, waitFor }) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/api/me*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          entitled
            ? { signed_in: true, account_type: 'business', entitlement: { entitled: true, plan: 'business_monthly' } }
            /* Signed in and NOT paying is the state the paywall is aimed at:
               a signed-out reader is correctly sent through sign-in first, so
               testing only that state would let a missing checkout button
               hide behind a sign-in link. */
            : { signed_in: true, account_type: 'personal', entitlement: { entitled: false } },
        ),
      }));
    /* An entitled session is served the UNSTRIPPED pool. dist/api/v1/full/ is
       byte-for-byte what worker/index.js:2332 returns to one, so the stub is
       the real payload rather than a hand-made one. */
    if (entitled) {
      await ctx.route('**/api/v1/startups/*.json', (route) => {
        const name = route.request().url().split('/').pop().split('?')[0];
        const full = path.join(DIST, 'api/v1/full/startups', name);
        if (name === 'index.json' || !fs.existsSync(full)) return route.continue();
        route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(full, 'utf8') });
      });
      await ctx.route('**/api/v1/programmes/*.json', (route) => {
        const name = route.request().url().split('/').pop().split('?')[0];
        const full = path.join(DIST, 'api/v1/full/programmes', name);
        if (!fs.existsSync(full)) return route.continue();
        route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(full, 'utf8') });
      });
    }
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      lockedRows: document.querySelectorAll('.locked__row').length,
      /* Either a control that opens checkout, or a link that carries the plan
         through sign-in and back. Both are a road to paying; a bare link to
         /pricing/ is not. */
      checkouts: document.querySelectorAll('[data-checkout], a[href*="plan="]').length,
      text: document.body.innerText,
    }));
    await ctx.close();
    return state;
  }

  /* ---- /check/ results, in all seven locales ---------------------- */
  for (const loc of LOCALES) {
    const url = `${base}/${loc}check/#r=${hash}`;
    const free = await screen({ url, entitled: false, waitFor: '.result-hero' });
    free.lockedRows > 0
      ? ok(`/${loc}check/ free: ${free.lockedRows} withheld rows`)
      : bad(`/${loc}check/ free: the paywall rendered no withheld rows at all`);
    free.checkouts > 0
      ? ok(`/${loc}check/ free: a control that starts checkout is on the screen`)
      : bad(`/${loc}check/ free: a lock with no way to pay`);

    const paid = await screen({ url, entitled: true, waitFor: '.result-hero' });
    paid.lockedRows === 0
      ? ok(`/${loc}check/ entitled: no withheld rows`)
      : bad(`/${loc}check/ entitled: ${paid.lockedRows} rows are still redacted for a paying subscriber`);
    const named = realNames.filter((n) => paid.text.includes(n));
    named.length > 0
      ? ok(`/${loc}check/ entitled: ${named.length} real programme names are on the page`)
      : bad(`/${loc}check/ entitled: the wall is gone and no programme is named`);
  }

  /* ---- /startups/check/ results ----------------------------------- */
  for (const loc of LOCALES) {
    const url = `${base}/${loc}startups/check/`;
    /* The company wizard has no shareable hash, so it is clicked through. */
    async function drive(entitled) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.route('**/api/me*', (route) =>
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(entitled
            ? { signed_in: true, account_type: 'business', entitlement: { entitled: true, plan: 'business_monthly' } }
            : { signed_in: false, entitlement: { entitled: false } }),
        }));
      if (entitled) {
        await ctx.route('**/api/v1/startups/*.json', (route) => {
          const name = route.request().url().split('/').pop().split('?')[0];
          const full = path.join(DIST, 'api/v1/full/startups', name);
          if (name === 'index.json' || !fs.existsSync(full)) return route.continue();
          route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(full, 'utf8') });
        });
      }
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-act="country"]', { timeout: 8000 });
      await page.click('[data-cc="gb"]');
      await page.click('[data-field="stage"][data-value="seed"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="headcount"][data-value="15"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="turnover_annual_eur"][data-value="750000"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="sectors"][data-value="software"]');
      await page.click('[data-act="next"]');
      await page.click('[data-field="rd_active"][data-value="true"]');
      await page.click('[data-act="next"]');
      await page.waitForSelector('.result-hero', { timeout: 8000 });
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => ({
        lockedRows: document.querySelectorAll('.locked__row').length,
        checkouts: document.querySelectorAll('[data-checkout]').length,
        text: document.body.innerText,
      }));
      await ctx.close();
      return state;
    }
    let free;
    let paid;
    try {
      free = await drive(false);
      paid = await drive(true);
    } catch (e) {
      bad(`/${loc}startups/check/ could not be driven to a result: ${e.message.split('\n')[0]}`);
      continue;
    }
    free.lockedRows > 0
      ? ok(`/${loc}startups/check/ free: ${free.lockedRows} withheld rows`)
      : bad(`/${loc}startups/check/ free: the paywall rendered no withheld rows`);
    free.checkouts > 0
      ? ok(`/${loc}startups/check/ free: a control that starts checkout is on the screen`)
      : bad(`/${loc}startups/check/ free: a lock with no way to pay`);
    paid.lockedRows === 0
      ? ok(`/${loc}startups/check/ entitled: no withheld rows`)
      : bad(`/${loc}startups/check/ entitled: ${paid.lockedRows} rows are still redacted for a paying subscriber`);
    const startupNames = (() => {
      const f = path.join(DIST, 'api/v1/full/startups/gb.json');
      if (!fs.existsSync(f)) return [];
      return JSON.parse(fs.readFileSync(f, 'utf8')).programmes.map((p) => p.name_en).filter(Boolean);
    })();
    const named = startupNames.filter((n) => paid.text.includes(n));
    named.length > 0
      ? ok(`/${loc}startups/check/ entitled: ${named.length} real programme names are on the page`)
      : bad(`/${loc}startups/check/ entitled: the wall is gone and no programme is named`);
  }

  /* ---- one voice for withheld content ----------------------------- *
   * theme.css:1079 states the contract: "One class so a test can enumerate
   * them and confirm the site speaks about withheld content in exactly one
   * voice." src/app.js emitted bare `<div class="locked__row">` while
   * src/ui.mjs emitted `locked__row withheld` with a lock chip, so on the one
   * screen where redaction IS the product there were zero
   * `.locked__row__lock` elements, user-select was 'auto', and the grey bars
   * read as failed loading rather than as withheld records.
   */
  for (const loc of LOCALES) {
    for (const rel of ['check/', 'gb/']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.route('**/api/me*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signed_in: false, entitlement: { entitled: false } }) }));
      const page = await ctx.newPage();
      const url = rel === 'check/' ? `${base}/${loc}check/#r=${hash}` : `${base}/${loc}${rel}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.locked__rows > *')];
        const dots = [...document.querySelectorAll('*')].filter(
          (el) => el.children.length === 0 && el.textContent.trim() === '●●●●',
        );
        return {
          rows: rows.length,
          rowsUnmarked: rows.filter((el) => !el.classList.contains('withheld')).length,
          dots: dots.length,
          dotsUnmarked: dots.filter((el) => !el.closest('.withheld')).length,
          chips: document.querySelectorAll('.locked__row__lock').length,
        };
      });
      await ctx.close();
      if (r.rows === 0) continue; // nothing withheld on this page
      r.rowsUnmarked === 0
        ? ok(`/${loc}${rel}: all ${r.rows} withheld rows carry .withheld`)
        : bad(`/${loc}${rel}: ${r.rowsUnmarked} of ${r.rows} redacted rows are not marked .withheld`);
      r.dotsUnmarked === 0
        ? ok(`/${loc}${rel}: every ●●●● is inside a .withheld element`)
        : bad(`/${loc}${rel}: ${r.dotsUnmarked} ●●●● elements are not marked withheld`);
      r.chips > 0
        ? ok(`/${loc}${rel}: the lock chip names the pattern once`)
        : bad(`/${loc}${rel}: redacted rows with no lock chip — they read as failed loading`);
    }
  }

  await browser.close();
  server.close();
}

await lockedScreenBehaviour();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
