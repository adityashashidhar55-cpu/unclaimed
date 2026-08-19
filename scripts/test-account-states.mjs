/* The account page, one state at a time.
 *
 * This screen had exactly two branches for most of its life — entitled, and
 * everything else — and "everything else" is where a failed card payment
 * lives. A subscriber whose renewal bounced was told "Free account. You can
 * see your total" and offered a Subscribe button, so the remedy on offer for
 * a declined card was to buy a SECOND subscription while the first stayed
 * broken. These assert the state machine that replaced it: what each
 * entitlement answer says, and which control it offers.
 *
 * accountState() is imported from the shipped module, not re-implemented, so
 * the test cannot drift from what the page runs.
 */
/* Imported from the BUILT bundle, not from src: the module graph only
   resolves once the build has laid beacon.js out at the root, which is where
   the browser loads it from. Testing the built file also means a broken copy
   step fails here rather than in production. */
import fs from 'node:fs';
import { accountState, planLabel, PLANS } from '../dist/app/checkout.js';

let pass = 0, fail = 0;
const t = (name, ok) => { ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };

/* --- the state machine ------------------------------------------------- */

{
  const s = accountState({ entitled: true, reason: 'active', plan: 'personal_annual' });
  t('an active annual subscriber is told annual, not monthly', /Personal, annual/.test(s.line));
  t('and is offered the portal, not another checkout', s.action === 'portal');
}

{
  const s = accountState({ entitled: false, reason: 'past_due', plan: 'business_monthly' });
  t('a failed payment says the payment failed', /payment failed/i.test(s.line));
  t('and names the plan that is at risk', /Business, monthly/.test(s.line));
  t('and sends them to the portal to fix the card', s.action === 'portal');
  t('and does NOT offer to sell them a second subscription', s.action !== 'subscribe' && s.action !== 'both');
}

for (const reason of ['canceled', 'expired', 'unpaid', 'incomplete_expired']) {
  const s = accountState({ entitled: false, reason, plan: 'personal_annual' });
  t(`a ${reason} subscription reads as ended, not as a new free account`, s.kind === 'lapsed');
  t(`and ${reason} promises their saved work survived`, /saved work is still here/.test(s.line));
}

{
  const s = accountState({ entitled: false, reason: 'no_subscription' });
  t('a genuinely new account is the only one offered checkout', s.kind === 'free' && s.action === 'subscribe');
}

{
  const s = accountState({ entitled: true, reason: 'admin' });
  t('an operator session says so rather than claiming a plan', s.kind === 'admin' && !/annual|monthly/i.test(s.line));
  t('and is offered no billing controls at all', s.action === 'none');
}

{
  const s = accountState({ entitled: true, reason: 'free_in_jurisdiction' });
  t('free-in-jurisdiction explains why it is free', s.kind === 'free_here' && /do not charge/.test(s.line));
  t('and offers no portal, because there is no subscription behind it', s.action === 'none');
}

/* --- which plan the buttons buy ---------------------------------------- */

{
  const ind = accountState({ entitled: false, reason: 'no_subscription', accountType: 'individual' });
  const biz = accountState({ entitled: false, reason: 'no_subscription', accountType: 'business' });
  t('an individual account is offered the personal plans', ind.plans.annual === 'personal_annual' && ind.plans.monthly === 'personal_monthly');
  t('a business account is offered the business plans', biz.plans.annual === 'business_annual' && biz.plans.monthly === 'business_monthly');
  t('no account type falls back to personal, not to nothing', accountState({ reason: 'no_subscription' }).plans.annual === 'personal_annual');
}

/* --- the plan names themselves ----------------------------------------- */

{
  t('every plan the Worker sells has a human name', Object.keys(PLANS).length === 4);
  t('the legacy "monthly" row still renders as English', planLabel('monthly') === 'Monthly');
  t('an absent plan does not render as undefined', planLabel(null) === 'Your subscription');
  for (const key of ['personal_monthly', 'personal_annual', 'business_monthly', 'business_annual']) {
    t(`${key} has a label`, typeof PLANS[key]?.label === 'string' && PLANS[key].label.length > 0);
  }
}

/* --- no state is unreachable or unhandled ------------------------------ */

