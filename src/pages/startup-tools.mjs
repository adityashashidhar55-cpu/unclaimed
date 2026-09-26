/**
 * /startups/tools/ — free, client-side calculators for founders (SEO lead
 * magnets, English-only like the rest of /startups/**).
 *
 *   /startups/tools/                 index linking every calculator
 *   /startups/tools/co-funding/      match-funding / grant-intensity calculator
 *   /startups/tools/forschungszulage/ German R&D tax-credit estimator
 *
 * All arithmetic runs in the browser against packages/rdcalc/index.js —
 * nothing a founder types is sent to a server, mirroring de-minimis.mjs.
 * Kept out of src/build.mjs itself for the same reason de-minimis.mjs is:
 * these only need esc/layout from ui.mjs plus the constants in
 * packages/rdcalc, so they can be generated and linked with a few lines in
 * build.mjs rather than growing that file.
 */
import { esc, layout } from '../ui.mjs';
import { COFUNDING_PRESETS, FORSCHUNGSZULAGE_RULES_2026 } from '../../packages/rdcalc/index.js';

const nf = (n) => new Intl.NumberFormat('en').format(n);
const money = (n) => `€${nf(n)}`;

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

function toolsBreadcrumb(SB, extra) {
  const items = [
    { label: 'Startup grants', href: `${SB()}/startups/` },
    { label: 'Free tools', href: `${SB()}/startups/tools/` },
  ];
  if (extra) items.push({ label: extra });
  else items[items.length - 1] = { label: 'Free tools' };
  return items;
}

/* ------------------------------------------------------------------ */
/* /startups/tools/ — index                                            */
/* ------------------------------------------------------------------ */

export function startupToolsIndex({ BASE, LB, SB, TR, L, ALT, SITE_URL }) {
  const tools = [
    {
      href: `${BASE}/startups/tools/co-funding/`,
      title: 'Co-funding / match-funding calculator',
      desc: 'Enter a project cost and a grant intensity — Horizon Europe or EIC Accelerator presets included — and see the grant amount, what you must fund yourself, and the cash you need up front if the grant is paid in arrears.',
    },
    {
      href: `${BASE}/startups/tools/forschungszulage/`,
      title: 'Forschungszulage (German R&D tax credit) estimator',
      desc: 'Estimate your German Forschungszulage from personnel costs, contract research and depreciation, using the exact rates and caps in force from 1 January 2026.',
    },
    {
      href: `${BASE}/startups/de-minimis/`,
      title: 'EU de minimis headroom calculator',
      desc: 'How much de minimis state-aid headroom your company has left in a Member State, and on what date more of it frees up.',
    },
  ];

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, ...toolsBreadcrumb(SB)])}
  <span class="eyebrow eyebrow-accent">For founders</span>
  <h1 style="max-width:20ch">Free calculators for EU and German grant funding</h1>
  <p class="lede" style="max-width:58ch">No sign-up, nothing sent to a server — every number here is computed in
  your browser from the same figures and modules our matching engine uses. Pick one below.</p>

  <div class="grid grid-2" style="margin-top:2rem;gap:1rem">
    ${tools.map((t) => `<a class="card card-link" href="${t.href}">
      <strong>${esc(t.title)}</strong>
      <p class="small" style="margin:.5rem 0 0;color:var(--ink-3)">${esc(t.desc)}</p>
    </a>`).join('')}
  </div>

  <p style="margin-top:2.5rem"><a class="btn btn-primary" href="${SB()}/startups/check/">Check what your company qualifies for</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Free grant calculators for founders',
    description: 'Free, client-side calculators for founders: EU co-funding / match-funding, the German Forschungszulage R&D tax credit, and EU de minimis headroom. Nothing you type is sent to a server.',
    canonical: `${SITE_URL}/startups/tools/`,
    audience: 'biz',
    body,
  });
}

/* ------------------------------------------------------------------ */
/* /startups/tools/co-funding/                                         */
/* ------------------------------------------------------------------ */

