/**
 * The road from "this is locked" to "here is Stripe".
 *
 * The Worker has had a working `/api/billing/checkout` since the day billing
 * landed, and for that whole time nothing in the interface called it. Every
 * paywall in the product ended at a link to `/account/`, and `/account/`
 * offered a sign-in form and, once you were through it, two buttons: go to
 * your check, and sign out. A signed-in free user could not reach checkout at
 * all — not from pricing, not from the locked results, not from their own
 * account page. The only way to pay was to POST to the endpoint by hand.
 *
 * So this module is the missing wire, and it lives in one file because the
 * same three questions come up on all three screens:
 *
 *   1. Is this person signed in? Checkout needs a user id, so a signed-out
 *      click has to go through sign-in first and come back — not dump them on
 *      a sign-in page and forget why they were there.
 *   2. Which plan? Named by the markup, never by the client's own arithmetic.
 *      The Worker picks the price id from a fixed table keyed by plan name; a
 *      client that can name a price is a client that can name a cheaper one.
 *   3. What do we say when it fails? Anything except nothing. A dead button is
 *      how this bug survived as long as it did.
 */

import { startCheckout, me } from './auth.js';
import { track } from '../beacon.js';

/** Plan keys the Worker accepts. Kept here so a typo in markup fails loudly. */
export const PLANS = {
  personal_monthly: { label: 'Personal, monthly', price: '€7 a month' },
  personal_annual: { label: 'Personal, annual', price: '€50 a year' },
  business_monthly: { label: 'Business, monthly', price: '€49 per seat a month' },
  business_annual: { label: 'Business, annual', price: '€490 per seat a year' },
};

/**
 * What to call a plan in front of a human.
 *
 * The account page used to print the raw column value — `'Your ' + plan + '
 * is active'` — and the webhook stored the literal string `monthly` for
 * everybody, so an annual subscriber was told "Your monthly is active". Both
 * halves of that are fixed; this is the half that makes the sentence read
 * like English even for a plan key this build has never heard of.
 */
