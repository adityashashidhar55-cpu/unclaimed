/**
 * /startups/feed.xml and /startups/{cc}/feed.xml — Atom feeds of company
 * grant programmes, sorted by last_verified_at (most recently checked
 * first), then by closes_at for programmes verified on the same date.
 *
 * Atom (RFC 4287) rather than RSS 2.0: it has a real required <updated>
 * per entry, a stable <id> requirement, and no ambiguity about encoding —
 * exactly the fields this feed already has (last_verified_at, slug) and
 * exactly the ambiguity a hand-rolled RSS pubDate would reintroduce.
 *
 * Kept in its own file per the multi-builder convention (see
 * src/pages/closing-soon.mjs, which this borrows its programme-URL and XML
 * escaping conventions from). build.mjs only imports and calls in.
 */
import { effectiveStatus } from '../../packages/deadlines/index.js';

const escXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const progUrl = (origin, p) => `${origin}/startups/${p.country_code}/${p.slug}/`;

/** RFC 3339 — required for Atom <updated>/<published>. A bare date gets
 *  midnight UTC, which is honest: these dates are day-precision in the data. */
function rfc3339(dateStr) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function entryXml(origin, p, asOf) {
  const updated = rfc3339(p.last_verified_at) || rfc3339(p.closes_at) || new Date(asOf).toISOString();
  const url = progUrl(origin, p);
  const amt =
    p.amount_max != null || p.amount_min != null
      ? `${p.amount_currency || ''} ${p.amount_max ?? p.amount_min}`.trim()
      : 'amount not published';
  const summary = [
    p.funder ? `Funder: ${p.funder}.` : '',
    `Status: ${effectiveStatus(p, asOf)}.`,
    `Amount: ${amt}.`,
    p.closes_at ? `Closes: ${String(p.closes_at).slice(0, 10)}.` : '',
    p.last_verified_at ? `Last verified: ${p.last_verified_at}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `  <entry>
    <id>${escXml(url)}</id>
    <title>${escXml(p.name_en)}</title>
    <link href="${escXml(url)}"/>
    <updated>${updated}</updated>
    <summary>${escXml(summary)}</summary>
  </entry>`;
}

function feedXml({ origin, siteUrl, selfUrl, title, subtitle, programmes, asOf }) {
  const sorted = programmes
    .slice()
    .sort((a, b) => {
      const av = a.last_verified_at || '';
      const bv = b.last_verified_at || '';
      if (av !== bv) return bv.localeCompare(av); // most recently verified first
      const ac = a.closes_at ? Date.parse(a.closes_at) : Infinity;
      const bc = b.closes_at ? Date.parse(b.closes_at) : Infinity;
      return ac - bc;
    })
    .slice(0, 200); // a feed reader's reasonable limit; the JSON API has the rest

  const feedUpdated =
    sorted.length && sorted[0].last_verified_at ? rfc3339(sorted[0].last_verified_at) : new Date(asOf).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escXml(title)}</title>
  <subtitle>${escXml(subtitle)}</subtitle>
  <link href="${escXml(selfUrl)}" rel="self"/>
  <link href="${escXml(siteUrl)}"/>
  <id>${escXml(selfUrl)}</id>
  <updated>${feedUpdated}</updated>
  <author><name>Unclaimed</name><uri>${escXml(origin)}/</uri></author>
${sorted.map((p) => entryXml(origin, p, asOf)).join('\n')}
</feed>
`;
}

/** Writes the global feed and one per jurisdiction. */
export function buildStartupFeeds({ STARTUP_MANIFEST, STARTUP_DATA, SITE_URL, ORIGIN, write, BUILD_NOW = Date.now() }) {
  const allProgrammes = STARTUP_MANIFEST.countries.flatMap((c) => STARTUP_DATA[c.slug].programmes);

  write(
    'startups/feed.xml',
    feedXml({
      origin: ORIGIN,
      siteUrl: `${SITE_URL}/startups/`,
      selfUrl: `${SITE_URL}/startups/feed.xml`,
      title: 'Unclaimed — company and startup grants',
      subtitle: 'Recently verified company grant and funding programmes, across every jurisdiction, most recently checked first.',
      programmes: allProgrammes,
      asOf: BUILD_NOW,
    }),
  );

  for (const c of STARTUP_MANIFEST.countries) {
    write(
      `startups/${c.slug}/feed.xml`,
      feedXml({
        origin: ORIGIN,
        siteUrl: `${SITE_URL}/startups/${c.slug}/`,
        selfUrl: `${SITE_URL}/startups/${c.slug}/feed.xml`,
        title: `Unclaimed — company grants in ${c.name}`,
        subtitle: `Recently verified company grant and funding programmes in ${c.name}, most recently checked first.`,
        programmes: STARTUP_DATA[c.slug].programmes,
        asOf: BUILD_NOW,
      }),
    );
  }
}
