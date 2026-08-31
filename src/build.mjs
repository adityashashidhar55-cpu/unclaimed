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
import { deadlineState, STATUS_META, effectiveStatus } from '../packages/deadlines/index.js';

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
/* The default is the domain the site is actually on.

   It used to be the old github.io host, and package.json's `build` script is
   the only invocation that sets SITE_ORIGIN — so a bare `node src/build.mjs`
   (the Verify phase, any manual build, any script that shells out) produced a
   dist whose canonicals and every language-switcher href pointed at a dead
   host: 13 of them on the home page alone. A canonical to a host you do not
   control is not a cosmetic error; it is a request that search engines
   deindex you in favour of somewhere that no longer answers. */
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://unclaimedgrant.com').replace(/\/$/, '');
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
/**
 * Link base for the company funnel: /startups/, /startups/check/, /enterprise/.
 *
 * This used to be a flat BASE, because the startups section was English-only.
 * /enterprise/ has been localised for a while and this was still sending
 * /fr/ visitors to the English page — and `ls -d dist/*​/startups` returned
 * nothing at all, while dist/fr/index.html linked /startups/check/ three
 * times and dist/fr/pricing/index.html linked it too. The localised hero CTA
 * for the entire business funnel dropped the visitor out of their locale.
 *
 * The two entry surfaces and /enterprise/ are generated per locale now, so
 * this follows the language. The per-country and per-programme startup pages
 * are still English-only and are linked with BASE directly — the same
 * fall-back-to-English rule CB() applies to countries.
 */
const SB = () => (L === 'en' ? BASE : `${BASE}/${L}`);

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

/**
 * Counts come from the records, never from the manifest.
 *
 * data/manifest.json is a checked-in artefact — generated_at 2026-08-12 — and
 * it had drifted from the files it describes. /gb/ printed "89 real support
 * programmes" and "11 of them pay out automatically; the other 78 need an
 * application" directly above a category breakdown that added up to 114,
 * because data/gb.json holds 114. /countries/ printed "25 countries, 2,216
 * programmes" over rows summing to 1,933, since build.mjs overwrote only the
 * two grand totals from live STATS and copied every per-country number
 * straight through. It also said "45 verified" for the UK where the /check/
 * picker said 25.
 *
 * None of that errors. A stale number is indistinguishable from a real one,
 * and on a site whose whole claim is accuracy it is the most expensive kind
 * of bug. So the derived fields are recomputed here, from the country file
 * itself, and the manifest is consulted only for identity — the things a
 * programme record cannot tell us: country_code, slug, name, flag, currency,
 * language, income_bands.
 *
 * `regions` is the sorted union of every eligibility.admin_areas value in the
 * file, which is where the /check/ picker's vocabulary has to come from if
 * choosing a region is to select anything.
 */
function deriveEntry(entry, data) {
  const regions = new Set();
  const categories = new Set();
  let verified = 0;
  let automatic = 0;
  for (const p of data.programmes) {
    if (p.category) categories.add(p.category);
    if (p.verification_status === 'verified') verified += 1;
    if (p.is_automatic) automatic += 1;
    const areas = p.eligibility && p.eligibility.admin_areas;
    for (const a of Array.isArray(areas) ? areas : areas ? [areas] : []) {
      const v = String(a).trim();
      if (v) regions.add(v);
    }
  }
  return {
    ...entry,
    programme_count: data.programmes.length,
    verified_count: verified,
    automatic_count: automatic,
    categories: [...categories].sort(),
    regions: [...regions].sort((a, b) => a.localeCompare(b)),
  };
}

const countries = manifest.countries
  .map((raw) => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, `${raw.slug}.json`), 'utf8'));
    return { entry: deriveEntry(raw, data), data };
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

/**
 * The one date the corpus is entitled to state.
 *
 * `last_verified_at` is identical on all 2,216 records — grouping it yields a
 * single bucket — so it is not a per-record fact, it is the day the catalogue
 * was extracted. Programme pages used to print it as "Last checked {date} · a
 * researcher confirmed this against the official page", which reads as a claim
 * about that one record and is not one. It is stated once as what it is, on
 * /methodology/, and fed to JSON-LD's dateModified from here.
 *
 * When per-record verification dates land, this constant is the single place
 * that has to learn they exist.
 */
const CORPUS_EXTRACTED_AT = STATS.asOf;

/**
 * Does this category label already end in the word "support"?
 *
 * Three of the labels do, and two templates appended the word again: the
 * related-programmes heading ("Other income support support in United
 * Kingdom", 641 pages) and the /browse/{cat}/ meta description ("421 income
 * support support programmes"). A doubled word is small, but it appears in a
 * search result, which is the first sentence of ours that most people read.
 */
const catEndsInSupport = (cat) => /(^|\s)support$/i.test(categoryLabel(cat));

/* ------------------------------------------------------------------ */
/* Shared fragments                                                    */
/* ------------------------------------------------------------------ */

/* The separators are drawn by CSS (`.breadcrumb > * + *::before`), not written
   here. They used to be real `<span>/</span>` elements, which a screen reader
   announces as "slash" between every step and which, once the trail was
   styled, rendered next to the CSS separator: "Home › / › Pricing". */
/**
 * "1 of them pay out automatically" was on seven country pages.
 *
 * A count and its verb have to agree, in both clauses, or the sentence reads
 * as generated rather than written — on a page whose entire argument is that
 * a human checked this. Both halves vary independently, so both are branched
 * here rather than patched at one call site. (The country-page lede is not
 * localised; when it is, this becomes a function-valued i18n key with the
 * same two branches per language.)
 */
