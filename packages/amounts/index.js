/**
 * What a programme actually pays, said in a way a person can act on.
 *
 * The complaint this exists to answer is that the amounts are not
 * understandable. They are not, and the reason is structural rather than
 * sloppy: 2,432 of 3,900 records have no `amount_min` or `amount_max`, and
 * every one of them renders as "Set by the Department for Work and Pensions".
 * That sentence is true, useless, and printed on 62% of the paid product.
 *
 * The mistake was assuming every award is a number. It is not. Sorting the
 * records that have no figure by what they actually are:
 *
 *   480  are IN KIND — free schooling, a health card, subsidised training,
 *        an incubator place. There is no cash figure and there never will be
 *        one, so "Set by the funder" is not a gap in the data; it is the
 *        wrong question. What you get IS the answer.
 *   420  are a RATE — 50% off metro fares, 0% corporate tax below a revenue
 *        line, 55% of net income, 70% of eligible project costs. The rate is
 *        the answer. Converting it to euros would require knowing the
 *        claimant's own numbers, which is exactly what we do not have.
 *   ~300 are DISCRETIONARY — housing grants, plots of land, hardship funds
 *        decided case by case. The honest answer names the decider AND what
 *        the award consists of, which the record does contain.
 *  1,224 are cash-shaped with the figure simply missing. These are the only
 *        ones that need somebody to go and read the funder's page, and they
 *        are what `needsFigure()` selects for the harvest worklist.
 *
 * So this module decides the SHAPE of an award and lets each shape say its own
 * sentence. It invents nothing: every branch is derived from fields the record
 * already carries, and where the honest answer is "the funder publishes no
 * figure", it still says that — just without pretending the other 1,200
 * records are the same case.
 *
 * The standing rule is unchanged and load-bearing: a monetary range comes only
 * from `amount_min` / `amount_max`. Nothing here reads a number out of prose
 * and presents it as the award.
 */

export const KIND = Object.freeze({
  FLAT: 'flat',                   // one figure — "£86.45 a week"
  RANGE: 'range',                 // two figures — "€1,000–€5,000"
  RATE: 'rate',                   // a percentage — "up to 70% of eligible costs"
  IN_KIND: 'in_kind',             // not money — a place, a card, free hours
  DISCRETIONARY: 'discretionary', // decided per case, and we know by whom
  UNPUBLISHED: 'unpublished',     // genuinely nothing published
});

/** Award shapes that are not cash and must never be chased for a figure. */
const NON_CASH_TYPES = new Set(['in_kind']);

/** Award shapes where a percentage, not a sum, is the answer. */
const RATE_TYPES = new Set(['discount', 'free_slab', 'tax_credit']);

/** Award shapes where a missing figure is a genuine gap worth harvesting. */
const CASH_TYPES = new Set([
  'cash_monthly', 'cash_one_off',        // individual benefits
  'grant', 'loan', 'prize', 'voucher',   // startup programmes
]);

/** The record's own word for what kind of thing it is. */
export const awardType = (p) => p?.benefit_type ?? p?.grant_type ?? null;

/* A percentage stated in prose. Read only to CLASSIFY and to quote back the
   funder's own words — never converted into a monetary amount. */
const PCT = /(\d{1,3}(?:[.,]\d+)?)\s?%/;

/* Prose that says the decision is per case. `Amount depends on case`,
   `per ADHA policy`, `value depends on entitlement`. */
const DISCRETIONARY_PROSE =
  /\b(depends? on (?:the )?(?:case|entitlement|circumstances|need|assessment)|case[- ]by[- ]case|per (?:\w+ )?policy|at the discretion|assessed individually|means[- ]tested amount|decided by)\b/i;

/* Prose that says the award is calculated from the claimant's own figures. */
const CALCULATED_PROSE =
  /\b(means[- ]test|income[- ]based|income[- ]related|depending on your|based on your|calculated from|calculated according|earnings[- ]related|in proportion to)\b/i;

