# The paywall, and the one switch that can undo it

Free is the total and the count. Paid is the programme names, the directory,
the document checklist and auto-apply. Three things enforce that, and they only
work together.

## 1. The public dataset is stripped

`/api/v1/programmes/{cc}.json` and `/api/v1/startups/{pool}.json` ship the first
two records whole and every other one without its name, funder, links, quoted
source, steps or documents. Gating the pages while publishing the full records
is not a paywall — the directory was one `curl` away.

The stripped records carry a `derived` block holding the five answers the
matcher would otherwise read out of the prose that was removed, so the free
total is identical to the paid one. `scripts/test-gating.mjs` asserts that
across every country and three profiles. If it ever fails, stop: a free total
that quietly drifts is the worst bug this product can have.

## 2. The unstripped copies are opt-in

`EMIT_FULL_DATASET=1` writes `/api/v1/full/...`. **Leave it unset until the
Cloudflare Worker is actually in front of the site.**

The design is that `/api/v1/full/` sits inside `run_worker_first`, so the Worker
reads it through `env.ASSETS` (which does not re-enter the router) while the
router 404s every external request. That is true with the Worker deployed and
completely false without it. On GitHub Pages there is no router, so the flag
would publish the entire directory at a guessable path. `robots.txt` disallows
it, but that is a request, not a control.

This was shipped wrong once, live, and caught in verification. The build now
defaults the flag off and `test-gating.mjs` fails if the directory appears
without it.

Without the full copies the Worker falls back to the stripped file: a paid user
sees less than they paid for, which is the right direction to fail in.

## 3. The client never decides

`state.entitled` in the app defaults to `false`, including when the network is
down, and is only ever set from what the server said. The `.ics` export and the
deadlines screen both check it — a hidden button is not an authorisation check,
and the calendar export used to carry every programme name in its SUMMARY lines.

## Turning it on properly

1. Deploy the Worker (`wrangler deploy`) with `run_worker_first` covering
   `/api/*`, `/auth/*`, `/webhooks/*`.
2. Confirm `https://unclaimedgrant.com/api/v1/full/programmes/gb.json` returns
   404 from the internet.
3. Only then set `EMIT_FULL_DATASET: '1'` in the build step's `env` block in
   `.github/workflows/deploy.yml`.
4. Confirm step 2 again after the deploy.

## 4. Trials, discounts and pausing — what the checkout can do that the page
   does not have to build

### 14-day trial on the Startup plan

`handleCheckout` in `worker/index.js` sets
`subscription_data[trial_period_days] = 14` for `business_monthly` and
`business_annual` only — never `personal_*`, and never anywhere near a credit
pack, which is a `mode: 'payment'` session handled by a different function
entirely. Checkout in `mode: 'subscription'` always collects a card up front
regardless of a trial being attached, so a trialling subscriber has a payment
method on file the moment the trial ends. The trial is offered on a first
subscription only: an account whose entitlements row already carries a
`stripe_subscription_id` (a cancelled or lapsed subscriber coming back) checks
out with no trial, so cancel-and-resubscribe cannot restart the free days. `/pricing/` states the trial on the
Startup card only, in all seven locales (`priceTrialLine`).

### Student / nonprofit discount codes — an owner action

`allow_promotion_codes: 'true'` is already set on every subscription checkout
session (personal and business alike), which is what makes a coupon code
usable at checkout at all. **Creating the coupon itself has to be done by
hand, once, in the Stripe Dashboard — this repository has no script for it,
because a coupon is a business decision, not a deploy:**

1. In the Stripe Dashboard, go to **Product catalogue → Coupons → New**.
2. Give it a percentage or fixed-amount discount (a student/nonprofit rate is
   commonly 100% for a fixed term, or 50% ongoing — decide the policy first).
3. Set **Duration**: `once`, `repeating` for N months, or `forever`.
4. Under **Promotion codes**, click **Create promotion code**, and set a
   human-typeable code (e.g. `STUDENT2026`). This is the code a customer
   actually types at checkout — the coupon underneath it is not typed by
   anyone.
5. Optionally cap **Max redemptions** and set an expiry date.
6. Hand the code out by email when someone asks — `/pricing/` on every
   locale carries the line "Students and nonprofits: ask for a discount"
   (`priceStudentLine`) linking to `mailto:hello@unclaimedgrant.com`.

Nothing in the codebase has to change to create, retire or replace a code;
the Dashboard is the whole mechanism.

### Pause instead of cancel

`POST /api/billing/pause { months: 1|2|3 }` sets
`pause_collection: { behavior: 'void', resumes_at }` on the Stripe
subscription — `void` because it is the one behaviour that never generates an
invoice at all, which is what a customer means by "paused" rather than "an
invoice I have to go argue about later. `POST /api/billing/resume` clears
`pause_collection` early.

Stripe's `status` field does **not** change while paused — a paused
subscription is still reported back as `active`. So entitlement is not read
off `status` alone: `entitlements.paused_until` (migration `0013_billing_pause`) is this
product's own record of the pause, and `entitlementFor()` in `worker/index.js`
treats `paused_until > now` as **not entitled**, with `reason: 'paused'`. That
column is kept in sync with Stripe's own `pause_collection` on every
`customer.subscription.*` webhook — not only written by the pause/resume
endpoints — so a pause or resume made by hand in the Stripe Dashboard is
honoured exactly like one made from `/account/`, and `applyStripeEvent` never
has to special-case which side triggered it.

The account page shows "Pause subscription" (with a 1/2/3 month picker) on any
subscription with an active Stripe subscription behind it, and, while paused,
"Paused until `<date>`" with a "Resume subscription" button — never both at
once, and never on a granted, admin, or free-in-jurisdiction account, none of
which have a Stripe subscription for `pause_collection` to act on.
