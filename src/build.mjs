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
  isEmployerAid,
  isUnpricedMeansTest,
  monthsPayable,
  periodSuffix,
} from './engine/matcher.js';
import { LOCALES, LANGS, t as translator } from './i18n.mjs';
import { iconPng } from './icon-raster.mjs';
import { POSTS, blogFacts } from './blog.mjs';
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
  amountBasis,
  ASSET_V,
  progHref,
  categoryLabel,
  benefitTypeLabel,
  listRow,
  locked,
  teaseList,
  FREE_ROWS,
  paywallLd,
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
 * That was the reasoning for leaving them open. The owner has decided the
 * other way, three times, and it is his product: the schemes are now gated by
 * DEFAULT, and PAYWALL_SCHEMES=0 opens them again.
 *
 * Losing the traffic is not a foregone conclusion, because the pages are not
 * simply hidden. Each one keeps its title, its funder, its category and its
 * link to the official source — enough for a crawler to understand and rank
 * it — and declares the gate with schema.org's isAccessibleForFree markup.
 * That is Google's documented mechanism for paywalled content: without it,
 * showing the crawler more than the visitor is cloaking and gets the site
 * deindexed; with it, the page stays in the index and the human still pays.
 */
const PAYWALL_SCHEMES = process.env.PAYWALL_SCHEMES !== '0';
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

/* Not every page exists in every language. A localised build only generates the
 * countries that actually speak the language, and the startups section is
 * English-only — so prefixing those hrefs with the language code produced 701
 * dead links (a German visitor on /de/countries/ could not open Japan).
 *
 * These two helpers pick the prefix per target rather than per page: link to
 * the localised page when there is one, and fall back to English when there
 * is not. Falling back beats hiding the link — the English page is a real
 * answer, and a country list missing two thirds of the world is not. */

/** Link base for a country's pages: localised if this language builds it. */
function CB(cc) {
  const only = LOCALES[L]?.countries;
  return !only || only.includes(cc) ? LB() : BASE;
}
/** Link base for the startups section, which is only ever built in English. */
const SB = () => BASE;

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

/**
 * The rotating hero graphic.
 *
 * First attempt put a labelled disc in the middle and orbited the currency
 * marks. Both were wrong on the live page: the disc landed on top of the
 * headline and repeated the eyebrow, and the counter-rotation meant to keep
 * the glyphs upright only half-worked, so they drifted through the words at
 * an angle. Now the dashed rings turn and the marks hold still.
 *
 * Drawn rather than sourced: an image file would be one more thing to host,
 * would need an alt text that says nothing, and would not know how many
 * jurisdictions are in the dataset. This does — the ring is generated from the
 * real count, so the picture cannot drift from the data underneath it.
 *
 * Three rings turning at different speeds and directions, with currency marks
 * riding the outer one. Marked aria-hidden: it is atmosphere, and a screen
 * reader announcing sixteen currency symbols would be actively worse than
 * silence.
 */
