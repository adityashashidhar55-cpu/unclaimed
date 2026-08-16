/**
 * The funnel, defined once.
 *
 * Both the browser (which fires the events) and the Worker (which stores and
 * aggregates them) import this list, so a step cannot be recorded under a name
 * the dashboard does not know about — the classic way a funnel quietly grows a
 * step that reads as 100% drop-off.
 *
 * The order is the order a person moves through the product. Drop-off between
 * two adjacent steps is the whole point of the table, so a step inserted in the
 * wrong place produces a real-looking number that means nothing. Append rather
 * than insert unless the product order actually changed.
 *
 * What an event carries: the step, a per-tab random id, the country being
 * checked, the interface language, and the surface. Not an IP, not a user
 * agent, not a referrer, not anything typed into the wizard. A funnel needs to
 * know a step happened, not who took it.
 */

export const FUNNEL = [
  { step: 'land',          label: 'Landed on the site' },
  { step: 'check_start',   label: 'Opened the checker' },
  { step: 'country',       label: 'Picked a country' },
  { step: 'answers_1',     label: 'Answered the first question' },
  { step: 'answers_half',  label: 'Got halfway through the questions' },
  { step: 'answers_done',  label: 'Finished the questions' },
  { step: 'result',        label: 'Saw their total' },
  { step: 'paywall_seen',  label: 'Reached the locked list' },
  { step: 'signin_start',  label: 'Started signing in' },
  { step: 'signin_done',   label: 'Signed in' },
  { step: 'checkout_start',label: 'Opened checkout' },
  { step: 'checkout_done', label: 'Paid' },
];

export const STEPS = FUNNEL.map((f) => f.step);
const STEP_SET = new Set(STEPS);

export const isStep = (s) => STEP_SET.has(s);

export const stepLabel = (s) => FUNNEL.find((f) => f.step === s)?.label ?? s;

/**
 * Turn per-step visitor counts into a drop-off table.
 *
 * `reached` is the count of distinct visitors who fired each step. Two rates
 * matter and they answer different questions:
 *
 *   share  — of everyone who entered the funnel, how many got this far. This
 *            is the line that falls off a cliff, and it is what people mean by
 *            "where do we lose them" when they are looking at a chart.
 *   step   — of the people who reached the PREVIOUS step, how many reached
 *            this one. This is what you act on: a 40% share at step eight can
 *            be eight healthy steps or one catastrophic one, and only the
 *            per-step rate tells you which.
 *
 * `lost` is the absolute number who reached the previous step and not this
 * one, which is the number worth putting money against.
 */
export function funnelRows(reached) {
  const first = reached[STEPS[0]] || 0;
  let prev = null;
  return FUNNEL.map(({ step, label }) => {
    const n = reached[step] || 0;
    const row = {
      step,
      label,
      count: n,
      share: first ? n / first : 0,
      stepRate: prev === null ? 1 : prev ? n / prev : 0,
      lost: prev === null ? 0 : Math.max(0, prev - n),
    };
    prev = n;
    return row;
  });
}

/** The adjacent pair with the largest absolute loss — "where most traffic stops". */
export function worstDrop(rows) {
  let worst = null;
  for (let i = 1; i < rows.length; i++) {
    /* Absolute loss, not rate. A step that loses 90% of the twelve people who
       got that far is a rounding error; one that loses 30% of eight thousand
       is the product. */
    if (!worst || rows[i].lost > worst.lost) {
      worst = { from: rows[i - 1], to: rows[i], lost: rows[i].lost, rate: 1 - rows[i].stepRate };
    }
  }
  return worst;
}
