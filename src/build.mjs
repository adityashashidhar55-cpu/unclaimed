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
import { INSTRUMENTS, isFreeMoney, reachFor } from './engine/startup.js';
import { DE_MINIMIS_CEILING_EUR, REGULATION } from '../packages/stateaid/index.js';
import { REGISTRIES, autofillAvailable } from '../packages/registry/index.js';
import { awardLikelihood, effortFor, bandFor, BAND_LABELS } from '../packages/scoring/index.js';
import { deadlineState, STATUS_META } from '../packages/deadlines/index.js';

const BUILD_NOW = Date.parse('2026-08-14');

/** Status chip. The most time-sensitive fact on any programme, so it goes first. */
function statusChip(p) {
  const d = deadlineState(p, BUILD_NOW);
  return `<span class="status status--${d.urgency}" title="${attr(d.detail)}">${esc(d.headline)}</span>`;
}

/* Startup grants live in their own namespace with their own engine — a
   company is not a household and forcing both through one matcher would make
   each worse. See src/engine/startup.js. */
const STARTUP_MANIFEST = JSON.parse(fs.readFileSync(new URL('../data/startups/manifest.json', import.meta.url)));
const STARTUP_DATA = Object.fromEntries(
  STARTUP_MANIFEST.countries.map((c) => [
    c.slug,
    JSON.parse(fs.readFileSync(new URL(`../data/startups/${c.slug}.json`, import.meta.url))),
  ]),
);
const STARTUP_ALL = STARTUP_MANIFEST.countries.flatMap((c) => STARTUP_DATA[c.slug].programmes);
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
const SRC = __dirname;
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
  const startupCount = STARTUP_ALL.length;
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(p.status)).length;
  const reopening = STARTUP_ALL.filter(
    (p) => ['closed', 'paused'].includes(p.status) && (p.reopen_note || p.opens_at || (p.typical_months || []).length),
  ).length;
  const jurisdictions = new Set([...countries.map((c) => c.entry.slug), ...STARTUP_MANIFEST.countries.map((c) => c.slug)]).size;

  const body = `
<section style="padding:clamp(4rem,10vw,8rem) 0 clamp(3rem,6vw,5rem);position:relative">
  <div class="shell">
    <span class="eyebrow eyebrow-accent reveal">${nf(STATS.total + startupCount)} sourced programmes · ${jurisdictions} jurisdictions</span>
    <h1 style="max-width:15ch" data-blur-words>The money you are owed, and nobody told you about.</h1>
    <p class="lede reveal" data-delay="200" style="max-width:52ch;margin-top:1.4rem">
      Governments and funders hand out rent support, family payments, R&amp;D credits and startup grants
      every year. Most of it goes unclaimed because nobody can find it. We found it, sourced it, and dated it.
    </p>

    <div class="row reveal" data-delay="340" style="margin-top:2.2rem;gap:.7rem">
      <a class="btn btn-primary" href="${LB()}/check/">Check what you're owed</a>
      <a class="btn" href="${LB()}/startups/">I'm a founder</a>
    </div>

    <div class="grid grid-4 reveal" data-delay="460" style="margin-top:3.4rem">
      <div class="stat">
        <span class="stat__n tally" data-tally="${STATS.total + startupCount}">${nf(STATS.total + startupCount)}</span>
        <span class="stat__l">Programmes</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${openNow}">${nf(openNow)}</span>
        <span class="stat__l">Open right now</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${reopening}">${nf(reopening)}</span>
        <span class="stat__l">Closed, with a reopen date</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${jurisdictions}">${jurisdictions}</span>
        <span class="stat__l">Jurisdictions</span>
      </div>
    </div>
  </div>
</section>

<section class="section-tight">
  <div class="shell">
    <div class="callout reveal">
      <p><strong>Closed does not mean hidden.</strong> Every grant site either buries closed calls — so you
      never learn they exist and miss them again next year — or lists them as open and wastes your afternoon.
      We show them with the only fact that matters: <em class="serif-italic">when they come back</em>.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="shell">
    <span class="eyebrow reveal">How it works</span>
    <h2 class="reveal" style="max-width:16ch">Four questions. <em class="serif-italic">Then the money.</em></h2>
    <div class="flow" style="margin-top:2.6rem;max-width:46rem">
      ${[
        ['1', 'Tell us about you', 'Country, situation, rough income. No account, no email, nothing stored. The matcher runs in your browser.'],
        ['2', 'See the number', 'What you are owed across every programme you qualify for — free, always, no wall.'],
        ['3', 'Get the list and the paperwork', 'Which schemes, what each needs, and a prepared application per claim with the fields already filled.'],
        ['4', 'Never miss the window', 'Deadlines in your calendar, and an alert when a closed programme reopens.'],
      ]
        .map(
          (st, i) => `<div class="flow__step reveal" data-delay="${i * 130}">
        <div class="flow__dot">${st[0]}</div>
        <div>
          <h3 style="margin-bottom:.25rem">${st[1]}</h3>
          <p class="small" style="max-width:40ch">${st[2]}</p>
        </div>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>

<section class="section-rule section">
  <div class="shell">
    <span class="eyebrow reveal">Two products</span>
    <h2 class="reveal" style="max-width:18ch">Households and founders need different things.</h2>
    <div class="grid grid-2" style="margin-top:2.4rem">
      <a class="card card-link reveal" href="${LB()}/check/">
        <span class="eyebrow">For people</span>
        <h3>${nf(STATS.total)} benefits across ${countries.length} countries</h3>
        <p class="small">Rent support, family payments, energy help, transport concessions, tax credits.
        Means-tested rules modelled from the published thresholds, with every source linked.</p>
        <p class="small" style="color:#fff;margin-top:.8rem">Check what you're owed →</p>
      </a>
      <a class="card card-link reveal" data-delay="120" href="${LB()}/startups/">
        <span class="eyebrow eyebrow-accent">For founders</span>
        <h3>${nf(startupCount)} grants across ${STARTUP_MANIFEST.countries.length} jurisdictions</h3>
        <p class="small">Public and private, ranked by what you can realistically win rather than headline
        size — with the EU de minimis ceiling applied so the plan is one you can lawfully execute.</p>
        <p class="small" style="color:#fff;margin-top:.8rem">Find startup funding →</p>
      </a>
    </div>
  </div>
</section>

