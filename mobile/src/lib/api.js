/**
 * Unclaimed mobile — API client.
 *
 * The paywall is enforced on the server, so this client never decides what a
 * user may see; it just renders what comes back. Session is a signed cookie
 * held in SecureStore and replayed manually, because React Native's fetch does
 * not persist cookies reliably across platforms.
 */
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const ORIGIN = Constants.expoConfig?.extra?.apiOrigin ?? 'https://unclaimed.app';
const SESSION_KEY = 'ua_session';

export async function getSession() {
  return SecureStore.getItemAsync(SESSION_KEY);
}
export async function setSession(v) {
  return v ? SecureStore.setItemAsync(SESSION_KEY, v) : SecureStore.deleteItemAsync(SESSION_KEY);
}

async function call(path, { method = 'GET', body } = {}) {
  const session = await getSession();
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session ? { cookie: `ua_session=${session}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) throw Object.assign(new Error(data.error || 'request failed'), { status: res.status, data });
  return { status: res.status, data };
}

/** Free: the money figure and the shape. No scheme names come back unentitled. */
export const check = (profile) => call('/api/check', { method: 'POST', body: profile });

/** Paid: prepared application packages. */
export const applyPlan = (profile, lang) => call('/api/apply/plan', { method: 'POST', body: { profile, lang } });

/** Written before any package is handed over. */
export const recordConsent = (payload) => call('/api/apply/consent', { method: 'POST', body: payload });

export const me = (country) => call(`/api/me?country=${country ?? ''}`);
export const saveProfile = (profile) => call('/api/profile', { method: 'POST', body: profile });
export const loadProfile = () => call('/api/profile');
export const requestLink = (email) => call('/auth/request', { method: 'POST', body: { email } });

/**
 * Subscriptions are sold on the web, not in-app.
 *
 * Outside the US, Apple still requires IAP for in-app unlocks and forbids
 * link-outs — but a user who subscribed on the web may sign in and use paid
 * content, which Apple permits under the multiplatform allowance. That keeps
 * 100% of revenue and stays clear of the Epic/Apple commission litigation.
 * If you later add StoreKit, gate it behind this one function.
 */
export const billingOrigin = ORIGIN;
