/**
 * Trust labels for programme pages — company and household alike.
 *
 * Two small, honest facts belong beside every record: when it was last
 * verified, and where it came from. `last_verified_at` used to be treated as
 * a single corpus-wide date (see the long comment in src/build.mjs next to
 * `provVerified`) because every record shared one value — but re-verification
 * now lands a few records at a time, so the field has started telling the
 * truth per record, and it is worth surfacing again.
 *
 * `source_url` ranges from a specific programme page to a bare funder
 * homepage. Printing the raw URL either way reads as equally authoritative,
 * which is not true: a homepage means our own crawl could not find the
 * programme's own page, and a reader following it will land somewhere that
 * does not mention the programme at all. `sourceTrust` tells those apart so
 * the copy can say so, instead of implying a link is more specific than it
 * is.
 */

/* One-segment paths that are landing or section pages rather than a
   programme's own page. The spec's literal rule ("root or any one segment")
   was too blunt: gov.uk, servicesaustralia.gov.au and many others publish
   every programme at a single-segment slug (/winter-fuel-payment,
   /jobseeker-payment), and labelling those "the programme page was not
   found" would be false on hundreds of records. So a single segment counts
   as a homepage only when it is a locale code, an index file, or a generic
   section name. */
const GENERIC_SEGMENTS = new Set([
  'home', 'index', 'start', 'accueil', 'inicio', 'portada', 'startseite',
  'funding', 'fundings', 'grants', 'grant', 'programs', 'programmes', 'programme', 'program',
  'support', 'apply', 'startups', 'startup', 'subsidies', 'subsidy', 'business', 'businesses',
  'unternehmen', 'foerderungen', 'foerderung', 'förderung', 'förderungen', 'aides', 'aide',
  'financement', 'financements', 'ayudas', 'subvenciones', 'incentivi', 'bandi', 'finanziamenti',
  'services', 'opportunities', 'challenges', 'prizes', 'calls', 'news', 'about',
]);

function isGenericSegment(seg) {
  const s = decodeURIComponent(seg).toLowerCase().replace(/\.(html?|php|aspx?|jsp)$/, '').replace(/_[a-z]{2}$/, '');
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(s)) return true; // /en, /de, /en-gb
  return GENERIC_SEGMENTS.has(s);
}

/**
 * Classify a source URL as a specific page or a bare homepage.
 *
 * Root path: homepage. One segment: homepage only when that segment is
 * generic (see above). Two or more segments: a specific page.
 */
export function sourceTrust(sourceUrl) {
  const raw = String(sourceUrl || '');
  try {
    const u = new URL(raw);
    const segments = u.pathname.split('/').filter(Boolean);
    const homepage = segments.length === 0 || (segments.length === 1 && isGenericSegment(segments[0]));
    return { homepage, host: u.host };
  } catch {
    // Not a parseable absolute URL — treat conservatively as a homepage-grade
    // source rather than claim a host we cannot confirm.
    return { homepage: true, host: raw };
  }
}
