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

/**
 * Where the API lives, and how this client proves who it is.
 *
 * On the web both answers are trivial: same origin, HttpOnly cookie, done.
 *
 * Inside the packaged app neither is. Capacitor serves the bundle from
 * `https://localhost`, so a relative `/api/me` resolves to a file that is not
 * there — the request does not fail loudly, it 404s and the client concludes
 * "signed out", which is precisely the silent-logout bug this codebase has
 * already been bitten by once on the web. And once the URL is absolute the
 * request is cross-origin, where a SameSite=Lax cookie is not sent at all.
 *
 * So the native build gets an absolute base and a bearer token. The token is
 * the same signed session string the cookie carries; the Worker accepts either.
 * The web build keeps the cookie and never stores a token, because a token in
 * localStorage is readable by any injected script and a cookie is not — the
 * app takes that trade only because on a device there is no alternative, and
 * there is no third-party script in the bundle to do the injecting.
 *
 * `window.__UA_API__` is stamped in by native/prepare.mjs. Absent on the web,
 * which is what makes the web path byte-identical to what it was.
 */
const API = (typeof window !== 'undefined' && window.__UA_API__) || '';
const NATIVE = API !== '';
const TOKEN_KEY = 'ua_session_token';

const readToken = () => {
  if (!NATIVE) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const writeToken = (t) => {
  if (!NATIVE) return;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Storage refused. The session lasts this launch only, which is a bad
       session and not a broken app. */
  }
};

/** Auth headers for the current surface: nothing on web, bearer on device. */
export function authHeaders() {
  const t = readToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

export { NATIVE as IS_NATIVE, writeToken as setSessionToken };

/** Cookie on the web, bearer token on device. Never both. */
async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    credentials: NATIVE ? 'omit' : 'same-origin',
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
  /* `client: 'native'` asks the Worker to put the session in the body as well
     as the Set-Cookie header. Only the app sends it, so the web response is
     unchanged and no token is ever minted into a browser that does not need
     one. */
  const { ok, status, data } = await post('/auth/verify', {
    email,
    code,
    account_type: accountType,
    ...(NATIVE ? { client: 'native' } : {}),
  });
  if (status === 429) return { ok: false, error: 'too_many_attempts', message: data.message };
  if (!ok) return { ok: false, error: 'invalid_code', message: 'That code is wrong or has expired.' };
  /* On device this is the only copy of the session there will ever be — the
     cookie the Worker also set cannot be replayed cross-origin from a
     WKWebView. Store it before returning, or the user is signed in for exactly
     one function call. */
  if (NATIVE && data.session) writeToken(data.session);
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
    /* `cache: 'no-store'` on the request as well as no-store on the response.
       Belt and braces, and both are load-bearing: the response header stops
       Cloudflare's edge keeping a copy, and this stops the BROWSER reusing one
       it already has — which it will, because a Worker deployed without the
       header cached a `signed_in: false` answer that then outlived the fix.
       An authentication check is the one request in a product that must never
       be answered from a cache at any layer. */
    const res = await fetch(`${API}/api/me`, {
      credentials: NATIVE ? 'omit' : 'same-origin',
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) return { signedIn: false, entitled: false };
    const data = await res.json();
    /* Read the shape the Worker actually sends. This used to look for
       `data.user`, which /api/me has never returned — so `signedIn` was false
       for everybody, including people holding a perfectly valid session
       cookie. Nothing errored; the account page simply kept showing the
       sign-in form after a successful sign-in, which is indistinguishable from
       "sign-in does not work" and was reported as exactly that. */
    return {
      signedIn: !!data.signed_in,
      admin: !!data.admin,
      user: data.signed_in ? { email: data.email ?? null } : null,
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
  writeToken(null);
  await fetch(`${API}/auth/signout`, {
    credentials: NATIVE ? 'omit' : 'same-origin',
    headers: authHeaders(),
  });
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
