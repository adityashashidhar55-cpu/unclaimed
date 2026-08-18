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
export function planLabel(key) {
  if (!key) return 'Your subscription';
  const known = PLANS[key];
  if (known) return known.label;
  return String(key)
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

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
    /* Not an error — the expected path for most first-time buyers. */
    toSignIn(plan);
    return { ok: true, redirected: 'signin' };
  }
  if (who.entitled) {
    /* Already paying. Sending them to Stripe again would sell a second
       subscription to the same person, which is a refund request wearing a
       success message. */
    fail('You already have an active plan.');
    return { ok: false, error: 'already_entitled' };
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