{
  /* Every reason entitlementFor() can return must land somewhere deliberate.
     Read them out of the Worker rather than listing them here, so a new
     reason added there fails this test instead of silently rendering the
     generic "Free account" line at someone who is paying. */
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function entitlementFor'), src.indexOf('/* Data access'));
  const reasons = new Set([...fn.matchAll(/reason: '([a-z_]+)'/g)].map((m) => m[1]));
  /* `reason: live ? ... : row.status` also passes Stripe statuses through. */
  for (const s of ['past_due', 'canceled', 'unpaid', 'incomplete_expired']) reasons.add(s);

  const unhandled = [...reasons].filter((r) => {
    const st = accountState({ entitled: false, reason: r });
    return st.kind === 'free' && r !== 'no_subscription' && r !== 'anonymous';
  });
  t(`every entitlement reason has its own state (unhandled: ${unhandled.join(', ') || 'none'})`, unhandled.length === 0);
}

/* Half-translated is worse than untranslated: "Personal, annual" sitting in
   the middle of a German sentence is what an unfinished product looks like in
   exactly the market you are demoing to. Every state line and every plan name
   takes its words from the page's own locale table. */
{
  const fs = await import('node:fs');
  const locales = ['en', 'de', 'fr', 'es', 'it', 'pt', 'hi'];
  const needed = [
    'acctActive', 'acctFreeAcct', 'acctPastDue', 'acctLapsed', 'acctAdminLine',
    'acctFreeHere', 'acctConfirming', 'planPersonalMonthly', 'planPersonalAnnual',
    'planBusinessMonthly', 'planBusinessAnnual', 'planNone',
  ];
  for (const l of locales) {
    const mod = (await import(`../src/i18n/${l}.mjs`)).default;
    const missing = needed.filter((k) => !mod[k]);
    t(`${l} has every account-state string (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  }

  /* And the state machine actually uses them rather than its own fallbacks. */
  const de = (await import('../src/i18n/de.mjs')).default;
  const tr = {
    active: de.acctActive, pastDue: de.acctPastDue, lapsed: de.acctLapsed,
    admin: de.acctAdminLine, freeHere: de.acctFreeHere, free: de.acctFreeAcct,
    personal_annual: de.planPersonalAnnual, planNone: de.planNone,
  };
  const line = accountState({ entitled: false, reason: 'past_due', plan: 'personal_annual' }, tr).line;
  t('a German past-due line is German end to end', line.includes(de.planPersonalAnnual) && line.includes(de.acctPastDue));
  t('and contains no English fallback', !/annual —|payment failed/.test(line));

  /* The built pages must carry the table, not just the source. */
  const acct = fs.readFileSync(new URL('../dist/de/account/index.html', import.meta.url), 'utf8');
  t('the built German account page ships its own strings', acct.includes(de.acctPastDue) && acct.includes(de.planPersonalAnnual));
}

/* ---- the Stripe session Stripe will actually accept ---- */
/*
 * A 500 from POST /api/billing/checkout, on the enterprise plan, with the
 * body: "`customer_update` can only be used with `customer`". The session
 * sent `customer_update[name]` next to a bare `customer_email`, so every
 * business checkout died before the redirect and the only visible symptom was
 * a button that did nothing. Stripe's two rules here are exact, so assert
 * them against the source rather than hoping.
 */
{
  console.log('\nStripe checkout session');
  const worker = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  const start = worker.indexOf("stripeCall(env, 'checkout/sessions'");
  const block = worker.slice(start, worker.indexOf('});', start));
  t('the checkout session is built somewhere in the Worker', start > 0);
  const guarded = (needle) => {
    const i = block.indexOf(needle);
    if (i < 0) return true; // not sent at all is fine
    /* It must sit inside a conditional keyed on having a customer id. */
    return /customerId \?/.test(block.slice(Math.max(0, i - 400), i));
  };
  t('customer_update is only sent when a customer id is', guarded('customer_update'));
  t('customer and customer_email are never both unconditional', !(/\n\s+customer:/.test(block) && /\n\s+customer_email:/.test(block)));
  t('the customer id is looked up before the session is built', worker.slice(0, start).includes('stripe_customer_id FROM entitlements WHERE user_id'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
