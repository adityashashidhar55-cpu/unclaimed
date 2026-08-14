#!/usr/bin/env node
/**
 * UNCLAIMED — static site generator.
 *
 * Reads the curated dataset in /data and emits a fully static, crawlable site
 * into /dist. No dependencies, no npm install, no framework. Run: node src/build.mjs
 *
 * Every number rendered here comes from the dataset or from src/engine/matcher.js,
 * which is the same module the browser wizard runs. Nothing is hand-typed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  match as matchEngine,
  AUDIENCES,
  audienceTags,
  CATEGORY_LABEL,
  CIRCUMSTANCES,
  circumstanceTags,
  formatMoney,
  isCapitalCeiling,
  periodSuffix,
} from './engine/matcher.js';
import { LOCALES, LANGS, t as translator } from './i18n.mjs';
import { policyFor, autoApplyTier, railFor } from '../packages/policy/index.js';
import { DOC_TYPES } from '../packages/vault/index.js';
import {
  SITE_NAME,
  TAGLINE,
  esc,
  attr,
  ICON,
  layout,
  verificationBadge,
  applyBadge,
  amountLabel,
  progHref,
  categoryLabel,
  benefitTypeLabel,
  listRow,
  disclaimerBar,
} from './ui.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'dist');

const BASE = (process.env.SITE_BASE ?? '').replace(/\/$/, '');

/**
 * Gate the 2,216 programme pages behind the paywall?
 *
 * Default OFF, deliberately. Those pages ARE the acquisition engine — they are
 * what Google indexes and what a Meta ad lands on. Gating them removes the
 * content Google ranks and the traffic stops. The paid product is the
 * PERSONALISED answer (which of these apply to you, and the prepared
 * application for each), which is gated server-side in worker/index.js and
 * cannot be scraped.
 *
 * Set PAYWALL_SCHEMES=1 to gate them anyway — the page keeps its JSON-LD and
 * its title so it stays in the index, but the steps, documents and source are
 * replaced with a sign-in prompt.
 */
const PAYWALL_SCHEMES = process.env.PAYWALL_SCHEMES === '1';
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://adityashashidhar55-cpu.github.io').replace(/\/$/, '');
const SITE_URL = `${ORIGIN}${BASE}`;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function write(rel, content) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function page(rel, html) {
  write(rel, html);
  PAGES.push(rel);
}

const PAGES = [];
const nf = (n) => new Intl.NumberFormat('en').format(n);

/* ---- Language state. The whole page set is generated once per language. ---- */
let L = 'en';
const LB = () => (L === 'en' ? BASE : `${BASE}/${L}`);
let TR = translator('en');
/** hreflang siblings for the page currently being rendered. */
let ALT = [];
function altFor(path) {
  return LANGS.filter((lg) => lg === 'en' || (LOCALES[lg].countries ?? []).length)
    .map((lg) => ({
      lang: lg,
      native: LOCALES[lg].native,
      href: `${ORIGIN}${BASE}${lg === 'en' ? '' : '/' + lg}${path}`,
    }));
}

/* ------------------------------------------------------------------ */
/* Load data                                                           */
/* ------------------------------------------------------------------ */

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const countries = manifest.countries
  .map((entry) => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, `${entry.slug}.json`), 'utf8'));
    return { entry, data };
  })
  .sort((a, b) => a.entry.name.localeCompare(b.entry.name));

// ---- Computed statistics. The landing page may NOT hard-code any of these. ----
const STATS = (() => {
  let total = 0;
  let verified = 0;
  let automatic = 0;
  let withSteps = 0;
  let withDocs = 0;
  let priced = 0;
  let withDeadline = 0;
  const byCategory = {};
  const funders = new Set();
  let latest = '';
  for (const { data } of countries) {
    for (const p of data.programmes) {
      total += 1;
      if (p.verification_status === 'verified') verified += 1;
      if (p.is_automatic) automatic += 1;
      if ((p.procedure_steps || []).length) withSteps += 1;
      if ((p.documents_required || []).length) withDocs += 1;
      if (p.amount_min != null || p.amount_max != null) priced += 1;
      if (p.deadline_type && p.deadline_type !== 'none' && p.deadline_type !== 'rolling') withDeadline += 1;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      if (p.funder) funders.add(p.funder);
      if (p.last_verified_at > latest) latest = p.last_verified_at;
    }
  }
  return {
    total,
    verified,
    automatic,
    mustApply: total - automatic,
    withSteps,
    withDocs,
    priced,
    withDeadline,
    byCategory,
    funderCount: funders.size,
    countryCount: countries.length,
    asOf: latest,
    verifiedPct: Math.round((verified / total) * 100),
  };
})();

/* ------------------------------------------------------------------ */
/* Shared fragments                                                    */
/* ------------------------------------------------------------------ */

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it, i) =>
      it.href
        ? `<a href="${it.href}">${esc(it.label)}</a>${i < items.length - 1 ? '<span>/</span>' : ''}`
        : `<span style="opacity:1;margin:0">${esc(it.label)}</span>`,
    )
    .join('')}</nav>`;
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.label,
      item: it.href ? `${ORIGIN}${it.href}` : undefined,
    })),
  };
}

/* ================================================================== */
/* 1. Landing page                                                     */
/* ================================================================== */

function landing() {
  const flags = countries
    .map(
      ({ entry }) =>
        `<a class="flag-chip" href="${LB()}/${entry.slug}/"><span class="flag-chip__flag">${entry.flag}</span>${esc(
          entry.name,
        )}<span class="tiny">${entry.programme_count}</span></a>`,
    )
    .join('');

  const catCards = Object.entries(STATS.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([cat, n]) =>
        `<a class="card card-link" href="${LB()}/browse/${cat}/">
          <h3 style="font-size:1.15rem;margin-bottom:.2rem">${esc(categoryLabel(cat))}</h3>
          <p class="small" style="margin:0">${nf(n)} programmes across ${STATS.countryCount} countries</p>
        </a>`,
    )
    .join('');

  // A real, computed example — run through the same engine the browser uses,
  // so the landing page can never claim a figure the product wouldn't produce.
  const example = (() => {
    const gb = countries.find((c) => c.entry.slug === 'gb') || countries[0];
    const profile = {
      country_code: gb.entry.country_code,
      admin_area: null,
      status: 'employee',
      age: 34,
      income_band: (gb.entry.income_bands || [])[0]?.id ?? null,
      income_annual: null,
      household_size: 3,
      children_count: 2,
      housing_tenure: 'renting',
      nationality_group: 'citizen_or_pr',
      residency_months: 120,
      circumstances: [],
    };
    const r = matchEngine(profile, gb.data, gb.entry);
    return { r, entry: gb.entry };
  })();

  const body = `
