/**
 * The query string a shared result link should carry over.
 *
 * Both check flows (the household wizard in src/app.js, the company one in
 * src/pwa/startup-check.js) build their "copy a link to these results" URL as
 * `${origin}${pathname}#r=<answers>` — the campaign that sent someone here in
 * the first place was dropped the moment they generated their own link, so a
 * founder who arrived from a newsletter and shared their result with a
 * co-founder attributed that second visit, and every visit after it, to
 * nothing. Only utm_* is ours to carry: gclid/fbclid and the like are ad
 * platforms' own click ids, not campaign labels, and copying them onto a link
 * two people now share double-counts a single click as two.
 *
 * Exported as a function of the query string it reads (defaulting to the
 * page's own) so a test can call it without a DOM.
 */
export function utmQuery(search) {
  const src = search ?? (typeof location !== 'undefined' ? location.search : '');
  let parsed;
  try {
    parsed = new URLSearchParams(src);
  } catch {
    return '';
  }
  const kept = new URLSearchParams();
  for (const [k, v] of parsed) {
    if (/^utm_[a-z_]+$/i.test(k)) kept.set(k, v);
  }
  const s = kept.toString();
  return s ? `?${s}` : '';
}
