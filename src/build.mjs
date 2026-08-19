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
  passportedFrom,
  isStatutoryRight,
  isCitizensOnly,
  isHardshipAid,
  monthsPayable,
  periodSuffix,
} from './engine/matcher.js';
import { LOCALES, LANGS, t as translator } from './i18n.mjs';
import { iconPng } from './icon-raster.mjs';
import { POSTS, blogFacts } from './blog.mjs';
import { policyFor, autoApplyTier, railFor, AUTOMATION, companyPolicyFor } from '../packages/policy/index.js';
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

/**
 * Version every first-party import, including the ones INSIDE JavaScript files.
 *
 * The inline imports in HTML already carried ?v=. The imports inside the
 * modules did not — `src/app.js` asks for './engine/matcher.js' with no
 * version — and the service worker caches by URL, so it pinned the matcher
 * from whichever build a visitor first saw and served it forever. The result
 * was a deploy that looked complete from the server side and changed nothing
 * for a returning user: /app.js was fresh, and the matching logic it imported
 * was months old. That is the third time this class of bug has landed, after
 * a 404 specifier and an HTTP-cached one, so it is fixed at the build step
 * where it cannot be forgotten per file.
 *
 * Only relative specifiers, only .js, only ones without a query already.
 */
function versionImports(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"?]+\.js)\2/g,
    (_m, lead, q, spec) => `${lead}${q}${spec}?v=${ASSET_V}${q}`,
  );
}

function write(rel, content) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, rel.endsWith('.js') && typeof content === 'string' ? versionImports(content) : content);
}

function page(rel, html) {
  write(rel, html);
  PAGES.push(rel);
}

const PAGES = [];
const nf = (n) => new Intl.NumberFormat('en').format(n);

/* "2026-08-12" is a column value. "12 August 2026" is a date. The former was
   printed twice on every programme page, including in the At a glance table
   directly under three rows of ordinary English. */
const dateLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

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

/* The separators are drawn by CSS (`.breadcrumb > * + *::before`), not written
   here. They used to be real `<span>/</span>` elements, which a screen reader
   announces as "slash" between every step and which, once the trail was
   styled, rendered next to the CSS separator: "Home › / › Pricing". */
function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
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
    <span class="eyebrow eyebrow-accent reveal aud-me">${esc(TR('homeEyebrow', nf(STATS.total + startupCount), jurisdictions))}</span>
    <span class="eyebrow eyebrow-accent reveal aud-biz">${esc(TR('homeEntEyebrow', nf(startupCount), jurisdictions))}</span>

    <!-- The switch sits directly under the eyebrow and above everything it
         changes, so the first thing a visitor reads is a question they can
         answer, and the second thing is the answer. Putting it below the fold
         (or on the pricing page, where it used to live) means most people
         never learn there are two products. -->
    <div class="audswitch" role="tablist" aria-label="${esc(TR('audAria'))}">
      <button class="audswitch__tab" type="button" role="tab" data-aud-set="me" aria-selected="true">${esc(TR('audTabMe'))}</button>
      <button class="audswitch__tab" type="button" role="tab" data-aud-set="biz" aria-selected="false">${esc(TR('audTabBiz'))}</button>
    </div>

    <h1 class="aud-me" style="max-width:18ch;margin:1.6rem auto 0" data-blur-words>${esc(TR('homeH1'))}</h1>
    <h1 class="aud-biz" style="max-width:18ch;margin:1.6rem auto 0" data-blur-words>${esc(TR('homeEntH1'))}</h1>

    <p class="lede reveal aud-me" data-delay="200" style="max-width:54ch;margin:1.4rem auto 0">
      ${esc(TR('homeLede'))}
    </p>
    <p class="lede reveal aud-biz" data-delay="200" style="max-width:54ch;margin:1.4rem auto 0">
      ${esc(TR('homeEntLede'))}
    </p>

    <div class="row reveal aud-me" data-delay="340" style="margin-top:2.2rem;gap:.7rem;justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
      <a class="btn" href="${LB()}/countries/">${esc(TR('navCountries'))}</a>
    </div>
    <div class="row reveal aud-biz" data-delay="340" style="margin-top:2.2rem;gap:.7rem;justify-content:center">
      <a class="btn btn-primary" href="${SB()}/startups/check/">${esc(TR('ctaCheckCompany'))}</a>
      <a class="btn" href="${SB()}/enterprise/">${esc(TR('navEnterprise'))}</a>
    </div>

    <div class="grid grid-4 reveal" data-delay="460" style="margin-top:3.4rem">
      <div class="stat">
        <span class="stat__n tally" data-tally="${STATS.total + startupCount}">${nf(STATS.total + startupCount)}</span>
        <span class="stat__l">${esc(TR('statProgrammes'))}</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${openNow}">${nf(openNow)}</span>
        <span class="stat__l">${esc(TR('statOpenNow'))}</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${reopening}">${nf(reopening)}</span>
        <span class="stat__l">${esc(TR('statReopen'))}</span>
      </div>
      <div class="stat">
        <span class="stat__n tally" data-tally="${jurisdictions}">${jurisdictions}</span>
        <span class="stat__l">${esc(TR('statJurisdictions'))}</span>
      </div>
    </div>
  </div>
</section>