function orbit(jurisdictions) {
  const marks = ['€', '£', '$', '¥', '₹', 'kr', 'CHF', 'R$', '₩', 'AED', 'zł', 'MX$'];
  const R = 150;
  const dots = marks
    .map((m, i) => {
      const a = (i / marks.length) * Math.PI * 2 - Math.PI / 2;
      const x = 160 + R * Math.cos(a);
      const y = 160 + R * Math.sin(a);
      return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle r="15" class="orbit__chip"/>
        <text y="4" text-anchor="middle" class="orbit__mark">${m}</text>
      </g>`;
    })
    .join('');

  return `<div class="orbit reveal" aria-hidden="true">
    <svg viewBox="0 0 320 320" role="presentation">
      <defs>
        <linearGradient id="orbitStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--teal)" stop-opacity=".55"/>
          <stop offset="50%" stop-color="var(--teal)" stop-opacity=".08"/>
          <stop offset="100%" stop-color="var(--blue)" stop-opacity=".5"/>
        </linearGradient>
      </defs>
      <circle cx="160" cy="160" r="150" class="orbit__ring orbit__ring--slow"/>
      <circle cx="160" cy="160" r="119" class="orbit__ring orbit__ring--mid"/>
      <circle cx="160" cy="160" r="88"  class="orbit__ring orbit__ring--fast"/>
      <g class="orbit__marks">${dots}</g>
    </svg>
  </div>`;
}

function landing() {
  const startupCount = STARTUP_ALL.length;
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(p.status)).length;
  const reopening = STARTUP_ALL.filter(
    (p) => ['closed', 'paused'].includes(p.status) && (p.reopen_note || p.opens_at || (p.typical_months || []).length),
  ).length;
  const jurisdictions = new Set([...countries.map((c) => c.entry.slug), ...STARTUP_MANIFEST.countries.map((c) => c.slug)]).size;

  const body = `
<section class="hero-centre" style="padding:clamp(3.5rem,8vw,6rem) 0 clamp(3rem,6vw,5rem);position:relative">
  <div class="shell">
    ${orbit(jurisdictions)}
    <span class="eyebrow eyebrow-accent reveal">${nf(STATS.total + startupCount)} sourced programmes · ${jurisdictions} jurisdictions</span>
    <h1 style="max-width:18ch;margin-inline:auto" data-blur-words>The money you are owed, and nobody told you about.</h1>
    <p class="lede reveal" data-delay="200" style="max-width:54ch;margin:1.4rem auto 0">
      Governments and funders hand out rent support, family payments, R&amp;D credits and startup grants
      every year. Most of it goes unclaimed because nobody can find it. We found it, sourced it, and dated it.
    </p>

    <div class="row reveal" data-delay="340" style="margin-top:2.2rem;gap:.7rem;justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">Check what you're owed</a>
      <a class="btn" href="${SB()}/startups/">I'm a founder</a>
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
    <div class="steps4">
      ${[
        ['1', 'Tell us about you', 'Country, situation, rough income. No account, no email, nothing stored — the matcher runs in your browser.'],
        ['2', 'See the number', 'What you are owed across every programme you qualify for. Free, always, no wall.'],
        ['3', 'Get the list and the paperwork', 'Which schemes, what each needs, and a prepared application per claim with the fields already filled.'],
        ['4', 'Never miss the window', 'Deadlines in your calendar, and an alert when a closed programme reopens.'],
      ]
        .map(
          (st) => `<div class="step4">
        <div class="step4__n">${st[0]}</div>
        <h3>${st[1]}</h3>
        <p>${st[2]}</p>
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
      <a class="card card-link reveal" data-delay="120" href="${SB()}/startups/">
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
    { label: entry.name, href: `${CB(cc)}/${cc}/` },
    { label: categoryLabel(p.category), href: `${CB(cc)}/${cc}/${p.category}/` },
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
    .filter((x) => x.category === p.category && x.slug !== p.slug);
  const relatedRows = related
    .slice(0, FREE_ROWS)
    .map((x) => listRow(BASE, cc, x, data.currency));

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

      ${locked({
        title: 'What this pays',
        blurb: 'The published value, how it is calculated, and whether it is cash or a credit ceiling.',
        rows: 2,
      })}

      ${(() => {
        const tags = circumstanceTags(p);
        if (!tags.length) return '';
        const labels = tags.map((id) => CIRCUMSTANCES.find((c) => c.id === id)?.short || id).join(' or ');
        return `<div class="callout callout--terracotta" style="margin:1.5rem 0"><p style="margin:0"><strong>Gated on a personal circumstance.</strong>
          This programme depends on ${esc(labels)} — a condition the structured eligibility fields below do not capture.
          Read the official page carefully before assuming you qualify.</p></div>`;
      })()}

      ${PAYWALL_SCHEMES
        ? locked({
            title: 'Who qualifies',
            blurb: `The ${ruleRows.length} published rules this programme tests you against — age, income, residency, household and the rest.`,
            rows: Math.min(ruleRows.length, 4),
          })
        : `<h2 style="margin-top:2.5rem">Who qualifies</h2>
      <table class="rule-table">${ruleRows.join('')}</table>`}

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
        PAYWALL_SCHEMES
          ? (p.documents_required || []).length
            ? locked({
                title: `${(p.documents_required || []).length} documents you'll need`,
                blurb: 'Exactly what to gather before you start, so nothing sends you back to the beginning.',
                rows: Math.min((p.documents_required || []).length, 4),
              })
            : ''
          : docs
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

      ${related.length ? `<h2 style="margin-top:3rem">Other ${esc(categoryLabel(p.category).toLowerCase())} support in ${esc(entry.name)}</h2>${teaseList({ rows: relatedRows, total: related.length, noun: 'programmes', href: `${LB()}/pricing/` })}` : ''}
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

  /* Declared, not hidden. See paywallLd(). */
  const paywallMarkup = PAYWALL_SCHEMES
    ? paywallLd({
        headline: `${p.name_en} — ${entry.name}`,
        url: `${SITE_URL}/${cc}/${p.category}/${p.slug}/`,
      })
    : '';

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${p.name_en} — ${entry.name}`,
    description: `${p.name_en}${p.name_local !== p.name_en ? ` (${p.name_local})` : ''}: who qualifies, ${amt ? `worth ${amt}, ` : ''}documents needed, how to apply, and the official ${p.funder} source. Last checked ${p.last_verified_at}.`,
    canonical: `${SITE_URL}/${cc}/${p.category}/${p.slug}/`,
    body: paywallMarkup + body,
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
      return `<section style="margin-top:3rem">
        <div class="spread" style="border-bottom:1px solid var(--line);padding-bottom:.6rem">
          <h2 style="font-size:clamp(1.3rem,2.2vw,1.9rem);margin:0">${esc(categoryLabel(cat))}</h2>
          <span class="small">${list.length} ${esc(categoryLabel(cat).toLowerCase())} programmes</span>
        </div>
        ${teaseList({
          rows: list.slice(0, FREE_ROWS).map((p) => listRow(BASE, cc, p, data.currency)),
          total: list.length,
          noun: `${categoryLabel(cat).toLowerCase()} programmes`,
          href: `${LB()}/pricing/`,
        })}
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
      .map((c) => `<a class="tag" href="${CB(cc)}/${cc}/${c}/">${esc(categoryLabel(c))} <span class="tiny">${cats[c].length}</span></a>`)
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
    dataset of <a href="${SB()}/startups/${esc(entry.slug)}/">${STARTUP_DATA[entry.slug].programmes.length}
    startup funding programmes in ${esc(entry.name)}</a> — grants, R&D credits and cloud credits, ranked by
    what you can realistically win rather than by headline size.</p>
  </div>`
      : '';
  const cc = entry.slug;
  const crumbs = [
    { label: 'Home', href: `${LB()}/` },
    { label: entry.name, href: `${CB(cc)}/${cc}/` },
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
  <div style="margin-top:2rem">
    ${teaseList({
      rows: list
        .slice()
        .sort((a, b) => (b.amount_max ?? b.amount_min ?? -1) - (a.amount_max ?? a.amount_min ?? -1))
        .slice(0, FREE_ROWS)
        .map((p) => listRow(BASE, cc, p, data.currency)),
      total: list.length,
      noun: `${categoryLabel(cat).toLowerCase()} programmes`,
      href: `${LB()}/pricing/`,
    })}
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
      return `<a class="list-row" href="${CB(entry.slug)}/${entry.slug}/${cat}/">
        <span><span class="list-row__name">${entry.flag} ${esc(entry.name)}</span>
        <span class="list-row__meta">${list
          .slice(0, FREE_ROWS)
          .map((p) => esc(p.name_en))
          .join(' · ')}${list.length > FREE_ROWS ? ` · and ${list.length - FREE_ROWS} more` : ''}</span></span>
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
      return `<a class="list-row" href="${CB(entry.slug)}/${entry.slug}/">
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
<script type="module" src="${BASE}/app.js?v=${ASSET_V}"></script>`;

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

  const tier = (t) => `<div class="card reveal${t.featured ? ' card--featured' : ''}" data-delay="${t.delay}">
    <span class="eyebrow${t.featured ? ' eyebrow-accent' : ''}">${t.eyebrow}</span>
    <div class="figure-sm">${t.price}${t.per ? `<span style="font-size:.9rem;color:var(--ink-4);font-family:var(--font-body)">${t.per}</span>` : ''}</div>
    ${t.second ? `<p class="small" style="margin:-.3rem 0 .6rem;color:var(--ink-4)">${t.second}</p>` : ''}
    <p class="small">${t.blurb}</p>
    <ul class="ticks">
      ${t.features.map((f) => `<li>${f}</li>`).join('')}
    </ul>
    ${
      t.excludes
        ? `<ul class="ticks ticks--no">${t.excludes.map((f) => `<li>${f}</li>`).join('')}</ul>`
        : ''
    }
    <p style="margin-top:1.6rem"><a class="btn ${t.featured ? 'btn-primary' : ''}" href="${t.href}">${t.cta}</a></p>
    ${t.note ? `<p class="tiny" style="margin-top:.8rem">${t.note}</p>` : ''}
  </div>`;

  /* The line every free tier repeats, written once.
     Free is deliberately, legibly small: the total and the count. Saying so in
     the same words in three places is how a visitor learns it is a rule and
     not an oversight. */
  const FREE_EXCLUDES = [
    'Which programmes — names are on the paid plan',
    'The programme directory',
    'Documents, deadlines and prepared applications',
  ];

  const APP_LINE = '<strong>The Android and iOS app</strong> — free plan included';

  /* One toggle, in the hero, above everything it changes.
     Radio inputs and sibling selectors rather than a click handler: both
     panels are in the HTML, so the page works with JavaScript off, both halves
     are indexed, and there is no flash of the wrong price while a script
     boots. The previous version put Enterprise in a third tab further down the
     page, where it appeared without being asked for. */
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Pricing' }])}

  <div class="audience">
    <input type="radio" name="audience" id="aud-me" class="audience__radio" checked>
    <input type="radio" name="audience" id="aud-ent" class="audience__radio">

    <div class="hero-centre">
      <span class="eyebrow eyebrow-accent">Pricing</span>
      <h1 style="max-width:16ch;margin-inline:auto">Finding out is free. <em class="serif-italic">Always.</em></h1>
      <p class="lede" style="max-width:52ch;margin-inline:auto">You never pay to learn the number. You pay
      when you want to know which programmes it came from, and to have the paperwork done.</p>

      <div class="audience__switch audience__switch--hero" role="tablist" aria-label="Who is this for">
        <label for="aud-me" class="audience__tab">Individuals &amp; startups</label>
        <label for="aud-ent" class="audience__tab">Enterprise</label>
      </div>
    </div>

    <div class="audience__panel audience__panel--me">
      <div class="grid grid-3" style="margin-top:2.2rem;align-items:stretch">
        ${tier({
          delay: 0, eyebrow: 'Free', price: '€0', per: ' forever',
          blurb: 'How much you are owed, and how many places it comes from. For people and for companies — the free tier is the same either way.',
          features: [
            '<strong>How much you are eligible for</strong>, per year',
            '<strong>How many programmes</strong> it comes from',
            'How many of those pay out automatically',
            APP_LINE,
            'No account needed to see the number',
          ],
          excludes: FREE_EXCLUDES,
          href: `${LB()}/check/`, cta: 'Check your total',
          note: 'The check runs on your device. Nothing you type is sent anywhere.',
        })}
        ${tier({
          delay: 110, eyebrow: 'Personal', price: '€50', per: '/year', featured: true,
          second: 'or €7/month — the annual plan saves €34',
          blurb: 'For a household claiming what it is entitled to.',
          features: [
            '<strong>Which programmes</strong>, by name',
            `The full directory — all ${nf(STATS.total)} records with rules and sources`,
            '<strong>A document checklist per claim</strong>, in your dashboard',
            'Every document reused across every later claim that asks for it',
            'Exact steps, deadlines and a calendar export',
            '<strong>Auto-apply where it is legally available</strong>',
            APP_LINE,
          ],
          href: `${LB()}/check/`, cta: 'Start with the free check',
          note: 'Cancel any time. Same price whether you are owed nothing or €9,000.',
        })}
        ${tier({
          delay: 220, eyebrow: 'Startup', price: '€49', per: '/month',
          second: 'or €490/year · one company, one seat',
          blurb: 'For a founder chasing grants for their own company.',
          features: [
            `All ${nf(startupCount)} startup programmes by name, ranked by what you can realistically win`,
            'Award odds and effort estimate per programme',
            '<strong>EU de minimis ceiling tracking</strong>',
            'Company auto-fill from public registers',
            'Document checklist reused across applications',
            'Reopen alerts, saved searches, weekly digest',
            APP_LINE,
          ],
          href: `${SB()}/startups/check/`, cta: 'Check your company',
        })}
      </div>

      <div class="callout callout--sage" style="margin-top:1.6rem">
        <p><strong>What free actually gets you, stated plainly.</strong> The total and the count. Not a
        shortened list, not the first few names, not a teaser you can piece together — the programme names are
        the product. We would rather say that on the pricing page than have you find out at the end of a
        ten-minute questionnaire.</p>
      </div>

      <div class="callout" style="margin-top:1.4rem">
        <p><strong>The apps are free.</strong> Android and iOS, on the free plan and the paid one. A free user
        gets their number on their phone, offline, with no account. Paying unlocks the same extra content in the
        app as on the web — it is one subscription, not two.</p>
      </div>

      <div class="callout callout--sage" style="margin-top:1.4rem">
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

    <div class="audience__panel audience__panel--ent">
      <div class="panel panel--float" style="margin-top:2.2rem">
        <span class="eyebrow eyebrow-accent">Enterprise · from €80 per seat / month</span>
        <h2 style="max-width:20ch;margin-top:.5rem">Grant work stops being scattered. <em class="serif-italic">It becomes a system.</em></h2>
        <p class="lede" style="max-width:58ch">For accelerators, funds, universities, chambers and public bodies running
        many applicants at once. One place to find what they qualify for, write the applications, track every
        submission, keep the funder relationships warm, and prove where the money went.</p>
        <p style="margin-top:1.6rem">
          <a class="btn btn-primary" href="${BASE}/dashboard/">Open the workspace</a>
          <a class="btn" href="${LB()}/enterprise/">What it does</a>
          <a class="btn btn-ghost" href="mailto:hello@unclaimedgrant.com?subject=Enterprise%20trial">Talk to us</a>
        </p>
        <p class="tiny">€800 per seat per year if you pay annually. Web only — a pipeline board with forty
        companies is not a phone screen.</p>
      </div>

      <div class="grid grid-2x" style="align-items:stretch">
        ${[
          {
            eyebrow: 'Find',
            title: 'Match a portfolio, not a company',
            body: `Run every company you back against all ${nf(startupCount)} programmes at once, ranked by what
                   each can realistically win rather than by headline size. Saved searches re-run weekly and surface
                   only what is new, so the pipeline stays current without anyone refreshing it.`,
          },
          {
            eyebrow: 'Write',
            title: 'Applications that start part-written',
            body: `A shared library of your standard answers, company facts and past applications. Each new
                   application opens with the register fields filled and its provenance shown, scored against the
                   programme's own published criteria, with every issue flagged before you submit.`,
          },
          {
            eyebrow: 'Track',
            title: 'Every application, and where it stands',
            body: `One tab listing every grant applied for across the portfolio: who submitted it, when, for how
                   much, what came back and what is still outstanding. Entries are created automatically the moment
                   an opportunity enters the pipeline, so nothing depends on someone remembering to log it.`,
          },
          {
            eyebrow: 'Manage',
            title: 'The part after the award',
            body: `Milestones, reports and deliverables with their own dates and reminders, a de minimis ledger per
                   portfolio company, and a record per funder of who you spoke to and when to follow up. Reopen
                   alerts on closed calls, before the window opens rather than after it shuts.`,
          },
        ]
          .map(
            (c, i) => `<div class="panel panel--float reveal" data-delay="${i * 110}">
          <span class="eyebrow eyebrow-accent">${c.eyebrow}</span>
          <h3 style="font-size:1.25rem;margin:.4rem 0 .5rem">${c.title}</h3>
          <p class="small" style="margin:0">${c.body}</p>
        </div>`,
          )
          .join('')}
      </div>

      <div class="grid grid-3" style="align-items:stretch">
        ${[
          ['Up and running in days', 'No implementation fee and no scoping call. Import your companies, invite the team, start matching.'],
          ['Fits your existing tools', 'Deadlines to your calendar, records to your CRM, exports to your sheet. API and webhooks for anything else.'],
          ['Accountable to a board', 'SSO, an audit log of who saw and sent what, role-based visibility, and EU data residency.'],
        ]
          .map(
            (c, i) => `<div class="panel panel--float reveal" data-delay="${i * 110}">
          <h3 style="font-size:1.1rem;margin:0 0 .4rem">${c[0]}</h3>
          <p class="small" style="margin:0">${c[1]}</p>
        </div>`,
          )
          .join('')}
      </div>

      <div class="callout" style="margin-top:1.6rem">
        <p><strong>Why this is priced per seat and the other plans are not.</strong> A founder checking one company
        is a search, and it costs us the same whether they run it once or fifty times. An accelerator is people:
        each analyst has their own pipeline, their own funder conversations and their own deadlines to miss. The
        work scales with the number of people doing it, so the price does too.</p>
      </div>
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:1.8rem;align-items:stretch">
    <div class="card reveal">
      <span class="eyebrow">Included on every paid plan</span>
      <h2 style="font-size:1.3rem;margin-top:.4rem">A checklist that fills itself in</h2>
      <p class="small">Every claim wants a payslip, a proof of address, a birth certificate. The dashboard lists
      exactly what each programme asks for, and keeping a document once ticks it off on every later claim that
      wants it. <strong>Encrypted on your device before it reaches us</strong> — we hold scrambled bytes and a
      label, and cannot open your files.</p>
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
    description: `Free forever to see how much you are owed and how many programmes it comes from, on web and in the Android and iOS apps. Paid unlocks the names, the directory, the document checklist and auto-apply. Personal €50/year, Startup €49/month, Enterprise from €80/seat/month across ${nf(totalProgrammes)} programmes.`,
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
<meta name="theme-color" content="#eef7f7">
<link rel="manifest" href="${BASE}/manifest.webmanifest">
<link rel="stylesheet" href="${BASE}/app/app.css?v=${ASSET_V}">
<link rel="apple-touch-icon" sizes="180x180" href="${BASE}/icon-180.png">
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
      <stop offset="0%" stop-color="#125a63"/><stop offset="55%" stop-color="#0f3d47"/><stop offset="100%" stop-color="#0c333c"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <circle cx="${r}" cy="${r}" r="${size * 0.27}" fill="none" stroke="#4fd1c5" stroke-width="${size * 0.055}"/>
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
    background_color: '#eef7f7',
    theme_color: '#0f6f76',
    categories: ['finance', 'productivity', 'utilities'],
    lang: 'en',
    icons: [
      /* PNG first: an installer that cannot rasterise SVG takes the second
         entry rather than falling back to a screenshot of the page. */
      { src: `${BASE}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
/* ================================================================== */
/* Blog                                                                */
/* ================================================================== */

/* Facts are computed once per build and shared by every post, so two posts
   cannot disagree about the same figure. */
let BLOG_FACTS = null;
const facts = () => (BLOG_FACTS ??= blogFacts({ countries, startups: STARTUP_ALL, stats: STATS }));

const postTitle = (post) => (typeof post.title === 'function' ? post.title(facts()) : post.title);

const fmtPostDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function blogIndex() {
  const posts = POSTS.slice().sort((a, b) => b.date.localeCompare(a.date));
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Writing' }])}
  <div class="hero-centre">
    <span class="eyebrow eyebrow-accent">Writing</span>
    <h1 style="max-width:18ch;margin-inline:auto">What ${nf(STATS.total)} support programmes look like from the inside.</h1>
    <p class="lede" style="max-width:54ch;margin-inline:auto">Analyses of the dataset behind this site. Every
    figure in every post is computed from the records at build time, so none of it goes quietly out of date.</p>
  </div>

  <div class="grid grid-2x" style="margin-top:2.6rem;align-items:stretch">
    ${posts
      .map(
        (post, i) => `<a class="card card-link reveal" data-delay="${i * 70}" href="${BASE}/blog/${post.slug}/">
      <span class="eyebrow">${esc(fmtPostDate(post.date))}</span>
      <h2 style="font-size:1.3rem;margin:.3rem 0 .5rem">${esc(postTitle(post))}</h2>
      <p class="small" style="margin:0">${esc(post.summary)}</p>
    </a>`,
      )
      .join('')}
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Writing — analyses of the support-programme dataset',
    description: `Data-driven writing about government benefits and startup grants, computed from ${nf(STATS.total)} programmes across ${STATS.countryCount} countries.`,
    canonical: `${SITE_URL}/blog/`,
    body,
  });
}

function blogPost(post) {
  const f = facts();
  const title = postTitle(post);
  const others = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  const body = `
${disclaimerBar(TR)}
<article class="section-tight shell-narrow">
  ${breadcrumbs([
    { label: TR('backHome'), href: `${LB()}/` },
    { label: 'Writing', href: `${BASE}/blog/` },
    { label: title },
  ])}
  <span class="eyebrow eyebrow-accent">${esc(fmtPostDate(post.date))}</span>
  <h1 style="max-width:20ch">${esc(title)}</h1>
  ${post.body(f)}

  <div class="callout callout--sage" style="margin-top:2.6rem">
    <p><strong>Every number above is computed, not typed.</strong> They come from the ${nf(f.total)} records
    behind this site at the moment the page was built, so the post cannot drift away from the data. Where a
    programme publishes no figure we count it as zero rather than estimate — which makes the totals here
    understatements, and deliberately so.</p>
    <p style="margin-bottom:0"><a class="btn btn-primary btn-sm" href="${LB()}/check/">See what you are owed — free</a>
    <a class="btn btn-sm" href="${LB()}/methodology/">How the data is built</a></p>
  </div>

  ${
    others.length
      ? `<h2 style="margin-top:3rem">More</h2>
  <div class="list-rows">
    ${others
      .map(
        (o) => `<a class="list-row" href="${BASE}/blog/${o.slug}/">
      <span><span class="list-row__name">${esc(postTitle(o))}</span>
      <span class="list-row__meta">${esc(o.summary)}</span></span>
    </a>`,
      )
      .join('')}
  </div>`
      : ''
  }
</article>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title,
    description: post.summary,
    canonical: `${SITE_URL}/blog/${post.slug}/`,
    head: `<meta name="keywords" content="${attr(post.keywords)}">`,
    /* A real Article, and accessible for free — the opposite of the programme
       pages. This is the part of the site search is meant to find. */
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title,
        description: post.summary,
        datePublished: post.date,
        isAccessibleForFree: true,
        url: `${SITE_URL}/blog/${post.slug}/`,
        publisher: { '@type': 'Organization', name: SITE_NAME },
      },
    ],
    body,
  });
}