function autoSplitSentence(automatic, manual) {
  const left =
    automatic === 0
      ? 'None of them pay out automatically'
      : automatic === 1
        ? 'One of them pays out automatically'
        : `${nf(automatic)} of them pay out automatically`;
  const right =
    manual === 0
      ? 'every one has to be claimed through an authority that already knows you qualify'
      : manual === 1
        ? 'the other one needs an application'
        : `the other ${nf(manual)} need an application`;
  return `${left}; ${right}.`;
}

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
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(effectiveStatus(p))).length;
  const reopening = STARTUP_ALL.filter(
    (p) => ['closed', 'paused'].includes(effectiveStatus(p)) && (p.reopen_note || p.opens_at || (p.typical_months || []).length),
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

    ${/* `hero__cta`, not `row`. Both `.btn-row` and `.hero__cta` carry the
          @media (max-width:560px) rule that stacks a button pair full-width —
          written for exactly this pair — and the hero used neither, so at
          390px the primary CTA rendered about 203px wide next to a secondary
          of similar weight and the two read as a choice rather than an
          action and an escape hatch. */''}
    <div class="hero__cta reveal aud-me" data-delay="340" style="margin-top:2.2rem;justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
      <a class="btn" href="${LB()}/countries/">${esc(TR('navCountries'))}</a>
    </div>
    <div class="hero__cta reveal aud-biz" data-delay="340" style="margin-top:2.2rem;justify-content:center">
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
        <p class="card-link__go">${esc(TR('ctaCheck'))} ${ICON.arrow}</p>
      </a>
      <a class="card card-link reveal" data-delay="120" href="${SB()}/startups/">
        <span class="eyebrow eyebrow-accent">${esc(TR('homeForFounders'))}</span>
        <h3>${esc(TR('homeFoundersH3', nf(startupCount), STARTUP_MANIFEST.countries.length))}</h3>
        <p class="small">${esc(TR('homeFoundersB'))}</p>
        <p class="card-link__go">${esc(TR('homeFindFunding'))} ${ICON.arrow}</p>
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
    ${/* The closing block carried no audience attribute, so a visitor who had
          answered "for my company" at the top of the page — and whose masthead
          and hero had both switched — was sent to the HOUSEHOLD wizard by the
          last and largest button on the page. The audience is a property of the
          whole document, not of the hero, so the final CTA gets the same
          aud-me / aud-biz pair the hero uses. */''}
    <div class="row reveal aud-me" data-delay="220" style="justify-content:center">
      <a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
      <a class="btn" href="${LB()}/pricing/">${esc(TR('seePricing'))}</a>
    </div>
    <div class="row reveal aud-biz" data-delay="220" style="justify-content:center">
      <a class="btn btn-primary" href="${SB()}/startups/check/">${esc(TR('ctaCheckCompany'))}</a>
      <a class="btn" href="${LB()}/pricing/">${esc(TR('seePricing'))}</a>
    </div>
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    /* The home page passed SITE_NAME here, and layout() special-cases a title
       equal to SITE_NAME by NOT appending the suffix — so the single most
       linked page on the site had a one-word <title> and og:title, "Unclaimed",
       in all seven locales. A one-word title is a search result nobody clicks
       and a share card that says nothing. Same suffix shape as every other
       page. */
    title: TR('homeTitle'),
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
  /* data/startups uses its own vocabulary for the same field. Without these
     four the startup programme page printed the raw token — "Deadline:
     annual_call" — and the at-a-glance row fell through to "Open all year"
     for records whose own status is closed. */
  annual_call: 'One call a year',
  cutoff: 'Fixed cut-off dates',
  closed: 'Closed',
  irregular: 'Opens irregularly',
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

      ${/* At ≤900px the sidebar stops being a sidebar: it goes static and
            lands roughly 4,000px down the page, below three paywalled
            panels. The one action this page exists to offer cannot be the
            last thing on it, so it is repeated here and shown only at that
            breakpoint — one instance visible at a time, never two. */''}
      <p class="prog-hoist"><a class="btn btn-primary" href="${LB()}/check/?country=${cc}">${esc(TR('ctaCheck'))}</a></p>

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
            /* `whoQualifiesBlurb` is a function of the rule count. Called with
               no argument it interpolated the literal word "undefined" into
               body copy — "The undefined published rules this programme tests
               you against" — on 3,462 programme pages in all seven locales,
               one line above the paywall. Nothing errored; a template just
               stringified a missing parameter. Pass the count. */
            blurb: TR('whoQualifiesBlurb', ruleRows.length),
            id: 'rules',
            rows: Math.min(ruleRows.length, 4), tr: TR, base: LB(), cta: false })
        : `<h2 style="margin-top:2.5rem">Who qualifies</h2>
      <table class="rule-table">${ruleRows.join('')}</table>`}

      ${/* The fourth pitch on one page. The locked panel above already carries
            the buttons; this said the same thing again in a louder colour.
            One sentence, no buttons — the reader has not forgotten.

            It also used to promise three things unconditionally. 344 records
            carry an empty procedure_steps AND an empty documents_required (AE
            62, BE 58, PT 55, ES 52, AT 49, GB 34, SG 24 …), and for much of the
            AE subset application_url is the same bare domain root as
            source_url — so on those pages a reader was being sold steps,
            documents and a link that do not exist behind the paywall. Selling
            content we do not hold is the one thing this site cannot do and
            still be worth paying for. The sentence now names only what is
            genuinely withheld on THIS record; when nothing procedural is
            withheld, the amount and the rules still are, and it says so. */''}
      ${
        PAYWALL_SCHEMES
          ? `<p class="small" data-paywall-note style="margin:2rem 0;color:var(--ink-3)">${esc(
              (p.procedure_steps || []).length ||
              (p.documents_required || []).length ||
              (p.application_url && p.application_url !== p.source_url)
                ? TR('paidPlanNoteFull')
                : TR('paidPlanNoteThin'),
            )}</p>`
          : ''
      }
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
        ${/* This read "Last checked {date} · a researcher confirmed this against
              the official page". Every one of the 2,216 records carries the
              same last_verified_at, so the date was not a fact about this
              programme — it was the extraction date of the whole corpus, worn
              as a per-record claim. That is a false specificity, and on a site
              whose entire product is "we dated it" it is the most expensive
              kind of thing to be wrong about. The verification STATUS is real
              per record, so that is what survives; the corpus date is stated
              once, as a corpus fact, on /methodology/. When per-record dates
              arrive this line gets its date back. */''}
        <p class="tiny" style="margin:.6rem 0 0">${esc(
          p.verification_status === 'verified' ? TR('provVerified') : TR('provAuto'),
        )}</p>
      </div>

      ${/* The heading was assembled as "Other {label} support in {country}",
            with the English category label lowercased. Three of those labels
            already end in the word "support", so 641 pages carried "Other
            income support support in United Kingdom" — and the six non-English
            locales got an English frame besides. The frame comes from i18n now,
            and a label that already says "support" picks the frame that does
            not say it again. */''}
      ${related.length ? `<h2 style="margin-top:3rem">${esc(
        TR(
          catEndsInSupport(p.category) ? 'otherSupportIn' : 'otherSupport',
          categoryLabel(p.category).toLowerCase(),
          entry.name,
        ),
      )}</h2>${teaseList({ rows: relatedRows, total: related.length, noun: 'programmes', href: `${LB()}/pricing/`, tr: TR, checkHref: `${LB()}/check/`, cc, base: BASE, hiddenSlugs: related.slice(FREE_ROWS).map((x) => x.slug) })}` : ''}
    </div>

    <aside class="sticky-side stack no-print">
      ${/* The weights used to say the opposite of what the page is for.

            Solid teal, 320×48, went to "Apply on the official site" — an
            outbound government link that ends the visit — while the only paid
            conversion on the page and a print button were two identical 320px
            ghosts beside it. Inverted: the entitlement check is the primary,
            the official link keeps its arrow but drops to glass, and Print is
            a utility and reads as one. `btn-ghost` is now reserved for
            utilities, so neither of the first two carries it. */''}
      <a class="btn btn-primary" style="width:100%" href="${LB()}/check/?country=${cc}">${esc(TR('ctaCheck'))}</a>
      ${
        p.application_url
          ? `<a class="btn" style="width:100%" href="${attr(p.application_url)}" rel="nofollow noopener" target="_blank">Apply on the official site ${ICON.arrow}</a>`
          : `<a class="btn" style="width:100%" href="${attr(p.source_url)}" rel="nofollow noopener" target="_blank">Open the official page ${ICON.arrow}</a>`
      }
      <p class="small" style="margin:.2rem 0 0"><a class="link-underline" href="#" onclick="window.print();return false">Print / save as PDF</a></p>
      <div class="card card-flat">
        <h2 class="h-eyebrow" style="margin-bottom:.7rem">At a glance</h2>
        <table class="rule-table" style="font-size:.85rem">
          <tr><th>Type</th><td>${esc(benefitTypeLabel(p.benefit_type))}</td></tr>
          <tr><th>Applying</th><td>${p.is_automatic ? 'Automatic — no application' : esc(CHANNEL_LABEL[p.application_channel] ?? 'Online')}</td></tr>
          <tr><th>Deadline</th><td>${esc(p.deadline_note || DEADLINE_LABEL[p.deadline_type] || 'Open all year')}</td></tr>
          <tr><th>Run by</th><td>${esc(LEVEL_LABEL[p.admin_level] ?? 'National government')}${p.admin_area ? ` · ${esc(p.admin_area)}` : ''}</td></tr>
          ${/* Same constant, same false specificity — a date in an "at a glance"
                table reads as the day someone looked at THIS record. */''}
          <tr><th>${esc(TR('atGlanceChecked'))}</th><td>${esc(
            p.verification_status === 'verified' ? TR('provVerifiedShort') : TR('provAutoShort'),
          )}</td></tr>
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
    /* One named constant, so the day per-record dates arrive there is exactly
       one place that has to learn about them. Structured data may carry the
       corpus date honestly — dateModified is a statement about the document,
       and the document really was generated from that extraction. */
    dateModified: CORPUS_EXTRACTED_AT,
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
    description: `${p.name_en}${p.name_local !== p.name_en ? ` (${p.name_local})` : ''}: who qualifies, ${amt ? `worth ${amt}, ` : ''}documents needed, how to apply, and the official ${p.funder} source.`,
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
  ${autoSplitSentence(automatic, entry.programme_count - automatic)}</p>
  <div class="hero__cta">
    ${/* The free personal check had five verbs across the site — "Check what
          you're owed", "Check your total", "Check your total free", "Check
          your entitlement in United States", "Check your full entitlement".
          One action, one name; the country is already the <h1>. */''}
    <a class="btn btn-primary" href="${LB()}/check/?country=${cc}">${esc(TR('ctaCheck'))} ${ICON.arrow}</a>
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
      .map((c) => `<a class="tag" href="${CB(cc)}/${cc}/${c}/">${esc(categoryLabel(c))} <span class="tag__n">${cats[c].length}</span></a>`)
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
    dataset of <a href="${BASE}/startups/${esc(entry.slug)}/">${STARTUP_DATA[entry.slug].programmes.length}
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

