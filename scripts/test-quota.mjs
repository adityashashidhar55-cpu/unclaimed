#!/usr/bin/env node
/**
 * Metered generation: the margin, the cap, and the line that keeps a top-up
 * from being a commission.
 *
 * The first block is the one that matters commercially. It walks every priced
 * thing that carries a generation allowance and FAILS THE BUILD if any of them
 * would fall below the margin floor when a customer uses every unit they are
 * entitled to. Raising an allowance or cutting a price therefore has to be a
 * decision somebody makes on purpose, in this file, rather than a number
 * quietly changed in a table and noticed a quarter later.
 *
 * The second block is the legal shape. packages/policy holds
 * FLAT_SUBSCRIPTION_ONLY because a fee that scales with the benefit obtained
 * is a procurement commission. A generation unit does not: it counts documents
 * produced, is charged whether or not anything is filed or awarded, and never
 * moves with an amount. That distinction is asserted here rather than trusted
 * to whoever edits the pricing next.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATORS, PACKS, PLAN_ALLOWANCE, PLAN_PRICE_CENTS, MONTHLY_EQUIVALENT,
  UNIT_COST_CENTS, MARGIN_FLOOR, METERING,
  marginFor, marginTable, allowanceFor, spend, unitsFor, monthKey,
  exhaustedMessage, isGenerator, MAX_SEATS_COUNTED,
} from '../packages/quota/index.js';
import { PRICING } from '../packages/policy/index.js';
import { memoryD1, allMigrations } from './lib/d1-memory.mjs';
import { __test } from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };
const is = (a, b, m) => (Object.is(a, b) ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`));
const yes = (v, m) => (v ? ok(m) : bad(m));
const no = (v, m) => (!v ? ok(m) : bad(`${m} — it did not refuse`));

console.log('\nGeneration quota\n');

/* ---- the margin floor -------------------------------------------- */

const table = marginTable();
let below = [];
for (const row of table) {
  if (row.units === 0) continue; // nothing metered, nothing to erode
  if (row.margin < MARGIN_FLOOR) below.push(`${row.kind} ${row.id} at ${(row.margin * 100).toFixed(1)}%`);
}
below.length === 0
  ? ok(`every priced allowance clears the ${MARGIN_FLOOR * 100}% floor at worst-case usage (${table.filter((r) => r.units).length} checked)`)
  : bad(`below the margin floor: ${below.join(', ')}`);

/* And the floor is measured at the ceiling of usage, not at the average. A
   plan whose margin only works if customers under-use it is a plan that stops
   working the month they stop under-using it. */
is(marginFor(4900, 20, 55), (4900 - 1100) / 4900, 'margin is computed against every unit being spent');
is(marginFor(0, 10), 0, 'a free thing has no margin to divide by');

/* The floor must actually bite. If the unit cost doubled, something has to
   fail — otherwise the assertion above is measuring nothing. */
{
  const doubled = marginTable(UNIT_COST_CENTS * 4).filter((r) => r.units > 0);
  yes(doubled.some((r) => r.margin < MARGIN_FLOOR),
    'the floor is capable of failing — at 4x the unit cost, something drops below it');
}

for (const row of table.filter((r) => r.units > 0)) {
  console.log(`      ${row.kind.padEnd(4)} ${row.id.padEnd(18)} ${String(row.units).padStart(3)} units  €${(row.price_cents / 100).toFixed(2).padStart(7)}  ${(row.margin * 100).toFixed(1)}%`);
}

/* ---- the pricing shape ------------------------------------------- */

yes(PRICING.NO_CONTINGENT_FEE && PRICING.NO_PER_BENEFIT_FEE, 'the policy invariants are still in force');
yes(METERING.UNIT_IS_A_GENERATED_DOCUMENT, 'a unit is a document produced');
yes(METERING.NEVER_PER_CLAIM && METERING.NEVER_SCALED_BY_AMOUNT, 'and is never per claim, nor scaled by an amount');

/* Asserted against the source, because this is the invariant somebody breaks
   by accident: reaching for the matched total when computing what to charge. */
{
  const quota = fs.readFileSync(path.join(ROOT, 'packages/quota/index.js'), 'utf8');
  no(/amount_min|amount_max|matched_total|est_annual|award(ed)?_amount/.test(quota),
    'nothing in the quota model reads a benefit amount');
  const worker = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  const gen = worker.slice(worker.indexOf('async function handleGenerate'), worker.indexOf('async function generateDocument'));
  no(/amount_min|amount_max|est_annual|total_eur/.test(gen), 'nor does the endpoint that spends them');
}

/* Individual plans are not metered at all — the flat subscription is the whole
   product there, including in the jurisdictions where assistance is given away
   rather than sold. */
is(PLAN_ALLOWANCE.personal_monthly, 0, 'a personal plan has no generation allowance');
is(PLAN_ALLOWANCE.personal_annual, 0, 'nor does the annual one');
is(allowanceFor({ plan: 'personal_annual', seats: 40 }), 0, 'and seats do not conjure one');

/* ---- what costs what --------------------------------------------- */

