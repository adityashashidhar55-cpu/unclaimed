/**
 * Operator-granted access.
 *
 * The owner needs to hand someone a paid plan without taking their money:
 * an enterprise deal closed on a call, a pilot, a refund that should not also
 * cost the customer their access, a journalist, a partner at involve-consulting.
 *
 * The load-bearing decision is that **a grant is not a subscription**, and it
 * is not written into the `entitlements` table. Two reasons, both of which this
 * codebase has already paid for once in a different shape:
 *
 *   1. `entitlements` is owned by the Stripe webhook, which upserts on
 *      `user_id` and assigns `status` unconditionally. Anything an operator
 *      wrote there would survive until that customer's next invoice event and
 *      then disappear, with nothing to say it had ever been there.
 *
 *   2. A comped account sitting in the same table as paying ones, with
 *      `status='active'`, makes every revenue figure wrong. Silently. Forever.
 *      MRR would count people who have never paid a cent.
 *
 * So grants live in their own table, `entitlementFor()` reads both, and access
 * is the union. Billing is untouched in either direction: granting does not
 * create a Stripe customer, and revoking does not cancel a subscription.
 *
 * This module is the part with no database in it — the vocabulary, the
 * validation, and the "which grant counts" rule — so it can be tested without
 * a Worker and imported by the build, the Worker and the test suite alike.
 */

/**
 * What an operator may grant.
 *
 * Deliberately the same keys the checkout uses, plus `enterprise`, which has
 * no Stripe price and never has had one. The pricing page quotes €80/seat/month
 * for a tier nothing could charge for; this is what closes that gap. Enterprise
 * is sold on a call and granted here, which is what "Talk to us" always meant.
 */
export const GRANTABLE_PLANS = [
  { plan: 'personal_monthly', label: 'Personal — monthly', account: 'individual', seats: false },
  { plan: 'personal_annual',  label: 'Personal — annual',  account: 'individual', seats: false },
  { plan: 'business_monthly', label: 'Startup — monthly',  account: 'business',   seats: true },
  { plan: 'business_annual',  label: 'Startup — annual',   account: 'business',   seats: true },
  { plan: 'enterprise',       label: 'Enterprise',         account: 'business',   seats: true },
];

const PLAN_MAP = new Map(GRANTABLE_PLANS.map((p) => [p.plan, p]));

export const isGrantablePlan = (plan) => PLAN_MAP.has(plan);
export const planMeta = (plan) => PLAN_MAP.get(plan) ?? null;
export const planLabel = (plan) => PLAN_MAP.get(plan)?.label ?? plan;

/** Grants may be handed out for a fixed window. 0 or absent means no expiry. */
export const MAX_GRANT_DAYS = 3650;
export const MAX_SEATS = 500;
export const MIN_REASON = 3;
export const MAX_REASON = 300;

/**
 * Validate and normalise what an operator submitted.
 *
 * Returns `{ ok: true, grant }` or `{ ok: false, error, message }`. It never
 * throws and never guesses: a plan that is not in the table is refused rather
 * than mapped to the nearest one, because "close enough" here means handing
 * out the wrong licence.
 *
 * `reason` is required, and that is a product decision rather than a technical
 * one. A comped account with no recorded reason is indistinguishable in six
 * months from a billing bug, and the person who has to tell them apart is the
 * owner, at the point where somebody is asking why revenue does not match
 * seats.
 */
export function normaliseGrant(input = {}, now = Date.now()) {
  const plan = String(input.plan ?? '').trim();
  if (!isGrantablePlan(plan)) {
    return { ok: false, error: 'unknown_plan', message: `No such plan: ${plan || '(none)'}` };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < MIN_REASON) {
    return { ok: false, error: 'reason_required', message: 'Say why. A comped account with no reason is a billing bug in six months.' };
  }

  const meta = planMeta(plan);
  const rawSeats = parseInt(input.seats, 10);
  const seats = meta.seats ? Math.min(Math.max(Number.isFinite(rawSeats) ? rawSeats : 1, 1), MAX_SEATS) : 1;

  /* Days, not a date, because the operator is answering "how long" and a date
     picker in a browser at the wrong timezone offset is a whole class of
     off-by-one nobody needs. Absent or 0 is a grant with no end. */
  const rawDays = parseInt(input.days, 10);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, MAX_GRANT_DAYS) : 0;
  const expires_at = days ? now + days * 864e5 : null;

  const rawAllowance = parseInt(input.gen_allowance, 10);
  const gen_allowance = Number.isFinite(rawAllowance) && rawAllowance >= 0 ? Math.min(rawAllowance, 100000) : null;

  return {
    ok: true,
    grant: { plan, seats, reason: reason.slice(0, MAX_REASON), expires_at, gen_allowance, days },
  };
}

/** A grant counts if nobody revoked it and it has not run out. */
export function isLive(grant, now = Date.now()) {
  if (!grant) return false;
  if (grant.revoked_at) return false;
  if (grant.expires_at && grant.expires_at <= now) return false;
  return true;
}

/**
 * Which of a user's grants decides their access.
 *
 * The most recently granted live one, because superseding is how a plan gets
 * upgraded: the Worker revokes the old grant when it writes a new one, but a
 * race, a partial failure or a hand-edited row could still leave two. Picking
 * the newest is the answer that matches what the operator last decided.
 */
export function pickLive(grants = [], now = Date.now()) {
  return (
    grants
      .filter((g) => isLive(g, now))
      .sort((a, b) => (b.granted_at ?? 0) - (a.granted_at ?? 0))[0] ?? null
  );
}

/** Days left, rounded up, or null for a grant with no end. */
export function daysLeft(grant, now = Date.now()) {
  if (!grant?.expires_at) return null;
  return Math.max(0, Math.ceil((grant.expires_at - now) / 864e5));
}

/**
 * One sentence describing the grant, for the admin table and the account page.
 *
 * The account page shows this to the customer, so it says what they have and
 * when it ends and does not repeat the operator's private reason at them.
 */
export function describeGrant(grant, now = Date.now(), { includeReason = false } = {}) {
  if (!grant) return 'No granted access.';
  const label = planLabel(grant.plan);
  const seats = planMeta(grant.plan)?.seats && grant.seats > 1 ? ` · ${grant.seats} seats` : '';
  if (grant.revoked_at) return `${label}${seats} — revoked`;
  const left = daysLeft(grant, now);
  const when = left === null ? 'no end date' : left === 0 ? 'expired' : left === 1 ? '1 day left' : `${left} days left`;
  const why = includeReason && grant.reason ? ` · ${grant.reason}` : '';
  return `${label}${seats} — granted, ${when}${why}`;
}

/** The audit actions that exist. Anything else is a typo, and is refused. */
export const AUDIT_ACTIONS = ['grant', 'revoke', 'supersede', 'create_user'];
export const isAuditAction = (a) => AUDIT_ACTIONS.includes(a);