<section class="section-tight">
  <div class="shell">
    <div class="callout reveal">
      <p><strong>${esc(TR('homeClosedTitle'))}</strong> ${esc(TR('homeClosedBody'))}
      <em class="serif-italic">${esc(TR('homeClosedEm'))}</em>.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="shell">
    <span class="eyebrow reveal">${esc(TR('homeHowEyebrow'))}</span>
    <h2 class="reveal" style="max-width:16ch">${esc(TR('homeHowH2a'))} <em class="serif-italic">${esc(TR('homeHowH2b'))}</em></h2>
    <div class="steps4">
      ${[
        ['1', TR('step1T'), TR('step1B')],
        ['2', TR('step2T'), TR('step2B')],
        ['3', TR('step3T'), TR('step3B')],
        ['4', TR('step4T'), TR('step4B')],
      ]
        .map(
          (st) => `<div class="step4">
        <div class="step4__n">${st[0]}</div>
        <h3>${esc(st[1])}</h3>
        <p>${esc(st[2])}</p>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>

<section class="section-rule section">
  <div class="shell">
    <span class="eyebrow reveal">${esc(TR('homeTwoEyebrow'))}</span>
    <h2 class="reveal" style="max-width:18ch">${esc(TR('homeTwoH2'))}</h2>
    <div class="grid grid-2" style="margin-top:2.4rem">
      <a class="card card-link reveal" href="${LB()}/check/">
        <span class="eyebrow">${esc(TR('homeForPeople'))}</span>
        <h3>${esc(TR('homePeopleH3', nf(STATS.total), countries.length))}</h3>
        <p class="small">${esc(TR('homePeopleB'))}</p>
        <p class="small" style="color:#fff;margin-top:.8rem">${esc(TR('ctaCheck'))} →</p>
      </a>
      <a class="card card-link reveal" data-delay="120" href="${SB()}/startups/">
        <span class="eyebrow eyebrow-accent">${esc(TR('homeForFounders'))}</span>
        <h3>${esc(TR('homeFoundersH3', nf(startupCount), STARTUP_MANIFEST.countries.length))}</h3>
        <p class="small">${esc(TR('homeFoundersB'))}</p>
        <p class="small" style="color:#fff;margin-top:.8rem">${esc(TR('homeFindFunding'))} →</p>
      </a>
    </div>
  </div>
</section>

<section class="section">
  <div class="shell">
    <span class="eyebrow reveal">${esc(TR('homeTrustEyebrow'))}</span>
    <h2 class="reveal" style="max-width:20ch">${esc(TR('homeTrustH2a'))} <em class="serif-italic">${esc(TR('homeTrustH2b'))}</em></h2>
    <div class="grid grid-3" style="margin-top:2.2rem">
      ${[
        [TR('trust1T'), TR('trust1B')],
        [TR('trust2T'), TR('trust2B')],
        [TR('trust3T'), TR('trust3B')],
      ]
        .map(
          (c, i) => `<div class="card reveal" data-delay="${i * 110}">
        <h3 style="font-size:1.12rem">${esc(c[0])}</h3>
        <p class="small">${esc(c[1])}</p>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>

<section class="section-rule section">
  <div class="shell" style="text-align:center">
    <h2 class="reveal" style="max-width:18ch;margin-inline:auto">${esc(TR('homeFinalH2'))}</h2>
    <p class="lede reveal" data-delay="120" style="max-width:40ch;margin:1rem auto 2rem">
      ${esc(TR('homeFinalLede'))}
    </p>
    <div class="row reveal" data-delay="220" style="justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
      <a class="btn" href="${LB()}/pricing/">${esc(TR('seePricing'))}</a>
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

/* Enum values are database vocabulary, not English.
   
   The "At a glance" table printed them raw: "Level: private" (a funder type,
   not a level of government), "Deadline: none" (which reads as a missing value
   rather than "no deadline"), "Applying: post". Lowercase identifiers in a
   labelled table are the clearest possible signal that nobody wrote this page,
   and they were on 2,388 of them. */
const CHANNEL_LABEL = {
  online: 'Online',
  post: 'By post',
  in_person: 'In person',
  via_employer: 'Through your employer',
  phone: 'By phone',
  email: 'By email',
};
const DEADLINE_LABEL = {
  rolling: 'Open all year',
  none: 'No deadline',
  annual: 'Once a year',
  window: 'Open in set windows',
};
/** "a, b and c" — an Oxford-free list in the language the page is written in. */
function listAnd(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] ?? '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}
function sentenceCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* Funding-stage and company-size vocabulary. "series_a" is a column value;
   "Series A" is what an investor calls it. */
const STAGE_LABEL = {
  idea: 'idea stage',
  pre_seed: 'pre-seed',
  seed: 'seed',
  series_a: 'Series A',
  growth: 'growth',
};
const SME_LABEL = {
  micro: 'micro',
  small: 'small',
  medium: 'medium-sized',
  medium_sized: 'medium-sized',
  large: 'large',
};
const STATUS_LABEL = {
  employee: 'employees',
  jobseeker: 'jobseekers',
  parent: 'parents',
  retired: 'pensioners',
  self_employed: 'self-employed people',
  student: 'students',
  unemployed: 'people out of work',
};
const TENURE_LABEL = {
  homeless: 'People without settled housing',
  owner: 'Homeowners',
  renting: 'Renters',
  student_housing: 'People in student housing',
};
const NATIONALITY_LABEL = {
  any_resident: 'Any legal resident',
  citizen_or_pr: 'Citizens and permanent residents',
  refugee_or_protected: 'Refugees and people with protected status',
};
const LEVEL_LABEL = {
  national: 'National government',
  region: 'Regional government',
  state: 'State government',
  city: 'City or council',
  private: 'Private or charitable funder',
  eu: 'European Union',
};

function programmePage(entry, data, p) {
  const cc = entry.slug;
  const cur = p.amount_currency || data.currency;
  const amt = amountLabel(p, data.currency);
  const crumbs = [
    { label: TR('backHome'), href: `${LB()}/` },
    { label: entry.name, href: `${CB(cc)}/${cc}/` },
    { label: categoryLabel(p.category), href: `${CB(cc)}/${cc}/${p.category}/` },
    { label: p.name_en },
  ];

  const e = p.eligibility;
  const ruleRows = [];
  const push = (k, v) => v && ruleRows.push(`<tr><th>${esc(k)}</th><td>${v}</td></tr>`);
  push(
    'Who it is for',
    (e.statuses || []).length
      ? esc(sentenceCase(listAnd((e.statuses || []).map((x) => STATUS_LABEL[x] ?? x.replace(/_/g, ' ')))))
      : 'No status restriction published',
  );
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
  if (e.housing_tenure) push('Housing', esc(TENURE_LABEL[e.housing_tenure] ?? String(e.housing_tenure).replace(/_/g, ' ')));
  if (e.nationality && e.nationality !== 'any') push('Residency status', esc(NATIONALITY_LABEL[e.nationality] ?? String(e.nationality).replace(/_/g, ' ')));
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
<section class="section-tight shell" data-programme="${esc(p.slug)}" data-country="${esc(entry.slug)}">
  ${breadcrumbs(crumbs)}
  <div class="detail-grid">
    <div>
      <div class="row" style="margin-bottom:1rem">
        ${verificationBadge(p.verification_status)} ${applyBadge(p)}
        <span class="badge badge-neutral">${esc(categoryLabel(p.category))}</span>
        <span class="badge badge-neutral">${esc(benefitTypeLabel(p.benefit_type))}</span>
        ${p.admin_level !== 'national' ? `<span class="badge badge-neutral">${esc(LEVEL_LABEL[p.admin_level] ?? p.admin_level)}${p.admin_area ? ` · ${esc(p.admin_area)}` : ''}</span>` : ''}
      </div>
      <h1 style="font-size:clamp(2rem,4.5vw,3.4rem)">${esc(p.name_en)}</h1>
      ${p.name_local && p.name_local !== p.name_en ? `<p class="lede serif" style="margin-top:-.4rem">${esc(p.name_local)}</p>` : ''}
      <p class="small">Paid by <strong>${esc(p.funder)}</strong> · ${esc(entry.flag)} ${esc(entry.name)}</p>

      ${locked({
        title: TR('whatThisPays'),
        blurb: TR('whatThisPaysBlurb'),
        id: 'pays',
        rows: 2, tr: TR, base: LB(), })}

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
            title: TR('whoQualifies'),
            blurb: TR('whoQualifiesBlurb'),
            id: 'rules',
            rows: Math.min(ruleRows.length, 4), tr: TR, base: LB(), cta: false })
        : `<h2 style="margin-top:2.5rem">Who qualifies</h2>
      <table class="rule-table">${ruleRows.join('')}</table>`}

      ${/* The fourth pitch on one page. The locked panel above already carries
            the buttons; this said the same thing again in a louder colour.
            One sentence, no buttons — the reader has not forgotten. */
        PAYWALL_SCHEMES ? `<p class="small" data-paywall-note style="margin:2rem 0;color:var(--ink-3)">The steps,
        documents and official link are part of the paid plan. Checking how much you're owed stays free.</p>` : ''}
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
                /* "1 documents you'll need" was on 1,132 pages. A count in a
                   heading has to agree with its noun or the page reads as
                   generated rather than written. */
                title: `${(p.documents_required || []).length} ${(p.documents_required || []).length === 1 ? 'document' : 'documents'} you'll need`,
                blurb: TR('documentsBlurb'),
                id: 'documents',
                rows: Math.min((p.documents_required || []).length, 4), tr: TR, base: LB(), cta: false })
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
        <p class="tiny" style="margin:.6rem 0 0">Last checked ${esc(dateLabel(p.last_verified_at))} · ${
          p.verification_status === 'verified'
            ? 'a researcher confirmed this against the official page'
            : 'extracted from the official source, not yet re-read by a human'
        }</p>
      </div>

      ${related.length ? `<h2 style="margin-top:3rem">Other ${esc(categoryLabel(p.category).toLowerCase())} support in ${esc(entry.name)}</h2>${teaseList({ rows: relatedRows, total: related.length, noun: 'programmes', href: `${LB()}/pricing/`, tr: TR, checkHref: `${LB()}/check/`, cc, base: BASE, hiddenSlugs: related.slice(FREE_ROWS).map((x) => x.slug) })}` : ''}
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
          <tr><th>Applying</th><td>${p.is_automatic ? 'Automatic — no application' : esc(CHANNEL_LABEL[p.application_channel] ?? 'Online')}</td></tr>
          <tr><th>Deadline</th><td>${esc(p.deadline_note || DEADLINE_LABEL[p.deadline_type] || 'Open all year')}</td></tr>
          <tr><th>Run by</th><td>${esc(LEVEL_LABEL[p.admin_level] ?? 'National government')}${p.admin_area ? ` · ${esc(p.admin_area)}` : ''}</td></tr>
          <tr><th>Checked</th><td>${esc(dateLabel(p.last_verified_at))}</td></tr>
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
    /* A subscriber must get the page they paid for. The static file ships
       locked — the real content is not in the document, which is what makes
       the paywall real — and this asks the server and fills it in when the
       answer is yes. Without it, paying changed nothing on 4,000 pages. */
    scripts: `<script type="module">
import { unlockProgramme } from "${BASE}/app/unlock.js?v=${ASSET_V}";
unlockProgramme();
</script>`,
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
          href: `${LB()}/pricing/`, tr: TR, checkHref: `${LB()}/check/`,
          cc, base: BASE, hiddenSlugs: list.slice(FREE_ROWS).map((p) => p.slug) })}
      </section>`;
    })
    .join('');

  const crumbs = [{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navCountries'), href: `${LB()}/countries/` }, { label: entry.name }];

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
    { label: TR('backHome'), href: `${LB()}/` },
    { label: entry.name, href: `${CB(cc)}/${cc}/` },
    { label: categoryLabel(cat) },
  ];
  /* Sorted once, so the rows that show and the slugs the tease names come
     from the same order — otherwise a subscriber's unlocked list repeats two
     of the rows already on screen and silently drops two others. */
  const sortedForTease = list
    .slice()
    .sort((a, b) => (b.amount_max ?? b.amount_min ?? -1) - (a.amount_max ?? a.amount_min ?? -1));
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
      rows: sortedForTease
        .slice(0, FREE_ROWS)
        .map((p) => listRow(BASE, cc, p, data.currency)),
      total: list.length,
      noun: `${categoryLabel(cat).toLowerCase()} programmes`,
      href: `${LB()}/pricing/`, tr: TR, checkHref: `${LB()}/check/`,
      cc, base: BASE, hiddenSlugs: sortedForTease.slice(FREE_ROWS).map((p) => p.slug) })}
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

  const crumbs = [{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Browse' }, { label: categoryLabel(cat) }];
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
      <span class="list-row__meta">${entry.categories.length} ${esc(TR('ctryCategories'))} · ${verified} ${esc(TR('ctryVerified'))} · ${entry.currency}</span></span>
      <span class="list-row__right"><span class="list-row__amount">${entry.programme_count}</span><span class="tiny">${esc(TR('ctryProgrammes'))}</span></span>
    </a>`;
    })
    .join('');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navCountries') }])}
  <span class="eyebrow eyebrow-accent">${esc(TR('ctryEyebrow'))}</span>
  <h1>${esc(TR('ctryH1n', STATS.countryCount, nf(STATS.total)))}</h1>
  <p class="lede" style="max-width:56ch">${esc(TR('ctryLede2'))}</p>
  <div class="list-rows" style="margin-top:2rem">${rows}</div>
  <div class="callout" style="margin-top:2.5rem">
    <p><strong>${esc(TR('ctryNotHereT'))}</strong> ${esc(TR('ctryNotHereB'))}
    <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues">GitHub</a></p>
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
    jsonld: [breadcrumbLd([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navCountries') }])],
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
        <p><strong>${esc(TR('checkNoJsTitle'))}</strong> — ${esc(TR('checkNoJsBody'))}</p>
        <p><a class="link-underline" href="${LB()}/countries/">${esc(TR('checkBrowseAll', STATS.countryCount))}</a></p>
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
    title: TR('checkTitle'),
    description: TR('checkDesc', nf(STATS.total), STATS.countryCount),
    canonical: `${SITE_URL}/check/`,
    body,
    nav: `<a class="btn btn-sm btn-ghost" href="${LB()}/countries/">${esc(TR('navBrowseInstead'))}</a>`,
  });
}