<section class="section">
  <div class="shell">
    <span class="eyebrow reveal">Why trust the number</span>
    <h2 class="reveal" style="max-width:20ch">Every figure is a published rule, <em class="serif-italic">not a guess.</em></h2>
    <div class="grid grid-3" style="margin-top:2.2rem">
      ${[
        ['Sourced and dated', 'Every programme links to the funder\'s own page with a verbatim quote and the date we last read it. Records we have not re-checked say so.'],
        ['Nulls, never estimates', 'Where a funder publishes no amount we show no amount. An invented figure is worse than a blank.'],
        ['Nothing leaves your device', 'The free check runs entirely in your browser. No account, no tracking, no answers stored anywhere.'],
      ]
        .map(
          (c, i) => `<div class="card reveal" data-delay="${i * 110}">
        <h3 style="font-size:1.12rem">${c[0]}</h3>
        <p class="small">${c[1]}</p>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>

<section class="section-rule section">
  <div class="shell" style="text-align:center">
    <h2 class="reveal" style="max-width:18ch;margin-inline:auto">Find out in ninety seconds.</h2>
    <p class="lede reveal" data-delay="120" style="max-width:40ch;margin:1rem auto 2rem">
      No sign-up. No card. The number is free forever.
    </p>
    <div class="row reveal" data-delay="220" style="justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">Check what you're owed</a>
      <a class="btn" href="${LB()}/pricing/">See pricing</a>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: SITE_NAME,
    description: `${nf(STATS.total + startupCount)} sourced government and private funding programmes across ${jurisdictions} jurisdictions. Find what you are owed in ninety seconds — free, anonymous, no sign-up.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/`,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
      {
        '@context': 'https://schema.org', '@type': 'Dataset', name: `${SITE_NAME} programme dataset`,
        description: `${nf(STATS.total + startupCount)} sourced funding programmes across ${jurisdictions} jurisdictions.`,
        url: `${SITE_URL}/api/`, license: 'https://opensource.org/licenses/MIT',
      },
    ],
    body,
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
  /* Founders arriving on a business-support page should be told the startup
     dataset exists — it is deeper and purpose-built for companies. */
  const startupCrossLink =
    cat === 'business' && STARTUP_DATA[entry.slug]
      ? `<div class="callout callout--sage" style="margin-top:1.5rem">
    <p><strong>Building a startup rather than a small business?</strong> We keep a separate, deeper
    dataset of <a href="${LB()}/startups/${esc(entry.slug)}/">${STARTUP_DATA[entry.slug].programmes.length}
    startup funding programmes in ${esc(entry.name)}</a> — grants, R&D credits and cloud credits, ranked by
    what you can realistically win rather than by headline size.</p>
  </div>`
      : '';
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
  ${startupCrossLink}
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
  const startupCount = STARTUP_ALL.length;
  const totalProgrammes = STATS.total + startupCount;

  const tier = (t) => `<div class="card reveal" data-delay="${t.delay}">
    <span class="eyebrow${t.featured ? ' eyebrow-accent' : ''}">${t.eyebrow}</span>
    <div class="figure-sm">${t.price}${t.per ? `<span style="font-size:.9rem;color:var(--ink-4);font-family:var(--font-body)">${t.per}</span>` : ''}</div>
    ${t.second ? `<p class="small" style="margin:-.3rem 0 .6rem;color:var(--ink-4)">${t.second}</p>` : ''}
    <p class="small">${t.blurb}</p>
    <ul style="margin:1.2rem 0 0;padding-left:1.1rem">
      ${t.features.map((f) => `<li class="small" style="margin-bottom:.42rem">${f}</li>`).join('')}
    </ul>
    <p style="margin-top:1.6rem"><a class="btn ${t.featured ? 'btn-primary' : ''}" href="${t.href}">${t.cta}</a></p>
    ${t.note ? `<p class="tiny" style="margin-top:.8rem">${t.note}</p>` : ''}
  </div>`;

  /* Two audiences, one page, one visible at a time.

     Built on radio inputs and sibling selectors rather than a click handler:
     the panels are both in the HTML, so the page works with JavaScript off,
     search engines index both halves, and there is no flash of the wrong
     price while a script boots. */
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Pricing' }])}
  <span class="eyebrow eyebrow-accent">Pricing</span>
  <h1 style="max-width:15ch">Finding out is free. <em class="serif-italic">Always.</em></h1>
  <p class="lede" style="max-width:54ch">You never pay to learn the number. You pay when you want the
  programmes behind it, the paperwork done, and the deadlines watched.</p>

  <div class="audience">
    <input type="radio" name="audience" id="aud-me" class="audience__radio" checked>
    <input type="radio" name="audience" id="aud-biz" class="audience__radio">

    <div class="audience__switch" role="tablist" aria-label="Who is this for">
      <label for="aud-me" class="audience__tab">For me and my household</label>
      <label for="aud-biz" class="audience__tab">For my company or team</label>
    </div>

    <div class="audience__panel audience__panel--me">
      <div class="grid grid-2" style="margin-top:2.2rem;align-items:stretch">
        ${tier({
          delay: 0, eyebrow: 'Free', price: '€0', per: ' forever',
          blurb: 'The number, and enough of the shape to know whether it is worth your time.',
          features: [
            '<strong>How much you are owed</strong>, per year',
            'How many programmes it comes from',
            'How many pay out automatically',
            `All ${nf(totalProgrammes)} programme pages, with sources`,
            'Email sign-in, verified by a code',
          ],
          href: `${LB()}/check/`, cta: 'Check your total',
        })}
        ${tier({
          delay: 110, eyebrow: 'Personal', price: '€50', per: '/year', featured: true,
          second: 'or €7/month — the annual plan saves €34',
          blurb: 'For households claiming what they are entitled to.',
          features: [
            '<strong>Which programmes</strong> you specifically qualify for',
            'Exact steps and documents for each',
            '<strong>A prepared application per claim</strong>',
            'Encrypted document vault, reused across claims',
            'Deadline reminders in your calendar',
            'The Android and iOS app',
          ],
          href: `${LB()}/check/`, cta: 'Start with the free check',
          note: 'Cancel any time. Same price whether you are owed nothing or €9,000.',
        })}
      </div>

      <div class="callout callout--sage" style="margin-top:1.6rem">
        <p><strong>One flat price. Never a cut of what you get.</strong> No success fee, no commission, no
        per-claim charge. That is a deliberate limit on us: the moment a service takes a share of someone's
        benefits it stops being a tool and becomes a middleman, and in several countries that is exactly what
        the law is there to stop.</p>
      </div>

      <div class="callout" style="margin-top:1.4rem">
        <p><strong>What we don't do.</strong> We never sign in to a government website as you, and we never
        press submit on your behalf outside Spain. Every application we prepare is sent by you, from your own
        account. A benefits declaration is sworn by the person making it, and keeping it yours is what the law
        requires and what protects you.</p>
      </div>
    </div>

    <div class="audience__panel audience__panel--biz">
      <div class="grid grid-3" style="margin-top:2.2rem;align-items:stretch">
        ${tier({
          delay: 0, eyebrow: 'Free', price: '€0', per: ' forever',
          blurb: 'See what your company could raise before you pay anything.',
          features: [
            '<strong>Your total non-dilutive potential</strong>',
            'How many programmes, and how many are open',
            `Every one of the ${nf(startupCount)} programme pages`,
            'Business sign-in, verified by a code',
          ],
          href: `${LB()}/startups/`, cta: 'Check your company',
        })}
        ${tier({
          delay: 110, eyebrow: 'Business', price: '€49', per: '/month', featured: true,
          second: 'or €490/year · one company, one seat',
          blurb: 'For founders chasing grants for their own company.',
          features: [
            `All ${nf(startupCount)} startup programmes, ranked by what you can realistically win`,
            'Award odds and effort estimate per programme',
            '<strong>EU de minimis ceiling tracking</strong>',
            'Company auto-fill from public registers',
            'Reopen alerts on closed calls',
            'Saved searches, weekly digest',
          ],
          href: `${LB()}/startups/`, cta: 'Find your grants',
        })}
        ${tier({
          delay: 220, eyebrow: 'Enterprise', price: 'From €80', per: '/seat/month',
          second: 'or €800/seat/year · teams, portfolios and public bodies',
          blurb: 'For accelerators, funds, universities and anyone managing many applicants.',
          features: [
            '<strong>Team dashboard</strong> with pipeline and stages',
            'Portfolio view across every company you back',
            'Bulk matching and CSV export',
            'A de minimis ledger per portfolio company',
            'API access and webhooks',
            'SSO, audit log, data residency',
            'Named support and onboarding',
          ],
          href: `${LB()}/enterprise/`, cta: 'See the dashboard',
          note: 'Web only — the dashboard is not in the mobile app.',
        })}
      </div>

      <div class="callout" style="margin-top:1.6rem">
        <p><strong>Why Enterprise is not a slightly bigger Business plan.</strong> One founder checking one
        company is a search. An accelerator running forty companies against ${nf(startupCount)} programmes,
        tracking who applied for what, watching every deadline and keeping a de minimis ledger per portfolio
        company is a different product with a support obligation attached. It is priced per seat because that
        is what actually scales — the work is per person using it, not per company in the sheet.</p>
      </div>

      <div class="callout callout--sage" style="margin-top:1.4rem">
        <p><strong>Business accounts sign in separately.</strong> A company account is billed to the company,
        invoiced with your VAT number, and its seats are managed by whoever owns it. It is not a personal
        account with a bigger plan attached, because the two get audited by different people.</p>
      </div>
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:1.8rem;align-items:stretch">
    <div class="card reveal">
      <span class="eyebrow">Included on every paid plan</span>
      <h2 style="font-size:1.3rem;margin-top:.4rem">A place to keep the paperwork</h2>
      <p class="small">Every claim wants a payslip, a proof of address, a birth certificate. Keep each one
      once and every later claim that asks for it is already answered. <strong>Encrypted on your device
      before it reaches us</strong> — we hold scrambled bytes and a label, and cannot open your files.</p>
    </div>
    <div class="card reveal" data-delay="120">
      <span class="eyebrow">Where we can, we file it</span>
      <h2 style="font-size:1.3rem;margin-top:.4rem">Auto-apply, honestly scoped</h2>
      <p class="small">In <strong>Spain</strong> a company can hold a registered power of attorney and submit
      for you, so there we do. That is one country and we would rather say so. Everywhere else you get the
      complete package and press send yourself.</p>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Pricing — free to find out, paid to claim',
    description: `Free forever to see how much you are owed. Personal €50/year or €7/month. Business €49/month. Enterprise from €80/seat/month for portfolio matching across ${nf(totalProgrammes)} programmes.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/pricing/`,
    body,
  });
}




/* ================================================================== */
/* PWA — the mobile app                                                */
/* ================================================================== */

/**
 * The app is a PWA, and that is a deliberate choice rather than a fallback.
 *
 * An Expo build needs a Mac, two developer accounts, signing certificates and
 * a review queue before anyone can open it. A PWA installs from the browser on
 * both Android and iOS, updates the moment we deploy, and — because the
 * matcher is plain JS with no dependencies — runs the whole free check on
 * device with no signal. The Expo source stays in mobile/ for the store
 * builds; this is the one that works today.
 *
 * Individual scope only: check, results, deadlines, documents. The enterprise
 * dashboard is web-only by design.
 */
function appShell() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Unclaimed</title>
<meta name="description" content="Find the government money you are owed. Works offline, no account.">
<meta name="theme-color" content="#000000">
<link rel="manifest" href="${BASE}/manifest.webmanifest">
<link rel="stylesheet" href="${BASE}/app/app.css">
<link rel="apple-touch-icon" href="${BASE}/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Unclaimed">
<meta name="mobile-web-app-capable" content="yes">
</head>
<body data-base="${BASE}">
<div id="app"><noscript><p style="padding:2rem;color:#fff;font-family:system-ui">
This app needs JavaScript. The full site works without it — <a href="${BASE}/" style="color:#fff">open unclaimed</a>.
</p></noscript></div>

<div id="install" hidden>
  <span style="font-size:.88rem">Install Unclaimed for offline use</span>
  <button id="install-go" class="btn" style="min-height:40px;padding:.5rem 1rem">Install</button>
</div>

<script type="module" src="${BASE}/app/app.js"></script>
<script>
/* iOS gives no install prompt event, so tell Safari users how, once. */
(function () {
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!iOS || standalone) return;
  try { if (localStorage.getItem('unclaimed.ios-hint')) return; } catch (e) { return; }
  var bar = document.getElementById('install');
  bar.innerHTML = '<span style="font-size:.86rem">Add to Home Screen: tap Share, then Add to Home Screen</span>' +
                  '<button class="btn" id="ios-ok" style="min-height:40px;padding:.5rem 1rem">Got it</button>';
  bar.hidden = false;
  bar.addEventListener('click', function (e) {
    if (!e.target.closest('#ios-ok')) return;
    try { localStorage.setItem('unclaimed.ios-hint', '1'); } catch (err) {}
    bar.hidden = true;
  });
})();
</script>
</body>
</html>`;
}

/** Maskable icon. Generated rather than shipped as a binary — one less asset
 *  to keep in sync, and it stays crisp at every density. */
function appIcon(size) {
  const r = size * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="30%" cy="12%" r="90%">
      <stop offset="0%" stop-color="#2a1a14"/><stop offset="55%" stop-color="#0a0a0a"/><stop offset="100%" stop-color="#000"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <circle cx="${r}" cy="${r}" r="${size * 0.27}" fill="none" stroke="#e8734a" stroke-width="${size * 0.055}"/>
  <path d="M${r - size * 0.115} ${r + size * 0.005} l${size * 0.075} ${size * 0.085} l${size * 0.16} -${size * 0.175}"
        fill="none" stroke="#fff" stroke-width="${size * 0.055}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function webManifest() {
  return JSON.stringify({
    name: 'Unclaimed — money you are owed',
    short_name: 'Unclaimed',
    description:
      'Find the government benefits and grants you are entitled to. Works offline, no account, nothing leaves your device.',
    start_url: `${BASE}/app/`,
    scope: `${BASE}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['finance', 'productivity', 'utilities'],
    lang: 'en',
    icons: [
      { src: `${BASE}/icon-192.svg`, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: `${BASE}/icon-512.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
    shortcuts: [
      { name: 'Check what I am owed', url: `${BASE}/app/#check` },
      { name: 'Deadlines', url: `${BASE}/app/#deadlines` },
    ],
  });
}


/** /privacy/ — both stores refuse a listing without a reachable policy URL. */
/* ------------------------------------------------------------------ */
/* Account — email and a six-digit code                                */
/* ------------------------------------------------------------------ */

/**
 * Sign-in, built as a real form first.
 *
 * The markup below works with JavaScript disabled up to the point where it
 * cannot: the fields post nowhere useful without the fetch handler, so the
 * noscript block says so plainly instead of leaving someone typing into a
 * form that silently does nothing.
 *
 * Individual and business are separate doors on purpose. A company account is
 * billed to the company, invoiced with its VAT number and its seats are
 * managed by whoever owns it — landing there by accident from a personal
 * sign-in would put the wrong entity on the invoice.
 */
function accountPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell" style="max-width:34rem">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Sign in' }])}
  <span class="eyebrow eyebrow-accent">Sign in</span>
  <h1 style="max-width:16ch">No password. <em class="serif-italic">Just your email.</em></h1>
  <p class="lede" style="max-width:46ch">We send a six-digit code. It works once, expires in ten
  minutes, and there is nothing for anyone to steal or for you to forget.</p>

  <div class="card" style="margin-top:2.4rem" id="auth-card">
    <div class="audience" style="margin-bottom:1.4rem">
      <input type="radio" name="acct" id="acct-me" class="audience__radio" checked>
      <input type="radio" name="acct" id="acct-biz" class="audience__radio">
      <div class="audience__switch">
        <label for="acct-me" class="audience__tab">Personal</label>
        <label for="acct-biz" class="audience__tab">Business</label>
      </div>
    </div>

    <form id="auth-form" novalidate>
      <div id="step-email">
        <label class="tiny" for="auth-email">Your email</label>
        <input class="field" type="email" id="auth-email" name="email" autocomplete="email"
               inputmode="email" required placeholder="you@example.com" style="width:100%;margin:.4rem 0 1rem">
        <button class="btn btn-primary" type="submit" id="auth-send" style="width:100%">Send me a code</button>
      </div>

      <div id="step-code" hidden>
        <p class="small" id="code-sent-to" style="margin-top:0"></p>
        <label class="tiny" for="auth-code">Six-digit code</label>
        <input class="field" type="text" id="auth-code" name="code" autocomplete="one-time-code"
               inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required
               placeholder="000000" style="width:100%;margin:.4rem 0 1rem;letter-spacing:.4em;font-size:1.3rem">
        <button class="btn btn-primary" type="submit" id="auth-verify" style="width:100%">Verify and sign in</button>
        <p style="margin:.9rem 0 0"><button class="btn btn-sm" type="button" id="auth-back">Use a different email</button></p>
      </div>

      <p class="small" id="auth-msg" role="status" aria-live="polite" style="margin:1rem 0 0;min-height:1.2em"></p>
    </form>

    <noscript>
      <p class="small"><strong>Sign-in needs JavaScript.</strong> The code is exchanged for a session
      without leaving this page, and that cannot be done with a plain form post. Everything else on this
      site — every programme, every source, the whole database — works without it.</p>
    </noscript>
  </div>

  <div id="auth-signed-in" hidden class="card" style="margin-top:1.2rem">
    <span class="eyebrow eyebrow-accent">Signed in</span>
    <h2 style="font-size:1.3rem;margin-top:.4rem" id="acct-email"></h2>
    <p class="small" id="acct-plan"></p>
    <p style="margin-top:1.2rem">
      <a class="btn btn-primary" href="${LB()}/check/">Go to my check</a>
      <a class="btn" href="/auth/signout">Sign out</a>
    </p>
  </div>

  <div class="callout" style="margin-top:1.6rem">
    <p><strong>What signing in does and does not do.</strong> It keeps your answers and your unlocked
    programmes across devices. It does not make us able to read your documents — those are encrypted on
    your device before they reach us, and the key never leaves it.</p>
  </div>
</section>

<script type="module">
import { requestCode, verifyCode, me } from '${LB()}/app/auth.js';

const $ = (s) => document.querySelector(s);
const msg = $('#auth-msg');
const form = $('#auth-form');
let email = '';
const acctType = () => ($('#acct-biz').checked ? 'business' : 'individual');

/* Already signed in? Show the account, not another sign-in form. */
me().then((s) => {
  if (!s.signedIn) return;
  $('#auth-card').hidden = true;
  $('#auth-signed-in').hidden = false;
  $('#acct-email').textContent = s.user?.email ?? '';
  $('#acct-plan').textContent = s.entitled
    ? 'Your ' + (s.plan || 'subscription') + ' is active — every programme you match is unlocked.'
    : 'Free account. You can see your total; unlock to see which programmes it comes from.';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const onCode = !$('#step-code').hidden;
  msg.textContent = '';

  if (!onCode) {
    email = $('#auth-email').value.trim();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { msg.textContent = 'That does not look like an email address.'; return; }
    const btn = $('#auth-send'); btn.disabled = true; btn.textContent = 'Sending…';
    const res = await requestCode(email, acctType());
    btn.disabled = false; btn.textContent = 'Send me a code';
    if (!res.ok) { msg.textContent = res.message || 'Could not send the code.'; return; }
    $('#step-email').hidden = true;
    $('#step-code').hidden = false;
    $('#code-sent-to').textContent = res.sent
      ? 'We sent a code to ' + email + '. It expires in ten minutes.'
      : 'Mail is not configured on this deployment yet.';
    if (res.devCode) $('#auth-code').value = res.devCode;
    $('#auth-code').focus();
    return;
  }

  const code = $('#auth-code').value.trim();
  const btn = $('#auth-verify'); btn.disabled = true; btn.textContent = 'Checking…';
  const res = await verifyCode(email, code, acctType());
  btn.disabled = false; btn.textContent = 'Verify and sign in';
  if (!res.ok) { msg.textContent = res.message || 'That code is wrong or has expired.'; return; }
  location.href = '${LB()}/check/';
});

$('#auth-back').addEventListener('click', () => {
  $('#step-code').hidden = true;
  $('#step-email').hidden = false;
  msg.textContent = '';
});
</script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Sign in — Unclaimed Grants',
    description: 'Sign in with your email and a six-digit code. No password. Personal and business accounts.',
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/account/`,
    body,
  });
}

function privacyPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell" style="max-width:44rem">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Privacy' }])}
  <span class="eyebrow eyebrow-accent">Privacy</span>
  <h1 style="max-width:18ch">What we know about you, which is almost nothing.</h1>
  <p class="lede">Last updated 14 August 2026.</p>

  <div class="callout callout--sage" style="margin-top:1.6rem">
    <p><strong>The short version.</strong> The eligibility check runs on your device. Your answers are not
    sent to us and we cannot see them. If you create an account we store your email address. If you use the
    document vault, your files are encrypted on your device before upload and we cannot open them.</p>
  </div>

  <h2 style="margin-top:2.4rem">The free check</h2>
  <p>When you answer the questions, the matching happens in your browser or in the app, against data already
  downloaded to your device. Your country, age, income band, household and housing answers are stored on
  your device only. They are never transmitted to us. You can erase them at any time from Settings, and
  clearing your browser data or uninstalling the app removes them completely.</p>

  <h2 style="margin-top:2rem">If you create an account</h2>
  <p>We store your email address, to sign you in and to send the magic link. We do not use passwords. If you
  subscribe, our payment processor (Stripe) holds your card details — we never see or store them. We keep a
  record of your subscription status so we know what to show you.</p>

  <h2 style="margin-top:2rem">The document vault</h2>
  <p>Documents are encrypted on your device with a key derived from your passphrase, before anything leaves
  it. We receive ciphertext, a coarse type label such as "proof of income", a file size and two dates. We
  deliberately do not store filenames, because a filename can reveal exactly what the encryption is there to
  protect. <strong>We cannot decrypt your documents.</strong> Neither can anyone who obtains our database and
  our storage. If you forget your passphrase, they are unrecoverable — that is the cost of the guarantee.</p>

  <h2 style="margin-top:2rem">What we do not collect</h2>
  <p>No advertising identifiers. No location. No contacts, photos or messages. No cross-site tracking, and no
  third-party analytics or advertising SDKs in the app. We do not sell or share personal data with anyone,
  and there is no category of data we would sell.</p>

  <h2 style="margin-top:2rem">Notifications</h2>
  <p>Deadline reminders are scheduled locally on your device. There is no push server and no message about
  you leaves your phone.</p>

  <h2 style="margin-top:2rem">Your rights</h2>
  <p>Under the GDPR and equivalent laws you can ask for a copy of your data, correct it, or have it deleted.
  Account deletion is available in the app and on the web and removes your email, subscription record and all
  stored documents. Write to <a class="link-underline" href="mailto:privacy@unclaimedgrant.com">privacy@unclaimedgrant.com</a>
  and we will respond within 30 days.</p>

  <h2 style="margin-top:2rem">Children</h2>
  <p>The service is not directed at children under 13 and we do not knowingly collect their data.</p>

  <h2 style="margin-top:2rem">Changes</h2>
  <p>If this policy changes materially we will say so on this page and, for account holders, by email. The
  date at the top always reflects the current version.</p>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Privacy',
    description: 'The eligibility check runs on your device. Your answers are never sent to us, and documents are encrypted before they leave your phone.',
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/privacy/`,
    body,
  });
}