is(unitsFor('application_pack'), 0, 'the deterministic application pack is free');
is(unitsFor('checklist'), 0, 'so is the document checklist');
yes(unitsFor('deck') > unitsFor('cover_letter'), 'a deck costs more than a letter, because it costs more to make');
is(unitsFor('nonsense'), 0, 'an unknown type costs nothing — it is refused before it gets here');
no(isGenerator('nonsense'), 'and is not a generator');

is(allowanceFor({ plan: 'business_annual', seats: 4 }), 80, 'seats multiply the allowance');
is(allowanceFor({ plan: 'enterprise', seats: 99999 }), 60 * MAX_SEATS_COUNTED,
  'a seat count over the wire is clamped — an unbounded allowance is an unbounded model bill');
is(allowanceFor({ plan: 'unknown_plan' }), 0, 'an unrecognised plan gets nothing, rather than a default');

/* ---- spending ----------------------------------------------------- */

is(spend({ type: 'application_pack', allowance: 0, usedThisMonth: 0, credits: 0 }).ok, true,
  'the free pack works on an exhausted account');
{
  const d = spend({ type: 'deck', allowance: 20, usedThisMonth: 0, credits: 0 });
  is(d.from_allowance, 4, 'allowance is spent first');
  is(d.from_credits, 0, 'and purchased credits are left alone while it lasts');
}
{
  const d = spend({ type: 'deck', allowance: 20, usedThisMonth: 19, credits: 10 });
  is(d.ok, true, 'a generation may straddle the allowance and a pack');
  is(d.from_allowance, 1, 'taking what is left of the allowance');
  is(d.from_credits, 3, 'and the rest from credits');
}
{
  const d = spend({ type: 'deck', allowance: 20, usedThisMonth: 20, credits: 2 });
  is(d.ok, false, 'and is refused when neither covers it');
  is(d.short_by, 2, 'saying how short they are');
  yes(/25 generations/.test(exhaustedMessage(d)), 'and offering the smallest pack that would cover it, not the biggest');
  yes(/free and unlimited/.test(exhaustedMessage(d)), 'while pointing at what is still free');
}

is(monthKey(Date.parse('2026-03-01T00:00:00Z')), '2026-03', 'the month boundary is UTC');
is(monthKey(Date.parse('2026-02-28T23:59:59Z')), '2026-02', 'so a team across timezones shares one');

/* ---- against a real database -------------------------------------- */

const MIGRATIONS = allMigrations(ROOT);