export function renderCofundingPage({ BASE, LB, SB, TR, L, ALT, SITE_URL }) {
  const dataPayload = JSON.stringify({ presets: COFUNDING_PRESETS }).replace(/</g, '\\u003c');

  const presetRows = COFUNDING_PRESETS.map((p) => `<tr>
    <td>${esc(p.label)}</td>
    <td>${p.intensityPct}%</td>
    <td class="small">${esc(p.note)}${p.capEur ? ` Cap: ${money(p.capEur)}.` : ''}</td>
  </tr>`).join('');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, ...toolsBreadcrumb(SB, 'Co-funding calculator')])}
  <span class="eyebrow eyebrow-accent">For EU founders</span>
  <h1 style="max-width:24ch">Co-funding / match-funding calculator</h1>
  <p class="lede" style="max-width:60ch">Most EU grants do not cover 100% of a project. Enter your project cost and
  the grant's funding rate ("intensity") — pick a verified preset below or type your own — and this works out the
  grant amount, what you have to fund yourself, and, if the grant reimburses costs already spent (the normal
  pattern), the cash you need to have in hand before any of it comes back. Runs in your browser; nothing is sent
  to a server.</p>

  <div class="callout" style="margin-top:1.4rem">
    <p><strong>Not financial advice, and not every programme's real rules.</strong> Grant intensity, eligible-cost
    definitions and in-kind rules differ by call — always confirm the exact figure in the call text or grant
    agreement before committing spend. The presets below are cited to an official or funder page each; a rate you
    type yourself is only as accurate as the source you typed it from.</p>
  </div>

  <div class="card" id="cofunding-app" style="margin-top:2rem" data-payload="cofunding-data">
    <noscript><p><strong>This calculator needs JavaScript</strong> — the arithmetic runs in your browser so your
    figures are never sent to a server.</p></noscript>
  </div>
  <script type="application/json" id="cofunding-data">${dataPayload}</script>
  <script type="module" src="${BASE}/cofunding.js"></script>

  <h2 style="margin-top:3rem">Verified grant-intensity presets</h2>
  <div style="overflow-x:auto;margin-top:1rem">
    <table class="rule-table">
      <thead><tr><th>Programme</th><th>Intensity</th><th>Notes</th></tr></thead>
      <tbody>${presetRows}</tbody>
    </table>
  </div>

  <h2 style="margin-top:2.5rem">Why "paid in arrears" changes the number that matters</h2>
  <p style="max-width:64ch">Many grants — especially national and regional schemes — reimburse eligible costs the
  beneficiary has already paid, rather than advancing the grant share up front. That means a company claiming a
  70%-intensity reimbursement grant on a €500,000 project does not need €150,000 in cash (its 30% own share) — in
  the months before the first reimbursement lands, it needs closer to the <em>whole</em> €500,000, because the
  funder has not sent anything yet.</p>
  <p style="max-width:64ch">Horizon Europe works differently: it pays a pre-financing instalment within 30 days of
  the grant agreement entering into force (or 10 days before the start date, whichever is later), typically sized
  to one reporting period's needs, minus a 5–8% retention for the Mutual Insurance Mechanism; interim payments
  follow within 90 days of each periodic report
  (<a href="https://www.ffg.at/en/europe/heu/legal-financial/theme_grant-payments" rel="nofollow noopener">FFG — Grant
  payments in Horizon Europe</a>). For a pre-financed grant, untick "paid in arrears" to see your own cash share —
  and still plan for the gap between reporting periods. Always check the payment clause of your grant agreement.</p>
  <p class="small" style="max-width:64ch">In-kind contributions (donated staff time, equipment already owned,
  free premises) are not a cash outlay either way, so this tool excludes them from the cash-needed figure
  regardless of the arrears setting.</p>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${SB()}/startups/check/">Check what your company qualifies for</a>
  · <a class="link-underline" href="${SB()}/startups/tools/">More free tools</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'EU grant co-funding / match-funding calculator',
    description: 'Work out the grant amount, your own contribution, and the cash you need up front for an EU grant with less than 100% funding intensity — with verified Horizon Europe and EIC Accelerator presets. Runs in your browser.',
    canonical: `${SITE_URL}/startups/tools/co-funding/`,
    audience: 'biz',
    body,
  });
}

/* ------------------------------------------------------------------ */
/* /startups/tools/forschungszulage/                                   */
/* ------------------------------------------------------------------ */