export function planLabel(key, tr = {}) {
  if (!key) return tr.planNone || 'Your subscription';
  const known = tr[key] || PLANS[key]?.label;
  if (known) return known;
  return String(key)
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * What the account page should say and offer, for one entitlement answer.
 *
 * The page used to have two states: entitled, and everything else. Everything
 * else is where a failed card payment lives. A subscriber whose renewal
 * bounced was told "Free account. You can see your total" and shown a
 * Subscribe button — so the fix for a declined card was to buy a second
 * subscription, and the first one stayed broken. `past_due` and `canceled`
 * need the billing portal, not the checkout.
 *
 * `reason` comes straight from the Worker's entitlementFor().
 */
export function accountState({ entitled, reason, plan, accountType } = {}, tr = {}) {
  /* The strings arrive from the page, which knows the locale; these are the
     fallbacks for callers that do not pass any (the tests, and the packaged
     app, which ships English only). Building the sentence here and localising
     it there was the alternative, and it puts the state machine in two
     places. */
  const T = {
    active: 'active. Every programme you match is unlocked.',
    free: 'Free account. You can see your total; unlock to see which programmes it comes from.',
    pastDue: 'the last payment failed. Update your card to keep your programmes unlocked.',
    lapsed: 'ended. Your saved work is still here; resubscribe to see programme names again.',
    admin: 'Operator session — everything is unlocked.',
    freeHere: 'Free where you are. Your country regulates this as advice, so we do not charge for it.',
    ...tr,
  };
  /* Plan names are localised too. "Personal, annual" in the middle of a German
     sentence is the kind of half-translated screen that makes a product look
     unfinished in exactly the market you are demoing to. */
  const label = (k) => planLabel(k, tr);
  const business = accountType === 'business';
  const plans = business
    ? { annual: 'business_annual', monthly: 'business_monthly' }
    : { annual: 'personal_annual', monthly: 'personal_monthly' };

  if (reason === 'admin') {
    return { kind: 'admin', line: T.admin, action: 'none', plans };
  }
  if (reason === 'free_in_jurisdiction') {
    return {
      kind: 'free_here',
      line: T.freeHere,
      action: 'none',
      plans,
    };
  }
  if (reason === 'past_due') {
    return {
      kind: 'past_due',
      line: `${label(plan)} — ${T.pastDue}`,
      action: 'portal',
      plans,
    };
  }
  if (reason === 'canceled' || reason === 'expired' || reason === 'unpaid' || reason === 'incomplete_expired') {
    return {
      kind: 'lapsed',
      line: `${label(plan)} — ${T.lapsed}`,
      action: 'both',
      plans,
    };
  }
  if (entitled) {
    return {
      kind: 'active',
      line: `${label(plan)} — ${T.active}`,
      action: 'portal',
      plans,
    };
  }
  return {
    kind: 'free',
    line: T.free,
    action: 'subscribe',
    plans,
  };
}

/**
 * 'auto' means "the annual plan for whichever door they signed in by", and it
 * is resolved by the WORKER, not here.
 *
 * The locked panels cannot know the account type when they render — the
 * results page is built long before we know who is looking at it — so they ask
 * for 'auto'. Resolving it client-side would work, but the Worker already
 * holds the session and therefore the only authoritative answer; doing it
 * there means one rule instead of one rule per caller. Anything else is passed
 * through untouched: a button that says Business buys Business.
 */

/** Where to come back to after a detour through sign-in. */
const returnHere = () => location.pathname + location.search;

/**
 * Send a signed-out visitor to sign in, carrying their intent with them.
 *
 * `next` is a path on this origin and is validated as one on the way back in —
 * an open redirect that starts with "sign in here" is a phishing kit.
 */
function toSignIn(plan) {
  const q = new URLSearchParams({ next: returnHere() });
  if (plan) q.set('plan', plan);
  location.href = '/account/?' + q.toString();
}

/**
 * Start checkout for `plan`, or route through sign-in first.
 *
 * `btn` is optional and only used to say something while the round trip is in
 * flight; the caller may pass any element with textContent.
 */
export async function upgrade(plan = 'personal_annual', { btn = null, seats = 1, onError = null } = {}) {
  const label = btn?.textContent;
  const fail = (m) => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
    if (onError) onError(m);
    else if (btn) btn.textContent = m;
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
  }

  const who = await me();
  if (!who.signedIn) {
    /* Keep 'auto' as 'auto' across sign-in — which plan it means depends on
       the account they are about to sign into, which we do not know yet. */
    /* Not an error — the expected path for most first-time buyers. */
    toSignIn(plan);
    return { ok: true, redirected: 'signin' };
  }
  if (who.entitled) {
    /* Already paying — but "already have a plan" was a dead end. The button
       kept that text forever, there was no route onward, and a Personal
       subscriber who wanted Business simply could not buy it. Changing plan is
       what the billing portal is for, so send them there instead of refusing.
       Selling a second subscription would be a refund request wearing a
       success message; doing nothing is a lost upgrade. */
    if (btn) btn.textContent = 'Opening your billing settings…';
    const moved = await manageBilling(null);
    if (!moved.ok) fail('You already have a plan. Manage or change it from your account page.');
    return { ok: false, error: 'already_entitled', redirected: moved.ok };
  }

  const res = await startCheckout(plan, seats);
  if (!res.ok || !res.url) {
    fail(res.message || 'Could not open checkout — try again.');
    return { ok: false, error: res.error, message: res.message };
  }
  track('checkout_redirect');
  location.href = res.url;
  return { ok: true, redirected: 'stripe' };
}

/**
 * Wait for the webhook to catch up after a payment.
 *
 * Stripe sends the customer back to /account/?welcome=1 the instant the card
 * clears, and tells US separately over a webhook that may land a second or two
 * later. The page used to render whatever /api/me said at that moment — which,
 * for the person who just paid, is often still "Free account" — and then ask
 * them to reload. Poll instead; it is the same wait, without the instruction.
 */
export async function awaitEntitlement({ tries = 8, gapMs = 1500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const who = await me();
    if (who.entitled) return who;
    /* Only wait while a payment could still be settling. Signed out means
       something else is wrong and no amount of waiting fixes it. */
    if (!who.signedIn) return who;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return me();
}

/** Open the Stripe billing portal for an existing subscriber. */
export async function manageBilling(btn = null) {
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening…';
  }
  try {
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      location.href = data.url;
      return { ok: true };
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = data.error === 'no subscription' ? 'No subscription to manage' : label;
    }
    return { ok: false };
  } catch {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
    return { ok: false };
  }
}

/**
 * Wire every `[data-checkout]` on the page, now and after any re-render.
 *
 * Delegated on purpose: three of the four screens that need this rebuild their
 * markup, and a handler bound to an element that no longer exists is the same
 * dead button in a different costume.
 */
export function bindCheckout(root = document) {
  if (root.__ua_checkout_bound) return;
  root.__ua_checkout_bound = true;
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-checkout]');
    if (el) {
      e.preventDefault();
      const plan = el.dataset.plan || el.getAttribute('data-checkout') || 'personal_annual';
      const seats = Number(el.dataset.seats) || 1;
      upgrade(plan, { btn: el, seats });
      return;
    }
    const portal = e.target.closest?.('[data-portal]');
    if (portal) {
      e.preventDefault();
      manageBilling(portal);
    }
  });
}
