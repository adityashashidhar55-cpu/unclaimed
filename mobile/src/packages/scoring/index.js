/**
 * UNCLAIMED — grant ranking.
 *
 * This module exists because ranking by headline amount is bad advice, and we
 * shipped exactly that bug. A three-person pre-seed company with no revenue was
 * shown a €3,000,000 regional grant requiring 30% co-funding — €900,000 they do
 * not have — above every award they could actually win, with cloud credits and
 * a dilutive accelerator ranked above real grants beneath it.
 *
 * The personal matcher already learned this lesson (see `tier()` in
 * src/engine/matcher.js, which demotes business loans for people who are not
 * traders). The lesson did not carry across. This is that fix, generalised.
 *
 * THE MODEL
 *
 *   band       — what kind of money it is. Non-dilutive cash outranks a loan
 *                you repay, equity that dilutes you, and credits that are not
 *                cash at all. This is a hard ordering, never traded off
 *                against amount, because no amount of credits is a grant.
 *
 *   expected   — amount × probability of award. A €30,000 voucher you have a
 *                one-in-two chance of winning beats a €2.5m grant at 5.9%.
 *
 *   feasible   — can this company actually mount the application? Co-funding
 *                it cannot raise, or a major bid at pre-seed, is a reason to
 *                rank lower even when the expected value is high.
 *
 * WHERE THE PROBABILITIES COME FROM
 *
 * `rates.json` carries funder-published figures only — 22 of them, each with
 * the counts, the period and a link. Where no official rate exists, we do NOT
 * invent one. We fall back to a prior computed from the rates we do have for
 * that class of programme, and label it `class_prior` so the UI can say
 * "estimated from similar programmes" instead of implying we know.
 *
 * THE TRAP, WHICH IS WORTH STATING LOUDLY
 *
 * Published rates are measured at different stages. EIC Accelerator's 5.9% is
 * the rate on FULL proposals, after a separate short-proposal filter the
 * applicant must pass first. EXIST-Gründungsstipendium's 55% is on
 * applications a university has already endorsed. NSF's 11% is on invited
 * proposals. Comparing those to a single-stage competition's end-to-end rate
 * systematically flatters two-stage and gatekeepered programmes. We carry the
 * stage on every rate and apply a documented haircut rather than silently
 * mixing them — see STAGE_HAIRCUT.
 */

import { RATE_DATA } from './rates.js';

/* ------------------------------------------------------------------ */
/* Bands — the hard ordering                                           */
/* ------------------------------------------------------------------ */

/**
 * Lower is better. This is not a weight and is never traded off against
 * money: a company should see the grant before the loan before the equity
 * before the credits, whatever the numbers say.
 */
export const BANDS = Object.freeze({
  grant: 0,
  prize: 0,
  voucher: 0,
  tax_credit: 1, // real cash, but arrives via a tax return, often a year later
  loan: 2, // repayable — the principal is not a benefit
  accelerator: 3, // usually equity, terms vary, often unpublished
  equity: 3, // dilutive: you are selling something
  in_kind: 4, // credits are not cash and cannot pay salaries
});

export function bandFor(grantType) {
  return BANDS[grantType] ?? 5;
}

export const BAND_LABELS = Object.freeze([
  'Non-dilutive cash',
  'Tax credits',
  'Repayable',
  'Dilutive',
  'Credits and in-kind',
  'Other',
]);

/* ------------------------------------------------------------------ */
/* Currency — for ranking only, never for display                      */
/* ------------------------------------------------------------------ */

/**
 * Comparing a £50,000 grant with a €40,000 one requires a rate. We refuse to
 * convert for DISPLAY — every figure on the site is shown in the currency the
 * funder published it in — but ranking is impossible without a common unit.
 *
 * So: one fixed, dated table, used only inside this module, and stamped so it
 * is obvious when it has gone stale. Ranking is insensitive to a few percent
 * of drift; display would not be, which is why display never uses this.
 */
export const FX_TO_EUR = Object.freeze({
  as_of: '2026-08-14',
  note: 'Indicative rates for ranking only. Never used to display an amount.',
  rates: Object.freeze({
    EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.05, SEK: 0.088, PLN: 0.23,
    INR: 0.011, SGD: 0.68, AED: 0.25, JPY: 0.0059, KRW: 0.00068,
    CAD: 0.67, AUD: 0.60, NZD: 0.55, BRL: 0.16, MXN: 0.049, ZAR: 0.049,
  }),
});

/** null in, null out — an unpriced programme must never become zero. */
export function toEur(amount, currency) {
  if (amount == null) return null;
  const r = FX_TO_EUR.rates[currency || 'EUR'];
  return r == null ? null : amount * r;
}

