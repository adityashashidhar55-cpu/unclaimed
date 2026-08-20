/**
 * UNCLAIMED — startup grant matcher.
 *
 * A separate engine from `matcher.js`, deliberately. A person is means-tested
 * on income, household and tenure; a company is tested on age, headcount,
 * turnover, sector and stage. Forcing both through one set of rules would
 * make each worse, so they share conventions — the same bucket names, the same
 * "never guess" discipline — and nothing else.
 *
 * Three things this engine does that a naive filter would not:
 *
 * 1. **Supranational programmes travel.** An Estonian founder is eligible for
 *    EIC Accelerator and for AWS Activate. Those live in `eu` and `global`
 *    and are merged in for the right countries rather than duplicated 27
 *    times in the data.
 *
 * 2. **Credits and equity are not cash.** A €150k EIC grant and $100k of AWS
 *    credits are not the same thing and must never be added into one number.
 *    Totals are reported per instrument.
 *
 * 3. **De minimis is a ceiling on the total, not on any one grant.** See
 *    packages/stateaid — a company that has already taken €280,000 of small
 *    public aid in the EU cannot take a €100,000 one, and the whole new award
 *    falls out rather than being trimmed. An aggregator that ignores this
 *    sends founders into an application they are barred from.
 *
 * Runs unchanged in Node, the browser, the Worker and React Native.
 */

import { rankMatches, rateCoverage } from '../../packages/scoring/index.js';

/* ------------------------------------------------------------------ */
/* EU SME definition — Recommendation 2003/361/EC, Annex Art. 2        */
/* ------------------------------------------------------------------ */

/**
 * Headcount is the binding test; turnover OR balance sheet is the second,
 * and a company may exceed one of those two and still qualify. Amounts are
 * in EUR because the Recommendation is.
 */
export const SME_THRESHOLDS = Object.freeze({
  micro: { headcount: 10, turnover: 2_000_000, balance_sheet: 2_000_000 },
  small: { headcount: 50, turnover: 10_000_000, balance_sheet: 10_000_000 },
  medium: { headcount: 250, turnover: 50_000_000, balance_sheet: 43_000_000 },
});

const SME_ORDER = ['micro', 'small', 'medium'];

/**
 * Which SME band a company falls in, or 'large'.
 *
 * Note the OR between turnover and balance sheet — that is the actual rule,
 * and reading it as AND wrongly excludes capital-heavy startups with low
 * revenue, which is most deeptech.
 */
export function smeCategory({ headcount, turnover_annual_eur, balance_sheet_eur }) {
  if (headcount == null) return null;
  for (const band of SME_ORDER) {
    const t = SME_THRESHOLDS[band];
    if (headcount >= t.headcount) continue;
    const turnoverOk = turnover_annual_eur == null || turnover_annual_eur <= t.turnover;
    const balanceOk = balance_sheet_eur == null || balance_sheet_eur <= t.balance_sheet;
    if (turnoverOk || balanceOk) return band;
  }
  return 'large';
}

/** Does a company satisfy a programme's `sme_category` requirement? */
function meetsSme(required, actual) {
  if (!required || required === 'any') return true;
  if (actual == null) return null; // unknown, not failed
  if (actual === 'large') return false;
  return SME_ORDER.indexOf(actual) <= SME_ORDER.indexOf(required);
}

/* ------------------------------------------------------------------ */
/* Reach — which programmes a country can see                          */
/* ------------------------------------------------------------------ */

/** EU member states, for deciding whether EU-level programmes apply. */
export const EU_MEMBERS = Object.freeze([
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu',
  'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se',
]);

/**
 * Horizon Europe and EIC are open to associated countries too, not only
 * members. Kept separate because the list genuinely differs and conflating
 * them would wrongly exclude Norwegian and Israeli founders.
 */
export const HORIZON_ASSOCIATED = Object.freeze(['no', 'is', 'il', 'tr', 'ua', 'md', 'ge', 'ch', 'gb', 'nz', 'ca']);

export function reachFor(cc) {
  const c = String(cc || '').toLowerCase();
  const pools = [c, 'global'];
  if (EU_MEMBERS.includes(c) || HORIZON_ASSOCIATED.includes(c)) pools.push('eu');
  return pools;
}

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