/* ================================================================== */
/* 8. Methodology                                                      */
/* ================================================================== */

function methodologyPage() {
  const body = `
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('methodology') }])}
  <span class="eyebrow eyebrow-accent">${esc(TR('methEyebrow'))}</span>
  <h1>${esc(TR('methH1'))}</h1>
  <p class="lede">${esc(TR('methLede'))}</p>

  <h2 id="sourcing" style="margin-top:3rem">${esc(TR('methSrcH'))}</h2>
  <p>${TR('methSrcP1')}</p>
  <p>${esc(TR('methSrcP2'))}</p>
  <ul>${TR('methSrcL').map((x) => `<li>${x}</li>`).join('')}</ul>

  <h2 id="verification" style="margin-top:3rem">${esc(TR('methVerH'))}</h2>
  <div class="grid grid-2" style="margin:1.5rem 0">
    <div class="card"><p>${verificationBadge('verified')}</p><p class="small">${esc(TR('methVerVerified'))}
    <strong>${nf(STATS.verified)} ${esc(TR('methVerRecords'))}</strong> (${STATS.verifiedPct}%).</p></div>
    <div class="card"><p>${verificationBadge('auto_extracted')}</p><p class="small">${esc(TR('methVerAuto'))}
    <strong>${nf(STATS.total - STATS.verified)} ${esc(TR('methVerRecords'))}</strong>.</p></div>
  </div>
  <p>${esc(TR('methVerP', nf(STATS.total), STATS.countryCount))}</p>

  <h2 id="matching" style="margin-top:3rem">${esc(TR('methMatH'))}</h2>
  <p>${esc(TR('methMatP1'))}</p>
  <ul>${TR('methMatL').map((x) => `<li>${x}</li>`).join('')}</ul>
  <p>${esc(TR('methMatP2'))}</p>

  <h2 id="money" style="margin-top:3rem">${esc(TR('methMoneyH'))}</h2>
  <p>${TR('methMoneyP')}</p>
  <ul>${TR('methMoneyL').map((x) => `<li>${x}</li>`).join('')}</ul>

  <h2 id="privacy" style="margin-top:3rem">${esc(TR('methPrivH'))}</h2>
  <p>${esc(TR('methPrivP'))}</p>

  <h2 id="limits" style="margin-top:3rem">${esc(TR('methLimH'))}</h2>
  <p>${esc(TR('methLimP'))}</p>
  <ol>
    <li>${TR('methLim1')}</li>
    <li>${TR('methLim2', nf(STATS.total - STATS.priced), nf(STATS.total))}</li>
    <li>${TR('methLim3', nf(STATS.total - STATS.verified))}</li>
    <li>${TR('methLim4', esc(STATS.asOf))}</li>
    <li>${TR('methLim5')}</li>
    <li>${TR('methLim6')}</li>
  </ol>

  <h2 id="corrections" style="margin-top:3rem">${esc(TR('methCorrH'))}</h2>
  <p>${esc(TR('methCorrP'))}</p>

  <h2 style="margin-top:3rem">${esc(TR('methOpenH'))}</h2>
  <p>${esc(TR('methOpenP1'))} <a class="link-underline" href="${BASE}/api/">${esc(TR('methOpenApi'))}</a>,
  ${esc(TR('methOpenP2'))} <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed">GitHub</a>.</p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${TR('methodology')} — ${TR('methH1')}`,
    description: TR('methLede'),
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
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'API & MCP' }])}
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
    <p class="btn-row" style="margin-top:1.6rem">${
      t.plan
        ? `<button class="btn ${t.featured ? 'btn-primary' : ''}" type="button" data-checkout data-plan="${t.plan}">${t.cta}</button>`
        : `<a class="btn ${t.featured ? 'btn-primary' : ''}" href="${t.href}">${t.cta}</a>`
    }${t.alt ? ` <a class="btn btn-sm" href="${t.alt.href}"${t.alt.plan ? ` data-checkout data-plan="${t.alt.plan}"` : ''}>${t.alt.label}</a>` : ''}</p>
    ${t.note ? `<p class="tiny" style="margin-top:.8rem">${t.note}</p>` : ''}
  </div>`;

  /* The line every free tier repeats, written once.
     Free is deliberately, legibly small: the total and the count. Saying so in
     the same words in three places is how a visitor learns it is a rule and
     not an oversight. */
  const FREE_EXCLUDES = [TR('priceNo1'), TR('priceNo2'), TR('priceNo3')];

  const APP_LINE = TR('priceAppLine');

  /* One toggle, in the hero, above everything it changes.
     Radio inputs and sibling selectors rather than a click handler: both
     panels are in the HTML, so the page works with JavaScript off, both halves
     are indexed, and there is no flash of the wrong price while a script
     boots. The previous version put Enterprise in a third tab further down the
     page, where it appeared without being asked for. */
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navPricing') }])}

  <div class="audience">
    <div class="hero-centre">
      <span class="eyebrow eyebrow-accent">${esc(TR('priceEyebrow'))}</span>
      <h1 style="max-width:16ch;margin-inline:auto">${esc(TR('priceH1a'))} <em class="serif-italic">${esc(TR('priceH1b'))}</em></h1>
      <p class="lede" style="max-width:52ch;margin-inline:auto">${esc(TR('priceLede'))}</p>

      <!-- The same switch as the landing hero, driving the same cookie.
           Pricing used to own a private pair of radios, so someone who chose
           "my company" on the home page arrived here and was shown household
           plans. A switch that appears to forget is worse than no switch. -->
      <div class="audswitch" role="tablist" aria-label="${esc(TR('audAria'))}">
        <button class="audswitch__tab" type="button" role="tab" data-aud-set="me" aria-selected="true">${esc(TR('priceTabMe'))}</button>
        <button class="audswitch__tab" type="button" role="tab" data-aud-set="biz" aria-selected="false">${esc(TR('priceTabEnt'))}</button>
      </div>
    </div>

    <div class="aud-me">
      <div class="grid grid-3" style="margin-top:2.2rem;align-items:stretch">
        ${tier({
          delay: 0, eyebrow: TR('priceFree'), price: '€0', per: TR('priceForever'),
          blurb: TR('priceFreeBlurb'),
          features: [TR('priceFree1'), TR('priceFree2'), TR('priceFree3'), APP_LINE, TR('priceFree5')],
          excludes: FREE_EXCLUDES,
          href: `${LB()}/check/`, cta: TR('priceCheckTotal'),
          note: TR('priceFreeNote'),
        })}
        ${tier({
          delay: 110, eyebrow: TR('pricePersonal'), price: '€50', per: TR('pricePerYear'), featured: true,
          second: TR('pricePersonalSecond'),
          blurb: TR('pricePersonalBlurb'),
          features: [
            TR('pricePers1'),
            TR('pricePers2', nf(STATS.total)),
            TR('pricePers3'),
            TR('pricePers4'),
            TR('pricePers5'),
            TR('pricePers6'),
            APP_LINE,
          ],
          /* This used to link to /check/ with the copy "start with the free
             check" — which is where the visitor has almost always just come
             from. Every route to Stripe on this page pointed back at the free
             product, so the pricing page sold nothing. */
          plan: 'personal_annual', cta: TR('priceSubYear'),
          alt: { href: '#', plan: 'personal_monthly', label: TR('priceSubMonth') },
          href: `${LB()}/check/`,
          note: TR('pricePersonalNote'),
        })}
        ${tier({
          delay: 220, eyebrow: TR('priceStartup'), price: '€49', per: TR('pricePerMonth'),
          second: TR('priceStartupSecond'),
          blurb: TR('priceStartupBlurb'),
          features: [
            TR('priceStart1', nf(startupCount)),
            TR('priceStart2'),
            TR('priceStart3'),
            TR('priceStart4'),
            TR('priceStart5'),
            TR('priceStart6'),
            APP_LINE,
          ],
          plan: 'business_monthly', cta: TR('priceSubSeat'),
          alt: { href: `${SB()}/startups/check/`, label: TR('priceCheckCompany') },
          href: `${SB()}/startups/check/`,
          note: TR('priceSeatNote'),
        })}
      </div>

      <div class="callout callout--sage" style="margin-top:1.6rem">
        <p><strong>${esc(TR('priceWhatFreeT'))}</strong> ${esc(TR('priceWhatFreeB'))}</p>
      </div>

      <div class="callout" style="margin-top:1.4rem">
        <p><strong>${esc(TR('priceAppsT'))}</strong> ${esc(TR('priceAppsB'))}</p>
      </div>

      <div class="callout callout--sage" style="margin-top:1.4rem">
        <p><strong>${esc(TR('priceFlatT'))}</strong> ${esc(TR('priceFlatB'))}</p>
      </div>

      <div class="callout" style="margin-top:1.4rem">
        <p><strong>${esc(TR('priceNotDoT'))}</strong> ${esc(TR('priceNotDoB'))}</p>
      </div>
    </div>

    <div class="aud-biz">
      <!-- Self-serve, before the enterprise pitch.

           Flipping the switch to "For my company" removed every buyable thing
           from the pricing page: the enterprise panel is a mailto and a link
           to the workspace, and the €49 startup tier lived only in the
           individual half. A founder who told the site they were a company
           was shown three prices and no way to pay any of them. -->
      <div class="panel panel--float" style="margin-top:2.2rem">
        <span class="eyebrow eyebrow-accent">${esc(TR('priceStartup'))}</span>
        <h2 style="max-width:22ch;margin-top:.5rem">${esc(TR('priceStartupBlurb'))}</h2>
        <p class="lede" style="max-width:56ch">${esc(TR('priceStartupSecond'))}</p>
        <p class="btn-row" style="margin-top:1.4rem">
          <button class="btn btn-primary" type="button" data-checkout data-plan="business_monthly">${esc(TR('priceSubSeat'))}</button>
          <a class="btn btn-sm" href="${SB()}/startups/check/">${esc(TR('priceCheckCompany'))}</a>
        </p>
        <p class="tiny">${esc(TR('priceSeatNote'))}</p>
      </div>

      <div class="panel panel--float" style="margin-top:2.2rem">
        <span class="eyebrow eyebrow-accent">${esc(TR('entPriceEyebrow'))}</span>
        <h2 style="max-width:20ch;margin-top:.5rem">${esc(TR('entPriceH2a'))} <em class="serif-italic">${esc(TR('entPriceH2b'))}</em></h2>
        <p class="lede" style="max-width:58ch">${esc(TR('entPriceLede'))}</p>
        <p class="btn-row" style="margin-top:1.6rem">
          <a class="btn btn-primary" href="${BASE}/dashboard/">${esc(TR('entOpenWorkspace'))}</a>
          <a class="btn" href="${LB()}/enterprise/">${esc(TR('entWhatItDoes'))}</a>
          <a class="btn btn-ghost" href="mailto:hello@unclaimedgrant.com?subject=Enterprise%20trial">${esc(TR('entTalkToUs'))}</a>
        </p>
        <p class="tiny">${esc(TR('entPriceNote'))}</p>
      </div>

      <div class="grid grid-2x" style="align-items:stretch">
        ${[
          {
            eyebrow: TR('entFindT').split(' ')[0],
            title: TR('entFindT'),
            body: TR('entFindL', nf(startupCount), STARTUP_MANIFEST.countries.length),
          },
          {
            eyebrow: TR('priceEyebrow'),
            title: TR('entApplyT'),
            body: TR('entApplyL'),
          },
          {
            eyebrow: TR('entTrackT'),
            title: TR('entTrackT'),
            body: TR('entTrackL'),
          },
          {
            eyebrow: TR('entReportT'),
            title: TR('entReportT'),
            body: TR('entReportL'),
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
          [TR('entQuickT'), TR('entQuickB')],
          [TR('entToolsT'), TR('entToolsB')],
          [TR('entBoardT'), TR('entBoardB')],
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
        <p><strong>${esc(TR('entSeatWhyT'))}</strong> ${esc(TR('entSeatWhyB'))}</p>
      </div>
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:1.8rem;align-items:stretch">
    <div class="card reveal">
      <span class="eyebrow">${esc(TR('priceIncluded'))}</span>
      <h2 style="font-size:1.3rem;margin-top:.4rem">${esc(TR('priceChecklistT'))}</h2>
      <p class="small">${TR('priceChecklistB')}</p>
    </div>
    <div class="card reveal" data-delay="120">
      <span class="eyebrow">${esc(TR('priceWhereWeFile'))}</span>
      <h2 style="font-size:1.3rem;margin-top:.4rem">${esc(TR('priceAutoApplyT'))}</h2>
      <p class="small">${TR('priceAutoApplyB')}</p>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('priceTitle'),
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
/**
 * Where we can press submit, and where we cannot.
 *
 * "Auto-apply" is not one feature that is on or off — it is a legal question
 * with a different answer in every country, and the honest version of the
 * product says which answer applies before someone buys it expecting the other
 * one. Three tiers, read straight from packages/policy so this page cannot
 * drift from what the software will actually do:
 *
 *   MANDATED_SUBMIT  a statutory instrument lets a legal person file on your
 *                    behalf under a registered mandate, so we can submit.
 *   PREPARE_ONLY     we produce the complete, pre-filled package; you submit
 *                    it in your own authenticated session. This is not a
 *                    limitation of the software — filing as you, with your
 *                    credentials, is the thing regulators object to.
 *   DISCOVERY_ONLY   no application-assistance product at all here.
 */
function autoApplyPage() {
  const rows = manifest.countries
    .map((c) => ({ c, pol: policyFor(c.slug) }))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));

  const TIERS = [
    {
      id: AUTOMATION.MANDATED_SUBMIT,
      eyebrow: 'We can submit for you',
      title: 'Filed on your behalf, under a registered mandate',
      body:
        'A statutory instrument in these countries lets a legal person file on your behalf once you have signed a mandate. ' +
        'We prepare the claim, you sign the mandate, we submit and track it.',
      tone: 'callout--sage',
    },
    {
      id: AUTOMATION.PREPARE_ONLY,
      eyebrow: 'We prepare, you press submit',
      title: 'Everything filled in, filed in your own session',
      body:
        'We produce the complete application: every field pre-filled from your answers, every document listed and attached, ' +
        'the deadline in your calendar. You submit it yourself, signed in as you. We never ask for, hold or use your credentials ' +
        'on a government portal — that is the part regulators object to, and it is the part we will not build.',
      tone: '',
    },
    {
      id: AUTOMATION.DISCOVERY_ONLY,
      eyebrow: 'Discovery only',
      title: 'We tell you what exists, and stop there',
      body: 'Application assistance is not a product we can sell here. You get the directory, the rules and the deadlines.',
      tone: '',
    },
  ];

  const companyRows = manifest.countries
    .map((c) => ({ c, pol: companyPolicyFor(c.slug) }))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));
  const RAIL_LABEL = {
    delegated_account: 'a delegated account on your own portal login',
    registered_power: 'a government-registered power of attorney',
    signed_mandate: 'a signed letter of authorisation',
  };

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Auto-apply by country' }])}
  <span class="eyebrow eyebrow-accent">Auto-apply</span>
  <h1 style="max-width:24ch">We file for <em class="serif-italic">companies</em>. For individuals, you press submit.</h1>
  <p class="lede" style="max-width:62ch">These are two different legal questions and they have opposite answers, so the product
  gives two different guarantees. Both are read from the same policy table the software obeys, so this page cannot promise
  something the product will then refuse to do.</p>

  <div class="panel panel--float" style="margin-top:2rem;border-left:3px solid var(--accent,#2f6f4f)">
    <span class="eyebrow eyebrow-accent">Companies · every jurisdiction we cover</span>
    <h2 style="font-size:1.45rem;margin:.4rem 0 .5rem">We prepare it, we file it, we chase it</h2>
    <p class="small" style="max-width:64ch">Appointing an agent to prepare and submit funding applications is ordinary
    commercial practice — it is what grant consultants, R&amp;D tax credit firms and EU funding advisors do, and the portals are
    built for it. Horizon Europe has the LEAR precisely so a legal entity can appoint people to act for it. You sign one scoped
    authorisation naming the programmes; after that there is nothing per application.</p>
    <p class="small" style="max-width:64ch;margin-top:.8rem"><strong>What we never ask for is your password.</strong> Authority
    reaches us the way the portal intends: ${[...new Set(companyRows.map((r) => RAIL_LABEL[r.pol.rail]))].join(', or ')}. Your
    administrator grants it from inside your own account and revokes it in one click. Every filing we make carries the id of the
    authorisation it was made under, so the audit trail answers "who allowed this" without anyone reconstructing it.</p>
    <p class="small" style="margin-top:.9rem"><strong>Scoped, not blanket.</strong> The mandate names the programmes, the
    signatory and an expiry date — the version a finance director will actually sign, and the version a funder will accept if it
    asks to see it.</p>
    <p class="btn-row" style="margin-top:1.4rem">
      <a class="btn btn-primary" href="${SB()}/startups/check/">See what your company qualifies for</a>
      <a class="btn" href="${LB()}/enterprise/">What the workspace does</a>
    </p>
  </div>

  <h2 style="margin-top:3rem;font-size:1.3rem">Individuals: a different law, and a different answer</h2>
  <p class="small" style="max-width:62ch">The statutes here are consumer-protection ones — they exist because someone on
  subsistence benefits is vulnerable to an intermediary taking a cut. They are addressed to benefit claims by a natural person
  and they do not reach a company's grant application, which is why the two halves of this page disagree.</p>

  ${TIERS.map((t) => {
    const list = rows.filter((r) => r.pol.automation === t.id);
    if (!list.length) return '';
    return `<div class="panel panel--float" style="margin-top:1.8rem">
      <span class="eyebrow eyebrow-accent">${esc(t.eyebrow)}</span>
      <h2 style="font-size:1.35rem;margin:.4rem 0 .5rem">${esc(t.title)}</h2>
      <p class="small" style="max-width:64ch">${esc(t.body)}</p>
      <p class="small" style="margin-top:1rem"><strong>${list.length} ${list.length === 1 ? 'country' : 'countries'}:</strong>
        ${list.map((r) => `<a class="link-underline" href="${CB(r.c.slug)}/${r.c.slug}/">${esc(r.c.name)}</a>`).join(' · ')}</p>
    </div>`;
  }).join('')}

  <div class="callout" style="margin-top:1.8rem">
    <p><strong>What "prepare" actually means for an individual.</strong> Not a checklist. The application is filled in from the
    answers you already gave, the supporting documents are named and attached from your vault, the wording is drafted, and the
    deadline is tracked. What is left is the signature and the submit button, which have to be yours — and that is the part the
    law is about, not a gap in the software.</p>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Auto-apply by country — Unclaimed Grants',
    description:
      'Which countries we can file a claim in on your behalf under a registered mandate, and which ones we prepare the ' +
      'complete application for you to submit yourself. Read from the policy table the software obeys.',
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/auto-apply/`,
    body,
  });
}

