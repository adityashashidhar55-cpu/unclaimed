/**
 * What a company may generate, how much of it, and what it costs us.
 *
 * The template-based application pack in packages/autoapply costs nothing to
 * produce — it projects the company's own answers onto the programme's own
 * requirements, deterministically. It stays free and unmetered, forever.
 *
 * What is metered is the work that costs real money per call: a pitch deck, a
 * project narrative, a budget justification, a written review of a draft. Those
 * go to a language model, and a language model has a bill.
 *
 * Two things had to be true at once. The margin has to survive a customer who
 * uses every unit they are entitled to — not the average customer, the one at
 * the ceiling, because that is the one who decides whether the price works.
 * And the ceiling has to be legible before they hit it, because a company that
 * discovers a cap mid-deadline does not renew.
 *
 * So: an allowance per seat per month with a hard stop, and top-up packs for
 * anyone who wants more. Both are checked against a declared worst-case unit
 * cost by `scripts/test-quota.mjs`, which FAILS THE BUILD if any price falls
 * below the margin floor. Raising an allowance or cutting a price is therefore
 * a decision the test forces you to make on purpose.
 *
 * ------------------------------------------------------------------------
 * Why metering does not break the pricing invariant in packages/policy
 * ------------------------------------------------------------------------
 * PRICING.FLAT_SUBSCRIPTION_ONLY exists because a fee that scales with, or is
 * conditioned on, the benefit obtained is a procurement commission — the one
 * pricing shape that would put this product inside L554-2 and its equivalents.
 *
 * A generation unit is none of those things. It counts DOCUMENTS PRODUCED. It
 * is charged whether or not anything is ever filed, whether or not anything is
 * ever awarded, and it does not move with the size of the award. Buying more
 * units buys more compute, exactly as buying more seats buys more logins.
 *
 * The line is drawn here rather than left to judgement, and the invariants
 * below are asserted in the test suite:
 *   - a unit is a generated document, never an application filed, a programme
 *     matched, or an award received;
 *   - nothing about the count may be derived from a matched or received
 *     amount;
 *   - metering applies to the COMPANY product only. The individual product is
 *     flat everywhere, including in the jurisdictions where the assistance
 *     half is given away rather than sold.
 */

export const METERING = Object.freeze({
  UNIT_IS_A_GENERATED_DOCUMENT: true,
  NEVER_PER_CLAIM: true,
  NEVER_SCALED_BY_AMOUNT: true,
  COMPANY_PRODUCT_ONLY: true,
});

/**
 * What can be generated, and what each one weighs.
 *
 * The weight is roughly proportional to tokens, which is roughly proportional
 * to cost. A deck is four cover letters because it is four cover letters'
 * worth of model time, not because decks are worth more.
 *
 * `free` marks the deterministic outputs — no model, no bill, no counter.
 * They are listed here anyway so that a caller asking "what can I make" gets
 * one answer, and so that adding a new generator forces a decision about
 * which side of the line it is on.
 */
export const GENERATORS = Object.freeze([
  { type: 'application_pack', label: 'Application pack',        units: 0, free: true,
    note: 'Your answers projected onto the funder’s own form. Deterministic — no model, no limit.' },
  { type: 'checklist',        label: 'Document checklist',      units: 0, free: true,
    note: 'What this funder asks for, from the programme record.' },
  { type: 'cover_letter',     label: 'Cover letter',            units: 1, free: false,
    note: 'A letter written for this programme and this company.' },
  { type: 'review',           label: 'Review of your draft',    units: 1, free: false,
    note: 'Your draft read against the funder’s published criteria.' },
  { type: 'narrative',        label: 'Project narrative',       units: 2, free: false,
    note: 'The long-form section most grant forms ask for.' },
  { type: 'budget',           label: 'Budget justification',    units: 2, free: false,
    note: 'A costed budget with the reasoning each line needs.' },
  { type: 'deck',             label: 'Pitch deck',              units: 4, free: false,
    note: 'A deck built from the programme’s criteria and your own numbers.' },
]);

const BY_TYPE = new Map(GENERATORS.map((g) => [g.type, g]));

export const isGenerator = (t) => BY_TYPE.has(t);
export const generator = (t) => BY_TYPE.get(t) ?? null;

/**
 * Units a generation costs. Unknown types cost nothing because they are
 * refused before they get here — returning a default weight would let a typo
 * silently bill somebody.
 */
export function unitsFor(type) {
  return BY_TYPE.get(type)?.units ?? 0;
}

/**
 * The worst-case cost of one unit, in euro cents.
 *
 * Deliberately worst case, not average: it assumes a long prompt, a long
 * answer, and a retry. Every margin figure in this file is computed against
 * it, so the margins are floors rather than hopes.
 *
 * If model pricing moves, this is the one number to change — and the test
 * suite will then tell you which plan or pack stopped clearing the floor.
 */
export const UNIT_COST_CENTS = 55;

/** Nothing may be sold at a gross margin below this. */
export const MARGIN_FLOOR = 0.25;

/**
 * Monthly allowance per seat, by plan.
 *
 * Personal plans get none, and that is a product decision rather than a
 * stingy one: a person claiming a housing benefit does not need a pitch deck,
 * and the deterministic application pack — which is what they do need — is
 * free and unmetered on every plan.
 */