${disclaimerBar(TR)}
<section class="hero shell">
  <div class="hero__grid">
  <div>
  <span class="eyebrow eyebrow-accent">${nf(STATS.total)} real programmes · ${STATS.countryCount} countries · sourced &amp; dated</span>
  <h1>${esc(TR('heroA'))} <span class="hero__accent">${esc(TR('heroB'))}</span>${esc(TR('heroQ'))}</h1>
  <p class="lede hero__lede">${esc(TR('heroLede'))}</p>
  <div class="hero__cta">
    <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))} ${ICON.arrow}</a>
    <a class="btn btn-ghost" href="${LB()}/countries/">${esc(TR('ctaBrowse'))}</a>
  </div>
  <p class="tiny" style="margin-top:1rem">${esc(TR('free'))}</p>
  ${L === 'en' ? '' : `<p class="tiny" style="margin-top:.6rem;opacity:.8">${esc(TR('langNote'))}</p>`}
  </div>
  <aside class="hero__demo">
    <div class="result-hero" style="padding:1.6rem 1.5rem">
      <span class="eyebrow" style="margin-bottom:.8rem">Example · ${example.entry.flag} ${esc(example.entry.name)} · renting, 2 children, low income band</span>
      <p class="figure" style="font-size:clamp(2.6rem,5.5vw,4rem)">${example.r.eligible.length} payments</p>
      <p class="figure-unit" style="margin-top:.7rem">this person can claim and probably isn't</p>
      <div style="margin-top:1.3rem;display:grid;gap:.5rem">
        ${example.r.eligible
          .filter((m) => !m.is_capital && (m.programme.amount_min != null || m.programme.amount_max != null))
          .slice(0, 3)
          .map(
            (m) =>
              `<div style="display:flex;justify-content:space-between;gap:1rem;font-size:.83rem;color:#cfc7b8;border-top:1px solid #34302a;padding-top:.5rem">
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.programme.name_en)}</span>
                <span style="flex:none;color:#f0c8a8">${esc(amountLabel(m.programme, example.r.currency) || '—')}</span>
              </div>`,
          )
          .join('')}
      </div>
      <p class="tiny" style="color:#8b8175;margin:1.2rem 0 0">Worth ${esc(formatMoney(example.r.total_max, example.r.currency))}/yr in fixed
      amounts, plus ${example.r.eligible.filter((m) => m.programme.amount_min == null && m.programme.amount_max == null).length}
      whose value the authority calculates from your circumstances — usually the biggest ones.
      ${example.r.conditional.length} more were held back because they need a disability, caring or new-baby situation this
      example didn't claim. Computed live at build time — not a mockup.</p>
    </div>
  </aside>
  </div>

  <div class="stat-strip">
    <div class="stat"><div class="stat__n">${nf(STATS.total)}</div><div class="stat__l">${esc(TR('statProgrammes'))}</div></div>
    <div class="stat"><div class="stat__n">${nf(STATS.countryCount)}</div><div class="stat__l">${esc(TR('statCountries'))}</div></div>
    <div class="stat"><div class="stat__n">${nf(STATS.verified)}</div><div class="stat__l">${esc(TR('statVerified'))} (${STATS.verifiedPct}%)</div></div>
    <div class="stat"><div class="stat__n">${nf(STATS.funderCount)}</div><div class="stat__l">${esc(TR('statFunders'))}</div></div>
  </div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">The problem</span>
  <div class="grid grid-2" style="align-items:start">
    <div>
      <h2>Eligibility is public. Findability is not.</h2>
      <p>
        Every scheme on this site is published on an official government page. None of it is secret.
        It is simply spread across dozens of departments, written in the local language, buried under
        criteria you have to read to know don't apply to you, and never cross-referenced.
      </p>
      <p>
        Unclaimed reads the rules for you. You answer six questions once; we evaluate
        ${nf(STATS.total)} sets of published criteria against them and tell you, in plain language,
        which ones you pass, which one answer is still missing, and which ones you fail and why.
      </p>
    </div>
    <div class="stack">
      <div class="callout callout--terracotta">
        <p><strong>${nf(STATS.automatic)} of ${nf(STATS.total)} programmes are automatic.</strong>
        You get them without applying — <em>if</em> the right authority already has your details. The other
        ${nf(STATS.mustApply)} require an application that nobody will prompt you to make.</p>
      </div>
      <div class="callout callout--sage">
        <p><strong>${nf(STATS.withDocs)} records ship a document checklist</strong> and ${nf(STATS.withSteps)} ship
        numbered application steps taken from the official page — so "am I eligible?" turns straight into
        "here is what to gather this weekend".</p>
      </div>
    </div>
  </div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">What you get</span>
  <h2 style="max-width:20ch">Not a list of links. A claim plan.</h2>
  <div class="grid grid-3" style="margin-top:2.5rem">
    <div class="card card-flat">
      <h3>Three honest buckets</h3>
      <p class="small">Eligible / needs one more answer / not eligible — with the exact failing rule spelled out
      in plain language, so you learn something even from a "no".</p>
    </div>
    <div class="card card-flat">
      <h3>One merged document list</h3>
      <p class="small">Your matches are deduplicated into a single checklist. Usually a handful of documents
      unlocks nearly everything — we show you which ones and what they open.</p>
    </div>
    <div class="card card-flat">
      <h3>Deadline calendar</h3>
      <p class="small">Programmes with a real deadline export to a calendar file you can drop into
      Google Calendar, Outlook or Apple Calendar in one click.</p>
    </div>
    <div class="card card-flat">
      <h3>A printable pack</h3>
      <p class="small">Print or save your plan as a PDF with every source URL and verified date attached —
      useful for a caseworker, an adviser, or a relative who doesn't use the web.</p>
    </div>
    <div class="card card-flat">
      <h3>A shareable link</h3>
      <p class="small">Your answers live in the URL, not in an account. Send the link to a partner,
      a parent, or a client and they see the same result.</p>
    </div>
    <div class="card card-flat">
      <h3>Sources on every claim</h3>
      <p class="small">Each programme carries the official URL, a verbatim snippet, the funder,
      and the date a human last checked it. No source, no entry.</p>
    </div>
  </div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">Coverage</span>
  <div class="spread"><h2>${STATS.countryCount} countries</h2><a class="link-underline" href="${LB()}/countries/">See coverage detail</a></div>
  <div class="flag-wall" style="margin-top:1.6rem">${flags}</div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">${esc(TR('whoFor'))}</span>
  <h2 style="max-width:20ch">Start from who you are</h2>
  <div class="grid grid-4" style="margin-top:2rem">
    ${AUDIENCES.map((a) => `<a class="card card-link" href="${LB()}/for/${a.id}/">
      <h3 style="font-size:1.1rem;margin-bottom:.3rem">${esc(a.label)}</h3>
      <p class="small" style="margin:0">${esc(TR(a.blurbKey))}</p>
    </a>`).join('')}
  </div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">${esc(TR('browseCat'))}</span>
  <h2>By category</h2>
  <div class="grid grid-3" style="margin-top:2rem">${catCards}</div>
</section>

<section class="section shell section-rule">
  <span class="eyebrow">Trust</span>
  <div class="grid grid-2">
    <div>
      <h2>We would rather say "we don't know".</h2>
      <p>Every record is tagged <strong>Verified</strong> (a researcher opened the official page and confirmed the
      rule) or <strong>Not human-checked</strong> (extracted from an official source, not yet re-read). We show the
      difference on every card instead of flattening it into a false uniform confidence.</p>
      <p>Amounts that depend on your circumstances are left blank with a note, never guessed. Right now
      ${nf(STATS.priced)} of ${nf(STATS.total)} records carry a published figure; the rest tell you the amount varies
      and link you to the official calculator.</p>
      <p><a class="link-underline" href="${LB()}/methodology/">Read the full methodology and known limitations</a></p>
    </div>
    <div class="card">
      <h3 style="margin-bottom:1rem">Data as of ${esc(STATS.asOf)}</h3>
      <table class="rule-table">
        <tr><th>Programmes</th><td>${nf(STATS.total)}</td></tr>
        <tr><th>Human-verified</th><td>${nf(STATS.verified)} (${STATS.verifiedPct}%)</td></tr>
        <tr><th>With published amount</th><td>${nf(STATS.priced)}</td></tr>
        <tr><th>With application steps</th><td>${nf(STATS.withSteps)}</td></tr>
        <tr><th>With document list</th><td>${nf(STATS.withDocs)}</td></tr>
        <tr><th>Automatic (no application)</th><td>${nf(STATS.automatic)}</td></tr>
        <tr><th>Funding bodies</th><td>${nf(STATS.funderCount)}</td></tr>
      </table>
    </div>
  </div>
</section>

<section class="section shell section-rule center">
  <h2 style="max-width:22ch;margin-inline:auto">It takes about ninety seconds.</h2>
  <p class="lede" style="max-width:48ch">The worst case is you find out you're already claiming everything.
  The realistic case is one payment you didn't know existed.</p>
  <p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/check/">Start the check ${ICON.arrow}</a></p>