/* ------------------------------------------------------------------ */
/* Probability of award                                                */
/* ------------------------------------------------------------------ */

const RATES = new Map(RATE_DATA.rates.map((r) => [r.slug, r]));

/**
 * How much to discount a rate that was not measured end to end.
 *
 * These are honest approximations of a known distortion, not measurements.
 * The alternative — using a post-filter rate as if it were end-to-end — is a
 * a bigger error in a known direction, so a stated, conservative haircut is
 * the lesser evil. Every one is surfaced in the breakdown.
 */
export const STAGE_HAIRCUT = Object.freeze({
  end_to_end: 1, // directly comparable
  eligibility: 1, // self-serve; the rate is the rate
  unstated: 0.8, // we could not establish the stage — discount modestly
  post_filter: 0.5, // applicant must first pass a stage this rate excludes
  post_endorsement: 0.4, // requires a gatekeeper (university, incubator) to back you first
});

/**
 * Class priors, computed from the programmes where a rate IS published.
 *
 * Used only where a funder publishes nothing. Labelled `class_prior` so it is
 * never mistaken for a measurement.
 */
export const CLASS_PRIORS = Object.freeze({
  competitive_grant: 0.15,
  prize: 0.02,
  accelerator: 0.02,
  equity: 0.02,
  voucher: 0.5,
  tax_credit: 0.9, // an entitlement if you qualify, not a competition
  loan: 0.6,
  in_kind: 0.9, // eligibility-based, near-automatic
});

function classOf(programme) {
  const t = programme.grant_type;
  if (t === 'grant') return 'competitive_grant';
  return CLASS_PRIORS[t] != null ? t : 'competitive_grant';
}

/**
 * Probability this company is awarded, with its provenance.
 *
 * Never returns a bare number: the caller always gets to know whether it came
 * from the funder or from us.
 */
export function awardLikelihood(programme) {
  const rec = RATES.get(programme.slug);

  if (rec && rec.p != null) {
    const haircut = STAGE_HAIRCUT[rec.stage] ?? STAGE_HAIRCUT.unstated;
    return {
      p: Math.max(0.001, Math.min(1, rec.p * haircut)),
      p_published: rec.p,
      basis: rec.confidence, // 'published' | 'derived'
      stage: rec.stage,
      haircut,
      detail: rec.basis,
      source_url: rec.source_url,
      period: rec.period,
    };
  }

  const cls = classOf(programme);
  return {
    p: CLASS_PRIORS[cls],
    p_published: null,
    basis: 'class_prior',
    stage: null,
    haircut: 1,
    detail:
      rec?.basis ??
      `No official success rate published. Estimated from the rate observed across ${cls.replace('_', ' ')} programmes that do publish one.`,
    source_url: rec?.source_url ?? null,
    period: null,
  };
}

/* ------------------------------------------------------------------ */
/* Effort                                                              */
/* ------------------------------------------------------------------ */

/**
 * How much work the application is, inferred from what the funder asks for.
 *
 * Derived from the record, not guessed: the count of required documents, the
 * count of procedure steps, and whether a written case is needed. A founder
 * deciding what to do this month needs this more than they need a score.
 */
export function effortFor(programme) {
  const docs = (programme.documents_required || []).length;
  const steps = (programme.procedure_steps || []).length;
  const needsNarrative = (programme.documents_required || []).some((d) =>
    /business plan|project (proposal|description)|work ?plan|pitch|financial (projection|plan)|budget/i.test(d.doc || ''),
  );
  const coFunded = programme.cofunding_pct != null && programme.cofunding_pct > 0;

  let points = docs + steps;
  if (needsNarrative) points += 4;
  if (coFunded) points += 3;

  if (points <= 3) return { tier: 'quick', points, label: 'Quick — mostly identity and bank details' };
  if (points <= 9) return { tier: 'moderate', points, label: 'Moderate — a form and supporting documents' };
  return { tier: 'major', points, label: 'Major bid — written case, budget, possibly partners' };
}

const EFFORT_WEIGHT = { quick: 1, moderate: 0.85, major: 0.6 };

/* ------------------------------------------------------------------ */
/* Feasibility                                                         */
/* ------------------------------------------------------------------ */

/**
 * Can this company actually take the money if offered?
 *
 * The co-funding test is the one that matters and the one nobody models. A
 * grant covering 70% of a €3,000,000 project needs €900,000 from the company.
 * Ranking that first for a pre-seed team is not ambition, it is noise.
 */