function accountPage() {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell" style="max-width:34rem">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('acctCrumb') }])}
  <!-- Two headers, one shown.

       A signed-in subscriber opening this page was met with SIGN IN / "No
       password. Just your email." and, below it, a card telling them they
       were signed in and what plan they held. The page argued for signing in
       to somebody who already had. The script at the bottom swaps these once
       /api/me answers; signed out is the default because that is who this
       page is usually for. -->
  <div id="acct-hero-out">
    <span class="eyebrow eyebrow-accent">${esc(TR('acctCrumb'))}</span>
    <h1 style="max-width:16ch">${esc(TR('acctH1a'))} <em class="serif-italic">${esc(TR('acctH1b'))}</em></h1>
    <p class="lede" style="max-width:46ch">${esc(TR('acctLede2'))}</p>
  </div>
  <div id="acct-hero-in" hidden>
    <span class="eyebrow eyebrow-accent">${esc(TR('acctSignedIn'))}</span>
    <h1 style="max-width:16ch">${esc(TR('navMyAccount'))}</h1>
  </div>

  <div class="card" style="margin-top:2.4rem" id="auth-card">
    <div class="audience" style="margin-bottom:1.4rem">
      <input type="radio" name="acct" id="acct-me" class="audience__radio" checked>
      <input type="radio" name="acct" id="acct-biz" class="audience__radio">
      <div class="audience__switch">
        <label for="acct-me" class="audience__tab">${esc(TR('acctPersonal'))}</label>
        <label for="acct-biz" class="audience__tab">${esc(TR('acctBusiness'))}</label>
      </div>
      <!-- The switch used to set a hidden variable and nothing else, so it
           read as broken. Each side now says what it actually changes. -->
      <p class="small audience__panel audience__panel--me" style="margin:1rem 0 0">${esc(TR('acctPanelMe'))}</p>
      <p class="small audience__panel audience__panel--biz" style="margin:1rem 0 0">${esc(TR('acctPanelBiz'))}</p>
    </div>

    <form id="auth-form" novalidate>
      <div id="step-email">
        <label class="tiny" for="auth-email">${esc(TR('acctYourEmail'))}</label>
        <input class="field" type="email" id="auth-email" name="email" autocomplete="email"
               inputmode="email" required placeholder="you@example.com" style="width:100%;margin:.4rem 0 1rem">
        <button class="btn btn-primary" type="submit" id="auth-send" style="width:100%">${esc(TR('acctSendCode'))}</button>
      </div>

      <div id="step-code" hidden>
        <p class="small" id="code-sent-to" style="margin-top:0"></p>
        <label class="tiny" for="auth-code">${esc(TR('acctCode'))}</label>
        <input class="field" type="text" id="auth-code" name="code" autocomplete="one-time-code"
               inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required
               placeholder="000000" style="width:100%;margin:.4rem 0 1rem;letter-spacing:.4em;font-size:1.3rem">
        <button class="btn btn-primary" type="submit" id="auth-verify" style="width:100%">${esc(TR('acctVerify'))}</button>
        <p style="margin:.9rem 0 0"><button class="btn btn-sm" type="button" id="auth-back">${esc(TR('acctDiffEmail'))}</button></p>
      </div>

      <p class="small" id="auth-msg" role="status" aria-live="polite" style="margin:1rem 0 0;min-height:1.2em"></p>
    </form>

    <noscript>
      <p class="small">${TR('acctNoJs2')}</p>
    </noscript>
  </div>

  <div id="acct-welcome" hidden class="callout callout--sage" style="margin-top:1.2rem">
    <p><strong>${esc(TR('acctPaidT'))}</strong> ${esc(TR('acctPaidB'))}</p>
  </div>

  <div id="auth-signed-in" hidden class="card" style="margin-top:1.2rem">
    <span class="eyebrow eyebrow-accent">${esc(TR('acctSignedIn'))}</span>
    <h2 style="font-size:1.3rem;margin-top:.4rem" id="acct-email"></h2>
    <p class="small" id="acct-plan"></p>

    <!-- The whole reason this page existed and could not be paid from: a
         signed-in free account had two buttons, "go to my check" and "sign
         out", and no way to subscribe. Both branches are rendered here and
         the script shows the one that applies. -->
    <div id="acct-upgrade" hidden>
      <p class="btn-row" style="margin-top:1.2rem">
        <button class="btn btn-primary" type="button" data-checkout data-plan="personal_annual" id="acct-buy-year">${esc(TR('acctSubYear'))}</button>
        <button class="btn" type="button" data-checkout data-plan="personal_monthly" id="acct-buy-month">${esc(TR('acctSubMonth'))}</button>
      </p>
      <p class="tiny"><a class="link-underline" href="${LB()}/pricing/">${esc(TR('acctSubNote'))}</a></p>
    </div>

    <div id="acct-manage" hidden>
      <p class="btn-row" style="margin-top:1.2rem">
        <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('acctGoCheck'))}</a>
        <button class="btn" type="button" data-portal>${esc(TR('acctManage'))}</button>
      </p>
    </div>

    <p class="btn-row" style="margin-top:1.2rem">
      <a class="btn btn-sm" href="${LB()}/check/" id="acct-check-free">${esc(TR('acctGoCheck'))}</a>
      <a class="btn btn-sm" href="/auth/signout">${esc(TR('acctSignOut'))}</a>
    </p>
  </div>