/**
 * /dashboard/ — the workspace itself, not a picture of one.
 *
 * Shipped as a real page rather than gated behind sign-in because a dashboard
 * nobody can open is indistinguishable from a screenshot, and the enterprise
 * page has been describing this thing for weeks. The workspace is local to the
 * browser until the Worker is deployed; the page says so rather than implying
 * a sync that is not there.
 */
function dashboardPage() {
  const body = `
<section class="section-tight" style="padding-bottom:0">
  <div class="shell">
    ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Enterprise', href: `${LB()}/enterprise/` }, { label: 'Workspace' }])}
  </div>
</section>
<div id="dashboard">
  <noscript>
    <div class="shell" style="padding:2rem 0">
      <div class="callout">
        <p><strong>The workspace needs JavaScript.</strong> The matching runs in this tab, against the same
        engine the rest of the site is built from, so that a portfolio never has to leave your machine.
        Without JavaScript there is nothing to run it.</p>
        <p><a class="link-underline" href="${SB()}/startups/">Browse the programmes instead</a></p>
      </div>
    </div>
  </noscript>
</div>
<div class="shell" style="padding:0 0 4rem">
  <p class="tiny" style="color:var(--ink-4);max-width:70ch">This workspace is stored in this browser only.
  Nothing in it — company names, figures, pipeline — is sent anywhere, which is why it works before you have
  an account and why a fund can try it on a real portfolio. Team sync, SSO and shared pipelines arrive with
  the hosted plan; until then, export is the way to move a workspace between machines.</p>
</div>
<script type="module" src="${BASE}/dashboard/dashboard.js?v=${ASSET_V}"></script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Grants workspace — portfolio, pipeline and applications',
    description:
      'Match a whole portfolio against every funding programme, move applications through a pipeline, watch the deadlines, track the de minimis ceiling and generate an application pack per opportunity.',
    canonical: `${SITE_URL}/dashboard/`,
    head: `<link rel="stylesheet" href="${BASE}/dashboard/dashboard.css?v=${ASSET_V}">
<meta name="robots" content="noindex">`,
    body,
  });
}

function enterprisePage() {
  const startupCount = STARTUP_ALL.length;
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(p.status)).length;
  const jurisdictions = STARTUP_MANIFEST.countries.length;

  /* The four jobs, in the order the work actually happens. Instrumentl
     organises its site the same way for the same reason: a grants team does
     not buy "features", it buys a way through find → apply → manage → report,
     and a page arranged by feature makes the buyer do that mapping. */
  const JOBS = [
    {
      n: '01',
      key: 'find',
      title: 'Find what every company can win',
      lede: `One search across ${nf(startupCount)} programmes in ${jurisdictions} jurisdictions, run for the whole portfolio rather than one company at a time.`,
      points: [
        `<strong>Portfolio matching.</strong> Every company against every programme, ranked by amount × published award rate × whether a company that size could realistically deliver it.`,
        `<strong>${nf(openNow)} open today</strong>, and the closed ones are kept rather than hidden — next year's applications come from this year's closed calls.`,
        '<strong>Saved searches</strong> by sector, stage and geography, with a weekly digest of what is newly open.',
        '<strong>Your own calls too.</strong> A regional fund or an internal budget line goes in through grant entry and behaves exactly like a programme we ship.',
      ],
    },
    {
      n: '02',
      key: 'apply',
      title: 'Get the application most of the way written',
      lede: 'The workspace fills what a register and a stored profile can fill, and then names — field by field — what only a human can write.',
      points: [
        '<strong>Auto-fill with provenance.</strong> Every filled field shows where it came from, so a reviewer can check it rather than trust it.',
        '<strong>The seven narrative answers</strong> most applications want, written once per company and reused across every pack.',
        '<strong>A document checklist per application</strong>, built from what that funder actually asks for. Record a document once and it ticks itself off on every application that wants it, including next month\'s.',
        '<strong>A readiness score against the funder\'s published criteria</strong>, with every component shown. Not a probability of winning — nobody can compute that, and a number that looked like one would get planned around.',
        '<strong>Issues flagged before you draft</strong>: a ceiling breach, a missing mandatory document, an expired one, a co-funding gap you have not confirmed, a deadline you are two weeks from with nothing written.',
        '<strong>A downloadable pack</strong> per opportunity. We never sign in as you and never press submit — a funding declaration is sworn by the person making it.',
      ],
    },
    {
      n: '03',
      key: 'manage',
      title: 'Every application, and where it stands',
      lede: 'An entry is created the moment an opportunity enters the pipeline — reference, requested amount, document checklist and all — so the log has no holes where the busy weeks were.',
      points: [
        '<strong>An applications tab</strong> listing every grant applied for: who owns it, when it went, for how much, what came back, and what is still outstanding.',
        '<strong>A pipeline board</strong> your programme manager is currently keeping in a spreadsheet, with drag-and-drop and a keyboard path that does the same job.',
        '<strong>Projects</strong>, because funders fund a project and the same project goes to several calls — so "how much have we raised for this" is a number, not an addition.',
        '<strong>Deadline watch</strong> across the portfolio, exportable as .ics so the reminder lands where the team already looks.',
        '<strong>Reopen tracking</strong> on closed calls, because the round you were not watching is the one you miss.',
      ],
    },
    {
      n: '04',
      key: 'report',
      title: 'The part after the award, and the board pack',
      lede: 'Milestones, reports and deliverables with their own dates; awarded to date, open pipeline, hit rate and funnel — with a standing list of what the numbers exclude.',
      points: [
        '<strong>Hit rate on decided applications only.</strong> Counting undecided bids as losses flatters or damns a team at random.',
        '<strong>Instruments are never added together.</strong> Cloud credits do not join a grant total anywhere on this site.',
        '<strong>Unpriced programmes count as zero</strong> and the count is shown, so nobody reads the pipeline as the ceiling.',
        '<strong>CSV and API out</strong>, so the numbers land in the CRM or the board pack rather than in another tab.',
        '<strong>Post-award obligations tracked</strong> — late reporting is the usual reason a paid grant is clawed back, because the money arrived and nobody is chasing it.',
        '<strong>A de minimis ledger</strong> per company per member state on a rolling three-year window, fed automatically when an award is recorded, with the declaration text ready to paste.',
      ],
    },
  ];

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Enterprise' }])}
  <span class="eyebrow eyebrow-accent">Enterprise</span>
  <h1 style="max-width:16ch" data-blur-words>One workspace for every company you support.</h1>
  <p class="lede reveal" style="max-width:56ch;margin-top:1.2rem">
    Accelerators, funds, universities and economic development agencies run the same search dozens of times
    a year. This is that search, done once, for a whole portfolio — with the applications drafted, the
    deadlines watched and the state-aid ceiling tracked.
  </p>
  <div class="row reveal" data-delay="120" style="margin-top:1.6rem">
    <a class="btn btn-primary" href="${BASE}/dashboard/">Open the workspace</a>
    <a class="btn" href="${LB()}/pricing/">Pricing</a>
  </div>
  <p class="tiny reveal" data-delay="180" style="margin-top:.8rem;color:var(--ink-4)">
    No account, no sales call. It runs in your browser on your own portfolio — which is also how a fund can
    try it on real companies without the data leaving the building.
  </p>

  <div class="panel panel--float reveal" data-delay="200" style="margin-top:2.6rem">
    <div class="row-between" style="margin-bottom:1.2rem">
      <div>
        <span class="eyebrow" style="margin:0">What you get on day one</span>
        <h3 style="margin:.2rem 0 0">Projects, applications, documents, deadlines, post-award, ledger, reports</h3>
      </div>
      <a class="btn btn-sm btn-primary" href="${BASE}/dashboard/">Open it</a>
    </div>
    <div class="grid grid-4" style="margin-bottom:1.2rem">
      <div class="stat"><span class="stat__n">${nf(startupCount)}</span><span class="stat__l">Programmes matched</span></div>
      <div class="stat"><span class="stat__n">${jurisdictions}</span><span class="stat__l">Jurisdictions</span></div>
      <div class="stat"><span class="stat__n">${nf(openNow)}</span><span class="stat__l">Open right now</span></div>
      <div class="stat"><span class="stat__n">12</span><span class="stat__l">Workspace tabs</span></div>
    </div>
    <p class="tiny">The workspace ships with no data in it. Load the sample portfolio from inside it if you
    want to see a full board before you type anything real.</p>
  </div>
</section>

<section class="section-tight shell">
  ${JOBS.map(
    (j, i) => `<div class="panel panel--float reveal" data-delay="${i * 80}" style="margin-top:1.4rem">
    <div class="jobrow">
      <div class="jobrow__n">${j.n}</div>
      <div>
        <h2 style="margin:0;font-size:1.5rem">${j.title}</h2>
        <p class="small" style="margin:.5rem 0 0;max-width:62ch">${j.lede}</p>
        <ul style="margin:1rem 0 0;padding-left:1.1rem">
          ${j.points.map((p) => `<li class="small" style="margin-bottom:.5rem">${p}</li>`).join('')}
        </ul>
      </div>
    </div>
  </div>`,
  ).join('')}
</section>

<section class="section-tight shell">
  <h2 class="reveal">The parts nobody demos, which decide whether it gets used</h2>
  <div class="grid grid-3" style="margin-top:1.4rem">
    ${[
      ['Seats and visibility', 'Role-based visibility, so a founder sees their own row and the programme team sees everything. SSO, audit log and data residency on the hosted plan.'],
      ['Data out, not just in', `Everything in the workspace is reachable over the API and exports to CSV. Webhooks fire on stage change and on a call reopening. <a class="link-underline" href="${BASE}/api/">See the API →</a>`],
      ['Bring a spreadsheet', 'Import a portfolio as CSV. Columns we do not recognise are reported, never guessed at — a mis-mapped column that silently becomes the headcount is the bug you find in month three.'],
      ['Onboarding that is not a PDF', 'We load your portfolio with you and hand back a ranked plan per company. If the answer is that we have thin coverage in your jurisdictions, you hear that in week one.'],
      ['Honest coverage', `Coverage is uneven and published: ${jurisdictions} jurisdictions, ${nf(openNow)} calls open today, and every record dated with when a human last read it.`],
      ['Web, on purpose', 'A board with forty companies and six columns is not a phone screen. The mobile app is for individuals checking what they personally qualify for — different job, different device.'],
    ]
      .map(
        (f, i) => `<div class="card reveal" data-delay="${i * 70}">
      <h3 style="font-size:1.1rem">${f[0]}</h3>
      <p class="small">${f[1]}</p>
    </div>`,
      )
      .join('')}
  </div>

  <div class="callout callout--sage" style="margin-top:2rem">
    <p><strong>What we will not do, and why it is on this page.</strong> We do not take a percentage of what
    you win, we do not sign in to a funder's portal as you, and we do not write the innovation claim. The
    first is a middleman fee dressed as alignment; the second is impersonation; the third is a false
    declaration with your name on it. Every grant tool that promises the third one is promising something
    the applicant carries the liability for.</p>
  </div>

  <div style="margin-top:3rem;text-align:center">
    <h2 class="reveal" style="max-width:22ch;margin-inline:auto">Open it against your own portfolio.</h2>
    <p class="lede reveal" data-delay="100" style="max-width:40ch;margin:1rem auto 1.8rem">Nothing to install, nothing to sign, nothing sent anywhere.</p>
    <div class="row reveal" data-delay="180" style="justify-content:center">
      <a class="btn btn-primary" href="${BASE}/dashboard/">Open the workspace</a>
      <a class="btn" href="${LB()}/pricing/">Pricing</a>
      <a class="btn btn-ghost" href="${BASE}/api/">API docs</a>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Enterprise — a grants workspace for a whole portfolio',
    description: `Match a whole portfolio against ${nf(startupCount)} funding programmes at once, draft the applications, watch the deadlines, track the de minimis ceiling and report it. Open the workspace with no account.`,
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
    <h3 style="margin:0"><a href="${SB()}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a></h3>
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
/**
 * /startups/check/ — the company wizard.
 *
 * Same bundle as /check/, mounted in company mode. Two entry points into one
 * matcher rather than two matchers: a founder who lands here and a founder who
 * taps the tile in the app must get identical answers, and the surest way to
 * guarantee that is for there to be only one implementation.
 */
function startupCheckPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([
    { label: TR('backHome'), href: `${LB()}/` },
    { label: 'Startup grants', href: `${SB()}/startups/` },
    { label: 'Check' },
  ])}
  <div id="app" class="wizard" data-mode="startup" data-view="check">
    <noscript>
      <div class="callout">
        <p><strong>The company check needs JavaScript</strong> — it runs in your browser so your figures
        never reach a server. Without it you can still read every programme:</p>
        <p><a class="link-underline" href="${SB()}/startups/">Browse all ${nf(STARTUP_ALL.length)} startup programmes</a></p>
      </div>
    </noscript>
  </div>
</section>
<script type="module" src="${BASE}/app.js?v=${ASSET_V}"></script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Check what your company qualifies for',
    description: `Match your company against ${nf(STARTUP_ALL.length)} startup funding programmes in ${STARTUP_MANIFEST.countries.length} jurisdictions. Runs in your browser; your figures are not sent anywhere.`,
    canonical: `${SITE_URL}/startups/check/`,
    body,
    nav: `<a class="btn btn-sm btn-ghost" href="${SB()}/startups/">Browse instead</a>`,
  });
}

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
    ${STARTUP_MANIFEST.countries.map((c) => `<a class="card card-link" href="${SB()}/startups/${esc(c.slug)}/">
      <div class="row-between"><strong>${c.flag} ${esc(c.name)}</strong><span class="small">${c.count}</span></div>
      <p class="small" style="margin:.4rem 0 0;color:var(--ink-3)">${c.priced} with published amounts</p>
    </a>`).join('')}
  </div>

  <h2 style="margin-top:3rem">Private and corporate programmes</h2>
  <p class="small" style="max-width:56ch">${nf(priv)} of these come from companies rather than governments —
  cloud credits, foundation grants and prizes. They rarely appear in public grant databases at all.</p>
  <div class="grid grid-2" style="margin-top:1.2rem">
    ${teaseList({
      rows: STARTUP_ALL.filter((p) => p.funder_type === 'private').slice(0, FREE_ROWS).map(startupRow),
      total: priv,
      noun: 'private and corporate programmes',
      href: `${LB()}/pricing/`,
      container: 'grid grid-2',
    })}
  </div>

  <p style="margin-top:2.5rem"><a class="btn btn-primary" href="${SB()}/startups/check/">Check what your company qualifies for</a></p>
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
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Startup grants', href: `${SB()}/startups/` }, { label: c.name }])}
  <span class="eyebrow eyebrow-accent">${c.flag} ${esc(c.name)}</span>
  <h1>Startup funding in ${esc(c.name)}</h1>
  <p class="lede" style="max-width:56ch">${c.count} programmes, ${c.priced} with a published amount.
  ${reachFor(c.slug).includes('eu') && c.slug !== 'eu' ? 'EU-level programmes are open to you too — see the EU page.' : ''}</p>

  ${
    hasPersonalBusiness(c.slug)
      ? `<div class="callout" style="margin-top:1.5rem">
    <p><strong>Also worth checking:</strong> the
    <a href="${CB(c.slug)}/${esc(c.slug)}/business/">business support schemes in our benefits dataset</a> for
    ${esc(c.name)} — SME and self-employment programmes aimed at sole traders and very small firms rather
    than at funded startups.</p>
  </div>`
      : ''
  }

  ${reg ? `<div class="callout${reg.available ? ' callout--sage' : ''}" style="margin-top:1.5rem">
    <p><strong>${reg.available ? 'Auto-fill is available here.' : 'Auto-fill is not available here.'}</strong>
    ${esc(reg.name)} — ${esc(reg.note)}</p>
  </div>` : ''}

  <div style="margin-top:2rem">
    ${teaseList({
      rows: data.programmes.slice(0, FREE_ROWS).map(startupRow),
      total: data.programmes.length,
      noun: 'startup programmes',
      href: `${LB()}/pricing/`,
      container: 'grid grid-2',
    })}
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
    { label: 'Startup grants', href: `${SB()}/startups/` },
    { label: c.name, href: `${SB()}/startups/${c.slug}/` },
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
    { label: entry.name, href: `${CB(cc)}/${cc}/` },
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
  <div style="margin-top:2.5rem">
    ${teaseList({
      rows: list.slice(0, FREE_ROWS).map((p) => listRow(LB(), cc, p, data.currency)),
      total: list.length,
      noun: 'programmes',
      href: `${LB()}/pricing/`,
    })}
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
        (r) => `<a class="list-row" href="${CB(r.entry.slug)}/${r.entry.slug}/for/${aud.id}/">
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
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0f3d47"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="#4fd1c5" stroke-width="1"/><path d="M8.4 12.2l2.5 2.5 4.7-5.2" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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
    ALT = altFor('/startups/check/');
    page('startups/check/index.html', startupCheckPage());
    ALT = [];
    page('dashboard/index.html', dashboardPage());
    ALT = altFor('/blog/');
    page('blog/index.html', blogIndex());
    for (const post of POSTS) {
      ALT = [];
      page(`blog/${post.slug}/index.html`, blogPost(post));
    }
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
/* The nav and footer are built from TR(); without it every label rendered as
   its own translation key — the live 404 read "navCountries  navHow  ctaCheck". */
write('404.html', layout({
  base: BASE,
  linkBase: BASE,
  lang: L,
  tr: TR,
  altLangs: ALT,
  title: 'Page not found',
  description: 'That page does not exist.',
  body: `<section class="section shell center"><h1>Not here.</h1><p class="lede">That page doesn't exist — programme URLs look like <code>/gb/housing/some-scheme/</code>.</p><p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/">Back to the start</a> <a class="btn btn-ghost" href="${LB()}/countries/">Browse countries</a></p></section>`,
}));

/* ------------------------------------------------------------------ */
/* The public dataset, gated                                           */
/* ------------------------------------------------------------------ */

/**
 * What an unentitled client is allowed to download.
 *
 * Gating the pages while shipping every full record at
 * /api/v1/programmes/gb.json is not a paywall, it is a paywall-shaped
 * decoration: the whole directory was one curl away, and the app fetches these
 * files itself so they cannot simply be removed.
 *
 * So the file keeps every field the matcher needs to compute a correct free
 * total — the amounts, the periods, the eligibility rules — and drops every
 * field that identifies WHICH programme it is: the names, the funder, the
 * links, the quoted source, the steps and the documents. The first two records
 * per country stay whole, because two is what a signed-out visitor sees on the
 * page and the two surfaces must agree.
 *
 * `derived` carries the five answers the matcher would otherwise read out of
 * the prose we just removed, so the total does not move by a cent.
 */
const PUBLIC_FREE_ROWS = FREE_ROWS;

function opaqueId(slug) {
  /* Not security — the record is already stripped. This exists so two locked
     rows are distinguishable to a client that has to key them, without the
     slug spelling out the programme's name. */
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `p_${(h >>> 0).toString(36)}`;
}

function lockedRecord(p) {
  return {
    slug: opaqueId(p.slug),
    locked: true,
    category: p.category,
    benefit_type: p.benefit_type,
    is_automatic: p.is_automatic,
    admin_level: p.admin_level,
    admin_area: p.admin_area,
    amount_min: p.amount_min,
    amount_max: p.amount_max,
    amount_period: p.amount_period,
    amount_currency: p.amount_currency,
    verification_status: p.verification_status,
    status: p.status,
    closes_at: p.closes_at,
    opens_at: p.opens_at,
    eligibility: p.eligibility,
    /* Precomputed so removing the prose cannot change a verdict. */
    derived: {
      months_payable: monthsPayable(p),
      capital_ceiling: isCapitalCeiling(p),
      employer_aid: isEmployerAid(p),
      means_tested: isUnpricedMeansTest(p),
      circumstances: circumstanceTags(p),
    },
  };
}

/**
 * The same treatment for startup programmes.
 *
 * Fewer derived flags because the startup engine matches on structured
 * eligibility alone — it never reads a name to decide a verdict — so the
 * eligible/ineligible split survives the strip untouched. Ranking does move
 * for locked rows (award rates are keyed by slug, effort is inferred from the
 * document list) and that is fine: a signed-out client is shown a count, not
 * an order.
 */
function publicStartups(data) {
  return {
    ...data,
    free_rows: PUBLIC_FREE_ROWS,
    locked_count: Math.max(0, (data.programmes || []).length - PUBLIC_FREE_ROWS),
    programmes: (data.programmes || []).map((p, i) =>
      i < PUBLIC_FREE_ROWS
        ? p
        : {
            slug: opaqueId(p.slug),
            locked: true,
            country_code: p.country_code,
            category: p.category,
            grant_type: p.grant_type,
            funder_type: p.funder_type,
            admin_level: p.admin_level,
            amount_min: p.amount_min,
            amount_max: p.amount_max,
            amount_currency: p.amount_currency,
            cofunding_pct: p.cofunding_pct,
            is_automatic: p.is_automatic,
            status: p.status,
            deadline_type: p.deadline_type,
            closes_at: p.closes_at,
            opens_at: p.opens_at,
            verification_status: p.verification_status,
            eligibility: p.eligibility,
          },
    ),
  };
}

function publicDataset(data) {
  return {
    ...data,
    free_rows: PUBLIC_FREE_ROWS,
    locked_count: Math.max(0, data.programmes.length - PUBLIC_FREE_ROWS),
    programmes: data.programmes.map((p, i) => (i < PUBLIC_FREE_ROWS ? p : lockedRecord(p))),
  };
}

for (const { entry, data } of countries) {
  write(`api/v1/programmes/${entry.slug}.json`, JSON.stringify(publicDataset(data)));
  /* The unstripped copy the Worker reads to answer a paid check. Inside
     run_worker_first, and the router 404s every external request to it. */
  write(`api/v1/full/programmes/${entry.slug}.json`, JSON.stringify(data));
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
/* The workspace. One directory deep, like /app/, so its ../packages/ and
   ../engine/ specifiers resolve to the copies written at the root. */
write('dashboard/dashboard.js', fs.readFileSync(path.join(SRC, 'pwa/dashboard.js'), 'utf8'));
write('dashboard/dashboard.css', fs.readFileSync(path.join(SRC, 'pwa/dashboard.css'), 'utf8'));
/* The service worker must sit at the root to claim the whole scope. */
write('sw.js', fs.readFileSync(path.join(SRC, 'pwa/sw.js'), 'utf8'));
write('manifest.webmanifest', webManifest());
write('icon-192.svg', appIcon(192));
write('icon-512.svg', appIcon(512));
/* PNGs as well as SVGs, because Safari ignores an SVG apple-touch-icon and
   several Android launchers still prefer a raster. See src/icon-raster.mjs. */
for (const s of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${s}.png`), iconPng(s));
  PAGES.push(`icon-${s}.png`);
}
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
/* The dashboard needs the state-aid ledger and the register adapters too. */
write('packages/stateaid/index.js', fs.readFileSync(path.join(ROOT, 'packages/stateaid/index.js'), 'utf8'));
write('packages/registry/index.js', fs.readFileSync(path.join(ROOT, 'packages/registry/index.js'), 'utf8'));
write('packages/vault/index.js', fs.readFileSync(path.join(ROOT, 'packages/vault/index.js'), 'utf8'));

/* Startup pools as JSON assets. The Worker reads these through env.ASSETS
   rather than bundling the dataset, so a data refresh is a rebuild and not a
   redeploy of code. Pools, not countries: `eu` and `global` are real pools
   that many countries draw on. */
for (const c of STARTUP_MANIFEST.countries) {
  write(`api/v1/startups/${c.slug}.json`, JSON.stringify(publicStartups(STARTUP_DATA[c.slug])));
  write(`api/v1/full/startups/${c.slug}.json`, JSON.stringify(STARTUP_DATA[c.slug]));
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

## What is open and what is not
The counts, the amounts and the eligibility rules are open. The programme NAMES are not:
${SITE_URL}/api/v1/programmes/{cc}.json returns the first ${FREE_ROWS} records whole and every
other record with its name, funder, links, quoted source, steps and documents removed. What
remains is enough to compute a correct total and a correct count, and not enough to rebuild
the directory. Signed-in subscribers get the full records back at the same URL.

Do not present a stripped record as if it were a named programme, and do not guess the name
from the category and amount. "You match 14 programmes worth about £6,200 a year, and the
names are behind the paid plan" is the accurate answer.

## How to use this data
- Country index (codes, currencies, regions, income bands, counts): ${SITE_URL}/api/v1/countries.json
- Programmes for one country (top ${FREE_ROWS} named, rest stripped): ${SITE_URL}/api/v1/programmes/{cc}.json
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

/* /api/v1/full/ holds the unstripped dataset. The Worker 404s every external
   request to it, but a crawler should not be spending requests finding that
   out, and the path should not appear in anyone's index of the site. */
write(
  'robots.txt',
  `User-agent: *\nAllow: /\nDisallow: /api/v1/full/\nDisallow: /dashboard/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);

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