/**
 * /browse/ — the parent of the ten category directories.
 *
 * It was a 404. dist/browse/ held ten live children, sitemap.xml listed all
 * ten and not the parent, and the breadcrumb on each child read
 * "Home / Browse / Housing & rent" with "Browse" as inert text — an explicit
 * invitation to trim the URL to a page that did not exist. Adding it changes
 * no URL; it fills a hole the site already pointed at.
 */
function browseIndex() {
  const cats = Object.keys(STATS.byCategory).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
  const rows = cats
    .map((cat) => {
      const n = STATS.byCategory[cat] || 0;
      const inCountries = countries.filter(({ data }) => data.programmes.some((p) => p.category === cat)).length;
      return `<a class="list-row" href="${BASE}/browse/${cat}/">
      <span><span class="list-row__name">${esc(categoryLabel(cat))}</span>
      <span class="list-row__meta">${inCountries} ${esc(TR('navCountries'))}</span></span>
      <span class="list-row__right"><span class="list-row__amount">${nf(n)}</span><span class="tiny">${esc(TR('ctryProgrammes'))}</span></span>
    </a>`;
    })
    .join('');

  const crumbs = [{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('browseAll') }];
  const body = `
<section class="section-tight shell">
  ${breadcrumbs(crumbs)}
  <span class="eyebrow eyebrow-accent">${esc(TR('ctryEyebrow'))}</span>
  <h1>${esc(TR('browseAll'))}</h1>
  <p class="lede" style="max-width:56ch">${esc(TR('browseAllLede'))}</p>
  <div class="list-rows" style="margin-top:2rem">${rows}</div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('browseAll'),
    description: TR('browseAllLede'),
    canonical: `${SITE_URL}/browse/`,
    body,
    jsonld: [breadcrumbLd(crumbs)],
  });
}

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

  const crumbs = [
    { label: TR('backHome'), href: `${LB()}/` },
    /* Was inert text pointing at a 404. The section is generated in English
       only, like /startups/, so the href is BASE rather than LB() — the same
       fall-back-to-English rule CB() applies to countries. */
    { label: TR('browseAll'), href: `${BASE}/browse/` },
    { label: categoryLabel(cat) },
  ];
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
    description: `${total} ${categoryLabel(cat).toLowerCase()}${
      catEndsInSupport(cat) ? '' : ' support'
    } programmes across ${STATS.countryCount} countries, with official sources and eligibility rules.`,
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
    title: TR('countriesTitle'),
    description: `Benefit and grant coverage across ${STATS.countryCount} countries — ${nf(STATS.total)} sourced programmes with eligibility rules and official links.`,
    canonical: `${SITE_URL}/countries/`,
    body,
    jsonld: [breadcrumbLd([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navCountries') }])],
  });
}

/* ================================================================== */
/* 7. Wizard + results (client-rendered, one page)                     */
/* ================================================================== */

/**
 * The wizard's translations, shipped with the page rather than the script.
 *
 * /fr/check/ served a fully French shell around an entirely English wizard —
 * every question, option, hint, progress caption and bucket heading — in six
 * locales, because src/app.js has no translator and every locale's page loads
 * the same /app.js. check-i18n.mjs could not see it: the strings are injected
 * client-side, long after the file it reads was written.
 *
 * A per-page JSON island rather than a per-locale copy of app.js: one script,
 * cached once, and no build-order dependency between the generator and the
 * wizard. Keyed by the exact English source string, so the wizard calls
 * T('Where do you live?') with the literal it already has and that literal is
 * its own fallback — neither side has to agree a list of key names, and a
 * missing translation degrades to English rather than to a key name printed
 * at the reader. English emits {} for the same reason.
 */
function wizardDict() {
  const d = L === 'en' ? {} : TR('wizard') || {};
  return `<script id="i18n-wizard" type="application/json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`;
}

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
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/check/`,
    head: wizardDict(),
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
  ${/* The corpus date, said once, in the only place where it is true as
        written. Programme pages carried it per record, where it implied a
        researcher had opened that page on that day. */''}
  <p>${esc(TR('methCorpusDate', dateLabel(CORPUS_EXTRACTED_AT)))}</p>
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
  ${/* The hero used to say "Plug the whole dataset into anything … Static
        JSON, no key, no rate limit", above a row promising "full records".
        The public payload is not the whole dataset and never was: of 114 GB
        records, 2 carry a name. A developer reading this page and then
        fetching the file finds no name, no funder, no source_url, no steps
        and an opaque slug, and concludes the API is broken rather than
        deliberately partial. Say which fields are public, here, once. */''}
  <h1>The structured half of the dataset, as files</h1>
  <p class="lede">Static JSON, no key, no rate limit, CORS-open by virtue of being files on a CDN.
  The structured fields — amounts, categories, eligibility rules, verification status — are public.
  Programme names and the prose around them are part of the paid plan and come back at the same
  URLs in an entitled session.</p>

  <h2 style="margin-top:2.5rem">REST-shaped endpoints</h2>
  <table class="rule-table">
    <tr><th><code>/api/v1/countries.json</code></th><td>Country index: codes, currencies, regions, income bands, counts.</td></tr>
    <tr><th><code>/api/v1/programmes/{cc}.json</code></th><td>Every programme for one country. The
      first ${FREE_ROWS} records are whole; the rest carry only
      <code>slug</code> (an opaque id), <code>category</code>, <code>benefit_type</code>,
      <code>amount_min</code>, <code>amount_max</code>, <code>amount_currency</code>,
      <code>amount_period</code>, <code>admin_level</code>, <code>admin_area</code>,
      <code>eligibility</code>, <code>is_automatic</code>, <code>verification_status</code>,
      <code>derived</code> and <code>locked: true</code>. No <code>name_en</code>,
      <code>funder</code>, <code>source_url</code>, <code>procedure_steps</code> or
      <code>documents_required</code> — those need an entitled session.</td></tr>
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

  /* One tier component, used four times.

     There used to be two. The individual tiers were 581px `.card` panels laid
     out two-up; the company tiers were 1180px `.panel panel--float` slabs with
     double the padding, a 32px figure instead of a 38px one, and — on
     Enterprise — no `.figure-sm` at all, its monthly figure hiding in an
     11.5px eyebrow and its annual figure in a footnote. Four things that are
     the same kind of thing were drawn three different ways, so a reader could
     not compare them by looking, which is the only thing a pricing page is
     for.

     Rules the component enforces, because each of them was broken somewhere:
       - one price figure per tier, in the same slot, in `.figure-sm`;
       - the price is stated ONCE. The Startup slab said €49 four ways
         ("€49/month", "or €490/year · one company, one seat", a button reading
         "Subscribe — €49 a seat a month", and a "Billed per seat" footnote),
         and a reader counting prices on a page counts offers;
       - exactly one primary control. Enterprise had three buttons of near
         equal weight ("Open the workspace", "What it does", "Talk to us"), so
         the card asked a question instead of making an offer. The other two
         drop to `.small` links under the button.

     The alternate billing period stays a real checkout control rather than
     becoming prose: business_annual and personal_monthly are priced in
     wrangler.jsonc and handled in src/pwa/checkout.js, and a plan you can be
     charged for but cannot buy is the omission this page already had once. It
     is a `.small` underlined link, not a second pill — one primary control per
     card is about weight, not about how many ways out there are. */
  const tier = (t) => `<div class="card reveal${t.featured ? ' card--featured' : ''}" data-delay="${t.delay}" data-tier="${attr(t.key)}">
    <div class="row-between" style="align-items:baseline">
      <span class="eyebrow${t.featured ? ' eyebrow-accent' : ''}">${t.eyebrow}</span>
      ${t.featured ? `<span class="badge badge-pick">${esc(TR('priceMostPick'))}</span>` : ''}
    </div>
    <div class="figure-sm">${esc(t.price)}${t.per ? `<span class="tiny">${esc(t.per)}</span>` : ''}</div>
    ${
      t.second
        ? `<p class="small" style="margin:-.3rem 0 .6rem;color:var(--ink-4)">${
            t.secondPlan
              ? `<a class="link-underline" href="#" data-checkout data-plan="${attr(t.secondPlan)}">${esc(t.second)}</a>`
              : esc(t.second)
          }</p>`
        : ''
    }
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
        ? `<button class="btn btn-primary" type="button" data-checkout data-plan="${attr(t.plan)}">${esc(t.cta)}</button>`
        : `<a class="btn btn-primary" href="${attr(t.href)}">${esc(t.cta)}</a>`
    }</p>
    ${
      (t.links || []).length
        ? `<p class="small" style="margin:.6rem 0 0">${(t.links || [])
            .map((l) => `<a class="link-underline" href="${attr(l.href)}">${esc(l.label)}</a>`)
            .join(' · ')}</p>`
        : ''
    }
    ${t.note ? `<p class="tiny" style="margin-top:.8rem">${esc(t.note)}</p>` : ''}
  </div>`;

  /* The line every free tier repeats, written once.
     Free is deliberately, legibly small: the total and the count. Saying so in
     the same words in three places is how a visitor learns it is a rule and
     not an oversight. */
  const FREE_EXCLUDES = [TR('priceNo1'), TR('priceNo2'), TR('priceNo3')];

  const APP_LINE = TR('priceAppLine');

  /* The price appears once per tier, in the tier's own figure, and the button
     says only "Subscribe". It used to be built from TR('planPrice') and glued
     into the button label as well, which is how the Startup slab came to state
     €49 in four different shapes. planPrice still backs the /account/ buttons,
     where the plan is known but the tier card is not on screen. */

  /* Free, in both audiences.

     Its own copy says "For people and for companies — the free tier is the
     same either way", and it was emitted only inside `.aud-me`. So a visitor
     who answered "for my company" — the answer this page asks for at the top —
     saw a €49/month floor and no zero-price tier at all, on the page whose
     headline is "Finding out is free. Always." The card is identical either
     way; only the CTA differs, because the free check for a company is a
     different wizard. */
  const freeTier = (audience) =>
    tier({
      key: 'free', delay: 0, eyebrow: TR('priceFree'), price: '€0', per: TR('priceForever'),
      blurb: TR('priceFreeBlurb'),
      features: [TR('priceFree1'), TR('priceFree2'), TR('priceFree3'), APP_LINE, TR('priceFree5')],
      excludes: FREE_EXCLUDES,
      href: audience === 'biz' ? `${SB()}/startups/check/` : `${LB()}/check/`,
      cta: audience === 'biz' ? TR('ctaCheckCompany') : TR('ctaCheck'),
      note: TR('priceFreeNote'),
    });

  /* One toggle, in the hero, above everything it changes.

     Hidden radios and sibling selectors, not `html[data-audience]`. The page
     used to draw `.audswitch` buttons whose panels were shown by
     `html[data-audience='biz'] .aud-me { display:none }`, and that attribute is
     only ever written by JavaScript — so with scripting off, or in the moment
     before app.js boots, `html:not([data-audience='biz']) .aud-biz` hid the
     entire company half: both company tiers and both checkout buttons,
     unreachable. /account/ already solved this with `.audience__*` and hidden
     radios, so this is the existing pattern rather than a new one.

     `data-aud-set` stays on the labels so src/pwa/audience.js keeps writing the
     cookie and keeps the masthead in sync. That handler calls preventDefault(),
     which cancels a label's activation behaviour and therefore stops the radio
     flipping — so the small script at the foot of this page mirrors the
     audience back onto the radio. Without JS the radio is the only mechanism
     and it works on its own; with JS the two agree. */
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('navPricing') }])}

  <div class="audience">
    <input type="radio" name="aud" id="aud-me" class="audience__radio" checked>
    <input type="radio" name="aud" id="aud-biz" class="audience__radio">

    <div class="hero-centre">
      <span class="eyebrow eyebrow-accent">${esc(TR('priceEyebrow'))}</span>
      <h1 style="max-width:16ch;margin-inline:auto">${esc(TR('priceH1a'))} <em class="serif-italic">${esc(TR('priceH1b'))}</em></h1>
      <p class="lede" style="max-width:52ch;margin-inline:auto">${esc(TR('priceLede'))}</p>

      <!-- The same switch as the landing hero, driving the same cookie.
           Pricing used to own a private pair of radios, so someone who chose
           "my company" on the home page arrived here and was shown household
           plans. A switch that appears to forget is worse than no switch. -->
      <div class="audience__switch audience__switch--hero" aria-label="${esc(TR('audAria'))}">
        ${/* One control, one pair of labels. This switch was "Individuals &
              startups / Enterprise", the home hero's was "For me / For my
              company" and /account/'s was "Personal / Business" — three
              namings of the same binary on one site, and the pricing split
              put startups on the individual side while the hero put "my
              company" opposite "me". Startups are a company. */''}
        <label for="aud-me" class="audience__tab" data-aud-set="me">${esc(TR('audTabMe'))}</label>
        <label for="aud-biz" class="audience__tab" data-aud-set="biz">${esc(TR('audTabBiz'))}</label>
      </div>
    </div>

    <div class="audience__panel audience__panel--me">
      <div class="grid grid-2x" style="margin-top:2.2rem;align-items:stretch">
        ${freeTier('me')}
        ${tier({
          key: 'personal', delay: 110, eyebrow: TR('pricePersonal'), price: '€50', per: TR('pricePerYear'),
          featured: true,
          second: TR('pricePersonalSecond'), secondPlan: 'personal_monthly',
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
          plan: 'personal_annual', cta: TR('subscribeShort'),
          note: TR('pricePersonalNote'),
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

    <div class="audience__panel audience__panel--biz">
      <div class="grid grid-3" style="margin-top:2.2rem;align-items:stretch">
        ${freeTier('biz')}
        ${tier({
          key: 'startup', delay: 110, eyebrow: TR('priceStartup'), price: '€49', per: TR('pricePerSeatMonth'),
          featured: true,
          second: TR('priceStartupYear'), secondPlan: 'business_annual',
          blurb: TR('priceStartupBlurb'),
          features: [
            TR('priceStart1', nf(startupCount)), TR('priceStart2'), TR('priceStart3'),
            TR('priceStart4'), TR('priceStart5'), TR('priceStart6'), APP_LINE,
          ],
          plan: 'business_monthly', cta: TR('subscribeShort'),
          note: TR('priceSeatNote'),
        })}
        ${tier({
          key: 'enterprise', delay: 220, eyebrow: TR('priceEnterprise'), price: '€80',
          per: TR('pricePerSeatMonth'),
          second: TR('priceEnterpriseYear'),
          blurb: TR('entPriceLede'),
          features: [TR('entFindT'), TR('entApplyT'), TR('entTrackT'), TR('entReportT')],
          href: `${BASE}/dashboard/`, cta: TR('entOpenWorkspace'),
          links: [
            { href: `${LB()}/enterprise/`, label: TR('entWhatItDoes') },
            { href: 'mailto:hello@unclaimedgrant.com?subject=Enterprise%20trial', label: TR('entTalkToUs') },
          ],
          note: TR('entPriceNote'),
        })}
      </div>

      ${/* A section heading, not just a run of cards.

            The two enterprise slabs that used to sit here each carried an h2,
            and folding them into the tier grid took both away — leaving the
            company panel going straight from the page h1 to the h3 of a detail
            card. A skipped heading level is invisible on screen and is the
            whole outline to anyone reading with a screen reader. The copy is
            the headline the Enterprise slab used to carry, which would
            otherwise have been orphaned. */''}
      <h2 style="max-width:22ch;margin-top:2.4rem">${esc(TR('entPriceH2a'))} <em class="serif-italic">${esc(TR('entPriceH2b'))}</em></h2>
      <p class="lede" style="max-width:58ch">${esc(TR('entPriceEyebrow'))}</p>

      <div class="grid grid-2x" style="align-items:stretch">
        ${[
          {
            eyebrow: TR('entEyeFind'),
            title: TR('entFindT'),
            body: TR('entFindL', nf(startupCount), STARTUP_MANIFEST.countries.length),
          },
          {
            eyebrow: TR('entEyeApply'),
            title: TR('entApplyT'),
            body: TR('entApplyL'),
          },
          {
            eyebrow: TR('entEyeTrack'),
            title: TR('entTrackT'),
            body: TR('entTrackL'),
          },
          {
            eyebrow: TR('entEyeReport'),
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
</section>

${/* Keep the radio and the cookie telling the same story.

      The panels above are shown by a checked radio, which is what makes this
      page work with JavaScript off. src/pwa/audience.js owns the cookie and the
      masthead, and its delegated click handler calls preventDefault() on
      anything carrying data-aud-set — which cancels a label's activation
      behaviour, so the radio would never flip while scripting is on. Rather
      than reach into that module (it is deliberately generic, and every other
      page's switch depends on the preventDefault), this page mirrors the
      audience onto the radio: once at boot from the attribute the head script
      already set, and again whenever audience.js announces a change.

      Plain inline script, no module specifier: a 404 on an import kills a whole
      type=module block silently, and the failure mode of that here would be a
      pricing page stuck on one audience with no error anywhere. */''}
<script>
(function () {
  function sync(v) {
    var r = document.getElementById(v === 'biz' ? 'aud-biz' : 'aud-me');
    if (r && !r.checked) r.checked = true;
  }
  /* The cookie, not the attribute. layout() writes data-audience="me" onto
     <html> for every dual-audience page, and audience.js's <head> boot script
     deliberately leaves an already-set attribute alone — so at this point the
     attribute always reads "me" and a returning company visitor would land on
     the household panel. The cookie is the actual answer, and reading it here
     is synchronous and needs nothing to have loaded. */
  var m = document.cookie.match(/(?:^|; )ua_aud=(me|biz)/);
  sync(m ? m[1] : 'me');
  document.addEventListener('audiencechange', function (e) { sync(e.detail); });
})();
</script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('priceTitle'),
    description: `Free forever to see how much you are owed and how many programmes it comes from, on the web and in the installable web app at /app/. Paid unlocks the names, the directory, the document checklist and auto-apply. Personal €50/year, Startup €49/month, Enterprise from €80/seat/month across ${nf(totalProgrammes)} programmes.`,
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
<!-- The no-JS fallback was white text on the app's #eef7f7 body: 1.07:1, so a
     visitor with scripting off got a blank screen and no route back to a site
     that works perfectly well without JavaScript. It inherits --ink now, and
     the way out is a link in --teal. -->
<div id="app"><noscript><p style="padding:2rem;color:var(--ink)">
This app needs JavaScript. The full site works without it — <a href="${BASE}/" style="color:var(--teal)">open unclaimed</a>.
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
    /* Hardcoded English. The head of a page is the one part a reader sees
       before they open it — a French search result and a French share card
       carrying an English title is the site announcing that the localisation
       stops at the door. */
    title: TR('autoApplyTitle'),
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
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('acctCrumb') }]).replace(
    '</nav>',
    `<span id="acct-crumb-in" hidden>${esc(TR('navMyAccount'))}</span></nav>`,
  )}
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
    <!-- No eyebrow: the card below already says SIGNED IN, and saying it
         twice on one screen is the same repetition the headline had. -->
    <h1 style="max-width:16ch">${esc(TR('navMyAccount'))}</h1>
  </div>

  <div class="card" style="margin-top:2.4rem" id="auth-card">
    <div class="audience" style="margin-bottom:1.4rem">
      <input type="radio" name="acct" id="acct-me" class="audience__radio" checked>
      <input type="radio" name="acct" id="acct-biz" class="audience__radio">
      <div class="audience__switch">
        <label for="acct-me" class="audience__tab">${esc(TR('audTabMe'))}</label>
        <label for="acct-biz" class="audience__tab">${esc(TR('audTabBiz'))}</label>
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

      ${/* "Could not send the code." was a p.small in --ink-3 — the same
            treatment as the marketing sentence beside it — and it named
            neither the cause nor the way out. `.notice` existed in theme.css
            and nothing used it. tabindex so failure can take focus: an
            aria-live region announces, but a sighted keyboard user who has
            just pressed a button that appeared to do nothing needs the
            cursor moved to the reason. */''}
      <p id="auth-msg" role="status" aria-live="polite" tabindex="-1" hidden style="margin:1rem 0 0"></p>
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
        ${/* No price here at build time.

              These used to be hardcoded "Subscribe — €50 a year" and "or €7 a
              month", and paint() then rewrote only dataset.plan. On a business
              account checkout.js's accountState() returns business_annual /
              business_monthly, which /pricing/ prices at €490 a year and €49 a
              seat a month — so the button said €50 and charged €490. A static
              page cannot know which account is reading it, so it must not
              name a price; paint() writes the label out of the same table,
              keyed by the plan, in the same statement that sets the plan. */''}
        <button class="btn btn-primary" type="button" data-checkout data-plan="personal_annual" id="acct-buy-year">${esc(TR('planNeutralCta'))}</button>
        <button class="btn" type="button" data-checkout data-plan="personal_monthly" id="acct-buy-month">${esc(TR('planNeutralCta'))}</button>
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
/* One way to say something went wrong, and one way to say nothing has.
   Hidden rather than an empty paragraph, so the error box does not sit on the
   screen as an empty coloured strip waiting for a failure. Focus moves to it
   because a live region announces but does not take a keyboard user there. */
const AUTH_SEND_FAIL = ${JSON.stringify(TR('authSendFail'))};
function fail(text) {
  msg.textContent = text;
  msg.className = 'notice notice--error';
  msg.hidden = false;
  msg.focus();
}
function clearMsg() { msg.textContent = ''; msg.className = ''; msg.hidden = true; }
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
  granted: TR('acctGranted'),
  freeHere: TR('acctFreeHere'),
  personal_monthly: TR('planPersonalMonthly'),
  personal_annual: TR('planPersonalAnnual'),
  business_monthly: TR('planBusinessMonthly'),
  business_annual: TR('planBusinessAnnual'),
  enterprise: TR('planEnterprise'),
  planNone: TR('planNone'),
})};

/* Plan key → the price we are allowed to print for it, and the two sentence
   frames that wrap it. Localised at build time like everything else on this
   screen. */
const PRICE = ${JSON.stringify(TR('planPrice'))};
/* The placeholder has to survive two encoders, not one. This pair used to use
   a NUL sentinel: JSON.stringify wrote it into the script body as an escape,
   which JS parses back into a real NUL, but the *needle* went out as a raw NUL
   byte in the HTML, and the HTML tokenizer rewrites a literal NUL to the
   replacement character. Needle and haystack therefore never matched, replace
   was a no-op, and both /account/ buttons rendered "Subscribe -" and "or" with
   a replacement glyph where the price belongs -- a checkout control with no
   price on it, in all seven locales. The token below is plain ASCII, so it
   comes out of the tokenizer exactly as it went in. The replacer is a function
   so a price containing a dollar-ampersand cannot be re-interpreted. */
const CTA_FOR = (k) => ${JSON.stringify(TR('subscribeCta', '{price}'))}.replace('{price}', () => PRICE[k] ?? '');
const ALT_FOR = (k) => ${JSON.stringify(TR('orAlt', '{price}'))}.replace('{price}', () => PRICE[k] ?? '');

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
     a button buys now follows the door they signed in by — and the label is
     written in the same statement as the plan, from the same table, so the
     two cannot drift apart the way they had. */
  const year = $('#acct-buy-year');
  const month = $('#acct-buy-month');
  year.dataset.plan = st.plans.annual;
  year.textContent = CTA_FOR(st.plans.annual);
  month.dataset.plan = st.plans.monthly;
  month.textContent = ALT_FOR(st.plans.monthly);
}

/* Already signed in? Show the account, not another sign-in form. */
me().then(async (s) => {
  if (!s.signedIn) return;
  /* The page stops arguing for something they have already done. */
  $('#acct-hero-out').hidden = true;
  $('#acct-hero-in').hidden = false;
  const crumbOut = document.querySelector('.breadcrumb > span:not(#acct-crumb-in)');
  if (crumbOut) crumbOut.hidden = true;
  $('#acct-crumb-in').hidden = false;
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
  clearMsg();

  if (!onCode) {
    email = $('#auth-email').value.trim();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { fail('That does not look like an email address.'); return; }
    track('signin_start');
    const btn = $('#auth-send'); btn.disabled = true; btn.textContent = 'Sending…';
    const res = await requestCode(email, acctType());
    btn.disabled = false; btn.textContent = 'Send me a code';
    if (!res.ok) { fail(res.message || AUTH_SEND_FAIL); return; }
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
  if (!res.ok) { fail(res.message || 'That code is wrong or has expired.'); return; }
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
  clearMsg();
});
</script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('acctTitle'),
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
<!-- A <section>, not a <div>: the main > section > *:last-child margin-bottom:0
     rule in theme.css is what closes the pre-footer joint on every page, and a
     bare <div> could not match it — /dashboard/ carried 16px more space above its
     footer than /startups/, /enterprise/ and /check/ for exactly that reason. -->
<section class="shell" style="padding:0 0 4rem">
  <!-- This paragraph said "nothing is sent anywhere" for as long as the
       workspace was localStorage-only. It now syncs, so leaving the old
       sentence there would be a privacy claim that is no longer true — the
       worst kind of stale copy, because it is the kind someone relies on. -->
  <p class="tiny" style="color:var(--ink-4);max-width:70ch">Signed out, this workspace stays in this browser and
  nothing in it leaves the machine — which is why you can try it on a real portfolio before you have an account.
  Signed in, the workspace itself syncs to your account so it survives a new laptop and your team sees the same
  pipeline. The <em>matching</em> never moves either way: every company is scored in this tab, against the same
  engine the rest of the site is built from, so a portfolio is never shipped somewhere to be analysed.</p>
</section>
<script type="module" src="${BASE}/dashboard/dashboard.js?v=${ASSET_V}"></script>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: 'Grants workspace — portfolio, pipeline and applications',
    description:
      'Match a whole portfolio against every funding programme, move applications through a pipeline, watch the deadlines, track the de minimis ceiling and generate an application pack per opportunity.',
    canonical: `${SITE_URL}/dashboard/`,
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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
  <h1 style="max-width:22ch">Who is here, where they stop, and <em class="serif-italic">who gets in</em></h1>

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

      <!-- Hidden until the server says a code is wanted. Showing it always
           would tell anyone who loads this page whether a second factor is
           enrolled, which is a fact worth not publishing. -->
      <span id="admin-code-wrap" hidden>
        <label class="tiny" for="admin-code">Six-digit code</label>
        <input class="field" type="text" id="admin-code" inputmode="numeric" autocomplete="one-time-code"
               pattern="[0-9]*" maxlength="6" style="width:100%;margin:.4rem 0 1rem;letter-spacing:.3em">
      </span>

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

    <section class="bucket" id="admin-security">
      <div class="bucket__head"><h2>This door</h2>
        <span class="bucket__count" id="admin-2fa-state">checking…</span></div>
      <p class="small" style="margin:.2rem 0 1rem;max-width:62ch">Signing in here unlocks every paid surface on the
      site. A password on a guessable URL is one secret between the internet and the whole product, so add a second
      one from an authenticator app.</p>
      <div id="admin-2fa"></div>
    </section>

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

    <section class="bucket" id="admin-customers-section">
      <div class="bucket__head"><h2>Customers</h2>
        <span class="bucket__count">grant a plan without taking money</span></div>

      <p class="small" style="margin:.2rem 0 1rem;max-width:62ch">A grant is not a subscription. It never
      touches Stripe, it never appears in the revenue tables, and it can be revoked here in one click. This
      is how the Enterprise tier is sold: closed on a call, switched on from this row.</p>

      <form id="admin-search" class="row" style="gap:.6rem;align-items:flex-end;margin-bottom:1rem" novalidate>
        <span style="flex:1;min-width:14rem">
          <label class="tiny" for="admin-q">Find a customer</label>
          <input class="field" type="search" id="admin-q" placeholder="email address, or part of one"
                 autocomplete="off" style="width:100%;margin-top:.35rem">
        </span>
        <button class="btn btn-sm" type="submit">Search</button>
      </form>

      <div id="admin-customer-list"></div>
    </section>

    <section class="bucket">
      <div class="bucket__head"><h2>What operators have changed</h2>
        <span class="bucket__count">append-only</span></div>
      <div id="admin-audit"></div>
    </section>
  </div>

  <!-- The grant form. One dialog, filled in from whichever row was clicked, so
       there is no chance of the form and the customer it is about drifting
       apart the way two copies of a form would. -->
  <dialog id="admin-grant-dialog" class="card" style="max-width:34rem;width:calc(100% - 2rem);border:0;padding:1.5rem">
    <form id="admin-grant-form" method="dialog" novalidate>
      <h2 style="margin:0 0 .3rem;font-size:1.25rem">Grant a plan</h2>
      <p class="small" id="admin-grant-who" style="margin:0 0 1rem"></p>

      <label class="tiny" for="admin-grant-plan">Plan</label>
      <select class="field" id="admin-grant-plan" style="width:100%;margin:.35rem 0 1rem"></select>

      <div class="row" style="gap:.8rem">
        <span style="flex:1">
          <label class="tiny" for="admin-grant-seats">Seats</label>
          <input class="field" type="number" id="admin-grant-seats" min="1" max="500" value="1"
                 style="width:100%;margin-top:.35rem">
        </span>
        <span style="flex:1">
          <label class="tiny" for="admin-grant-days">Days <span style="opacity:.6">(0 = no end date)</span></label>
          <input class="field" type="number" id="admin-grant-days" min="0" max="3650" value="0"
                 style="width:100%;margin-top:.35rem">
        </span>
      </div>

      <label class="tiny" for="admin-grant-reason" style="display:block;margin-top:1rem">Why</label>
      <input class="field" type="text" id="admin-grant-reason" required maxlength="300"
             placeholder="closed on a call, invoice #1042" style="width:100%;margin:.35rem 0 .3rem">
      <p class="tiny" style="margin:0 0 1rem;opacity:.75">Required. In six months this is the only thing that
      tells a comped account apart from a billing bug.</p>

      <label class="small" style="display:flex;gap:.5rem;align-items:flex-start;margin-bottom:1rem" id="admin-grant-create-wrap" hidden>
        <input type="checkbox" id="admin-grant-create" style="margin-top:.2rem">
        <span>No account exists for this address yet — create it and grant anyway.</span>
      </label>

      <p class="small" id="admin-grant-msg" role="status" aria-live="polite" style="margin:0 0 1rem;min-height:1.2em"></p>

      <div class="row" style="gap:.6rem;justify-content:flex-end">
        <button class="btn btn-sm btn-ghost" type="button" id="admin-grant-cancel">Cancel</button>
        <button class="btn btn-sm btn-primary" type="submit" id="admin-grant-submit">Grant</button>
      </div>
    </form>
  </dialog>

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
  const openNow = STARTUP_ALL.filter((p) => ['open', 'rolling'].includes(effectiveStatus(p))).length;
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
        ${/* h1 → h3 with nothing between: the first content heading on
              /enterprise/ skipped a level. Nothing about it is a
              sub-sub-heading; it is the first section of the page. */''}
        <h2 style="margin:.2rem 0 0;font-size:1.3rem">${esc(TR('entDayOneH3'))}</h2>
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
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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
    <h3 style="margin:0"><a href="${BASE}/startups/${esc(p.country_code)}/${esc(p.slug)}/">${esc(p.name_en)}</a></h3>
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
    /* The company product's entry point carried an English <title> and
       og:title in all seven locales — the one string a fr/de/es visitor reads
       before deciding whether the page is for them. */
    title: TR('startupCheckTitle'),
    description: `Match your company against ${nf(STARTUP_ALL.length)} startup funding programmes in ${STARTUP_MANIFEST.countries.length} jurisdictions. Runs in your browser; your figures are not sent anywhere.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/check/`,
    head: wizardDict(),
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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

  ${/* At 1280 this page had no in-page control until y=4256 — the only buttons
        above it were "Skip to content" and the masthead. The individual half of
        the site puts a button pair directly under the lede (home at y=719, a
        country page at about y=535), so a founder who arrives here from an
        organic result had to read four screens before being offered anything to
        do. Same pair, same place, same component as the country hero. */''}
  <div class="hero__cta" style="margin-top:1.8rem">
    <a class="btn btn-primary" href="${SB()}/startups/check/">${esc(TR('startupsHeroCta'))}</a>
    <a class="btn" href="${LB()}/pricing/">${esc(TR('seePlans'))}</a>
  </div>

  ${/* One stat component, not two. This grid drew the same information the home
        and country heroes draw — a figure and a label — as `.card` +
        `.figure-sm` + `p.small`: a 32px figure over a 15.6px sentence-case
        label, 22.4 padding, 20 radius, against the `.stat` tiles' 38.4px serif
        figure over a 12.8px tracked-uppercase label, 14.4/17.6 padding, 17.6
        radius. Two components for one idea means the two drift, and they had.
        `.stat-strip` also wraps the way the other strips wrap. */''}
  <div class="stat-strip">
    ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<div class="stat">
      <span class="stat__n">${n}</span>
      <span class="stat__l">${esc(INSTRUMENTS[t]?.label ?? t)}</span>
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
    ${STARTUP_MANIFEST.countries.map((c) => `<a class="card card-link" href="${BASE}/startups/${esc(c.slug)}/">
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
    title: TR('startupsTitle', STARTUP_MANIFEST.countries.length),
    description: `${nf(STARTUP_ALL.length)} startup funding programmes, public and private, across ${STARTUP_MANIFEST.countries.length} jurisdictions. Sourced, dated and linked to the funder.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/`,
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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

  ${/* The cards are <h3>. Without a section heading above them the page ran
        h1 → h3 on all 27 startup country pages: two levels missing, which a
        screen reader reports as skipped content. */''}
  <h2 style="margin-top:2.4rem">${c.count} ${c.count === 1 ? 'programme' : 'programmes'} in ${esc(c.name)}</h2>
  <div style="margin-top:1rem">
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
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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
    { label: c.name, href: `${BASE}/startups/${c.slug}/` },
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
      <p class="small">Deadline: ${esc(DEADLINE_LABEL[p.deadline_type] || p.deadline_type || 'Not stated')}${p.deadline_note ? ` — ${esc(p.deadline_note)}` : ''}</p>
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
    ${/* Every startup record shares one last_verified_at too, so the date said
          nothing about this programme. Status is per record; the date is not. */''}
    ${p.verification_status !== 'verified' ? ' · <strong>not human-checked</strong>' : ''}</p>
    ${p.source_snippet ? `<p class="small" style="margin-top:.6rem">"${esc(String(p.source_snippet).slice(0, 300))}"</p>` : ''}
  </div>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: `${p.name_en} — ${c.name} startup funding`,
    description: `${p.name_en} from ${p.funder}. ${amt != null ? money(amt, p.amount_currency) + '. ' : ''}Eligibility, steps and documents, linked to the official page.`,
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/startups/${c.slug}/${p.slug}/`,
    /* A company surface. See layout()'s `audience`: generated, not cookied,
       so the masthead offers the workspace even with JavaScript off. */
    audience: 'biz',
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

  /* The two entry points of the company funnel, in every locale. They were
     English-only while /fr/ linked to them four times, so a French visitor
     who clicked the hero CTA left their language for good. The per-country
     and per-programme startup pages below stay English — they are 2,000
     records of funder-written prose that we do not translate. */
  ALT = altFor('/startups/');
  page(`${pre}startups/index.html`, startupsIndex());
  ALT = altFor('/startups/check/');
  page(`${pre}startups/check/index.html`, startupCheckPage());

  if (lang === 'en') {
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

    /* No hreflang siblings: /browse/ is generated in English only, and a
       hreflang pointing at a URL that 404s is worse than none. */
    ALT = [];
    page('browse/index.html', browseIndex());
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
 * That was the reasoning while the site was on Pages. The Worker is in front
 * of it now, so the default has flipped: the full copies ship unless someone
 * asks for a deliberately public-only build with EMIT_FULL_DATASET=0.
 *
 * The old default cost a paying subscriber the thing they paid for. Without
 * dist/api/v1/full/, loadCountry() falls back to the stripped public file and
 * nothing errors — the results screen renders 69 cards with empty titles and
 * 404 links. Only `npm run build` set the flag, so every other invocation
 * produced exactly that dist, and "it worked when I ran the build script" is
 * how it survived.
 */
const EMIT_FULL = process.env.EMIT_FULL_DATASET !== '0';

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
    status: effectiveStatus(p),
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
            status: effectiveStatus(p),
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
/* Shared by both client-rendered wizards, which are both emitted at the dist
   root, so './wizard-i18n.js' resolves for each of them. */
write('wizard-i18n.js', fs.readFileSync(path.join(SRC, 'pwa/wizard-i18n.js'), 'utf8'));
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
- Programmes for one country: ${SITE_URL}/api/v1/programmes/{cc}.json
  The first ${FREE_ROWS} records are whole. Every other record carries only slug (an opaque id),
  category, benefit_type, amount_min, amount_max, amount_currency, amount_period, admin_level,
  admin_area, eligibility, is_automatic, verification_status, derived and locked: true — no name,
  funder, source_url, steps or documents.
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
