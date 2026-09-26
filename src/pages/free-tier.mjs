/**
 * UNCLAIMED — free-tier showcase selection and locked-record shaping.
 *
 * Two responsibilities that used to live inline in src/build.mjs, pulled out
 * so the hooks left in build.mjs are a handful of lines each:
 *
 * 1. pickHouseholdShowcase() / pickStartupShowcase() decide WHICH records a
 *    country's free showcase is. It used to be "whichever two the source file
 *    lists first" — for the US and India that was a closed or wound-down
 *    programme, because the source data has no ordering promise at all. Now
 *    it is the two (or one, or none) records that are actually worth showing
 *    to someone deciding whether to trust the dataset: open or rolling over
 *    closed/paused/unknown, verified over unverified, broadly-eligible cash
 *    over a narrow in-kind one, highest amount as the tiebreak.
 *
 * 2. lockedHouseholdRecord() / lockedStartupRecord() build the record a
 *    signed-out client is allowed to see for everything past the showcase.
 *    They already kept the amounts and every field the matcher needs so the
 *    free total cannot move. What they used to also strip was the NAME and
 *    the FUNDER — fields that are already sitting in public HTML on that
 *    programme's own page, so withholding them from the JSON leaked nothing
 *    to a determined reader and only cost the product a "which one is this?"
 *    moment on every results screen. They now carry name, funder and the
 *    public page's own URL; everything that is actually sold — the
 *    application link, the documents, the procedure, the source quote, the
 *    eligibility prose — stays stripped.
 */
import {
  monthsPayable,
  isCapitalCeiling,
  isEmployerAid,
  isUnpricedMeansTest,
  circumstanceTags,
  passportedFrom,
  isStatutoryRight,
  isCitizensOnly,
  isHardshipAid,
} from '../engine/matcher.js';
import { isFreeMoney } from '../engine/startup.js';
import { effectiveStatus } from '../../packages/deadlines/index.js';
import { progHref } from '../ui.mjs';

/* Coarse status tiers. Only "is it actionable right now" matters for a
   showcase pick — the fine-grained badge copy (STATUS_META) is a display
   concern, not a ranking one. */
const STATUS_RANK = { open: 0, rolling: 0, upcoming: 1, closed: 2, paused: 2, unknown: 2 };
const statusRank = (p, asOf) => STATUS_RANK[effectiveStatus(p, asOf)] ?? 2;

const verifiedRank = (p) => (p.verification_status === 'verified' ? 0 : 1);

const amountMax = (p) => (p.amount_max ?? p.amount_min ?? null);
/* Sorted ascending, so the tuple entry for "prefer the higher amount" has to
   be the negative — and a missing amount must sort as the WORST amount, not
   as the smallest number, or a record with no published figure at all would
   look like the best possible tiebreak. */
const amountSortKey = (p) => {
  const a = amountMax(p);
  return a == null ? Infinity : -a;
};

const CASH_BENEFIT_TYPES = new Set(['cash_monthly', 'cash_one_off']);

/**
 * How many people a household programme's own published rules exclude.
 *
 * Not a judgement about the programme — a count of the eligibility record's
 * own narrowing fields, so "eligible to many" is read off the data rather
 * than guessed from the category. Admin-area restriction counts too: a
 * programme that only applies in one region is not a showcase for the whole
 * country.
 */
function restrictiveness(p) {
  const e = p.eligibility || {};
  let n = 0;
  if (e.age_min != null) n += 1;
  if (e.age_max != null) n += 1;
  if (e.income_annual_max != null) n += 1;
  if (e.requires_children) n += 1;
  if (e.housing_tenure) n += 1;
  if (e.nationality && e.nationality !== 'any') n += 1;
  if (e.residency_months_min != null) n += 1;
  if (e.student_required) n += 1;
  if ((e.admin_areas || []).length) n += 1;
  return n;
}

function sortedIndices(programmes, key) {
  return programmes
    .map((p, i) => ({ i, key: key(p) }))
    .sort((a, b) => {
      for (let k = 0; k < a.key.length; k++) {
        if (a.key[k] !== b.key[k]) return a.key[k] - b.key[k];
      }
      return a.i - b.i; // stable: source order is the last tiebreak, not the first
    })
    .map((x) => x.i);
}

/**
 * The two (or fewer) household records a signed-out visitor sees whole.
 *
 * Order of the returned Set carries no meaning — callers key on membership,
 * not position, so the rest of the page (which reads `data.programmes` in
 * its original order for ranking and category grouping) is untouched.
 */
export function pickHouseholdShowcase(programmes, asOf = Date.now(), n = 2) {
  const order = sortedIndices(programmes, (p) => [
    statusRank(p, asOf),
    verifiedRank(p),
    CASH_BENEFIT_TYPES.has(p.benefit_type) ? 0 : 1,
    restrictiveness(p),
    amountSortKey(p),
  ]);
  return new Set(order.slice(0, n));
}

/** The startup equivalent: no eligibility-breadth term (a company's own
 *  stage/sector/jurisdiction already narrows the pool far more than any
 *  household rule does), but the same status/verified/cash/amount order. */
export function pickStartupShowcase(programmes, asOf = Date.now(), n = 2) {
  const order = sortedIndices(programmes, (p) => [
    statusRank(p, asOf),
    verifiedRank(p),
    isFreeMoney(p.grant_type) ? 0 : 1,
    amountSortKey(p),
  ]);
  return new Set(order.slice(0, n));
}

/**
 * A locked household record.
 *
 * `name_en`, `funder` and `url` are new: all three are already public on
 * `url` itself, which is this same build's own output (progHref), so nothing
 * here can be ahead of, or leak more than, the static HTML.
 */
export function lockedHouseholdRecord(p, { cc, base, opaqueId }) {
  return {
    slug: opaqueId(p.slug),
    locked: true,
    name_en: p.name_en,
    funder: p.funder,
    url: progHref(base, cc, p),
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

/** The same treatment for a locked startup record. */
export function lockedStartupRecord(p, { base, opaqueId }) {
  return {
    slug: opaqueId(p.slug),
    locked: true,
    name_en: p.name_en,
    funder: p.funder,
    url: `${base}/startups/${p.country_code}/${p.slug}/`,
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
  };
}