/* ================================================================== */
/* Enterprise                                                          */
/* ================================================================== */

/** /enterprise/ — the dashboard product. Web only, by design. */
function enterprisePage() {
  const startupCount = STARTUP_ALL.length;
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(p.status)).length;

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Enterprise' }])}
  <span class="eyebrow eyebrow-accent">Enterprise</span>
  <h1 style="max-width:16ch" data-blur-words>One dashboard for every company you support.</h1>
  <p class="lede reveal" style="max-width:54ch;margin-top:1.2rem">
    Accelerators, funds, universities and economic development agencies run the same search dozens of times
    a year. This is that search, done once, for a whole portfolio — with the deadlines watched.
  </p>

  <div class="card reveal" data-delay="200" style="margin-top:2.6rem;padding:1.6rem">
    <div class="row-between" style="margin-bottom:1.2rem">
      <div>
        <span class="eyebrow" style="margin:0">Portfolio</span>
        <h3 style="margin:.2rem 0 0">42 companies · 3 programmes closing this week</h3>
      </div>
      <span class="status status--closing">3 closing</span>
    </div>
    <div class="grid grid-4" style="margin-bottom:1.2rem">
      <div class="stat"><span class="stat__n">€4.1M</span><span class="stat__l">In pipeline</span></div>
      <div class="stat"><span class="stat__n">18</span><span class="stat__l">Submitted</span></div>
      <div class="stat"><span class="stat__n">7</span><span class="stat__l">Awarded</span></div>
      <div class="stat"><span class="stat__n">39%</span><span class="stat__l">Hit rate</span></div>
    </div>
    <div class="list-rows">
      ${[
        ['Northwind Bio', 'EIC Accelerator', 'Drafting', 'closing', 'Closes in 9 days'],
        ['Kestrel Energy', 'Innovation Fund', 'Submitted', 'open', 'Decision Q1'],
        ['Halden Robotics', 'Eurostars', 'Eligible', 'soon', 'Opens 12 Mar'],
        ['Vantage Health', 'EXIST Transfer', 'Blocked', 'stalled', 'De minimis ceiling'],
      ]
        .map(
          (r) => `<div class="list-row">
        <div><div class="list-row__name">${r[0]}</div><div class="list-row__meta">${r[1]} · ${r[2]}</div></div>
        <div class="list-row__right"><span class="status status--${r[3]}">${r[4]}</span></div>
      </div>`,
        )
        .join('')}
    </div>
    <p class="tiny" style="margin-top:1rem">Illustrative view. Figures are sample data, not a customer's.</p>
  </div>

  <div class="grid grid-3" style="margin-top:2.6rem">
    ${[
      ['Portfolio matching', `Run every company in your portfolio against all ${nf(startupCount)} programmes at once. ${nf(openNow)} are open today. Bulk import by company number — public registers fill the rest.`],
      ['Pipeline and stages', 'Eligible → drafting → submitted → awarded, with owner, value and next action on each. The board view your programme manager is currently keeping in a spreadsheet.'],
      ['Deadline watch', 'Every closing date and projected reopening across the portfolio, pushed to calendars and email. Closed calls are tracked, not hidden — that is where next quarter\'s applications come from.'],
      ['De minimis ledger', 'Cumulative state aid per company per member state, on a rolling three-year window. Flags an award that would breach the ceiling before anyone spends six weeks on it.'],
      ['Saved searches', 'Standing queries by sector, stage and geography, with a weekly digest of what is newly open. New programmes surface without anyone re-running a search.'],
      ['Seats and visibility', 'Unlimited seats with role-based visibility, so a founder sees their own row and the programme team sees everything. SSO, audit log, data residency.'],
    ]
      .map(
        (f, i) => `<div class="card reveal" data-delay="${i * 90}">
      <h3 style="font-size:1.1rem">${f[0]}</h3>
      <p class="small">${f[1]}</p>
    </div>`,
      )
      .join('')}
  </div>

  <div class="callout" style="margin-top:2.4rem">
    <p><strong>Enterprise is web only, on purpose.</strong> A pipeline board with forty companies and six
    columns is not a phone screen. The mobile app is for individuals checking what they personally qualify
    for — different job, different device, so we built it as a different product rather than cramming a
    dashboard into a 390px viewport.</p>
  </div>

  <div class="grid grid-2" style="margin-top:1.4rem">
    <div class="card reveal">
      <span class="eyebrow">Data out</span>
      <h3 style="font-size:1.1rem">API, webhooks and CSV</h3>
      <p class="small">Everything in the dashboard is reachable over the API, so matches land in your own
      CRM rather than in another tab. Webhooks fire on status change and on reopening.
      <a class="link-underline" href="${BASE}/api/">See the API →</a></p>
    </div>
    <div class="card reveal" data-delay="120">
      <span class="eyebrow">Getting started</span>
      <h3 style="font-size:1.1rem">Bring a spreadsheet</h3>
      <p class="small">Upload your portfolio as CSV with company numbers. We resolve each against its public
      register, match it, and hand back a ranked plan per company on day one.</p>
    </div>
  </div>

  <div style="margin-top:3rem;text-align:center">
    <h2 class="reveal" style="max-width:20ch;margin-inline:auto">See it against your own portfolio.</h2>
    <p class="lede reveal" data-delay="100" style="max-width:38ch;margin:1rem auto 1.8rem">Send a CSV, get a ranked plan back.</p>
    <div class="row reveal" data-delay="180" style="justify-content:center">
      <a class="btn btn-primary" href="${LB()}/pricing/">Pricing</a>
      <a class="btn" href="${BASE}/api/">API docs</a>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Enterprise — portfolio grant matching and deadline tracking',
    description: `Match a whole portfolio against ${nf(startupCount)} funding programmes at once. Pipeline, deadline watch, de minimis tracking, saved searches, SSO and API access.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/enterprise/`,
    body,
  });
}

