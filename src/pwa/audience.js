/**
 * Who the site is for, on every page.
 *
 * One switch in the hero decides whether a visitor is here for themselves or
 * for a company, and that choice changes the nav, the headline, the pricing,
 * the calls to action and where "check what you're owed" sends them. It is not
 * a tab on one page — a person who says "I'm a company" on the landing page
 * and then finds household benefits in the nav two clicks later has been told
 * the switch does not mean anything.
 *
 * How the choice survives a page load without a flash of the wrong site:
 *
 *   1. A tiny synchronous script in <head> (see boot() below, inlined by
 *      layout()) reads the cookie and sets data-audience on <html> BEFORE the
 *      first paint. CSS does the rest, so the correct version is the only one
 *      ever painted.
 *   2. A cookie rather than localStorage, because localStorage is not readable
 *      by anything server-side and this choice should eventually reach the
 *      Worker. Same reason it is not a query parameter: it should not leak
 *      into shared links or analytics URLs.
 *   3. Both versions ship in the HTML. Search engines index both, the page
 *      works with JavaScript disabled (defaulting to the individual view), and
 *      there is nothing to fetch when you flip the switch.
 */

export const AUDIENCES = ['me', 'biz'];
const COOKIE = 'ua_aud';
const DEFAULT = 'me';

/** The inline <head> script, as source. Kept here so it cannot drift. */
export const BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )ua_aud=(me|biz)/);document.documentElement.setAttribute('data-audience',m?m[1]:'me')}catch(e){document.documentElement.setAttribute('data-audience','me')}})()`;

export function readAudience() {
  const m = document.cookie.match(/(?:^|; )ua_aud=(me|biz)/);
  return m ? m[1] : DEFAULT;
}

export function setAudience(value, { reload = false } = {}) {
  const v = AUDIENCES.includes(value) ? value : DEFAULT;
  /* A year, on the apex so /fr/ and every subdomain agree. Lax rather than
     Strict: arriving from a Google result should not reset who you are. */
  document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.setAttribute('data-audience', v);
  for (const el of document.querySelectorAll('[data-aud-set]')) {
    el.setAttribute('aria-selected', String(el.dataset.audSet === v));
  }
  document.dispatchEvent(new CustomEvent('audiencechange', { detail: v }));
  if (reload) location.reload();
  return v;
}

/**
 * Wire every switch on the page.
 *
 * Any element with data-aud-set="me|biz" becomes a control. There is usually
 * one switch, in the hero, but the pricing page and the footer carry their own
 * and they all have to agree — hence one delegated listener rather than a
 * handler per switch.
 */
export function initAudience() {
  const current = readAudience();
  document.documentElement.setAttribute('data-audience', current);
  for (const el of document.querySelectorAll('[data-aud-set]')) {
    el.setAttribute('aria-selected', String(el.dataset.audSet === current));
  }
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-aud-set]');
    if (!el) return;
    ev.preventDefault();
    /* Keep the switch where the eye already is.
       
       The two panels are genuinely different lengths — measured, the pricing
       page grows 429px when you pick Enterprise — so switching yanks the
       content out from under the pointer and the reader loses their place.
       Nothing can make the panels the same height honestly, but the thing they
       are looking at can stay still: note where the switch sits in the
       viewport, swap, then restore it to the same spot. */
    const box = el.getBoundingClientRect();
    setAudience(el.dataset.audSet);
    requestAnimationFrame(() => {
      const after = el.getBoundingClientRect();
      const drift = after.top - box.top;
      if (Math.abs(drift) > 1) window.scrollBy({ top: drift, behavior: 'instant' });
    });
  });
  /* Keyboard: a tablist should move with the arrow keys, and these are
     <button role="tab">, so nothing gives us that for free. */
  document.addEventListener('keydown', (ev) => {
    const el = ev.target.closest('[data-aud-set]');
    if (!el || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const next = readAudience() === 'me' ? 'biz' : 'me';
    setAudience(next);
    document.querySelector(`[data-aud-set="${next}"]`)?.focus();
  });
}

/** Where "check what you're owed" goes, for whoever is looking. */
export function checkHref(base, linkBase) {
  return readAudience() === 'biz' ? `${base}/startups/check/` : `${linkBase}/check/`;
}