async function seedCompany(env, { plan = 'business_annual', seats = 3 } = {}) {
  const uid = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, locale, account_type, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, `founder-${uid.slice(0, 6)}@example.com`, 'en', 'business', Date.now()).run();
  await env.DB.prepare('INSERT INTO orgs (id, name, owner_id, seats, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(orgId, 'Kestrel Robotics', uid, seats, Date.now()).run();
  await env.DB.prepare('INSERT INTO org_members (org_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
    .bind(orgId, uid, 'owner', Date.now()).run();
  await env.DB.prepare('INSERT INTO entitlements (user_id, status, plan, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, 'active', plan, Math.floor((Date.now() + 300 * 864e5) / 1000), Date.now()).run();
  return { uid, orgId, gate: { session: { uid }, orgId, role: 'owner' } };
}

{
  const env = { DB: memoryD1(MIGRATIONS) };
  const { gate, orgId } = await seedCompany(env, { plan: 'business_annual', seats: 3 });
  const ent = { plan: 'business_annual', seats: 3 };

  const q0 = await __test.quotaFor(env, gate, ent);
  is(q0.allowance, 60, 'three seats on the startup plan is sixty generations a month');
  is(q0.used, 0, 'nothing spent yet');
  is(q0.total_left, 60, 'and all of it available');

  await __test.takeUnits(env, gate, { units: 4, from_allowance: 4, from_credits: 0 }, { type: 'deck', programmeSlug: 'x' });
  const q1 = await __test.quotaFor(env, gate, ent);
  is(q1.used, 4, 'a deck costs four');
  is(q1.allowance_left, 56, 'and comes out of the allowance');

  /* A pack, and a spend that straddles the boundary. */
  await env.DB.prepare(
    'INSERT INTO generation_credits (id, org_id, user_id, pack_id, units, remaining, price_cents, source, purchased_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), orgId, gate.session.uid, 'pack_25', 25, 25, 2900, 'stripe', Date.now() - 1000).run();

  const q2 = await __test.quotaFor(env, gate, ent);
  is(q2.credits, 25, 'a purchased pack shows up');
  is(q2.total_left, 56 + 25, 'and adds to what is left');

  await __test.takeUnits(env, gate, { units: 60, from_allowance: 56, from_credits: 4 }, { type: 'deck', programmeSlug: 'y' });
  const q3 = await __test.quotaFor(env, gate, ent);
  is(q3.allowance_left, 0, 'the allowance is used up');
  is(q3.credits, 21, 'and the overflow came out of the pack');

  /* The month rolls over on its own. */
  await env.DB.prepare('UPDATE generation_usage SET month = ?').bind('2020-01').run();
  const q4 = await __test.quotaFor(env, gate, ent);
  is(q4.used, 0, 'last month’s spend does not count against this month');
  is(q4.credits, 21, 'but a purchased pack does not expire with the month');
}

/* Two companies must never see each other's numbers. */
{
  const env = { DB: memoryD1(MIGRATIONS) };
  const a = await seedCompany(env);
  const b = await seedCompany(env);
  await __test.takeUnits(env, a.gate, { units: 10, from_allowance: 10, from_credits: 0 }, { type: 'narrative' });
  const qa = await __test.quotaFor(env, a.gate, { plan: 'business_annual', seats: 3 });
  const qb = await __test.quotaFor(env, b.gate, { plan: 'business_annual', seats: 3 });
  is(qa.used, 10, 'one company’s usage is its own');
  is(qb.used, 0, 'and is invisible to the other — a quota is a billing fact');
}

/* The migration not being applied must not lock out paying customers. */
{
  const env = { DB: memoryD1(MIGRATIONS.filter((f) => !f.endsWith('0009_generation_quota.sql'))) };
  const { gate } = await seedCompany(env);
  let threw = false;
  let q = null;
  try {
    q = await __test.quotaFor(env, gate, { plan: 'business_annual', seats: 3 });
  } catch { threw = true; }
  no(threw, 'a missing quota table does not throw');
  is(q?.allowance, 60, 'the allowance the plan already grants still stands');
  is(q?.used, 0, 'with nothing recorded as spent');
  is(q?.credits, 0, 'and no credits invented');
}

/* ---- buying a pack must not buy the product ----------------------- */

/* The most expensive bug available in this feature. `checkout.session.completed`
   set status='active' on anything that completed, and a credit pack goes
   through the same event — so a free account could have bought the entire paid
   product for the price of the smallest pack, with nothing anywhere saying
   why. */
{
  const env = { DB: memoryD1(MIGRATIONS) };
  const uid = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, locale, account_type, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, 'freeloader@example.com', 'en', 'business', Date.now()).run();

  /* The dangerous shape, stated as data: an account whose subscription has
     ALREADY lapsed. The upsert's COALESCE would keep the old plan and set
     status='active', so a €29 pack would silently reinstate a cancelled
     subscription — and unlike a fresh account, there is no NOT NULL constraint
     to trip over and make the mistake visible. */
  await env.DB.prepare('INSERT INTO entitlements (user_id, status, plan, stripe_customer_id, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, 'canceled', 'business_annual', 'cus_x', Date.now()).run();

  const packSession = {
    id: 'cs_test_pack_1',
    mode: 'payment',
    customer: 'cus_x',
    metadata: { kind: 'credit_pack', pack_id: 'pack_25', user_id: uid },
  };
  /* Caught rather than awaited bare: a regression here throws inside the
     webhook, and a crash that stops the whole file reports nothing. */
  let packThrew = null;
  try {
    await __test.applyStripeEvent({ type: 'checkout.session.completed', data: { object: packSession } }, env);
  } catch (err) { packThrew = String(err?.message ?? err); }
  is(packThrew, null, 'crediting a pack does not throw');

  const ent = await env.DB.prepare('SELECT status FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(ent.status, 'canceled', 'buying a credit pack does not reinstate a cancelled subscription');
  const credits = await env.DB.prepare('SELECT SUM(remaining) AS n FROM generation_credits').first();
  is(credits.n, 25, 'it grants exactly the units that were paid for');

  /* Stripe redelivers. A redelivery must not double the pack. */
  await __test.applyStripeEvent({ type: 'checkout.session.completed', data: { object: packSession } }, env);
  const again = await env.DB.prepare('SELECT SUM(remaining) AS n FROM generation_credits').first();
  is(again.n, 25, 'a redelivered webhook does not credit the pack twice');

  /* A real subscription still works. */
  await __test.applyStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_sub_1', mode: 'subscription', customer: 'cus_x', subscription: 'sub_1', metadata: { user_id: uid, plan: 'business_annual' } } },
  }, env);
  const after = await env.DB.prepare('SELECT status FROM entitlements WHERE user_id = ?').bind(uid).first();
  is(after.status, 'active', 'while a subscription checkout still activates the plan');

  /* A pack with no user id is dropped rather than credited to nobody. */
  await __test.applyStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_pack_2', mode: 'payment', metadata: { kind: 'credit_pack', pack_id: 'pack_100' } } },
  }, env);
  const orphan = await env.DB.prepare('SELECT SUM(remaining) AS n FROM generation_credits').first();
  is(orphan.n, 25, 'a pack naming no customer credits nobody');

  /* And a pack id we do not sell is not honoured at whatever size it claims. */
  await __test.applyStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_pack_3', mode: 'payment', metadata: { kind: 'credit_pack', pack_id: 'pack_1000000', user_id: uid } } },
  }, env);
  const fake = await env.DB.prepare('SELECT SUM(remaining) AS n FROM generation_credits').first();
  is(fake.n, 25, 'a pack id we do not sell credits nothing');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