/* ================================================================== */
/* Startup grants                                                      */
/* ================================================================== */

const money = (n, cur) =>
  n == null ? null : `${cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : ''}${nf(n)}${cur && !['GBP', 'USD', 'EUR'].includes(cur) ? ' ' + cur : ''}`;

function instrumentBadge(p) {
  const i = INSTRUMENTS[p.grant_type];
  const free = isFreeMoney(p.grant_type);
  return `<span class="pill${free ? ' pill-accent' : ''}">${esc(i?.label ?? p.grant_type)}</span>`;
}

function startupRow(p) {
  const amt = p.amount_max ?? p.amount_min;
  return `<article class="card">
  <div class="row-between">
    <h3 style="margin:0"><a href="${LB()}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a></h3>
    ${instrumentBadge(p)}
  </div>
  ${p.name_local && p.name_local !== p.name_en ? `<p class="small" style="margin:.2rem 0 0;color:var(--ink-3)">${esc(p.name_local)}</p>` : ''}
  <div class="row" style="margin-top:.6rem">${statusChip(p)}</div>
  <p class="small" style="margin:.6rem 0 0">${esc(p.funder)}${p.funder_type === 'private' ? ' · private' : ''}</p>
  <p style="margin:.6rem 0 0"><strong>${amt != null ? esc(money(amt, p.amount_currency)) : 'Amount not published'}</strong>
  ${p.amount_note ? `<span class="small" style="color:var(--ink-3)"> — ${esc(String(p.amount_note).slice(0, 130))}</span>` : ''}</p>
  ${p.eligibility?.de_minimis ? '<p class="small" style="margin:.4rem 0 0;color:var(--terracotta)">Counts against your de minimis ceiling</p>' : ''}
</article>`;
}

