/**
 * Funnel beacon.
 *
 * The one piece of analytics on this site. No third party, no fingerprint, no
 * cookie: a random id in sessionStorage that dies with the tab, the name of a
 * step, and nothing else. It exists to answer one question the owner cannot
 * otherwise answer — where people stop — and it is scoped to that question so
 * tightly that there is nothing here a privacy policy has to apologise for.
 *
 * Fails silently and never blocks. If the Worker is not deployed, or the
 * request is blocked, or storage is unavailable in a locked-down browser, the
 * product behaves exactly as it does now.
 */
const KEY = 'ua_vis';

function visitorId() {
  try {
    let v = sessionStorage.getItem(KEY);
    if (!v) {
      v = [...crypto.getRandomValues(new Uint8Array(12))]
        .map((b) => b.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 20);
      sessionStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

/* Each step is worth recording once per visit. Someone who reloads the results
   screen five times is one person who reached the results screen, and counting
   them five times would quietly flatten every drop-off below it. */
const sent = new Set();

export function track(step, extra = {}) {
  if (sent.has(step)) return;
  sent.add(step);

  const visitor = visitorId();
  if (!visitor) return;

  const body = JSON.stringify({
    step,
    visitor,
    locale: document.documentElement.lang || 'en',
    surface: window.Capacitor ? 'native' : location.pathname.startsWith('/app') ? 'pwa' : 'web',
    ...extra,
  });

  try {
    /* sendBeacon survives the page unload that follows most of these steps —
       "clicked through to the funder" is the last thing that happens in this
       tab, and a fetch() started at that moment is cancelled. */
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/event', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* Analytics must never be the reason a page breaks. */
  }
}