/**
 * How each instrument should be counted. Adding credits to cash would produce
 * a headline number that is a lie, so each is totalled separately and the UI
 * shows them apart.
 */
export const INSTRUMENTS = Object.freeze({
  grant: { dilutive: false, cash: true, repayable: false, label: 'Grants' },
  prize: { dilutive: false, cash: true, repayable: false, label: 'Prizes' },
  voucher: { dilutive: false, cash: true, repayable: false, label: 'Vouchers' },
  tax_credit: { dilutive: false, cash: true, repayable: false, label: 'Tax credits' },
  loan: { dilutive: false, cash: true, repayable: true, label: 'Loans' },
  equity: { dilutive: true, cash: true, repayable: false, label: 'Equity' },
  in_kind: { dilutive: false, cash: false, repayable: false, label: 'Credits and in-kind' },
  accelerator: { dilutive: null, cash: null, repayable: false, label: 'Accelerators' },
});

/** Non-dilutive cash a founder can count on without giving anything up. */
export function isFreeMoney(grantType) {
  const i = INSTRUMENTS[grantType];
  return !!i && i.cash === true && i.dilutive === false && i.repayable === false;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

const monthsBetween = (fromMs, toMs) => (toMs - fromMs) / (30.44 * 24 * 60 * 60 * 1000);

/** Company age in months, or null if we were not told when it incorporated. */
export function companyAgeMonths(profile, asOf) {
  if (!profile?.incorporation_date) return null;
  const t = Date.parse(profile.incorporation_date);
  return Number.isNaN(t) ? null : Math.max(0, monthsBetween(t, asOf));
}

/**
 * Test one programme against one company.
 *
 * Returns a verdict plus the reasons, because "why not" is the useful half.
 * `unknown` is a first-class outcome: a missing answer must never read as a
 * failure, or we hide money from anyone who skipped a question.
 */
export function testProgramme(programme, profile, asOf) {
  const e = programme.eligibility || {};
  const fails = [];
  const unknowns = [];

  const age = companyAgeMonths(profile, asOf);
  const sme = smeCategory({
    headcount: profile.headcount,
    turnover_annual_eur: profile.turnover_annual_eur,
    balance_sheet_eur: profile.balance_sheet_eur,
  });

  /* Incorporation. Some programmes fund pre-incorporation founders and a few
     require an existing entity — both directions matter. */
  if (e.requires_incorporation === true && profile.incorporated === false) {
    fails.push('Requires an incorporated company');
  }
  if (e.requires_incorporation === false && profile.incorporated === true) {
    // Not a failure — a pre-incorporation programme usually still accepts
    // very young companies. Left as a note rather than an exclusion.
  }

  /* Age */
  if (e.company_age_months_max != null) {
    if (age == null) unknowns.push('incorporation_date');
    else if (age > e.company_age_months_max) {
      fails.push(`Company must be under ${Math.round(e.company_age_months_max / 12)} years old`);
    }
  }
  if (e.company_age_months_min != null && age != null && age < e.company_age_months_min) {
    fails.push(`Company must be at least ${Math.round(e.company_age_months_min)} months old`);
  }

  /* Size */
  if (e.headcount_max != null) {
    if (profile.headcount == null) unknowns.push('headcount');
    else if (profile.headcount > e.headcount_max) fails.push(`Maximum ${e.headcount_max} employees`);
  }
  if (e.headcount_min != null && profile.headcount != null && profile.headcount < e.headcount_min) {
    fails.push(`At least ${e.headcount_min} employees required`);
  }
  /* The EUR sibling, never the raw local figure.
     
     turnover_annual_max holds the funder's PUBLISHED number, in the funder's
     own currency — SEK 10,000,000 for se-vinnova-innovativa-startups, INR
     2,000,000,000 for in-dpiit-startup-recognition — and the profile carries
     turnover_annual_eur. Comparing the two directly said yes to a company
     roughly 3.4x over Vinnova's published ceiling, with an empty `fails`
     array, which is the most confident way to be wrong. The local figure stays
     in the record because that is the number to SHOW; the derived
     turnover_annual_max_eur is the only one the engine reads.
     
     A record with a ceiling but no derived sibling is a data error, not a
     reason to fall back to the local figure — falling back is what produced
     the bug. It is treated as an unanswerable question instead, and
     scripts/verify.mjs fails the build on it. */
  if (e.turnover_annual_max != null) {
    if (e.turnover_annual_max_eur == null) unknowns.push('turnover_annual_eur');
    else if (profile.turnover_annual_eur == null) unknowns.push('turnover_annual_eur');
    else if (profile.turnover_annual_eur > e.turnover_annual_max_eur) fails.push('Turnover above the ceiling');
  }

  const smeOk = meetsSme(e.sme_category, sme);
  if (smeOk === false) fails.push(`Restricted to ${e.sme_category} enterprises`);
  if (smeOk === null && e.sme_category && e.sme_category !== 'any') unknowns.push('headcount');

  /* Sector — 'any' or an empty list means unrestricted. */
  const sectors = (e.sectors || []).filter((s) => s && s !== 'any');
  if (sectors.length) {
    const mine = profile.sectors || [];
    if (!mine.length) unknowns.push('sectors');
    else if (!mine.some((s) => sectors.includes(s))) {
      fails.push(`Restricted to: ${sectors.join(', ')}`);
    }
  }

  /* Stage */
  const stages = (e.stages || []).filter(Boolean);
  if (stages.length) {
    if (!profile.stage) unknowns.push('stage');
    else if (!stages.includes(profile.stage)) fails.push(`For ${stages.join(', ')} stage companies`);
  }

  /* R&D focus */
  if (e.rd_focus === true) {
    if (profile.rd_active == null) unknowns.push('rd_active');
    else if (profile.rd_active === false) fails.push('Requires R&D activity');
  }

  /* Founder criteria. These widen access rather than narrowing it, so an
     unanswered question routes to "conditional" and is never a hard fail. */
  let conditional = false;
  if (e.female_founder_only === true) {
    if (profile.female_founder !== true) conditional = true;
  }
  if (e.underrepresented_focus === true && profile.underrepresented !== true) conditional = true;

  /* Local presence */
  if (e.requires_local_entity === true && profile.has_local_entity === false) {
    fails.push('Requires a locally registered entity');
  }

  /* Closed means closed, whichever field says so.
     
     This read deadline_type only. The field the dataset actually populates is
     `status`, and the two disagreed on 168 of the 226 records marked closed —
     so 168 closed programmes were never marked closed by the engine, 27 of
     them came back 'eligible' for an ordinary seed-stage profile, and their
     amounts were summed into a headline total. `paused` is in here too: a
     programme between application windows is not something a founder can
     apply for today, and telling them otherwise wastes the one resource a
     small team has.
     
     `asOf` is passed in rather than read from the clock, so this stays a pure
     function and a test can pin the date. */
  const todayIso = new Date(asOf ?? Date.now()).toISOString().slice(0, 10);
  const closed =
    programme.status === 'closed' ||
    programme.status === 'paused' ||
    programme.deadline_type === 'closed' ||
    (typeof programme.closes_at === 'string' && programme.closes_at < todayIso);

  let verdict;
  if (closed) verdict = 'closed';
  else if (fails.length) verdict = 'not_eligible';
  else if (unknowns.length) verdict = 'needs_answer';
  else if (conditional) verdict = 'conditional';
  else verdict = 'eligible';

  return { verdict, fails, unknowns: [...new Set(unknowns)], sme_category: sme, age_months: age };
}

/**
 * Match a company against every programme it could reach.
 *
 * `datasets` is a map of country_code -> parsed data file, so the caller
 * controls loading (build time reads from disk, the Worker reads from
 * static assets, the app fetches).
 */
export function matchStartup(profile, datasets, asOf = Date.now()) {
  const cc = String(profile?.country_code || '').toLowerCase();
  const pools = reachFor(cc);

  const buckets = { eligible: [], conditional: [], needs_answer: [], not_eligible: [], closed: [] };

  for (const pool of pools) {
    const data = datasets[pool];
    if (!data) continue;
    for (const programme of data.programmes || []) {
      const r = testProgramme(programme, profile, asOf);
      buckets[r.verdict].push({ programme, pool, ...r });
    }
  }

  /* Rank by what the company can actually get, not by the biggest headline.
     
     Sorting on amount alone put a EUR 3,000,000 regional grant needing
     EUR 900,000 of co-funding above every award a three-person pre-seed team
     could realistically win, with cloud credits and a dilutive accelerator
     above the real grants beneath it. packages/scoring fixes that: a hard
     band ordering (cash before loans before equity before credits) and then
     amount x probability x feasibility inside each band. Every component is
     returned on the match so the UI can show the working. */
  for (const k of Object.keys(buckets)) buckets[k] = rankMatches(buckets[k], profile);

  /* Totals per instrument AND per currency.
     
     Summing EUR grants and USD prizes into one figure is the same lie as
     adding cloud credits to cash, and it is easier to commit by accident.
     Nothing is ever converted at a made-up FX rate; each currency is carried
     separately and the UI shows them separately. */
  const totals = {};
  for (const m of buckets.eligible) {
    const t = m.programme.grant_type;
    const cur = m.programme.amount_currency || 'EUR';
    totals[t] = totals[t] || {
      count: 0,
      priced: 0,
      unpriced: 0,
      by_currency: {},
      label: INSTRUMENTS[t]?.label ?? t,
      non_dilutive: isFreeMoney(t),
    };
    totals[t].count += 1;

    const max = m.programme.amount_max ?? m.programme.amount_min;
    if (max == null) {
      totals[t].unpriced += 1;
      continue;
    }
    totals[t].priced += 1;
    const c = (totals[t].by_currency[cur] = totals[t].by_currency[cur] || { min: 0, max: 0, count: 0 });
    c.min += m.programme.amount_min ?? 0;
    c.max += max;
    c.count += 1;
  }

  /* The headline: non-dilutive cash you keep, per currency. An array rather
     than a number, because for most founders it genuinely is more than one
     currency and pretending otherwise would require inventing an FX rate. */
  const nonDilutiveByCurrency = {};
  let nonDilutiveCount = 0;
  let nonDilutiveUnpriced = 0;
  for (const [t, v] of Object.entries(totals)) {
    if (!isFreeMoney(t)) continue;
    nonDilutiveCount += v.count;
    nonDilutiveUnpriced += v.unpriced;
    for (const [cur, c] of Object.entries(v.by_currency)) {
      const acc = (nonDilutiveByCurrency[cur] = nonDilutiveByCurrency[cur] || { min: 0, max: 0, count: 0 });
      acc.min += c.min;
      acc.max += c.max;
      acc.count += c.count;
    }
  }

  const nonDilutive = {
    count: nonDilutiveCount,
    unpriced: nonDilutiveUnpriced,
    by_currency: nonDilutiveByCurrency,
    /* Largest single currency pot, for the one-line headline. */
    headline: Object.entries(nonDilutiveByCurrency).sort((a, b) => b[1].max - a[1].max)[0] ?? null,
  };

  return {
    country: cc,
    pools,
    sme_category: smeCategory({
      headcount: profile.headcount,
      turnover_annual_eur: profile.turnover_annual_eur,
      balance_sheet_eur: profile.balance_sheet_eur,
    }),
    age_months: companyAgeMonths(profile, asOf),
    ...buckets,
    totals,
    non_dilutive: nonDilutive,
    /* Which single answer would unlock the most. Same idea as the personal
       engine's gaps: ask the question that moves the most money. */
    unlocks: unlockRanking(buckets.needs_answer),
    /* How much of this ranking rests on funder-published rates versus our
       own class priors. Surfaced so the honesty of the order is inspectable
       rather than something the user has to take on trust. */
    rate_coverage: rateCoverage(buckets.eligible.map((m) => m.programme)),
  };
}

/** Rank the unanswered questions by how much they would unlock. */
export function unlockRanking(needsAnswer) {
  const byField = new Map();
  for (const m of needsAnswer) {
    for (const f of m.unknowns) {
      const cur = byField.get(f) || { field: f, count: 0, value_max: 0, programmes: [] };
      cur.count += 1;
      cur.value_max += m.programme.amount_max ?? m.programme.amount_min ?? 0;
      if (cur.programmes.length < 6) cur.programmes.push(m.programme.name_en);
      byField.set(f, cur);
    }
  }
  return [...byField.values()].sort((a, b) => b.value_max - a.value_max || b.count - a.count);
}
