/**
 * UNCLAIMED GRANTS — sign-in and entitlement.
 *
 * Email plus a six-digit code. No passwords anywhere in the product: there is
 * nothing to leak, nothing to reset, and nothing a user can reuse from a site
 * that has already been breached.
 *
 * Why a code rather than a link: a magic link has to survive mail clients that
 * follow URLs to scan them, which burns a single-use token before the human
 * ever clicks, and it opens in whatever browser the mail app prefers rather
 * than the tab that is waiting for the session. A code typed back into the
 * open tab has neither problem.
 *
 * The session itself is an HttpOnly cookie set by the Worker. This module
 * never sees it and could not read it if it tried — which is the point, since
 * a token JavaScript can read is a token any injected script can steal.
 */

import { track } from '../beacon.js';

const API = '';

/** Every call carries the session cookie; none of them carry a token. */
async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Ask for a code. `accountType` splits individuals from company accounts. */
export async function requestCode(email, accountType = 'individual') {
  const { ok, status, data } = await post('/auth/request', { email, account_type: accountType });
  if (status === 429) return { ok: false, error: 'rate_limited', message: data.message };

  /* 404/405 means the static site is being served without the Worker behind
     it — the API route does not exist, so the request fell through to the
     asset handler. That is a deployment state, not a user error, and telling
     someone "could not send the code" would have them retyping their address
     at a wall. Name it instead. */
  if (status === 404 || status === 405) {
    return {
      ok: false,
      error: 'api_not_deployed',
      message: 'Accounts are not switched on yet — the sign-in service is still being deployed. Everything else on the site works.',
    };
  }

  if (!ok) return { ok: false, error: data.error ?? 'failed', message: data.message ?? 'Could not send the code.' };
  return { ok: true, sent: data.sent, devCode: data.dev_code ?? null, expiresIn: data.expires_in };
}

/**
 * Exchange the code for a session.
 *
 * Deliberately does not distinguish "wrong code" from "no such account" in
 * anything it shows the user — for a benefits product, whether an address has
 * an account is itself sensitive, and a form that answers that question is a
 * membership oracle anyone can query.
 */
export async function verifyCode(email, code, accountType = 'individual') {
  const { ok, status, data } = await post('/auth/verify', { email, code, account_type: accountType });
  if (status === 429) return { ok: false, error: 'too_many_attempts', message: data.message };
  if (!ok) return { ok: false, error: 'invalid_code', message: 'That code is wrong or has expired.' };
  return { ok: true, user: data.user };
}

/**
 * Who am I, and may I see paid content.
 *
 * Never cached beyond the current view. A user who has just paid must not be
 * shown the wall because a stale entitlement is sitting in memory, and that is
 * a far worse failure than one extra request.
 */
export async function me() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return { signedIn: false, entitled: false };
    const data = await res.json();
    return {
      signedIn: !!data.user,
      user: data.user ?? null,
      entitled: !!data.entitlement?.entitled,
      plan: data.entitlement?.plan ?? null,
      reason: data.entitlement?.reason ?? null,
    };
  } catch {
    /* Offline. Assume signed out rather than assume entitled — guessing
       generously here would hand the paid list to anyone who pulls their
       network cable at the right moment. */
    return { signedIn: false, entitled: false, offline: true };
  }
}

export async function signOut() {
  await fetch('/auth/signout', { credentials: 'same-origin' });
}

/**
 * The gated result.
 *
 * The total is computed on device so the free answer works offline; THIS is
 * the call that returns which programmes, and the server decides whether to
 * include them. The client never has the list and then hides it — a paywall
 * you can defeat with devtools is a suggestion.
 */
export async function fetchMatch(profile) {
  const { ok, data, status } = await post('/api/check', profile);
  if (!ok) return { ok: false, status, error: data.error ?? 'failed' };
  return { ok: true, ...data };
}

export async function startCheckout(plan = 'personal_annual', seats = 1) {
  track('checkout_start');
  const { ok, data } = await post('/api/billing/checkout', { plan, seats });
  if (!ok) return { ok: false, error: data.error, message: data.message };
  return { ok: true, url: data.url };
}