</section>

<script type="module">
/* BASE, not LB(). The auth module is written once, to /app/auth.js — there is
   no /de/app/auth.js and there never was. A module specifier that 404s does
   not fail loudly: it kills the whole <script type="module">, so the submit
   handler below is never attached and the form does nothing at all when you
   press the button. Sign-in was silently dead on all six localised account
   pages, and check-links does not resolve module imports so nothing caught
   it. */
/* ?v= on every one of these, and it is load-bearing rather than tidy.
   
   A module specifier that resolves to a STALE copy fails exactly as loudly as
   one that 404s, which is to say silently: the browser refuses the import, the
   whole <script type="module"> is abandoned, and the sign-in form goes dead
   with nothing in the page to show for it. That is precisely how sign-in broke
   on six localised account pages once already. It happened again the moment
   checkout.js grew a new export — every browser holding yesterday's copy got
   "does not provide an export named 'accountState'" and a page that could
   neither sign in nor pay. Everywhere else on the site already versions its
   modules; this block was the one that did not. */
import { requestCode, verifyCode, me } from '${BASE}/app/auth.js?v=${ASSET_V}';
import { accountState, awaitEntitlement, upgrade } from '${BASE}/app/checkout.js?v=${ASSET_V}';
import { track } from '${BASE}/beacon.js?v=${ASSET_V}';

