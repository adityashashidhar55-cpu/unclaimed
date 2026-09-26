/**
 * /startups/de-minimis/ — the EU de minimis headroom calculator.
 *
 * English-only, like the rest of /startups/**: this is a legal-mechanics page
 * for founders, not prose that benefits from translation the way a benefit
 * description does. All arithmetic runs in the browser, importing
 * ../../packages/stateaid/index.js — the same module the paid workspace and
 * the eligibility engine use — so the free calculator and the figures quoted
 * elsewhere on the site cannot disagree. Nothing a founder types here is sent
 * to a server; see docs/state-aid.md for the citations behind every ceiling.
 *
 * Kept out of src/build.mjs itself: this file only needs esc/attr/layout from
 * ui.mjs and the constants from packages/stateaid, so it can be generated and
 * linked with a two-line hook in build.mjs rather than growing that file.
 */
import { esc, layout } from '../ui.mjs';
import {
  DE_MINIMIS_CEILING_EUR,
  SGEI_CEILING_EUR,
  AGRICULTURE_CEILING_EUR,
  FISHERIES_CEILING_EUR,
  FISHERIES_CEILING_HIGHER_EUR,
  REGULATION,
} from '../../packages/stateaid/index.js';

/**
 * The 27 EU Member States, by the ISO-3166 alpha-2 codes this dataset uses.
 * De minimis is an EU state-aid regime — it does not reach EEA-only Norway
 * or Iceland, or non-EU Switzerland and the UK, even though those four are in
 * our `startups` country set for unrelated reasons. Getting this list wrong
 * would offer a headroom number for a country the Regulation does not cover.
 */
export const EU_MEMBER_STATES = Object.freeze([
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu',
  'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se',
]);

const nf = (n) => new Intl.NumberFormat('en').format(n);
const money = (n) => `€${nf(n)}`;

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

/**
 * The per-country programme list the calculator cross-references headroom
 * against, serialised once at build time. Kept intentionally small — name,
 * slug, funder, amount, country — so the inline JSON stays a few KB even
 * across all 27 Member States, not a re-export of the full dataset.
 */
function deMinimisProgrammesByCountry(startupManifest, startupData) {
  const out = {};
  for (const c of startupManifest.countries) {
    if (!EU_MEMBER_STATES.includes(c.slug)) continue;
    const rows = (startupData[c.slug]?.programmes || [])
      .filter((p) => p.eligibility?.de_minimis)
      .map((p) => ({
        slug: p.slug,
        name: p.name_en,
        funder: p.funder,
        amount_max: p.amount_max ?? null,
        amount_min: p.amount_min ?? null,
        sgei: !!p.eligibility?.sgei,
      }));
    if (rows.length) out[c.slug] = rows;
  }
  return out;
}