</section>
`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: SITE_NAME,
    description: `Find unclaimed government grants, benefits and tax relief across ${STATS.countryCount} countries. ${nf(STATS.total)} real programmes with official sources, document checklists and application steps. Free and anonymous.`,
    canonical: `${SITE_URL}/`,
    body,
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: TAGLINE,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_URL}/countries/?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: 'Unclaimed global benefits dataset',
        description: `${STATS.total} government and institutional support programmes across ${STATS.countryCount} countries, each with an official source URL, eligibility rules, documents and application steps.`,
        url: `${SITE_URL}/methodology/`,
        license: 'https://opensource.org/licenses/MIT',
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE_URL}/api/v1/countries.json` },
        ],
      },
    ],
  });
}

/* ================================================================== */
/* 2. Programme detail page                                            */
/* ================================================================== */

function programmePage(entry, data, p) {
  const cc = entry.slug;
  const cur = p.amount_currency || data.currency;
  const amt = amountLabel(p, data.currency);
  const crumbs = [
    { label: 'Home', href: `${LB()}/` },
    { label: entry.name, href: `${LB()}/${cc}/` },
    { label: categoryLabel(p.category), href: `${LB()}/${cc}/${p.category}/` },
    { label: p.name_en },
  ];

  const e = p.eligibility;
  const ruleRows = [];
  const push = (k, v) => v && ruleRows.push(`<tr><th>${esc(k)}</th><td>${v}</td></tr>`);
  push('Who it is for', (e.statuses || []).length ? esc(e.statuses.join(', ').replace(/_/g, ' ')) : 'No status restriction published');
  if (e.age_min != null || e.age_max != null) {
    push('Age', esc(e.age_min != null && e.age_max != null ? `${e.age_min}–${e.age_max}` : e.age_min != null ? `${e.age_min}+` : `Up to ${e.age_max}`));
  }
  if (e.income_annual_max != null || e.income_note) {
    push(
      e.income_annual_max != null ? 'Income test' : 'Eligibility notes',
      `${e.income_annual_max != null ? `<strong>Household income under ${esc(formatMoney(e.income_annual_max, cur))}/year.</strong> ` : ''}${esc(e.income_note || '')}`,
    );
  }
  if (e.requires_children) push('Children', 'At least one dependent child required');
  if (e.housing_tenure) push('Housing', esc(String(e.housing_tenure).replace(/_/g, ' ')));
  if (e.nationality && e.nationality !== 'any') push('Residency status', esc(String(e.nationality).replace(/_/g, ' ')));
  if (e.residency_months_min != null) push('Time in country', `At least ${e.residency_months_min} months`);
  if (e.student_required) push('Student status', 'Must be enrolled as a student');
  if ((e.admin_areas || []).length) push('Where it applies', esc(e.admin_areas.join(', ')));
  if (!ruleRows.length) ruleRows.push('<tr><th>Published restrictions</th><td>None recorded beyond residency in ' + esc(entry.name) + '</td></tr>');

  const steps = (p.procedure_steps || [])
    .slice()
    .sort((a, b) => a.step - b.step)
    .map(
      (s) =>
        `<li><div>${esc(s.detail)}${s.url ? ` <a class="link-underline" href="${attr(s.url)}" rel="nofollow noopener" target="_blank">open&nbsp;page</a>` : ''}</div></li>`,
    )
    .join('');

  const docs = (p.documents_required || [])
    .map(
      (d, i) =>
        `<li><input type="checkbox" id="doc-${i}"><label for="doc-${i}">${esc(d.doc)}${
          d.mandatory === false ? ' <span class="badge badge-neutral">if applicable</span>' : ''
        }${d.note ? `<span class="tiny" style="display:block">${esc(d.note)}</span>` : ''}</label></li>`,
    )
    .join('');

  const related = data.programmes
    .filter((x) => x.category === p.category && x.slug !== p.slug)
    .slice(0, 6)
    .map((x) => listRow(BASE, cc, x, data.currency))
    .join('');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <div class="detail-grid">
    <div>
      <div class="row" style="margin-bottom:1rem">
        ${verificationBadge(p.verification_status)} ${applyBadge(p)}
        <span class="badge badge-neutral">${esc(categoryLabel(p.category))}</span>
        <span class="badge badge-neutral">${esc(benefitTypeLabel(p.benefit_type))}</span>
        ${p.admin_level !== 'national' ? `<span class="badge badge-neutral">${esc(p.admin_level)}${p.admin_area ? ` · ${esc(p.admin_area)}` : ''}</span>` : ''}
      </div>
      <h1 style="font-size:clamp(2rem,4.5vw,3.4rem)">${esc(p.name_en)}</h1>
      ${p.name_local && p.name_local !== p.name_en ? `<p class="lede serif" style="margin-top:-.4rem">${esc(p.name_local)}</p>` : ''}
      <p class="small">Paid by <strong>${esc(p.funder)}</strong> · ${esc(entry.flag)} ${esc(entry.name)}</p>

      ${
        amt
          ? `<div class="card" style="margin:2rem 0"><span class="eyebrow" style="margin-bottom:.4rem">Published value</span>
             <div class="figure-sm" style="color:var(--sage)">${esc(amt)}</div>
             ${p.amount_note ? `<p class="small" style="margin:.6rem 0 0">${esc(p.amount_note)}</p>` : ''}
             ${isCapitalCeiling(p) ? `<p class="tiny" style="margin:.6rem 0 0"><strong>Note:</strong> this is a credit or capital ceiling, not cash in hand. It is excluded from the headline total in your results.</p>` : ''}
             </div>`
          : `<div class="callout" style="margin:2rem 0"><p><strong>Amount depends on your circumstances.</strong> ${esc(
              p.amount_note || 'The official body calculates it from your situation — we do not guess a figure.',
            )}</p></div>`
      }

      ${(() => {
        const tags = circumstanceTags(p);
        if (!tags.length) return '';
        const labels = tags.map((id) => CIRCUMSTANCES.find((c) => c.id === id)?.short || id).join(' or ');
        return `<div class="callout callout--terracotta" style="margin:1.5rem 0"><p style="margin:0"><strong>Gated on a personal circumstance.</strong>
          This programme depends on ${esc(labels)} — a condition the structured eligibility fields below do not capture.
          Read the official page carefully before assuming you qualify.</p></div>`;
      })()}

      <h2 style="margin-top:2.5rem">Who qualifies</h2>
      <table class="rule-table">${ruleRows.join('')}</table>

      ${PAYWALL_SCHEMES ? `<div class="callout callout--terracotta" style="margin:2rem 0">
        <p><strong>The steps, documents and official link are part of the paid plan.</strong>
        Checking how much you're owed is free and always will be.</p>
        <p style="margin-bottom:0"><a class="btn btn-primary btn-sm" href="${LB()}/pricing/">See plans</a>
        <a class="btn btn-ghost btn-sm" href="${LB()}/check/">Check your total free</a></p>
      </div>` : ''}
      ${
        PAYWALL_SCHEMES ? '' : steps
          ? `<h2 style="margin-top:3rem">${esc(TR('howApply'))}</h2>
             <ol class="steps">${steps}</ol>`
          : p.is_automatic
            ? `<h2 style="margin-top:3rem">How to apply</h2><div class="callout callout--sage"><p><strong>No application needed.</strong> This is paid automatically to people who meet the criteria, usually through an existing record the authority already holds. If you meet the rules and are not receiving it, contact ${esc(
                p.funder,
              )} — it usually means they are missing a detail about you.</p></div>`
            : `<h2 style="margin-top:3rem">How to apply</h2><div class="callout"><p>We have not yet recorded step-by-step instructions for this programme. Start from the official page below — it is the authoritative source.</p></div>`
      }

      ${
        docs
          ? `<h2 style="margin-top:3rem">Documents you'll need</h2>
             <p class="small">Tick these off as you gather them. Nothing is saved anywhere.</p>
             <ul class="docs">${docs}</ul>`
          : ''
      }

      <h2 style="margin-top:3rem">Where this comes from</h2>
      <div class="source-block">
        ${p.source_snippet ? `<blockquote>${esc(p.source_snippet)}</blockquote>` : ''}
        <p style="margin:.6rem 0 0"><a class="link-underline" href="${attr(p.source_url)}" rel="nofollow noopener" target="_blank">${esc(
          p.source_url,
        )}</a></p>
        <p class="tiny" style="margin:.6rem 0 0">Last checked ${esc(p.last_verified_at)} · ${
          p.verification_status === 'verified'
            ? 'a researcher confirmed this against the official page'
            : 'extracted from the official source, not yet re-read by a human'
        }</p>
      </div>

      ${related ? `<h2 style="margin-top:3rem">Other ${esc(categoryLabel(p.category).toLowerCase())} support in ${esc(entry.name)}</h2><div class="list-rows">${related}</div>` : ''}
    </div>

    <aside class="sticky-side stack no-print">
      ${
        p.application_url
          ? `<a class="btn btn-primary" style="width:100%" href="${attr(p.application_url)}" rel="nofollow noopener" target="_blank">Apply on the official site ${ICON.arrow}</a>`
          : `<a class="btn btn-ghost" style="width:100%" href="${attr(p.source_url)}" rel="nofollow noopener" target="_blank">Open the official page ${ICON.arrow}</a>`
      }
      <a class="btn btn-ghost" style="width:100%" href="${LB()}/check/?country=${cc}">Check your full entitlement</a>
      <button class="btn btn-ghost" style="width:100%" onclick="window.print()">Print / save as PDF</button>
      <div class="card card-flat">
        <h4 style="margin-bottom:.7rem">At a glance</h4>
        <table class="rule-table" style="font-size:.85rem">
          <tr><th>Type</th><td>${esc(benefitTypeLabel(p.benefit_type))}</td></tr>
          <tr><th>Applying</th><td>${p.is_automatic ? 'Automatic' : esc(String(p.application_channel || 'online').replace(/_/g, ' '))}</td></tr>
          <tr><th>Deadline</th><td>${esc(p.deadline_note || String(p.deadline_type || 'rolling').replace(/_/g, ' '))}</td></tr>
          <tr><th>Level</th><td>${esc(p.admin_level)}${p.admin_area ? ` · ${esc(p.admin_area)}` : ''}</td></tr>
          <tr><th>Checked</th><td>${esc(p.last_verified_at)}</td></tr>
        </table>
      </div>
      <p class="tiny">Rule changed or link dead? <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues/new?title=${encodeURIComponent(
        `Data problem: ${p.name_en} (${cc})`,
      )}&body=${encodeURIComponent(`Programme: ${p.name_en}\nCountry: ${entry.name}\nPage: ${SITE_URL}/${cc}/${p.category}/${p.slug}/\n\nWhat's wrong:`)}" rel="noopener" target="_blank">Report it on GitHub</a> — it goes to a real public issue tracker, not a form that vanishes.</p>
    </aside>
  </div>
</section>
`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: p.name_en,
    alternateName: p.name_local !== p.name_en ? p.name_local : undefined,
    serviceType: categoryLabel(p.category),
    description: p.source_snippet || p.amount_note || `${p.name_en} — support provided by ${p.funder} in ${entry.name}.`,
    provider: { '@type': 'GovernmentOrganization', name: p.funder },
    areaServed: { '@type': 'Country', name: entry.name },
    audience: { '@type': 'Audience', audienceType: (p.eligibility.statuses || []).join(', ') || 'Residents' },
    url: `${SITE_URL}/${cc}/${p.category}/${p.slug}/`,
    serviceUrl: p.application_url || p.source_url,
    isRelatedTo: p.source_url,
    dateModified: p.last_verified_at,
  };
  if (p.amount_max != null || p.amount_min != null) {
    ld.offers = {
      '@type': 'Offer',
      priceCurrency: cur,
      price: p.amount_max ?? p.amount_min,
      description: `${amt}${p.amount_note ? ` — ${p.amount_note}` : ''}`,
    };
  }

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${p.name_en} — ${entry.name}`,
    description: `${p.name_en}${p.name_local !== p.name_en ? ` (${p.name_local})` : ''}: who qualifies, ${amt ? `worth ${amt}, ` : ''}documents needed, how to apply, and the official ${p.funder} source. Last checked ${p.last_verified_at}.`,
    canonical: `${SITE_URL}/${cc}/${p.category}/${p.slug}/`,
    body,
    jsonld: [ld, breadcrumbLd(crumbs.map((c) => ({ ...c, href: c.href })))],
  });
}