/** /startups/ — the index. */
function startupsIndex() {
  const byType = {};
  for (const p of STARTUP_ALL) byType[p.grant_type] = (byType[p.grant_type] || 0) + 1;
  const nonDilutive = STARTUP_ALL.filter((p) => isFreeMoney(p.grant_type)).length;
  const priv = STARTUP_ALL.filter((p) => p.funder_type === 'private').length;

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Startup grants' }])}
  <span class="eyebrow eyebrow-accent">For founders</span>
  <h1 style="max-width:18ch">Grants your startup can take without giving up equity</h1>
  <p class="lede" style="max-width:58ch">${nf(STARTUP_ALL.length)} funding programmes across
  ${STARTUP_MANIFEST.countries.length} jurisdictions — public and private, every one with a link to the
  funder's own page. ${nf(nonDilutive)} of them are non-dilutive cash.</p>

  <div class="grid grid-4" style="margin-top:2rem">
    ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<div class="card">
      <div class="figure-sm">${n}</div>
      <p class="small">${esc(INSTRUMENTS[t]?.label ?? t)}</p>
    </div>`).join('')}
  </div>

  <div class="callout callout--sage" style="margin-top:2rem">
    <p><strong>Credits are not cash, and we never add them together.</strong> ${nf(byType.in_kind ?? 0)} of
    these are cloud or software credits. They are worth having, but a headline that mixed $100,000 of AWS
    credits into a grant total would be a lie, so instruments are counted separately everywhere on this site.
    Equity and loans are marked as such too.</p>
  </div>

  <div class="callout" style="margin-top:1.2rem">
    <p><strong>The ceiling most founders find out about too late.</strong> Small public grants across the EU
    are capped at <strong>€${nf(DE_MINIMIS_CEILING_EUR)} per company per member state over a rolling three
    years</strong> (${esc(REGULATION.general.id)}, ${esc(REGULATION.general.article)}). Go over it and the new
    award does not get trimmed — under Article 3(7) it is disqualified in full. We track what you have already
    taken and tell you before you spend six weeks on an application you are barred from.</p>
  </div>

  <h2 style="margin-top:3rem">By country</h2>
  <div class="grid grid-3" style="margin-top:1.2rem">
    ${STARTUP_MANIFEST.countries.map((c) => `<a class="card card-link" href="${LB()}/startups/${esc(c.slug)}/">
      <div class="row-between"><strong>${c.flag} ${esc(c.name)}</strong><span class="small">${c.count}</span></div>
      <p class="small" style="margin:.4rem 0 0;color:var(--ink-3)">${c.priced} with published amounts</p>
    </a>`).join('')}
  </div>

  <h2 style="margin-top:3rem">Private and corporate programmes</h2>
  <p class="small" style="max-width:56ch">${nf(priv)} of these come from companies rather than governments —
  cloud credits, foundation grants and prizes. They rarely appear in public grant databases at all.</p>
  <div class="grid grid-2" style="margin-top:1.2rem">
    ${STARTUP_ALL.filter((p) => p.funder_type === 'private').slice(0, 8).map(startupRow).join('')}
  </div>

  <p style="margin-top:2.5rem"><a class="btn btn-primary" href="${LB()}/startups/check/">Check what your company qualifies for</a></p>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Startup grants — non-dilutive funding across 27 jurisdictions',
    description: `${nf(STARTUP_ALL.length)} startup funding programmes, public and private, across ${STARTUP_MANIFEST.countries.length} jurisdictions. Sourced, dated and linked to the funder.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/`,
    body,
  });
}

/** /startups/{cc}/ */
/* The personal dataset also carries a `business` category — 152 SME and
   self-employment records written for the household engine. They overlap the
   startup dataset by 4 programmes. Rather than delete either (a self-employed
   person browsing benefits should still see SBA Microloans, and so should a
   founder), the two are cross-linked. */
function hasPersonalBusiness(cc) {
  const entry = countries.find((c) => c.entry.slug === cc);
  return entry ? entry.data.programmes.some((p) => p.category === 'business') : false;
}

function startupCountryPage(c) {
  const data = STARTUP_DATA[c.slug];
  const reg = REGISTRIES[c.slug];
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Startup grants', href: `${LB()}/startups/` }, { label: c.name }])}
  <span class="eyebrow eyebrow-accent">${c.flag} ${esc(c.name)}</span>
  <h1>Startup funding in ${esc(c.name)}</h1>
  <p class="lede" style="max-width:56ch">${c.count} programmes, ${c.priced} with a published amount.
  ${reachFor(c.slug).includes('eu') && c.slug !== 'eu' ? 'EU-level programmes are open to you too — see the EU page.' : ''}</p>

  ${
    hasPersonalBusiness(c.slug)
      ? `<div class="callout" style="margin-top:1.5rem">
    <p><strong>Also worth checking:</strong> the
    <a href="${LB()}/${esc(c.slug)}/business/">business support schemes in our benefits dataset</a> for
    ${esc(c.name)} — SME and self-employment programmes aimed at sole traders and very small firms rather
    than at funded startups.</p>
  </div>`
      : ''
  }

  ${reg ? `<div class="callout${reg.available ? ' callout--sage' : ''}" style="margin-top:1.5rem">
    <p><strong>${reg.available ? 'Auto-fill is available here.' : 'Auto-fill is not available here.'}</strong>
    ${esc(reg.name)} — ${esc(reg.note)}</p>
  </div>` : ''}

  <div class="grid grid-2" style="margin-top:2rem">
    ${data.programmes.map(startupRow).join('')}
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `Startup grants in ${c.name} — ${c.count} programmes`,
    description: `${c.count} startup funding programmes in ${c.name}, each linked to the funder's own page.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/${c.slug}/`,
    body,
  });
}