export function renderDeMinimisPage({ BASE, LB, SB, TR, L, ALT, SITE_URL, STARTUP_MANIFEST, STARTUP_DATA }) {
  const byCountry = deMinimisProgrammesByCountry(STARTUP_MANIFEST, STARTUP_DATA);
  const countryOptions = STARTUP_MANIFEST.countries
    .filter((c) => EU_MEMBER_STATES.includes(c.slug))
    .sort((a, b) => a.name.localeCompare(b.name));
  const countryMeta = Object.fromEntries(countryOptions.map((c) => [c.slug, { name: c.name, flag: c.flag }]));

  const dataPayload = JSON.stringify({
    programmes: byCountry,
    countries: countryMeta,
    ceilings: {
      general: DE_MINIMIS_CEILING_EUR,
      sgei: SGEI_CEILING_EUR,
      agriculture: AGRICULTURE_CEILING_EUR,
      fisheries: FISHERIES_CEILING_EUR,
      fisheries_higher: FISHERIES_CEILING_HIGHER_EUR,
    },
  }).replace(/</g, '\\u003c');

  const ceilingRows = [
    ['General de minimis', REGULATION.general.id, REGULATION.general.article, money(DE_MINIMIS_CEILING_EUR), 'any 3 years, rolling'],
    ['SGEI de minimis', REGULATION.sgei.id, REGULATION.sgei.article, money(SGEI_CEILING_EUR), 'any 3 years, rolling'],
    ['Agriculture (primary production)', REGULATION.agriculture.id, REGULATION.agriculture.article, money(AGRICULTURE_CEILING_EUR), 'any 3 years, rolling'],
    ['Fishery & aquaculture', REGULATION.fisheries.id, `${REGULATION.fisheries.article}`, `${money(FISHERIES_CEILING_EUR)} (up to ${money(FISHERIES_CEILING_HIGHER_EUR)} where the Member State runs a central register)`, '3 fiscal years'],
  ];

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([
    { label: TR('backHome'), href: `${LB()}/` },
    { label: 'Startup grants', href: `${SB()}/startups/` },
    { label: 'De minimis headroom' },
  ])}
  <span class="eyebrow eyebrow-accent">For EU founders</span>
  <h1 style="max-width:22ch">How much de minimis aid headroom does your company have left?</h1>
  <p class="lede" style="max-width:60ch">Small public grants and tax breaks across the EU are capped per company,
  per Member State, over a rolling three-year window. Enter what you have already taken and this runs the same
  arithmetic our matching engine does — in your browser, sent nowhere — to show what is left, and on what future
  date more of it frees up.</p>

  <div class="callout" style="margin-top:1.4rem">
    <p><strong>Not legal advice.</strong> This is a calculator, not a ruling. The granting authority's own
    declaration and assessment govern whether a specific award is de minimis and whether it fits your headroom —
    use this to check your own arithmetic before you apply, not instead of the authority's process.</p>
  </div>

  <div class="card" id="deminimis-app" style="margin-top:2rem" data-payload="deminimis-data">
    <noscript><p><strong>This calculator needs JavaScript</strong> — the arithmetic runs in your browser so your
    figures are never sent to a server. Without it, read the ceilings below and the explainer under them.</p></noscript>
  </div>
  <script type="application/json" id="deminimis-data">${dataPayload}</script>
  <script type="module" src="${BASE}/de-minimis.js"></script>

  <h2 style="margin-top:3rem">The four ceilings</h2>
  <p class="small" style="max-width:64ch">Four EU regulations set de minimis ceilings. Each has its own limit, but
  they are not fully separate pots: under Article 5(2) of Regulation (EU) 2023/2831, general, agriculture and
  fishery de minimis aid together may not exceed the general ${money(DE_MINIMIS_CEILING_EUR)} — the calculator
  applies that combined cap. Figures verified against the EUR-Lex text of each regulation; sources are linked
  at the end of this page.</p>
  <p class="tiny" style="max-width:64ch">Simplifications: the calculator treats SGEI de minimis as its own
  ${money(SGEI_CEILING_EUR)} pot and does not model how agriculture and fishery aid cumulate with each other
  for a company active in both. If either applies to you, ask the granting authority how it counts your
  existing awards.</p>
  <div style="overflow-x:auto;margin-top:1rem">
    <table class="rule-table">
      <thead><tr><th>Aid type</th><th>Regulation</th><th>Article</th><th>Ceiling</th><th>Window</th></tr></thead>
      <tbody>
        ${ceilingRows.map(([label, reg, art, ceiling, window]) => `<tr>
          <td>${esc(label)}</td><td>${esc(reg)}</td><td>${esc(art)}</td><td>${ceiling}</td><td>${esc(window)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <p class="tiny" style="margin-top:.6rem">Road freight transport has <strong>no</strong> separate sub-ceiling under
  the current general Regulation (EU) 2023/2831 — that EUR 100,000 figure existed only in the predecessor
  Regulation (EU) No 1407/2013, which expired 31 December 2023. Road freight operators are on the standard
  ${money(DE_MINIMIS_CEILING_EUR)}.</p>

  <h2 style="margin-top:3rem">What is de minimis aid?</h2>
  <p style="max-width:64ch">"De minimis" aid is public support small enough that the EU treats it as incapable of
  distorting competition between Member States, so it can be granted without the European Commission's prior
  notification and approval that larger State aid requires. It still counts as State aid in every other sense —
  it is public money given selectively to an undertaking — it is simply exempted from the notification procedure
  under Commission Regulation (EU) 2023/2831 (and the sector-specific regulations above), provided the total a
  single company receives per Member State stays under the ceiling over the relevant window.</p>
  <p style="max-width:64ch">The exemption is not automatic paperwork-free money: <strong>Article 3(7)</strong> of
  Regulation 2023/2831 says that if a new award would push a company over its ceiling, that whole new award falls
  outside the Regulation — it is not trimmed down to whatever headroom remains. A founder who signs for a grant
  without checking their running total first can end up owing the money back.</p>

  <h2 style="margin-top:2.5rem">How the three-year rolling period works</h2>
  <p style="max-width:64ch"><strong>Recital 11</strong> of Regulation (EU) 2023/2831 is explicit that the period
  "should be assessed on a rolling basis": every time a new award is considered, the granting authority looks back
  at the exact 36 months before it, not at fixed calendar or fiscal years. That replaced the predecessor
  Regulation (EU) No 1407/2013's fiscal-year approach, and the two give materially different answers near a
  year boundary — this calculator uses the current, rolling rule.</p>
  <ul style="max-width:64ch">
    <li><strong>The clock starts at the grant date, not the payment date.</strong> Article 3(3): aid is "deemed
    granted at the moment that the legal right to receive the aid is conferred… irrespective of the date of
    payment." A grant agreement signed in December counts from December, even if the cash lands months later.</li>
    <li><strong>The ceiling is per Member State.</strong> Aid from France and aid from Germany draw on two
    separate pots for the same company — a multi-country group tracks each one independently.</li>
    <li><strong>Old awards drop out one at a time.</strong> As each award passes its own 36-month mark it stops
    counting, which is why the same company can be over the ceiling today and clear again in a few months without
    taking any new action — the calculator above shows that date.</li>
    <li><strong>Fishery and aquaculture aid is the one exception.</strong> Regulation (EU) No 717/2014 (as amended)
    counts "three fiscal years", not a rolling 36-month window. This calculator approximates it on the same rolling
    basis as the other three regimes for a single running total — treat the date it shows as indicative and confirm
    against your actual fiscal year with the granting authority.</li>
  </ul>

  <p class="small" style="margin-top:2rem">Sources: <a href="https://eur-lex.europa.eu/eli/reg/2023/2831" rel="nofollow noopener">Regulation (EU) 2023/2831</a>
  · <a href="https://eur-lex.europa.eu/eli/reg/2023/2832" rel="nofollow noopener">Regulation (EU) 2023/2832 (SGEI)</a>
  · <a href="https://eur-lex.europa.eu/eli/reg/2013/1408" rel="nofollow noopener">Regulation (EU) No 1408/2013 (agriculture, as amended)</a>
  · <a href="https://eur-lex.europa.eu/eli/reg/2014/717" rel="nofollow noopener">Regulation (EU) No 717/2014 (fisheries, as amended)</a></p>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${SB()}/startups/check/">Check what your company qualifies for</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'EU de minimis aid headroom calculator',
    description: 'Work out how much EU de minimis state-aid headroom your company has left in a Member State, and on what date more of it frees up. Runs in your browser; nothing is sent to a server.',
    canonical: `${SITE_URL}/startups/de-minimis/`,
    audience: 'biz',
    body,
  });
}