const $ = (s) => document.querySelector(s);
const msg = $('#auth-msg');
const form = $('#auth-form');
let email = '';
const acctType = () => ($('#acct-biz').checked ? 'business' : 'individual');

const params = new URLSearchParams(location.search);

/* Where to go after signing in, and what to do when we get there.
   Same-origin paths only: an open redirect that begins with a sign-in form is
   a phishing kit with our domain on it. */
const nextPath = (() => {
  const n = params.get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
})();
const wantPlan = params.get('plan');

/* The localised strings the state machine needs. Computed at build time, so
   /de/account/ says it in German — the previous version of this screen
   interpolated TR() directly and I very nearly shipped an English-only
   rewrite of it. */
const TR = ${JSON.stringify({
  active: TR('acctActive'),
  free: TR('acctFreeAcct'),
  pastDue: TR('acctPastDue'),
  lapsed: TR('acctLapsed'),
  admin: TR('acctAdminLine'),
  freeHere: TR('acctFreeHere'),
  personal_monthly: TR('planPersonalMonthly'),
  personal_annual: TR('planPersonalAnnual'),
  business_monthly: TR('planBusinessMonthly'),
  business_annual: TR('planBusinessAnnual'),
  planNone: TR('planNone'),
})};

const welcomed = params.has('welcome');
if (welcomed) $('#acct-welcome').hidden = false;

/* Paint one signed-in state.
   
   Every branch here used to be "entitled or not", which put a failed card
   payment and a brand new free account in the same box — and offered the
   same fix, buying a second subscription, which repairs neither. */
function paint(s) {
  $('#auth-card').hidden = true;
  $('#auth-signed-in').hidden = false;
  $('#acct-email').textContent = s.user?.email ?? '';

  const st = accountState(s, TR);
  $('#acct-plan').textContent = st.line;

  const canBuy = st.action === 'subscribe' || st.action === 'both';
  const canManage = st.action === 'portal' || st.action === 'both';
  $('#acct-upgrade').hidden = !canBuy;
  $('#acct-manage').hidden = !canManage;
  $('#acct-check-free').hidden = canManage;

  /* A business account was being sold Personal at 7 euros a month. The plan
     a button buys now follows the door they signed in by. */
  $('#acct-buy-year').dataset.plan = st.plans.annual;
  $('#acct-buy-month').dataset.plan = st.plans.monthly;
}

/* Already signed in? Show the account, not another sign-in form. */
me().then(async (s) => {
  if (!s.signedIn) return;
  /* The page stops arguing for something they have already done. */
  $('#acct-hero-out').hidden = true;
  $('#acct-hero-in').hidden = false;
  document.title = ${JSON.stringify(`${TR('navMyAccount')} · ${SITE_NAME}`)};
  paint(s);

  /* Just paid. Stripe redirects the moment the card clears; the webhook that
     actually grants the entitlement can land a second or two later. Wait for
     it rather than printing "Free account" at someone who has just been
     charged and telling them to reload. */
  if (welcomed && !s.entitled) {
    $('#acct-plan').textContent = ${JSON.stringify(TR('acctConfirming'))};
    paint(await awaitEntitlement());
  }

  /* Arrived here from a locked panel with a plan in hand: finish the job
     rather than making them find the button a second time. */
  if (!s.entitled && !welcomed && wantPlan) upgrade(wantPlan);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const onCode = !$('#step-code').hidden;
  msg.textContent = '';

  if (!onCode) {
    email = $('#auth-email').value.trim();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { msg.textContent = 'That does not look like an email address.'; return; }
    track('signin_start');
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
  track('signin_done');
  /* Back where they came from, if they came from somewhere. Someone who
     clicked "sign in to unlock" on their results wants their results. */
  if (wantPlan) {
    const started = await upgrade(wantPlan, { btn });
    if (started.ok) return;
  }
  location.href = nextPath || '${LB()}/check/';
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
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('footPrivacy') }])}
  <span class="eyebrow eyebrow-accent">${esc(TR('footPrivacy'))}</span>
  <h1 style="max-width:18ch">${esc(TR('privH1'))}</h1>
  <p class="lede">${esc(TR('privUpdated'))}</p>

  <div class="callout callout--sage" style="margin-top:1.6rem">
    <p><strong>${esc(TR('privShortT'))}</strong> ${esc(TR('privShortB'))}</p>
  </div>

  ${TR('privSecs')
    .map(
      ([h, b]) => `<h2 style="margin-top:2.2rem">${esc(h)}</h2>
  <p>${b}</p>`,
    )
    .join('\n')}
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('footPrivacy'),
    description: TR('privShortB'),
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
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navWriting') }])}
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
    { label: TR('navWriting'), href: `${BASE}/blog/` },
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
    ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navEnterprise'), href: `${LB()}/enterprise/` }, { label: 'Workspace' }])}
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
  <!-- This paragraph said "nothing is sent anywhere" for as long as the
       workspace was localStorage-only. It now syncs, so leaving the old
       sentence there would be a privacy claim that is no longer true — the
       worst kind of stale copy, because it is the kind someone relies on. -->
  <p class="tiny" style="color:var(--ink-4);max-width:70ch">Signed out, this workspace stays in this browser and
  nothing in it leaves the machine — which is why you can try it on a real portfolio before you have an account.
  Signed in, the workspace itself syncs to your account so it survives a new laptop and your team sees the same
  pipeline. The <em>matching</em> never moves either way: every company is scored in this tab, against the same
  engine the rest of the site is built from, so a portfolio is never shipped somewhere to be analysed.</p>
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