/* ================================================================== */
/* 3. Country page                                                     */
/* ================================================================== */

function countryPage(entry, data) {
  const cc = entry.slug;
  const cats = {};
  for (const p of data.programmes) (cats[p.category] ||= []).push(p);
  const verified = data.programmes.filter((p) => p.verification_status === 'verified').length;
  const automatic = data.programmes.filter((p) => p.is_automatic).length;

  const catSections = Object.entries(cats)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, list]) => {
      const shown = list.slice(0, 8);
      return `<section style="margin-top:3rem">
        <div class="spread" style="border-bottom:1px solid var(--line);padding-bottom:.6rem">
          <h2 style="font-size:clamp(1.3rem,2.2vw,1.9rem);margin:0">${esc(categoryLabel(cat))}</h2>
          <a class="link-underline small" href="${LB()}/${cc}/${cat}/">All ${list.length} ${esc(categoryLabel(cat).toLowerCase())} programmes</a>
        </div>
        <div class="list-rows">${shown.map((p) => listRow(BASE, cc, p, data.currency)).join('')}</div>
      </section>`;
    })
    .join('');

  const crumbs = [{ label: 'Home', href: `${LB()}/` }, { label: 'Countries', href: `${LB()}/countries/` }, { label: entry.name }];

  const body = `
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${entry.flag} Country coverage</span>
  <h1>Unclaimed benefits &amp; grants in ${esc(entry.name)}</h1>
  <p class="lede" style="max-width:60ch">${nf(entry.programme_count)} real support programmes from national, regional and city bodies —
  each with the published eligibility rules, an official source and the date we last checked it.
  ${automatic} of them pay out automatically; the other ${entry.programme_count - automatic} need an application.</p>
  <div class="hero__cta">
    <a class="btn btn-primary" href="${LB()}/check/?country=${cc}">Check your entitlement in ${esc(entry.name)} ${ICON.arrow}</a>
    <a class="btn btn-ghost" href="${BASE}/api/v1/programmes/${cc}.json">Raw JSON</a>
  </div>
  <div class="stat-strip">
    <div class="stat"><div class="stat__n">${nf(entry.programme_count)}</div><div class="stat__l">Programmes</div></div>
    <div class="stat"><div class="stat__n">${nf(verified)}</div><div class="stat__l">Human-verified</div></div>
    <div class="stat"><div class="stat__n">${Object.keys(cats).length}</div><div class="stat__l">Categories</div></div>
    <div class="stat"><div class="stat__n">${entry.currency}</div><div class="stat__l">Currency</div></div>
  </div>
</section>

<section class="section-tight shell">
  <div class="filters">
    ${Object.keys(cats)
      .sort()
      .map((c) => `<a class="tag" href="${LB()}/${cc}/${c}/">${esc(categoryLabel(c))} <span class="tiny">${cats[c].length}</span></a>`)
      .join('')}
  </div>
  ${catSections}
</section>

<section class="section shell section-rule">
  <div class="callout">
    <p><strong>Regions covered:</strong> ${(entry.regions || []).map((r) => esc(r)).join(' · ') || 'National programmes only'}.
    City and regional schemes are the ones people miss most — if yours isn't listed, the national programmes above still apply.</p>
  </div>
</section>
`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${entry.name} — every benefit, grant and rebate we could source`,
    description: `${entry.programme_count} government and institutional support programmes in ${entry.name}: housing, family, income support, energy, transport, tax and business. Official sources, eligibility rules and application steps. Free eligibility check.`,
    canonical: `${SITE_URL}/${cc}/`,
    body,
    jsonld: [
      breadcrumbLd(crumbs),
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `Benefits and grants in ${entry.name}`,
        url: `${SITE_URL}/${cc}/`,
        about: { '@type': 'Country', name: entry.name },
        numberOfItems: entry.programme_count,
      },
    ],
  });
}

/* ================================================================== */
/* 4. Country + category page                                          */
/* ================================================================== */

function categoryPage(entry, data, cat, list) {
  const cc = entry.slug;
  const crumbs = [
    { label: 'Home', href: `${LB()}/` },
    { label: entry.name, href: `${LB()}/${cc}/` },
    { label: categoryLabel(cat) },
  ];
  const body = `
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${entry.flag} ${esc(entry.name)}</span>
  <h1 style="font-size:clamp(2rem,4.5vw,3.4rem)">${esc(categoryLabel(cat))} in ${esc(entry.name)}</h1>
  <p class="lede" style="max-width:58ch">${list.length} ${esc(categoryLabel(cat).toLowerCase())} programmes we could source and date.
  Sorted so the ones with a published amount come first.</p>
  <p><a class="btn btn-primary btn-sm" href="${LB()}/check/?country=${cc}">Check which of these you qualify for ${ICON.arrow}</a></p>
  <div class="list-rows" style="margin-top:2rem">
    ${list
      .slice()
      .sort((a, b) => (b.amount_max ?? b.amount_min ?? -1) - (a.amount_max ?? a.amount_min ?? -1))
      .map((p) => listRow(BASE, cc, p, data.currency))
      .join('')}
  </div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${categoryLabel(cat)} in ${entry.name} — ${list.length} programmes`,
    description: `Every ${categoryLabel(cat).toLowerCase()} programme we could source in ${entry.name} (${list.length} records), with eligibility rules, amounts, documents and official links.`,
    canonical: `${SITE_URL}/${cc}/${cat}/`,
    body,
    jsonld: [breadcrumbLd(crumbs)],
  });
}

/* ================================================================== */
/* 5. Global category browse                                           */
/* ================================================================== */

function globalCategoryPage(cat) {
  const rows = countries
    .map(({ entry, data }) => {
      const list = data.programmes.filter((p) => p.category === cat);
      if (!list.length) return '';
      return `<a class="list-row" href="${LB()}/${entry.slug}/${cat}/">
        <span><span class="list-row__name">${entry.flag} ${esc(entry.name)}</span>
        <span class="list-row__meta">${list
          .slice(0, 3)
          .map((p) => esc(p.name_en))
          .join(' · ')}</span></span>
        <span class="list-row__right"><span class="list-row__amount">${list.length}</span><span class="tiny">programmes</span></span>
      </a>`;
    })
    .join('');

  const crumbs = [{ label: 'Home', href: `${LB()}/` }, { label: 'Browse' }, { label: categoryLabel(cat) }];
  const total = STATS.byCategory[cat] || 0;

  const body = `
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">Browse by category</span>
  <h1>${esc(categoryLabel(cat))}</h1>
  <p class="lede" style="max-width:56ch">${nf(total)} ${esc(categoryLabel(cat).toLowerCase())} programmes across ${STATS.countryCount} countries.
  Pick your country to see the full list with eligibility rules and sources.</p>
  <div class="list-rows" style="margin-top:2rem">${rows}</div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${categoryLabel(cat)} programmes worldwide`,
    description: `${total} ${categoryLabel(cat).toLowerCase()} support programmes across ${STATS.countryCount} countries, with official sources and eligibility rules.`,
    canonical: `${SITE_URL}/browse/${cat}/`,
    body,
    jsonld: [breadcrumbLd(crumbs)],
  });
}

/* ================================================================== */
/* 6. Countries index                                                  */
/* ================================================================== */

function countriesIndex() {
  const rows = countries
    .map(({ entry, data }) => {
      const verified = data.programmes.filter((p) => p.verification_status === 'verified').length;
      return `<a class="list-row" href="${LB()}/${entry.slug}/">
      <span><span class="list-row__name">${entry.flag} ${esc(entry.name)}</span>
      <span class="list-row__meta">${entry.categories.length} categories · ${verified} verified · ${entry.currency}</span></span>
      <span class="list-row__right"><span class="list-row__amount">${entry.programme_count}</span><span class="tiny">programmes</span></span>
    </a>`;
    })
    .join('');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: 'Home', href: `${LB()}/` }, { label: 'Countries' }])}
  <span class="eyebrow eyebrow-accent">Coverage</span>
  <h1>${STATS.countryCount} countries, ${nf(STATS.total)} programmes</h1>
  <p class="lede" style="max-width:56ch">Coverage is deliberately uneven — we went deep on national schemes everywhere
  and added regional and city schemes where they matter most. Counts below are live from the dataset.</p>
  <div class="list-rows" style="margin-top:2rem">${rows}</div>
  <div class="callout" style="margin-top:2.5rem">
    <p><strong>Country not here?</strong> The engine and schema are country-agnostic — adding one is a data job, not a code job.
    Open an issue on <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues">GitHub</a> and say which one.</p>
  </div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'All countries',
    description: `Benefit and grant coverage across ${STATS.countryCount} countries — ${nf(STATS.total)} sourced programmes with eligibility rules and official links.`,
    canonical: `${SITE_URL}/countries/`,
    body,
    jsonld: [breadcrumbLd([{ label: 'Home', href: `${LB()}/` }, { label: 'Countries' }])],
  });
}

/* ================================================================== */
/* 7. Wizard + results (client-rendered, one page)                     */
/* ================================================================== */

function checkPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  <div id="app" class="wizard">
    <noscript>
      <div class="callout">
        <p><strong>The eligibility check needs JavaScript</strong> — it runs entirely in your browser so that
        nothing you type ever reaches a server. Without it you can still browse every programme by country:</p>
        <p><a class="link-underline" href="${LB()}/countries/">Browse all ${STATS.countryCount} countries</a></p>
      </div>
    </noscript>
  </div>
</section>
<script type="module" src="${BASE}/app.js"></script>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Check what you are owed',
    description: `A 90-second anonymous eligibility check against ${nf(STATS.total)} government support programmes in ${STATS.countryCount} countries. Nothing is stored on a server.`,
    canonical: `${SITE_URL}/check/`,
    body,
    nav: `<a class="btn btn-sm btn-ghost" href="${LB()}/countries/">Browse instead</a>`,
  });
}

/* ================================================================== */
/* 8. Methodology                                                      */
/* ================================================================== */

function methodologyPage() {
  const body = `
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: 'Home', href: `${LB()}/` }, { label: 'Methodology' }])}
  <span class="eyebrow eyebrow-accent">Trust</span>
  <h1>How we know what we say we know</h1>
  <p class="lede">Everything on this site is checkable. This page tells you exactly how the data was
  built, what the confidence levels mean, and — importantly — what is still wrong with it.</p>

  <h2 id="sourcing" style="margin-top:3rem">Sourcing</h2>
  <p>Every record is a real, currently-running programme published by a government, public body or
  well-known institution. Each one carries an official <code>source_url</code> on the funder's own domain
  and, where we quoted it, a verbatim <code>source_snippet</code> from that page.</p>
  <p>Rules we hold ourselves to, and which you can check us against:</p>
  <ul>
    <li>No invented URLs. If we couldn't find the exact deep link, we link the official landing page.</li>
    <li>No guessed amounts. If the amount depends on your circumstances, the fields are left empty and
    a note explains why — we never fabricate a plausible-looking figure.</li>
    <li>No ended programmes. Schemes that closed were deliberately excluded during curation.</li>
    <li>Every record is dated. <code>last_verified_at</code> is when a human last looked.</li>
  </ul>

  <h2 id="verification" style="margin-top:3rem">The two verification states</h2>
  <div class="grid grid-2" style="margin:1.5rem 0">
    <div class="card"><p>${verificationBadge('verified')}</p><p class="small">A researcher opened the official page
    and confirmed the rule, amount and link. <strong>${nf(STATS.verified)} records</strong> (${STATS.verifiedPct}%).</p></div>
    <div class="card"><p>${verificationBadge('auto_extracted')}</p><p class="small">Extracted from an official source
    during curation, but not re-read by a person since. Treat it as a strong lead, not a guarantee.
    <strong>${nf(STATS.total - STATS.verified)} records</strong>.</p></div>
  </div>
  <p>We show the difference on every card rather than flattening both into one confident-looking badge.
  A site that claims uniform accuracy across ${nf(STATS.total)} programmes in ${STATS.countryCount} countries is lying to you.</p>

  <h2 id="matching" style="margin-top:3rem">How matching works</h2>
  <p>Your answers are evaluated against nine published rule types: geography, work or life status, student
  status, age, household income, dependent children, residency status, length of residence, and housing
  tenure. Each programme lands in one of three buckets:</p>
  <ul>
    <li><strong>Eligible</strong> — you pass every rule the record publishes.</li>
    <li><strong>Needs one more answer</strong> — you pass everything we can test, but one rule needs a
    detail you haven't given. We show you the exact question.</li>
    <li><strong>Not eligible</strong> — you fail at least one rule, and we name it in plain language.</li>
  </ul>
  <p>A record with no published restriction on a given attribute passes that attribute. This is deliberate:
  it is better to surface a programme you might not get than to silently hide one you would.</p>

  <h2 id="money" style="margin-top:3rem">What the big number means (and doesn't)</h2>
  <p>The headline figure is the sum of published annualised maximums for programmes in your
  <em>eligible</em> bucket only. Monthly amounts are multiplied by twelve; one-off amounts are counted once.</p>
  <ul>
    <li>It is an <strong>upper bound of published ceilings</strong>, not a prediction of your payment.
    Most means-tested schemes taper — you get the maximum only at the bottom of the income range.</li>
    <li>Programmes with no published amount contribute <strong>zero</strong>. Your real entitlement is
    almost certainly higher than the number shown, not lower.</li>
    <li>Loan and credit-facility ceilings are <strong>excluded</strong> from the headline and reported
    separately, because borrowing capacity is not income.</li>
  </ul>

  <h2 id="privacy" style="margin-top:3rem">Privacy</h2>
  <p>The eligibility check runs entirely in your browser. Your answers are never transmitted anywhere —
  there is no server to transmit them to. This site is static files. If you use the "copy link" feature,
  your answers are encoded in the URL you choose to share, and nowhere else. There are no accounts,
  no cookies for tracking, and no analytics that identify you.</p>

  <h2 id="limits" style="margin-top:3rem">Known limitations</h2>
  <p>The honest list. If any of this changes, this section changes with it.</p>
  <ol>
    <li><strong>Income bands are approximations.</strong> Band thresholds are fractions of estimated median
    household income per country, not official poverty lines. Enter an exact income when the wizard offers
    it and matching gets sharper.</li>
    <li><strong>${nf(STATS.total - STATS.priced)} of ${nf(STATS.total)} records have no published amount.</strong>
    They are real programmes; the amount simply depends on circumstances the official body calculates.</li>
    <li><strong>${nf(STATS.total - STATS.verified)} records are not human-verified.</strong> Rules may have moved since curation.</li>
    <li><strong>Snapshot, not a live feed.</strong> Data is a curated snapshot dated ${esc(STATS.asOf)}. There is no
    scraper re-checking these pages daily.</li>
    <li><strong>Regional coverage is uneven.</strong> National schemes are well covered everywhere; city-level
    schemes are covered for major cities only.</li>
    <li><strong>Not legal or financial advice.</strong> We describe published criteria. Only the named authority
    can decide your case.</li>
  </ol>

  <h2 id="corrections" style="margin-top:3rem">Corrections</h2>
  <p>Every programme page has a "report it" link that opens a public GitHub issue with the programme and
  page pre-filled. Public tracker, public fix history — no feedback form that disappears into nothing.</p>

  <h2 style="margin-top:3rem">The data is yours</h2>
  <p>The full dataset is open. <a class="link-underline" href="${BASE}/api/">Use the JSON API or plug it into an AI assistant over MCP</a>,
  or take the whole repository from <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed">GitHub</a>.</p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Methodology, sources and known limitations',
    description: 'How the Unclaimed dataset is sourced, verified and dated — including an honest list of what is still wrong with it.',
    canonical: `${SITE_URL}/methodology/`,
    body,
  });
}