/* What an in-kind award consists of, in the funder's own words, so the page
   can say "free public schooling and tuition-free undergraduate study"
   instead of "Set by the Ministry of Education". */
const IN_KIND_LEAD =
  /\b(free|tuition-free|subsidised|subsidized|reduced|discounted|no-cost|complimentary|access to|place on|places on|use of)\b/i;

/**
 * The shape of this programme's award.
 *
 * Returns `{ kind, ... }`. Callers should switch on `kind` rather than test
 * for the presence of fields: a `rate` with no `pct` is a real state (the
 * funder says "a percentage" and does not say which), and treating it as
 * unpublished would lose the one useful thing the record knows.
 */
export function amountShape(p) {
  if (!p) return { kind: KIND.UNPUBLISHED };

  const note = String(p.amount_note ?? '').trim();
  const type = awardType(p);

  /* 1. A published figure always wins. This branch, and only this branch, is
        allowed to produce money. */
  if (p.amount_min != null || p.amount_max != null) {
    const min = p.amount_min;
    const max = p.amount_max;
    if (min != null && max != null && min !== max) {
      return { kind: KIND.RANGE, min, max, currency: p.amount_currency ?? null, period: p.amount_period ?? null };
    }
    return { kind: KIND.FLAT, value: max ?? min, currency: p.amount_currency ?? null, period: p.amount_period ?? null };
  }

  /* 2. Not money at all. Checked before the rate branch because an in-kind
        award often quotes a percentage of something else entirely — a
        subsidised course fee, a discounted rate — and calling that the award
        intensity would be wrong in a way that reads plausible. */
  if (NON_CASH_TYPES.has(type)) {
    return { kind: KIND.IN_KIND, what: inKindPhrase(note), note: note || null };
  }

  /* 3. A rate. `cofunding_pct` is structured and trusted; a percentage in
        prose is quoted, not computed, and only for the award shapes where a
        percentage IS the award. */
  if (p.cofunding_pct != null) {
    return { kind: KIND.RATE, pct: p.cofunding_pct, of: 'eligible costs', source: 'field', note: note || null };
  }
  if (RATE_TYPES.has(type)) {
    const m = note.match(PCT);
    if (m) {
      return { kind: KIND.RATE, pct: Number(String(m[1]).replace(',', '.')), of: null, source: 'note', note };
    }
    /* A discount or a free allocation with no percentage in it is not a rate
       the funder declined to publish — it is a thing you get. The health card
       giving "free or heavily subsidised treatment" was rendering as "A
       percentage, set by the Ministry of Health", which is both wrong and
       worse than the prose it replaced. */
    return { kind: KIND.IN_KIND, what: inKindPhrase(note), note: note || null };
  }

  /* 4. Decided per case, or calculated from the claimant's own numbers. Two
        different sentences, because they mean different things to the reader:
        one is "somebody will decide", the other is "it comes out of your own
        figures, so nobody can tell you in advance". */
  if (DISCRETIONARY_PROSE.test(note)) {
    return { kind: KIND.DISCRETIONARY, basis: 'case', what: inKindPhrase(note), note: note || null };
  }
  if (CALCULATED_PROSE.test(note)) {
    return { kind: KIND.DISCRETIONARY, basis: 'calculated', what: null, note: note || null };
  }

  /* 5. A percentage in a cash-shaped record, which is usually a contribution
        rate rather than the award. Reported as a rate so the page can quote
        it, and still counted as needing a figure by needsFigure() below. */
  if (PCT.test(note) && !CASH_TYPES.has(type)) {
    const m = note.match(PCT);
    return { kind: KIND.RATE, pct: Number(String(m[1]).replace(',', '.')), of: null, source: 'note', note };
  }

  return { kind: KIND.UNPUBLISHED, note: note || null };
}