/** /startups/{cc}/{slug}/ */
function startupProgrammePage(c, p) {
  const amt = p.amount_max ?? p.amount_min;
  const e = p.eligibility || {};
  const crit = [
    e.company_age_months_max != null ? `Under ${Math.round(e.company_age_months_max / 12)} years old` : null,
    e.headcount_max != null ? `Up to ${e.headcount_max} employees` : null,
    e.turnover_annual_max != null ? `Turnover up to ${nf(e.turnover_annual_max)}` : null,
    e.sme_category && e.sme_category !== 'any' ? `${e.sme_category} enterprises` : null,
    (e.sectors || []).filter((x) => x && x !== 'any').length ? `Sectors: ${e.sectors.join(', ')}` : null,
    (e.stages || []).length ? `Stage: ${e.stages.join(', ')}` : null,
    e.rd_focus ? 'R&D activity required' : null,
    e.female_founder_only ? 'Female founders' : null,
    e.requires_local_entity ? 'Locally registered entity required' : null,
  ].filter(Boolean);

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([
    { label: TR('backHome'), href: `${LB()}/` },
    { label: 'Startup grants', href: `${LB()}/startups/` },
    { label: c.name, href: `${LB()}/startups/${c.slug}/` },
    { label: p.name_en },
  ])}
  <span class="eyebrow eyebrow-accent">${esc(INSTRUMENTS[p.grant_type]?.label ?? p.grant_type)}</span>
  <h1 style="max-width:20ch">${esc(p.name_en)}</h1>
  ${p.name_local && p.name_local !== p.name_en ? `<p class="lede">${esc(p.name_local)}</p>` : ''}

  ${(() => {
    const d = deadlineState(p, BUILD_NOW);
    return `<div class="card" style="margin-top:1.6rem">
      <div class="row-between">
        <div>
          <span class="eyebrow" style="margin:0">Status</span>
          <h2 style="font-size:1.5rem;margin:.2rem 0 .3rem">${esc(d.headline)}</h2>
          <p class="small" style="margin:0;max-width:52ch">${esc(d.detail)}</p>
        </div>
        <span class="status status--${d.urgency}">${esc(d.meta.label)}</span>
      </div>
      ${d.projected ? '<p class="tiny" style="margin-top:.8rem">Projected from the pattern of past calls — confirm on the funder\'s page before planning around it.</p>' : ''}
    </div>`;
  })()}

  <div class="grid grid-2" style="margin-top:1.2rem;align-items:stretch">
    <div class="card">
      <span class="eyebrow">Amount</span>
      <div class="figure-sm">${amt != null ? esc(money(amt, p.amount_currency)) : 'Not published'}</div>
      ${p.amount_note ? `<p class="small">${esc(p.amount_note)}</p>` : ''}
      ${p.cofunding_pct != null ? `<p class="small"><strong>You must co-fund ${p.cofunding_pct}%.</strong></p>` : ''}
    </div>
    <div class="card">
      <span class="eyebrow">Funder</span>
      <p style="margin:.4rem 0 0"><strong>${esc(p.funder)}</strong></p>
      <p class="small">${esc(p.funder_type)} · ${esc(p.admin_level)}</p>
      <p class="small">Deadline: ${esc(p.deadline_type)}${p.deadline_note ? ` — ${esc(p.deadline_note)}` : ''}</p>
    </div>
  </div>

  ${(() => {
    const L = awardLikelihood(p);
    const eff = effortFor(p);
    if (L.basis === 'class_prior' && !L.detail) return '';
    return `<div class="grid grid-2" style="margin-top:1.2rem;align-items:stretch">
    <div class="card">
      <span class="eyebrow">Your odds</span>
      <div class="figure-sm">${L.p_published != null ? (L.p_published * 100).toFixed(1) + '%' : 'Not published'}</div>
      <p class="small">${
        L.p_published != null
          ? `${L.basis === 'published' ? 'Published by the funder' : 'Derived from official counts'}${L.period ? `, ${esc(L.period)}` : ''}.${L.haircut !== 1 ? ` This rate is measured ${esc(String(L.stage).replace(/_/g, ' '))}, so the odds from a standing start are lower.` : ''}`
          : 'This funder does not publish a success rate. We rank it using the rate observed across similar programmes and label it as an estimate rather than implying we know.'
      }</p>
      ${L.source_url && L.p_published != null ? `<p class="small"><a href="${esc(L.source_url)}" rel="nofollow noopener">Source</a></p>` : ''}
    </div>
    <div class="card">
      <span class="eyebrow">Effort</span>
      <div class="figure-sm" style="text-transform:capitalize">${esc(eff.tier)}</div>
      <p class="small">${esc(eff.label)}.</p>
      ${p.cofunding_pct != null && p.cofunding_pct > 0 ? `<p class="small"><strong>You fund ${p.cofunding_pct}% yourself.</strong></p>` : ''}
    </div>
  </div>`;
  })()}

  ${e.de_minimis ? `<div class="callout" style="margin-top:1.5rem;border-color:var(--terracotta)">
    <p><strong>This is de minimis aid.</strong> It counts against the €${nf(DE_MINIMIS_CEILING_EUR)} ceiling
    that applies to your company across a rolling three years in this member state
    (${esc(REGULATION.general.id)}). If a new award would take you over, Article 3(7) disqualifies that award
    in full rather than reducing it — so check your headroom before you apply, not after.</p>
  </div>` : ''}

  ${crit.length ? `<h2 style="margin-top:2.5rem">Who can apply</h2>
  <ul>${crit.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  ${e.other_note ? `<p class="small">${esc(e.other_note)}</p>` : ''}

  ${(p.procedure_steps || []).length ? `<h2 style="margin-top:2.5rem">How to apply</h2>
  <ol>${p.procedure_steps.map((st) => `<li>${esc(st.detail)}${st.url ? ` — <a href="${esc(st.url)}">link</a>` : ''}</li>`).join('')}</ol>` : ''}

  ${(p.documents_required || []).length ? `<h2 style="margin-top:2rem">What you will need</h2>
  <ul>${p.documents_required.map((d) => `<li>${esc(d.doc)}${d.mandatory === false ? ' <span class="small">(if applicable)</span>' : ''}</li>`).join('')}</ul>` : ''}

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${esc(p.application_url)}" rel="nofollow noopener">Apply on the funder's site</a></p>

  <div class="callout" style="margin-top:2rem">
    <p><strong>Source.</strong> <a href="${esc(p.source_url)}" rel="nofollow noopener">${esc(p.source_url)}</a>
    ${p.last_verified_at ? ` — checked ${esc(p.last_verified_at)}` : ''}
    ${p.verification_status !== 'verified' ? ' · <strong>not human-checked</strong>' : ''}</p>
    ${p.source_snippet ? `<p class="small" style="margin-top:.6rem">"${esc(String(p.source_snippet).slice(0, 300))}"</p>` : ''}
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `${p.name_en} — ${c.name} startup funding`,
    description: `${p.name_en} from ${p.funder}. ${amt != null ? money(amt, p.amount_currency) + '. ' : ''}Eligibility, steps and documents, linked to the official page.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/${c.slug}/${p.slug}/`,
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
  ALT = altFor('/enterprise/');
  page(`${pre}enterprise/index.html`, enterprisePage());
  ALT = altFor('/privacy/');
  page(`${pre}privacy/index.html`, privacyPage());
  page(`${pre}account/index.html`, accountPage());

  for (const aud of AUDIENCES) {
    ALT = altFor(`/for/${aud.id}/`);
    page(`${pre}for/${aud.id}/index.html`, audienceIndexPage(aud));
  }

  if (lang === 'en') {
    ALT = altFor('/startups/');
    page('startups/index.html', startupsIndex());
    for (const c of STARTUP_MANIFEST.countries) {
      ALT = altFor(`/startups/${c.slug}/`);
      page(`startups/${c.slug}/index.html`, startupCountryPage(c));
      for (const p2 of STARTUP_DATA[c.slug].programmes) {
        ALT = altFor(`/startups/${c.slug}/${p2.slug}/`);
        page(`startups/${c.slug}/${p2.slug}/index.html`, startupProgrammePage(c, p2));
      }
    }

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

/* GitHub Pages reads the custom domain from a CNAME file in the published
   artifact. Without it, every deploy silently reverts the site to the
   github.io subdomain and breaks the canonical URLs. */
write('CNAME', 'unclaimedgrant.com\n');

/* --- The app ---------------------------------------------------- */
write('app/index.html', appShell());
write('app/app.css', fs.readFileSync(path.join(SRC, 'pwa/app.css'), 'utf8'));
write('app/app.js', fs.readFileSync(path.join(SRC, 'pwa/app.js'), 'utf8'));
write('app/native.js', fs.readFileSync(path.join(SRC, 'pwa/native.js'), 'utf8'));
write('app/auth.js', fs.readFileSync(path.join(SRC, 'pwa/auth.js'), 'utf8'));
/* The service worker must sit at the root to claim the whole scope. */
write('sw.js', fs.readFileSync(path.join(SRC, 'pwa/sw.js'), 'utf8'));
write('manifest.webmanifest', webManifest());
write('icon-192.svg', appIcon(192));
write('icon-512.svg', appIcon(512));
/* The app imports these by relative path, so they must exist alongside it. */
/* The source lives at src/engine/startup.js and imports ../../packages/...,
   which is correct in the repo but escapes dist/ once emitted. Rewrite the
   specifier in the served copy so the browser can actually resolve it. */
write(
  'engine/startup.js',
  fs
    .readFileSync(path.join(SRC, 'engine/startup.js'), 'utf8')
    .replace(/from '\.\.\/\.\.\/packages\//g, "from '../packages/"),
);
write('packages/deadlines/index.js', fs.readFileSync(path.join(ROOT, 'packages/deadlines/index.js'), 'utf8'));
write('packages/scoring/index.js', fs.readFileSync(path.join(ROOT, 'packages/scoring/index.js'), 'utf8'));
write('packages/scoring/rates.js', fs.readFileSync(path.join(ROOT, 'packages/scoring/rates.js'), 'utf8'));

/* Startup pools as JSON assets. The Worker reads these through env.ASSETS
   rather than bundling the dataset, so a data refresh is a rebuild and not a
   redeploy of code. Pools, not countries: `eu` and `global` are real pools
   that many countries draw on. */
for (const c of STARTUP_MANIFEST.countries) {
  write(`api/v1/startups/${c.slug}.json`, JSON.stringify(STARTUP_DATA[c.slug]));
}
write(
  'api/v1/startups/index.json',
  JSON.stringify({
    generated_at: STARTUP_MANIFEST.generated_at,
    total: STARTUP_MANIFEST.total,
    countries: STARTUP_MANIFEST.countries.map((c) => ({
      ...c,
      data_url: `${BASE}/api/v1/startups/${c.slug}.json`,
    })),
  }),
);
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