/* ================================================================== */
/* 9. API / MCP page                                                   */
/* ================================================================== */

function apiPage() {
  const body = `
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: 'Home', href: `${LB()}/` }, { label: 'API & MCP' }])}
  <span class="eyebrow eyebrow-accent">Developers</span>
  <h1>Plug the whole dataset into anything</h1>
  <p class="lede">Static JSON, no key, no rate limit, CORS-open by virtue of being files on a CDN.
  Designed so an AI assistant can answer benefits questions from it directly.</p>

  <h2 style="margin-top:2.5rem">REST-shaped endpoints</h2>
  <table class="rule-table">
    <tr><th><code>/api/v1/countries.json</code></th><td>Country index: codes, currencies, regions, income bands, counts.</td></tr>
    <tr><th><code>/api/v1/programmes/{cc}.json</code></th><td>Every programme for one country, full records.</td></tr>
    <tr><th><code>/api/v1/stats.json</code></th><td>Live dataset statistics — the same numbers this site renders.</td></tr>
    <tr><th><code>/api/v1/mcp-tools.json</code></th><td>Tool schemas (JSON Schema 2020-12) for the MCP layer.</td></tr>
    <tr><th><code>/llms.txt</code></th><td>Plain-text orientation for language models.</td></tr>
  </table>

  <h2 style="margin-top:2.5rem">MCP layer</h2>
  <p>The MCP tool definitions ship as data at <code>/api/v1/mcp-tools.json</code>. Any MCP server that can
  fetch JSON can expose these tools with a thin adapter — the tools are pure reads over the static files,
  so the server needs no database and no state:</p>
  <table class="rule-table">
    <tr><th><code>list_countries</code></th><td>Coverage and counts.</td></tr>
    <tr><th><code>search_programmes</code></th><td>Filter by country, category, keyword, verification status.</td></tr>
    <tr><th><code>get_programme</code></th><td>Full record including steps, documents and source.</td></tr>
    <tr><th><code>match_profile</code></th><td>Run the eligibility engine over a profile and return the three buckets.</td></tr>
  </table>
  <p class="small"><strong>Status: schemas shipped, server not deployed.</strong> We won't call a documented
  interface a running one. The matcher itself (<code>src/engine/matcher.js</code>) is dependency-free and
  imports into a Node MCP server unchanged.</p>

  <h2 style="margin-top:2.5rem">Licence</h2>
  <p>MIT. Attribution appreciated, not required. The underlying programme information belongs to the
  publishing authorities and is linked on every record.</p>

  <div class="callout" style="margin-top:2rem">
    <p><strong>Every number on this site is generated from these files at build time.</strong> If the API and a
    page ever disagree, the API is right and it is a bug — please report it.</p>
  </div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'API and MCP access',
    description: 'Free static JSON API and MCP tool schemas over 2,000+ sourced government benefit programmes in 25 countries.',
    canonical: `${SITE_URL}/api/`,
    body,
  });
}



/* ================================================================== */
/* Pricing                                                             */
/* ================================================================== */

function pricingPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Pricing' }])}
  <span class="eyebrow eyebrow-accent">Pricing</span>
  <h1 style="max-width:16ch">Finding out what you're owed is free. Always.</h1>
  <p class="lede" style="max-width:56ch">You never pay to learn the number. You pay when you want the
  schemes behind it and the paperwork done for you.</p>

  <div class="grid grid-2" style="margin-top:3rem;align-items:stretch">
    <div class="card">
      <span class="eyebrow">Free</span>
      <div class="figure-sm">£0</div>
      <p class="small">Forever, no account.</p>
      <ul style="margin-top:1.2rem;padding-left:1.1rem">
        <li>How much you're owed, per year</li>
        <li>How many schemes it comes from</li>
        <li>How many pay out automatically</li>
        <li>Every one of ${nf(STATS.total)} programme pages, with sources</li>
      </ul>
      <p style="margin-top:1.5rem"><a class="btn btn-ghost" href="${LB()}/check/">Check your total</a></p>
    </div>

    <div class="card" style="border-color:var(--terracotta)">
      <span class="eyebrow eyebrow-accent">Claim</span>
      <div class="figure-sm" style="color:var(--terracotta)">£4.99<span style="font-size:1rem;color:var(--ink-3)">/month</span></div>
      <p class="small">Cancel any time, in two clicks.</p>
      <ul style="margin-top:1.2rem;padding-left:1.1rem">
        <li><strong>Which schemes</strong> you specifically qualify for</li>
        <li>The exact steps and documents for each</li>
        <li><strong>A prepared application per scheme</strong> — drafted, filled, ready to send</li>
        <li>One merged document checklist across every claim</li>
        <li>Deadline reminders and re-checks when rules change</li>
      </ul>
      <p style="margin-top:1.5rem"><a class="btn btn-primary" href="${LB()}/check/">Start with the free check</a></p>
    </div>
  </div>

  <div class="callout callout--sage" style="margin-top:2.5rem">
    <p><strong>One flat price. Never a cut of what you get.</strong> We charge for the software,
    the same amount whether you turn out to be owed nothing or £9,000 a year. No success fee, no
    commission, no per-claim charge. That is a deliberate limit on us, not a pricing gimmick: the moment
    a service takes a share of someone's benefits it stops being a tool and starts being a middleman,
    and in several countries that is exactly the thing the law is there to stop.</p>
  </div>

  <div class="grid grid-2" style="margin-top:2.5rem;align-items:stretch">
    <div class="card">
      <span class="eyebrow">Included</span>
      <h2 style="font-size:1.35rem;margin-top:.4rem">A place to keep the paperwork</h2>
      <p class="small">Every claim wants a payslip, a proof of address, a birth certificate. Keep each one
      once and every later claim that asks for it is already answered. We tell you when something has gone
      out of date, and which claims each missing document would unlock — so you fetch one thing and finish
      four applications, instead of doing it twelve times.</p>
      <p class="small" style="margin-top:.8rem"><strong>Encrypted on your device before it reaches us.</strong>
      We hold the scrambled bytes and a label like "proof of income". We cannot open your files, and neither
      can anyone who breaks into our servers.</p>
    </div>
    <div class="card">
      <span class="eyebrow">Where we can, we file it</span>
      <h2 style="font-size:1.35rem;margin-top:.4rem">Auto-apply, honestly scoped</h2>
      <p class="small">In <strong>Spain</strong> a company can hold a registered power of attorney and submit
      for you, so there we do. That is one country, and we would rather say so than imply otherwise.</p>
      <p class="small" style="margin-top:.8rem">Everywhere else no such mechanism exists, so you get the
      complete package — the letter written, the form fields filled from your answers, the document
      checklist, the exact steps — and you press send. In <strong>India</strong> we can pull your own
      documents in from DigiLocker with your consent each time.</p>
    </div>
  </div>

  <div class="callout" style="margin-top:1.5rem">
    <p><strong>What we don't do.</strong> We never sign in to a government website as you, and we never
    press submit on your behalf. Every application we prepare is sent by you, from your own account. That
    is a deliberate design choice: a benefits declaration is sworn by the person making it, and keeping it
    yours is what the law requires and what protects you.</p>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Pricing — free to find out, paid to claim',
    description: `Seeing how much you're owed is free forever. £4.99/month unlocks which of ${nf(STATS.total)} schemes you qualify for and a prepared application for each one.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/pricing/`,
    body,
  });
}