/**
 * /admin/ — the operator's door and the operator's dashboard, one page.
 *
 * English-only and `noindex`, and it does no gating of its own: the login form
 * posts to the Worker, every figure on it comes from an endpoint that checks
 * the session server-side, and with no session the page renders an empty
 * shell. There is nothing here worth hiding from view-source, which is the
 * point — an admin page whose secret is that you have to know the URL is not
 * an admin page.
 */
function adminPage() {
  const body = `
<section class="section-tight shell" style="max-width:70rem">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Operator' }])}
  <span class="eyebrow eyebrow-accent">Operator</span>
  <h1 style="max-width:20ch">Who is here, and <em class="serif-italic">where they stop</em></h1>

  <div class="card" id="admin-login" style="margin-top:2rem;max-width:32rem">
    <p class="small" style="margin-top:0">Signing in here unlocks every paid surface on the site for this
    browser for twelve hours, so you can walk the product as a subscriber sees it.</p>
    <form id="admin-form" novalidate>
      <label class="tiny" for="admin-email">Operator email</label>
      <input class="field" type="email" id="admin-email" autocomplete="username" required
             style="width:100%;margin:.4rem 0 1rem">
      <label class="tiny" for="admin-pass">Password</label>
      <input class="field" type="password" id="admin-pass" autocomplete="current-password" required
             style="width:100%;margin:.4rem 0 1rem">
      <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
      <p class="small" id="admin-msg" role="status" aria-live="polite" style="margin:1rem 0 0;min-height:1.2em"></p>
    </form>
  </div>

  <div id="admin-panel" hidden>
    <div class="row" style="gap:.6rem;margin:1.6rem 0">
      <span class="small" id="admin-who"></span>
      <span class="small">·</span>
      <label class="tiny" for="admin-days">Window</label>
      <select class="field" id="admin-days" style="width:auto">
        <option value="7">7 days</option>
        <option value="30" selected>30 days</option>
        <option value="90">90 days</option>
      </select>
      <button class="btn btn-sm" type="button" id="admin-refresh">Refresh</button>
      <a class="btn btn-sm btn-ghost" href="/auth/signout">Sign out</a>
    </div>

    <div class="grid grid-4" id="admin-kpis"></div>

    <section class="bucket">
      <div class="bucket__head"><h2>Where traffic stops</h2>
        <span class="bucket__count" id="admin-worst"></span></div>
      <div id="admin-funnel"></div>
    </section>

    <section class="bucket">
      <div class="bucket__head"><h2>Visitors per day</h2></div>
      <div id="admin-days-chart"></div>
    </section>

    <div class="grid grid-2x">
      <section class="bucket"><div class="bucket__head"><h2>By country checked</h2></div>
        <div id="admin-countries"></div></section>
      <section class="bucket"><div class="bucket__head"><h2>By language</h2></div>
        <div id="admin-locales"></div></section>
    </div>

    <section class="bucket">
      <div class="bucket__head"><h2>Who signed in</h2>
        <span class="bucket__count">most recent first</span></div>
      <div id="admin-logins"></div>
    </section>
  </div>

  <noscript><p class="small">The dashboard needs JavaScript — every figure is fetched.</p></noscript>
</section>

<script type="module" src="${BASE}/admin/admin.js?v=${ASSET_V}"></script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: [],
    title: 'Operator — traffic, sign-ins and funnel drop-off',
    description: 'Operator dashboard.',
    canonical: `${SITE_URL}/admin/`,
    head: '<meta name="robots" content="noindex, nofollow">',
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
      title: TR('entFindT'),
      lede: TR('entFindL', nf(startupCount), jurisdictions),
      points: [
        TR('entP11'),
        TR('entP12', nf(openNow)),
        TR('entP13'),
        TR('entP14'),
      ],
    },
    {
      n: '02',
      key: 'apply',
      title: TR('entApplyT'),
      lede: TR('entApplyL'),
      points: [
        TR('entP21'),
        TR('entP22'),
        TR('entP23'),
        TR('entP24'),
        TR('entP25'),
        TR('entP26'),
      ],
    },
    {
      n: '03',
      key: 'manage',
      title: TR('entTrackT'),
      lede: TR('entTrackL'),
      points: [
        TR('entP31'),
        TR('entP32'),
        TR('entP33'),
        TR('entP34'),
        TR('entP35'),
      ],
    },
    {
      n: '04',
      key: 'report',
      title: TR('entReportT'),
      lede: TR('entReportL'),
      points: [
        TR('entP41'),
        TR('entP42'),
        TR('entP43'),
        TR('entP44'),
        TR('entP45'),
        TR('entP46'),
      ],
    },
  ];

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navEnterprise') }])}
  <span class="eyebrow eyebrow-accent">Enterprise</span>
  <h1 style="max-width:16ch" data-blur-words>${esc(TR('entH1'))}</h1>
  <p class="lede reveal" style="max-width:56ch;margin-top:1.2rem">${esc(TR('entLede'))}</p>
  <div class="row reveal" data-delay="120" style="margin-top:1.6rem">
    <a class="btn btn-primary" href="${BASE}/dashboard/">${esc(TR('entOpenWorkspace'))}</a>
    <a class="btn" href="${LB()}/pricing/">${esc(TR('navPricing'))}</a>
  </div>
  <p class="tiny reveal" data-delay="180" style="margin-top:.8rem;color:var(--ink-4)">${esc(TR('entNoSales'))}</p>

  <div class="panel panel--float reveal" data-delay="200" style="margin-top:2.6rem">
    <div class="row-between" style="margin-bottom:1.2rem">
      <div>
        <span class="eyebrow" style="margin:0">${esc(TR('entDayOne'))}</span>
        <h3 style="margin:.2rem 0 0">${esc(TR('entDayOneH3'))}</h3>
      </div>
      <a class="btn btn-sm btn-primary" href="${BASE}/dashboard/">${esc(TR('entOpenWorkspace'))}</a>
    </div>
    <div class="grid grid-4" style="margin-bottom:1.2rem">
      <div class="stat"><span class="stat__n">${nf(startupCount)}</span><span class="stat__l">${esc(TR('entStatMatched'))}</span></div>
      <div class="stat"><span class="stat__n">${jurisdictions}</span><span class="stat__l">${esc(TR('entStatJurisdictions'))}</span></div>
      <div class="stat"><span class="stat__n">${nf(openNow)}</span><span class="stat__l">${esc(TR('entStatOpen'))}</span></div>
      <div class="stat"><span class="stat__n">12</span><span class="stat__l">${esc(TR('entStatTabs'))}</span></div>
    </div>
    <p class="tiny">${esc(TR('entSampleNote'))}</p>
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
  <h2 class="reveal">${esc(TR('entExtrasH2'))}</h2>
  <div class="grid grid-3" style="margin-top:1.4rem">
    ${[
      [TR('entSeatsT'), TR('entSeatsB')],
      [TR('entDataT'), `${TR('entDataB2')} <a class="link-underline" href="${BASE}/api/">${esc(TR('entSeeApi'))} →</a>`],
      [TR('entImportT'), TR('entImportB')],
      [TR('entOnboardT'), TR('entOnboardB')],
      [TR('entCoverageT'), TR('entCoverageB', jurisdictions, nf(openNow))],
      [TR('entWebT'), TR('entWebB')],
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
    <p><strong>${esc(TR('entWontT'))}</strong> ${esc(TR('entWontB'))}</p>
  </div>

  <div style="margin-top:3rem;text-align:center">
    <h2 class="reveal" style="max-width:22ch;margin-inline:auto">${esc(TR('entFinalH2'))}</h2>
    <p class="lede reveal" data-delay="100" style="max-width:40ch;margin:1rem auto 1.8rem">${esc(TR('entFinalLede'))}</p>
    <div class="row reveal" data-delay="180" style="justify-content:center">
      <a class="btn btn-primary" href="${BASE}/dashboard/">${esc(TR('entOpenWorkspace'))}</a>
      <a class="btn" href="${LB()}/pricing/">${esc(TR('navPricing'))}</a>
      <a class="btn btn-ghost" href="${BASE}/api/">${esc(TR('entApiDocs'))}</a>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('entTitle'),
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
  <div id="app" class="wizard" data-base="${BASE}">
    <noscript>
      <div class="callout">
        <p><strong>The company check needs JavaScript</strong> — it runs in your browser so your figures
        never reach a server. Without it you can still read every programme:</p>
        <p><a class="link-underline" href="${SB()}/startups/">Browse all ${nf(STARTUP_ALL.length)} startup programmes</a></p>
      </div>
    </noscript>
  </div>
</section>
<!-- The COMPANY wizard. This page used to load /app.js — the household one —
     with a data-mode="startup" attribute that nothing has ever read, so the
     primary business CTA asked founders about their children and matched them
     against personal benefits. -->
<script type="module" src="${BASE}/startup-check.js?v=${ASSET_V}"></script>`;

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
      container: 'grid grid-2', tr: TR, checkHref: `${LB()}/check/`, })}
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
      container: 'grid grid-2', tr: TR, checkHref: `${LB()}/check/`, })}
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
    e.sme_category && e.sme_category !== 'any' ? `${SME_LABEL[e.sme_category] ?? e.sme_category} enterprises` : null,
    (e.sectors || []).filter((x) => x && x !== 'any').length ? `Sectors: ${e.sectors.join(', ')}` : null,
    (e.stages || []).length ? `Stage: ${listAnd(e.stages.map((x) => STAGE_LABEL[x] ?? x.replace(/_/g, ' ')))}` : null,
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
    ${p.last_verified_at ? ` — checked ${esc(dateLabel(p.last_verified_at))}` : ''}
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
    { label: TR(aud.labelKey) },
  ];
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${entry.flag} ${esc(entry.name)} · ${esc(TR(aud.i18n))}</span>
  <h1 style="max-width:18ch">${esc(TR('audHead', list.length, TR(aud.i18n), entry.name))}</h1>
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
      href: `${LB()}/pricing/`, tr: TR, checkHref: `${LB()}/check/`, })}
  </div>
  <div class="callout" style="margin-top:2.5rem">
    <p><strong>${list.length - priced.length} of these publish no fixed amount.</strong> That does not mean they are
    small — it means the authority calculates the figure from your circumstances, and those are often the biggest
    payments of all. Run the check to see which apply to you.</p>
  </div>