export function renderForschungszulagePage({ BASE, LB, SB, TR, L, ALT, SITE_URL }) {
  const r = FORSCHUNGSZULAGE_RULES_2026;
  const dataPayload = JSON.stringify({ rules: r }).replace(/</g, '\\u003c');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, ...toolsBreadcrumb(SB, 'Forschungszulage estimator')])}
  <span class="eyebrow eyebrow-accent">For founders in Germany</span>
  <h1 style="max-width:24ch">Forschungszulage estimator</h1>
  <p class="lede" style="max-width:60ch">The Forschungszulage is a statutory German R&D tax credit under the
  Forschungszulagengesetz (FZulG) — every taxpayer doing qualifying R&D gets it, including a loss-making
  pre-revenue company, as a cash refund rather than a competed grant. Enter your eligible costs to estimate the
  credit using the rates in force from 1 January 2026. Runs in your browser; nothing is sent to a server.</p>

  <div class="callout" style="margin-top:1.4rem">
    <p><strong>This is an estimate, not tax advice.</strong> The real figure depends on your BSFZ certification,
    exact cost documentation and your Finanzamt's assessment. Confirm eligible R&D status with the
    <a href="https://www.bescheinigung-forschungszulage.de/" rel="nofollow noopener">Bescheinigungsstelle
    Forschungszulage (BSFZ)</a> and the exact credit with your tax adviser or Finanzamt before relying on this
    number.</p>
  </div>

  <div class="card" id="fz-app" style="margin-top:2rem" data-payload="fz-data">
    <noscript><p><strong>This calculator needs JavaScript</strong> — the arithmetic runs in your browser so your
    figures are never sent to a server.</p></noscript>
  </div>
  <script type="application/json" id="fz-data">${dataPayload}</script>
  <script type="module" src="${BASE}/forschungszulage.js"></script>

  <h2 style="margin-top:3rem">The rules this estimator uses (from 1 January 2026)</h2>
  <div style="overflow-x:auto;margin-top:1rem">
    <table class="rule-table">
      <thead><tr><th>Rule</th><th>Figure</th></tr></thead>
      <tbody>
        <tr><td>Credit rate — SME (EU definition)</td><td>${r.smeRatePct}%</td></tr>
        <tr><td>Credit rate — large company</td><td>${r.largeCompanyRatePct}%</td></tr>
        <tr><td>Eligible-cost base (Bemessungsgrundlage) cap, per business year</td><td>${money(r.bemessungsgrundlageCapEur)}</td></tr>
        <tr><td>Resulting maximum annual credit — SME</td><td>${money(r.bemessungsgrundlageCapEur * r.smeRatePct / 100)}</td></tr>
        <tr><td>Resulting maximum annual credit — large company</td><td>${money(r.bemessungsgrundlageCapEur * r.largeCompanyRatePct / 100)}</td></tr>
        <tr><td>Contract research (Auftragsforschung) — share of the fee that counts</td><td>${r.contractResearchEligibleSharePct}%</td></tr>
        <tr><td>Overhead flat rate (Gemeinkostenpauschale), for projects begun after 31 Dec 2025</td><td>${r.overheadFlatRatePct}% of direct eligible costs</td></tr>
        <tr><td>Combined state-aid cap per R&D project, across all years</td><td>${money(r.perProjectLifetimeCapEur)}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="tiny" style="margin-top:.6rem">Depreciation of moveable fixed assets required for and used exclusively
  in the R&D project is an eligible cost alongside personnel costs and contract research.</p>
  <p class="small" style="margin-top:1.5rem">Sources: <a href="https://www.wirtschaft.nrw/steuerliche-forschungszulage" rel="nofollow noopener">wirtschaft.nrw — Steuerliche Forschungszulage (rate table)</a>
  · <a href="https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/Steuerliche_Themengebiete/Forschungszulage/forschungszulage.html" rel="nofollow noopener">Bundesministerium der Finanzen — Forschungszulage</a>
  · <a href="https://www.ihk-muenchen.de/ratgeber/steuern/steuerliche-sonderthemen/foerderung-forschung-entwicklung/" rel="nofollow noopener">IHK München — steuerliche Förderung von Forschung und Entwicklung</a>
  · <a href="https://www.bescheinigung-forschungszulage.de/" rel="nofollow noopener">BSFZ — Bescheinigungsstelle Forschungszulage</a></p>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${SB()}/startups/de/">German startup grants</a>
  · <a class="link-underline" href="${SB()}/startups/tools/">More free tools</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Forschungszulage estimator — German R&D tax credit',
    description: 'Estimate your German Forschungszulage R&D tax credit from personnel costs, contract research and depreciation, using the exact rates and caps in force from 1 January 2026. Runs in your browser; not tax advice.',
    canonical: `${SITE_URL}/startups/tools/forschungszulage/`,
    audience: 'biz',
    body,
  });
}