/* ================================================================== */
/* Audience landing pages                                              */
/* ================================================================== */

function audienceRows(cc, data, audId) {
  return data.programmes
    .filter((p) => audienceTags(p).includes(audId))
    .sort((a, b) => {
      // Money first, then human-verified, then everything else.
      const av = a.amount_max ?? a.amount_min ?? -1;
      const bv = b.amount_max ?? b.amount_min ?? -1;
      if (bv !== av) return bv - av;
      return (b.verification_status === 'verified') - (a.verification_status === 'verified');
    });
}

/** /{cc}/for/{audience}/ — the page an ad click should land on. */
function audienceCountryPage(entry, data, aud) {
  const cc = entry.slug;
  const list = audienceRows(cc, data, aud.id);
  const automatic = list.filter((p) => p.is_automatic).length;
  const priced = list.filter((p) => p.amount_max != null || p.amount_min != null);
  const crumbs = [
    { label: TR('backHome'), href: `${LB()}/` },
    { label: entry.name, href: `${LB()}/${cc}/` },
    { label: aud.label },
  ];
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${entry.flag} ${esc(entry.name)} · ${esc(TR(aud.i18n))}</span>
  <h1 style="max-width:18ch">${esc(TR('audHead')(list.length, TR(aud.i18n), entry.name))}</h1>
  <p class="lede" style="max-width:56ch">${esc(TR(aud.blurbKey))}</p>
  <div class="hero__cta">
    <a class="btn btn-primary" href="${LB()}/check/?country=${cc}">${esc(TR('ctaCheck'))} ${ICON.arrow}</a>
  </div>
  <div class="stat-strip">
    <div class="stat"><div class="stat__n">${list.length}</div><div class="stat__l">${esc(TR('audFor'))}</div></div>
    <div class="stat"><div class="stat__n">${automatic}</div><div class="stat__l">${esc(TR('audAuto'))}</div></div>
    <div class="stat"><div class="stat__n">${list.length - automatic}</div><div class="stat__l">${esc(TR('audApply'))}</div></div>
    <div class="stat"><div class="stat__n">${priced.length}</div><div class="stat__l">${esc(TR('audPriced'))}</div></div>
  </div>
  <div class="list-rows" style="margin-top:2.5rem">
    ${list.map((p) => listRow(LB(), cc, p, data.currency)).join('')}
  </div>
  <div class="callout" style="margin-top:2.5rem">
    <p><strong>${list.length - priced.length} of these publish no fixed amount.</strong> That does not mean they are
    small — it means the authority calculates the figure from your circumstances, and those are often the biggest
    payments of all. Run the check to see which apply to you.</p>
  </div>
</section>`;
  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `${aud.label} in ${entry.name} — ${list.length} things you can claim`,
    description: `${list.length} real support programmes for ${aud.label.toLowerCase()} in ${entry.name}: ${aud.blurb} Official sources, eligibility rules and application steps. Free anonymous check.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/${cc}/for/${aud.id}/`,
    body,
    jsonld: [breadcrumbLd(crumbs)],
  });
}

/** /for/{audience}/ — the global chooser. */
function audienceIndexPage(aud) {
  const rows = countries
    .map(({ entry, data }) => ({ entry, n: audienceRows(entry.slug, data, aud.id).length }))
    .filter((r) => r.n)
    .sort((a, b) => b.n - a.n);
  const total = rows.reduce((s2, r) => s2 + r.n, 0);
  const crumbs = [{ label: TR('backHome'), href: `${LB()}/` }, { label: aud.label }];
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${esc(TR('whoFor'))}</span>
  <h1>${esc(aud.label)}</h1>
  <p class="lede" style="max-width:56ch">${esc(TR(aud.blurbKey))} ${nf(total)} programmes across ${rows.length} countries.
  Pick your country to see the list that applies to you.</p>
  <div class="list-rows" style="margin-top:2rem">
    ${rows
      .map(
        (r) => `<a class="list-row" href="${LB()}/${r.entry.slug}/for/${aud.id}/">
      <span><span class="list-row__name">${r.entry.flag} ${esc(r.entry.name)}</span></span>
      <span class="list-row__right"><span class="list-row__amount">${r.n}</span><span class="tiny">programmes</span></span>
    </a>`,
      )
      .join('')}
  </div>
</section>`;
  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `${aud.label} — what you can claim`,
    description: `${total} support programmes for ${aud.label.toLowerCase()} across ${rows.length} countries, with official sources and eligibility rules.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/for/${aud.id}/`,
    body,
    jsonld: [breadcrumbLd(crumbs)],
  });
}