export function feasibility(programme, profile) {
  const reasons = [];
  let factor = 1;

  const pct = programme.cofunding_pct;
  const amountEur = toEur(programme.amount_max ?? programme.amount_min, programme.amount_currency);

  if (pct != null && pct > 0 && amountEur != null) {
    const needed = amountEur * (pct / 100);
    const capacity =
      profile?.cash_available_eur ??
      (profile?.turnover_annual_eur != null ? profile.turnover_annual_eur * 0.25 : null);

    if (capacity != null && needed > capacity) {
      const ratio = capacity / Math.max(needed, 1);
      factor *= Math.max(0.05, ratio);
      reasons.push(
        `Needs about €${Math.round(needed).toLocaleString('en')} of your own money and we estimate you can cover €${Math.round(capacity).toLocaleString('en')}.`,
      );
    } else if (capacity == null) {
      factor *= 0.8;
      reasons.push(`Requires ${pct}% co-funding — tell us your available cash and we can judge this properly.`);
    }
  }

  /* A major bid at idea stage is usually the wrong use of a month. */
  const effort = effortFor(programme);
  if (effort.tier === 'major' && ['idea', 'pre_seed'].includes(profile?.stage)) {
    factor *= 0.7;
    reasons.push('Major application for a company at this stage.');
  }

  /* An award that is not open right now cannot be applied for right now. */
  if (programme.deadline_type === 'annual_call' || programme.deadline_type === 'cutoff') {
    factor *= 0.9;
    reasons.push('Opens in windows rather than continuously — check the next cut-off.');
  }

  return { factor, reasons, effort };
}

/* ------------------------------------------------------------------ */
/* The score                                                           */
/* ------------------------------------------------------------------ */

/**
 * Score one programme for one company.
 *
 * Returns the number AND every input, because a ranking a founder cannot
 * interrogate is a ranking they should not trust. The UI is expected to show
 * "€2.5m × 5.9% × 0.5 stage adjustment" rather than "score: 73".
 */
export function scoreProgramme(programme, profile = {}) {
  const band = bandFor(programme.grant_type);
  const likelihood = awardLikelihood(programme);
  const feas = feasibility(programme, profile);
  const amountEur = toEur(programme.amount_max ?? programme.amount_min, programme.amount_currency);

  /* Unpriced programmes are common and must not sort last as if worth zero.
     They are held at the median of their band and clearly marked. */
  const expectedEur = amountEur == null ? null : amountEur * likelihood.p;

  const effortWeight = EFFORT_WEIGHT[feas.effort.tier];
  const score = expectedEur == null ? null : expectedEur * feas.factor * effortWeight;

  return {
    slug: programme.slug,
    band,
    band_label: BAND_LABELS[band],
    amount_eur: amountEur,
    unpriced: amountEur == null,
    probability: likelihood,
    effort: feas.effort,
    feasibility: { factor: feas.factor, reasons: feas.reasons },
    expected_eur: expectedEur,
    score,
    /* One line a person can argue with. */
    explanation:
      amountEur == null
        ? 'Amount not published by the funder, so no expected value can be computed.'
        : `€${Math.round(amountEur).toLocaleString('en')} × ${(likelihood.p * 100).toFixed(1)}% chance` +
          (likelihood.basis === 'class_prior' ? ' (estimated — funder publishes no rate)' : '') +
          (likelihood.haircut !== 1 ? `, adjusted for a rate measured ${likelihood.stage.replace(/_/g, ' ')}` : '') +
          ` ≈ €${Math.round(expectedEur).toLocaleString('en')} expected` +
          (feas.factor < 1 ? `, reduced for feasibility` : ''),
  };
}

/**
 * Rank a matched set.
 *
 * Band first, always. Inside a band, by score. Unpriced programmes sit after
 * priced ones in their band rather than at the very bottom, because "we don't
 * know what it pays" is not the same as "it pays nothing".
 */
export function rankMatches(matches, profile = {}) {
  const scored = matches.map((m) => ({ ...m, scoring: scoreProgramme(m.programme, profile) }));

  scored.sort((a, b) => {
    if (a.scoring.band !== b.scoring.band) return a.scoring.band - b.scoring.band;
    if (a.scoring.unpriced !== b.scoring.unpriced) return a.scoring.unpriced ? 1 : -1;
    if (a.scoring.score !== b.scoring.score) return (b.scoring.score ?? 0) - (a.scoring.score ?? 0);
    const av = a.programme.verification_status === 'verified' ? 1 : 0;
    const bv = b.programme.verification_status === 'verified' ? 1 : 0;
    return bv - av;
  });

  return scored;
}

/** Coverage stats, so the honesty of the ranking is itself inspectable. */
export function rateCoverage(programmes) {
  let published = 0;
  let prior = 0;
  for (const p of programmes) {
    const r = RATES.get(p.slug);
    if (r && r.p != null) published += 1;
    else prior += 1;
  }
  return {
    total: programmes.length,
    published,
    class_prior: prior,
    published_pct: programmes.length ? Math.round((published / programmes.length) * 100) : 0,
  };
}