/** The funder's own description of what an in-kind award consists of. */
function inKindPhrase(note) {
  if (!note) return null;
  /* The first clause, up to a semicolon or full stop, is reliably the "what".
     Later clauses are conditions. Capped so a page never renders a paragraph
     where a phrase belongs. */
  const first = note.split(/[;.]/)[0].trim();
  if (!first) return null;
  /* Long enough to carry a real list — "Housing loans, land grants,
     ready-built homes and loan repayment exemptions" is 93 characters and was
     being thrown away for being 3 over, leaving the page saying nothing at
     all. Short enough that a page never renders a paragraph in a slot sized
     for a phrase. */
  if (first.length > 140) return null;
  return first;
}

/**
 * Does this record need somebody to go and read the funder's page?
 *
 * This is the harvest worklist rule, and it is deliberately narrow. Sending a
 * crawler at all 2,432 records with no figure would spend most of its budget
 * on free schooling and metro discounts, which have no figure to find. It
 * selects cash-shaped awards whose figure is simply missing.
 */
export function needsFigure(p) {
  if (!p) return false;
  if (p.amount_min != null || p.amount_max != null) return false;
  if (!CASH_TYPES.has(awardType(p))) return false;
  const kind = amountShape(p).kind;
  return kind === KIND.UNPUBLISHED || kind === KIND.DISCRETIONARY || kind === KIND.RATE;
}

/**
 * One sentence for the amount panel, when there is no figure to print.
 *
 * `amountLabel()` in ui.mjs still owns the money case. This owns everything
 * else, and its job is to be worth reading — the sentence it replaces was
 * "Set by <funder>" on 2,432 pages.
 *
 * `funder` is passed rather than read from the record so a caller can localise
 * or shorten it.
 */
export function amountSentence(p, { funder = null } = {}) {
  const shape = amountShape(p);
  const who = funder ?? p?.funder ?? 'the funder';

  switch (shape.kind) {
    case KIND.IN_KIND:
      /* Deliberately not "not a cash payment". Several records typed in_kind
         describe interest-free loans and land grants, and flatly denying that
         money is involved contradicts the sentence immediately after it. What
         you get is the honest frame and needs no negation to be useful. */
      return shape.what
        ? `What you get — ${lowerFirst(shape.what)}`
        : `A service or an allocation rather than a sum of money, provided by ${who}.`;

    case KIND.RATE:
      if (shape.pct == null) return `A percentage, set by ${who} — the rate is not published as a single figure.`;
      /* Zero is a rate, and it is the most valuable one on the page: it means
         a full exemption. "0%, per the Federal Tax Authority's own published
         rate" reads like a broken template. */
      if (shape.pct === 0) return `A full exemption — 0%, per ${who}.`;
      return shape.of
        ? `${trimPct(shape.pct)}% of ${shape.of}`
        : `${trimPct(shape.pct)}%, per ${who}'s own published rate`;

    case KIND.DISCRETIONARY:
      if (shape.basis === 'calculated') {
        return `Calculated from your own circumstances by ${who}, so no fixed figure exists to publish.`;
      }
      return shape.what
        ? `Decided case by case by ${who} — ${lowerFirst(shape.what)}`
        : `Decided case by case by ${who}.`;

    case KIND.UNPUBLISHED:
      return `${who} publishes no figure for this one.`;

    default:
      return null; // FLAT and RANGE are the caller's job
  }
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const trimPct = (n) => (Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, ''));

/**
 * Counts by shape, for the build's own stats and for the verifier.
 *
 * "1,014 verified (46%)" is the figure the build prints today, and it says
 * nothing about whether the product can answer the question people pay it to
 * answer. This one does.
 */
export function shapeCounts(programmes = []) {
  const out = { flat: 0, range: 0, rate: 0, in_kind: 0, discretionary: 0, unpublished: 0, needs_figure: 0 };
  for (const p of programmes) {
    out[amountShape(p).kind] += 1;
    if (needsFigure(p)) out.needs_figure += 1;
  }
  return out;
}