export const PLAN_ALLOWANCE = Object.freeze({
  personal_monthly: 0,
  personal_annual: 0,
  business_monthly: 20,
  business_annual: 20,
  enterprise: 60,
});

/** What each plan costs us per seat per month, in euro cents. */
export const PLAN_PRICE_CENTS = Object.freeze({
  personal_monthly: 700,
  personal_annual: 4167,   // €50/year
  business_monthly: 4900,
  business_annual: 4083,   // €490/year
  enterprise: 8000,
});

/** Annual plans are billed once; this is what a month of them is worth. */
export const MONTHLY_EQUIVALENT = Object.freeze({
  personal_annual: Math.round(5000 / 12),
  business_annual: Math.round(49000 / 12),
});

/**
 * Top-up packs.
 *
 * Bigger packs are cheaper per unit, so the margin falls as the pack grows —
 * which is the correct direction and is why the floor is asserted rather than
 * assumed. The 300 pack sits at 33%, and a fourth, larger pack would need a
 * price rise rather than another discount.
 */
export const PACKS = Object.freeze([
  { id: 'pack_25',  units: 25,  price_cents: 2900,  label: '25 generations' },
  { id: 'pack_100', units: 100, price_cents: 9900,  label: '100 generations' },
  { id: 'pack_300', units: 300, price_cents: 24900, label: '300 generations' },
]);

export const pack = (id) => PACKS.find((p) => p.id === id) ?? null;

/**
 * Gross margin on a thing that sells for `priceCents` and entitles the buyer
 * to `units` generations, assuming they use every one.
 */
export function marginFor(priceCents, units, unitCostCents = UNIT_COST_CENTS) {
  if (!priceCents) return 0;
  const cost = units * unitCostCents;
  return (priceCents - cost) / priceCents;
}

/**
 * Every priced thing with an allowance attached, and its worst-case margin.
 * The test walks this; nothing has to be listed twice.
 */
export function marginTable(unitCostCents = UNIT_COST_CENTS) {
  const rows = [];
  for (const [plan, units] of Object.entries(PLAN_ALLOWANCE)) {
    const price = MONTHLY_EQUIVALENT[plan] ?? PLAN_PRICE_CENTS[plan];
    rows.push({ kind: 'plan', id: plan, units, price_cents: price, margin: marginFor(price, units, unitCostCents) });
  }
  for (const p of PACKS) {
    rows.push({ kind: 'pack', id: p.id, units: p.units, price_cents: p.price_cents, margin: marginFor(p.price_cents, p.units, unitCostCents) });
  }
  return rows;
}

/**
 * The allowance an entitlement is worth this month.
 *
 * Seats multiply it, because seats are what the company bought. Clamped
 * because a seat count arriving over the wire is a seat count somebody can
 * inflate, and an inflated allowance is an unbounded model bill.
 */
export const MAX_SEATS_COUNTED = 500;

export function allowanceFor({ plan, seats = 1 } = {}) {
  const per = PLAN_ALLOWANCE[plan] ?? 0;
  const n = Math.min(Math.max(parseInt(seats, 10) || 1, 1), MAX_SEATS_COUNTED);
  return per * n;
}

/**
 * Can this generation go ahead, and what does it leave behind?
 *
 * Allowance is spent before purchased credits. A customer who has bought a
 * pack should not watch it drain while a monthly allowance they already paid
 * for expires unused — and if the order were reversed, that is exactly what
 * would happen every month.
 *
 * Returns a decision rather than throwing, because the caller has to turn a
 * refusal into a sentence and an offer, not into a 500.
 */
export function spend({ type, allowance = 0, usedThisMonth = 0, credits = 0 }) {
  const g = BY_TYPE.get(type);
  if (!g) return { ok: false, reason: 'unknown_type', units: 0 };
  if (g.free) return { ok: true, units: 0, from_allowance: 0, from_credits: 0, free: true };

  const units = g.units;
  const allowanceLeft = Math.max(0, allowance - usedThisMonth);
  const fromAllowance = Math.min(units, allowanceLeft);
  const fromCredits = units - fromAllowance;

  if (fromCredits > credits) {
    return {
      ok: false,
      reason: 'quota_exhausted',
      units,
      allowance_left: allowanceLeft,
      credits,
      short_by: fromCredits - credits,
    };
  }
  return { ok: true, units, from_allowance: fromAllowance, from_credits: fromCredits, free: false };
}

/** The month a usage row belongs to. UTC, so a team spread over timezones
 *  shares one boundary rather than arguing about whose midnight counts. */
export const monthKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 7);

/**
 * What to tell somebody who has run out.
 *
 * Names the smallest pack that would actually cover what they were trying to
 * do, rather than the biggest one we would like to sell. A quota wall that
 * upsells past the need is the thing that makes people cancel.
 */
export function exhaustedMessage(decision) {
  const need = decision.short_by ?? decision.units ?? 1;
  const smallest = PACKS.find((p) => p.units >= need) ?? PACKS[PACKS.length - 1];
  const euros = (smallest.price_cents / 100).toFixed(0);
  return (
    `This month's generations are used up. ` +
    `${smallest.label} for €${euros} covers this and ${smallest.units - need} more. ` +
    `The application pack and document checklist stay free and unlimited.`
  );
}