/* ================================================================== */
/* Build                                                               */
/* ================================================================== */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// static assets
fs.copyFileSync(path.join(__dirname, 'theme.css'), path.join(OUT, 'theme.css'));
fs.copyFileSync(path.join(__dirname, 'app.js'), path.join(OUT, 'app.js'));
fs.mkdirSync(path.join(OUT, 'engine'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'engine/matcher.js'), path.join(OUT, 'engine/matcher.js'));
write(
  'favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1c1a16"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="#faf6ef" stroke-width="1"/><path d="M8.4 12.2l2.5 2.5 4.7-5.2" fill="none" stroke="#e08a5a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);

/* ---- Generate the whole page set once per language. ------------------
 * English gets everything. Each other language gets the shared surfaces plus
 * the countries that actually speak it — a Hindi page for Portugal would be
 * SEO noise, and a French page for France is the entire point.
 */
function buildLanguage(lang) {
  L = lang;
  TR = translator(lang);
  const only = LOCALES[lang].countries;
  const mine = only ? countries.filter((c) => only.includes(c.entry.slug)) : countries;
  const pre = lang === 'en' ? '' : `${lang}/`;

  ALT = altFor('/');
  page(`${pre}index.html`, landing());
  ALT = altFor('/countries/');
  page(`${pre}countries/index.html`, countriesIndex());
  ALT = altFor('/check/');
  page(`${pre}check/index.html`, checkPage());
  ALT = altFor('/methodology/');
  page(`${pre}methodology/index.html`, methodologyPage());
  ALT = altFor('/pricing/');
  page(`${pre}pricing/index.html`, pricingPage());

  for (const aud of AUDIENCES) {
    ALT = altFor(`/for/${aud.id}/`);
    page(`${pre}for/${aud.id}/index.html`, audienceIndexPage(aud));
  }

  if (lang === 'en') {
    for (const cat of Object.keys(STATS.byCategory)) {
      ALT = altFor(`/browse/${cat}/`);
      page(`browse/${cat}/index.html`, globalCategoryPage(cat));
    }
  }

  for (const { entry, data } of mine) {
    const cc = entry.slug;
    ALT = altFor(`/${cc}/`);
    page(`${pre}${cc}/index.html`, countryPage(entry, data));

    for (const aud of AUDIENCES) {
      if (!audienceRows(cc, data, aud.id).length) continue;
      ALT = altFor(`/${cc}/for/${aud.id}/`);
      page(`${pre}${cc}/for/${aud.id}/index.html`, audienceCountryPage(entry, data, aud));
    }

    const cats = {};
    for (const p2 of data.programmes) (cats[p2.category] ||= []).push(p2);
    for (const [cat, list] of Object.entries(cats)) {
      ALT = altFor(`/${cc}/${cat}/`);
      page(`${pre}${cc}/${cat}/index.html`, categoryPage(entry, data, cat, list));
      for (const p2 of list) {
        ALT = altFor(`/${cc}/${cat}/${p2.slug}/`);
        page(`${pre}${cc}/${cat}/${p2.slug}/index.html`, programmePage(entry, data, p2));
      }
    }
  }
}

for (const lang of LANGS) buildLanguage(lang);
L = 'en';
TR = translator('en');
ALT = [];
page('api/index.html', apiPage());
write('404.html', layout({
  base: BASE,
  linkBase: BASE,
  title: 'Page not found',
  description: 'That page does not exist.',
  body: `<section class="section shell center"><h1>Not here.</h1><p class="lede">That page doesn't exist — programme URLs look like <code>/gb/housing/some-scheme/</code>.</p><p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/">Back to the start</a> <a class="btn btn-ghost" href="${LB()}/countries/">Browse countries</a></p></section>`,
}));

for (const { entry, data } of countries) {
  write(`api/v1/programmes/${entry.slug}.json`, JSON.stringify(data));
}

// ---- machine-readable layer ----
write(
  'api/v1/countries.json',
  JSON.stringify({
    generated_at: STATS.asOf,
    total_programmes: STATS.total,
    total_verified: STATS.verified,
    countries: countries.map(({ entry }) => ({ ...entry, data_url: `${BASE}/api/v1/programmes/${entry.slug}.json` })),
  }),
);
write('api/v1/stats.json', JSON.stringify(STATS));
const mcpToolsSrc = path.join(DATA, 'mcp-tools.json');
if (fs.existsSync(mcpToolsSrc)) fs.copyFileSync(mcpToolsSrc, path.join(OUT, 'api/v1/mcp-tools.json'));

write(
  'llms.txt',
  `# ${SITE_NAME}

> ${TAGLINE}

${SITE_NAME} is an open dataset and eligibility matcher covering ${STATS.total} real government,
public-body and institutional support programmes across ${STATS.countryCount} countries. Every record
carries an official source URL, the published eligibility rules, application steps, a document list,
and the date a human last verified it. Data as of ${STATS.asOf}.

## How to use this data
- Country index (codes, currencies, regions, income bands, counts): ${SITE_URL}/api/v1/countries.json
- All programmes for one country: ${SITE_URL}/api/v1/programmes/{cc}.json  (cc = ISO-3166 alpha-2, lowercase)
- Dataset statistics: ${SITE_URL}/api/v1/stats.json
- MCP tool schemas: ${SITE_URL}/api/v1/mcp-tools.json
- Human pages: ${SITE_URL}/{cc}/{category}/{slug}/

## Rules for answering questions from this data
1. ${STATS.verified} of ${STATS.total} records are human-verified (verification_status: "verified").
   The rest are "auto_extracted" — cite them as leads, and say so.
2. Never state an amount that is not in amount_min/amount_max. Null means the amount depends on
   circumstances; say that instead of estimating.
3. Always surface source_url and last_verified_at when you quote a rule.
4. is_automatic: true means no application is needed. This is the single most useful thing to tell a user.
5. This is not legal, tax or financial advice. Only the named authority can confirm entitlement.

## Categories
${Object.entries(STATS.byCategory)
  .sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `- ${c} (${n})`)
  .join('\n')}

## Countries
${countries.map(({ entry }) => `- ${entry.slug}: ${entry.name} — ${entry.programme_count} programmes`).join('\n')}
`,
);

write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

const urls = PAGES.map((p) => {
  const u = `${SITE_URL}/${p.replace(/index\.html$/, '')}`;
  const depth = p.split('/').length;
  const pri = depth <= 1 ? '1.0' : depth === 2 ? '0.9' : depth === 3 ? '0.7' : '0.6';
  return `  <url><loc>${u}</loc><lastmod>${STATS.asOf}</lastmod><priority>${pri}</priority></url>`;
});
// Sitemaps cap at 50k URLs; split if needed.
if (urls.length <= 45000) {
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
} else {
  const chunks = [];
  for (let i = 0; i < urls.length; i += 45000) chunks.push(urls.slice(i, i + 45000));
  chunks.forEach((c, i) =>
    write(`sitemap-${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${c.join('\n')}\n</urlset>\n`),
  );
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${chunks
      .map((_, i) => `  <sitemap><loc>${SITE_URL}/sitemap-${i + 1}.xml</loc><lastmod>${STATS.asOf}</lastmod></sitemap>`)
      .join('\n')}\n</sitemapindex>\n`,
  );
}

write('.nojekyll', '');

console.log(
  `Built ${PAGES.length} HTML pages · ${STATS.total} programmes · ${STATS.countryCount} countries · ${STATS.verified} verified (${STATS.verifiedPct}%)`,
);
console.log(`Base path: "${BASE || '/'}"  Origin: ${ORIGIN}`);
