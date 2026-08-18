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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/engine/matcher.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');

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
  if (process.env.EMIT_FULL_DATASET === '1') {
    emitted ? ok('full dataset emitted, as EMIT_FULL_DATASET asked') : bad('EMIT_FULL_DATASET=1 but no full dataset was written');
  } else {
    emitted
      ? bad('api/v1/full/ was written without EMIT_FULL_DATASET — on a static host that publishes the whole directory')
      : ok('no unstripped dataset in the build (set EMIT_FULL_DATASET=1 only behind the Worker)');
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

  const pricing = readOut('pricing/index.html');
  if (!pricing) bad('no pricing page built');
  else {
    const plans = [...pricing.matchAll(/data-plan="([a-z_]+)"/g)].map((m) => m[1]);
    plans.includes('personal_annual') && plans.includes('personal_monthly')
      ? ok('pricing sells both personal plans')
      : bad(`pricing has no personal checkout control (found: ${plans.join(', ') || 'none'})`);
    plans.some((x) => x.startsWith('business'))
      ? ok('pricing sells a business plan')
      : bad('pricing has no business checkout control');
  }

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