</section>`;
  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('audHead', list.length, TR(aud.i18n), entry.name),
    description: `${TR('audHead', list.length, TR(aud.i18n), entry.name)} ${TR(aud.blurbKey)} ${TR('disclaimerRest')}`,
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
  const crumbs = [{ label: TR('backHome'), href: `${LB()}/` }, { label: TR(aud.labelKey) }];
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${esc(TR('whoFor'))}</span>
  <h1>${esc(TR(aud.labelKey))}</h1>
  <p class="lede" style="max-width:56ch">${esc(TR(aud.blurbKey))} ${esc(TR('audIndexCount', nf(total), rows.length))}</p>
  <div class="list-rows" style="margin-top:2rem">
    ${rows
      .map(
        (r) => `<a class="list-row" href="${CB(r.entry.slug)}/${r.entry.slug}/for/${aud.id}/">
      <span><span class="list-row__name">${r.entry.flag} ${esc(r.entry.name)}</span></span>
      <span class="list-row__right"><span class="list-row__amount">${r.n}</span><span class="tiny">${esc(TR('ctryProgrammes'))}</span></span>
    </a>`,
      )
      .join('')}
  </div>
</section>`;
  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `${TR(aud.labelKey)} — ${TR('audTitleSuffix')}`,
    description: `${TR(aud.blurbKey)} ${TR('audIndexCount', nf(total), rows.length)}`,
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
/* Through write(), not copyFileSync: these two need their internal imports
   version-stamped, and a straight copy is exactly how the stale matcher got
   pinned in every returning visitor's service worker. */
write('app.js', fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'));
fs.mkdirSync(path.join(OUT, 'engine'), { recursive: true });
write('engine/matcher.js', fs.readFileSync(path.join(__dirname, 'engine/matcher.js'), 'utf8'));
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
  ALT = altFor('/auto-apply/');
  page(`${pre}auto-apply/index.html`, autoApplyPage());
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
    ALT = [];
    page('admin/index.html', adminPage());
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

/**
 * Whether to emit the unstripped copies at all. Off by default, and that
 * default is load-bearing.
 *
 * The design is that /api/v1/full/ sits inside run_worker_first, so the Worker
 * can read it through env.ASSETS while its router 404s every external request.
 * That is true the moment the Worker is deployed — and completely false until
 * then. The site is on GitHub Pages today, where there is no router, so
 * emitting the full copies published the entire directory at a guessable path
 * and undid the whole paywall. robots.txt disallowing it is a request, not a
 * control.
 *
 * So: the full copies ship only when someone sets EMIT_FULL_DATASET=1, which
 * should happen in the same change that puts the Worker in front of the site.
 * Without them the Worker falls back to the stripped file (see loadCountry),
 * which degrades a paid answer rather than leaking an unpaid one — the right
 * direction to fail in.
 */
const EMIT_FULL = process.env.EMIT_FULL_DATASET === '1';

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
      /* The four gates added when the matcher learned that most of its wrong
         answers came from rules living in prose. They read names, funders and
         source snippets — exactly the fields stripped below — so they must be
         answered here or a locked record silently loses its condition and
         reappears as a straight match. */
      passported: passportedFrom(p),
      statutory_right: isStatutoryRight(p),
      citizens_only: isCitizensOnly(p),
      hardship_aid: isHardshipAid(p),
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
  /* The unstripped copy the Worker reads to answer a paid check — only where
     there is a Worker in front of it to refuse direct requests. */
  if (EMIT_FULL) write(`api/v1/full/programmes/${entry.slug}.json`, JSON.stringify(data));
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
  write('app/checkout.js', fs.readFileSync(path.join(SRC, 'pwa/checkout.js'), 'utf8'));
  write('app/unlock.js', fs.readFileSync(path.join(SRC, 'pwa/unlock.js'), 'utf8'));
/* The workspace. One directory deep, like /app/, so its ../packages/ and
   ../engine/ specifiers resolve to the copies written at the root. */
write('dashboard/dashboard.js', fs.readFileSync(path.join(SRC, 'pwa/dashboard.js'), 'utf8'));
write('dashboard/dashboard.css', fs.readFileSync(path.join(SRC, 'pwa/dashboard.css'), 'utf8'));
/* The operator dashboard. Same depth rule as /dashboard/ so ../packages/
   resolves; holds no secret, since the Worker checks the session. */
write('admin/admin.js', fs.readFileSync(path.join(SRC, 'pwa/admin.js'), 'utf8'));
write('beacon.js', fs.readFileSync(path.join(SRC, 'pwa/beacon.js'), 'utf8'));
/* The audience switch, at the root so every page and every language can load
   the same copy — the cookie it sets is shared across all of them. */
write('audience.js', fs.readFileSync(path.join(SRC, 'pwa/audience.js'), 'utf8'));
write('startup-check.js', fs.readFileSync(path.join(SRC, 'pwa/startup-check.js'), 'utf8'));
/* The workspace's sync layer. At the root, one directory above /dashboard/,
   which is how dashboard.js's `../workspace-sync.js` resolves. */
write('workspace-sync.js', fs.readFileSync(path.join(SRC, 'pwa/workspace-sync.js'), 'utf8'));
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
/* The funnel's step names, shared so the dashboard cannot invent one. */
write('packages/analytics/index.js', fs.readFileSync(path.join(ROOT, 'packages/analytics/index.js'), 'utf8'));

/* Startup pools as JSON assets. The Worker reads these through env.ASSETS
   rather than bundling the dataset, so a data refresh is a rebuild and not a
   redeploy of code. Pools, not countries: `eu` and `global` are real pools
   that many countries draw on. */
for (const c of STARTUP_MANIFEST.countries) {
  write(`api/v1/startups/${c.slug}.json`, JSON.stringify(publicStartups(STARTUP_DATA[c.slug])));
  if (EMIT_FULL) write(`api/v1/full/startups/${c.slug}.json`, JSON.stringify(STARTUP_DATA[c.slug]));
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
