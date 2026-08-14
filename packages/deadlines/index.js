/**
 * UNCLAIMED — deadlines and status.
 *
 * A closed grant is not useless information. It is a date in the future.
 *
 * Most grant sites either hide closed calls (so a founder never learns the
 * programme exists and misses it again next year) or list them as though they
 * were open (so the founder wastes an afternoon discovering otherwise). Both
 * are failures of the same kind: treating status as a filter rather than as
 * the most time-sensitive fact on the record.
 *
 * So every programme carries a status, and closed ones are shown with the
 * thing that actually matters — when they come back. 246 of the 251 closed or
 * paused programmes in the dataset carry reopening information, because we
 * asked for it during research rather than discarding the record.
 *
 * Where a funder publishes no reopening date but has a visible rhythm — "cut
 * offs in March and October", four consecutive years of a January call — we
 * project the next window and label it as a projection. A projection clearly
 * marked as one is useful; a projection presented as a date is a lie.
 */

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export const STATUS = Object.freeze({
  OPEN: 'open', // accepting applications now, with a stated close date
  ROLLING: 'rolling', // continuously open, no deadline
  CLOSED: 'closed', // this round has closed
  PAUSED: 'paused', // suspended by the funder, not merely between rounds
  UPCOMING: 'upcoming', // announced, not yet accepting
  UNKNOWN: 'unknown', // the funder publishes nothing we could read
});

/** How each status should read to a person, and how urgently. */
export const STATUS_META = Object.freeze({
  open: { label: 'Open now', tone: 'go', rank: 0, actionable: true },
  rolling: { label: 'Always open', tone: 'go', rank: 1, actionable: true },
  upcoming: { label: 'Opens soon', tone: 'wait', rank: 2, actionable: false },
  closed: { label: 'Closed', tone: 'wait', rank: 3, actionable: false },
  paused: { label: 'Paused by the funder', tone: 'stop', rank: 4, actionable: false },
  unknown: { label: 'Check with the funder', tone: 'unknown', rank: 5, actionable: null },
});

const DAY = 24 * 60 * 60 * 1000;
const parse = (d) => {
  if (d == null) return null;
  const t = typeof d === 'number' ? d : Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

/* ------------------------------------------------------------------ */
/* Projecting the next window                                          */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * When is this likely to open again?
 *
 * Order of preference, and it matters:
 *   1. A date the funder published. Not a projection at all.
 *   2. The programme's stated call months, projected forward.
 *   3. The last close date plus one cycle length.
 *   4. Nothing. We say we do not know, rather than inventing a quarter.
 *
 * The return always says which of those it is, so the UI can render
 * "Opens 3 March 2027" differently from "Usually opens around March".
 */
export function nextWindow(programme, asOf = Date.now()) {
  const opens = parse(programme?.opens_at);
  if (opens && opens > asOf) {
    return { at: opens, basis: 'published', confident: true, text: null };
  }

  const months = (programme?.typical_months || []).filter((m) => m >= 1 && m <= 12);
  if (months.length) {
    const now = new Date(asOf);
    const year = now.getUTCFullYear();
    const candidates = [];
    for (const m of months) {
      candidates.push(Date.UTC(year, m - 1, 1), Date.UTC(year + 1, m - 1, 1));
    }
    const next = candidates.filter((t) => t > asOf).sort((a, b) => a - b)[0];
    if (next) {
      const label = months.map((m) => MONTH_NAMES[m - 1]).join(' and ');
      return {
        at: next,
        basis: 'pattern',
        confident: false,
        text: `Usually opens in ${label}`,
      };
    }
  }

  const CYCLE_DAYS = { annual: 365, biannual: 182, quarterly: 91, continuous: 0, one_off: null, irregular: null };
  const last = parse(programme?.last_call_closed_at);
  const cycleDays = CYCLE_DAYS[programme?.cycle];
  if (last && cycleDays) {
    let projected = last + cycleDays * DAY;
    while (projected < asOf) projected += cycleDays * DAY;
    return {
      at: projected,
      basis: 'cycle',
      confident: false,
      text: `Runs ${programme.cycle}; last round closed ${new Date(last).toISOString().slice(0, 10)}`,
    };
  }

  return {
    at: null,
    basis: 'unknown',
    confident: false,
    text: programme?.reopen_note ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* The user-facing verdict                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything a person needs to decide what to do about this programme today.
 *
 * `urgency` drives the UI colour and sort:
 *   'closing'  — open and closing within two weeks. Act now.
 *   'open'     — open with time, or rolling.
 *   'soon'     — reopening within 90 days. Worth preparing for.
 *   'later'    — reopening beyond that, or pattern-projected.
 *   'stalled'  — paused with no restart date.
 *   'unknown'  — we could not establish anything. Say so.
 */
export function deadlineState(programme, asOf = Date.now()) {
  const status = programme?.status || STATUS.UNKNOWN;
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  const closes = parse(programme?.closes_at);

  if (status === STATUS.OPEN || (status === STATUS.ROLLING && closes)) {
    if (closes) {
      const days = Math.ceil((closes - asOf) / DAY);
      if (days < 0) {
        /* The published deadline has passed and nobody updated the record.
           Say that plainly rather than showing a date in the past as "open". */
        return {
          status,
          meta,
          urgency: 'unknown',
          headline: 'Deadline has passed',
          detail: `The last published deadline was ${new Date(closes).toISOString().slice(0, 10)}. Check the funder's page for a new round.`,
          days_until: days,
          at: closes,
          stale: true,
        };
      }
      return {
        status,
        meta,
        urgency: days <= 14 ? 'closing' : 'open',
        headline: days === 0 ? 'Closes today' : days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`,
        detail: `Applications close ${new Date(closes).toISOString().slice(0, 10)}.`,
        days_until: days,
        at: closes,
        stale: false,
      };
    }
  }

  if (status === STATUS.ROLLING) {
    return {
      status,
      meta,
      urgency: 'open',
      headline: 'Open continuously',
      detail: 'No deadline — apply whenever you are ready.',
      days_until: null,
      at: null,
      stale: false,
    };
  }

  if (status === STATUS.CLOSED || status === STATUS.UPCOMING) {
    const w = nextWindow(programme, asOf);
    if (w.at) {
      const days = Math.ceil((w.at - asOf) / DAY);
      return {
        status,
        meta,
        urgency: days <= 90 ? 'soon' : 'later',
        headline: w.confident
          ? `Opens ${new Date(w.at).toISOString().slice(0, 10)}`
          : w.text || `Expected around ${new Date(w.at).toISOString().slice(0, 10)}`,
        detail: w.confident
          ? 'Date published by the funder.'
          : `Projected from ${w.basis === 'pattern' ? 'the months this call usually opens' : 'its published cycle'} — not a date the funder has confirmed.`,
        days_until: days,
        at: w.at,
        projected: !w.confident,
        stale: false,
      };
    }
    return {
      status,
      meta,
      urgency: 'later',
      headline: 'Closed for now',
      detail: programme?.reopen_note || 'The funder has not said when this reopens.',
      days_until: null,
      at: null,
      stale: false,
    };
  }

  if (status === STATUS.PAUSED) {
    return {
      status,
      meta,
      urgency: 'stalled',
      headline: 'Paused by the funder',
      detail: programme?.reopen_note || 'Suspended with no restart date announced.',
      days_until: null,
      at: null,
      stale: false,
    };
  }

  return {
    status: STATUS.UNKNOWN,
    meta,
    urgency: 'unknown',
    headline: 'Status not published',
    detail:
      programme?.deadline_note ||
      'This funder does not publish a call calendar. Check their page before planning around it.',
    days_until: null,
    at: null,
    stale: false,
  };
}

/* ------------------------------------------------------------------ */
/* Planning across a whole result set                                  */
/* ------------------------------------------------------------------ */

const URGENCY_RANK = { closing: 0, open: 1, soon: 2, later: 3, unknown: 4, stalled: 5 };

/**
 * Group a set of matches into a calendar a founder can act on.
 *
 * The point of this shape: "three things close this month, two open in
 * March, one is paused indefinitely" is a plan. A flat list sorted by money
 * is not.
 */
export function calendar(matches, asOf = Date.now()) {
  const rows = matches.map((m) => ({ ...m, deadline: deadlineState(m.programme, asOf) }));

  const groups = { closing: [], open: [], soon: [], later: [], unknown: [], stalled: [] };
  for (const r of rows) groups[r.deadline.urgency].push(r);

  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => {
      const ad = a.deadline.days_until;
      const bd = b.deadline.days_until;
      if (ad != null && bd != null) return ad - bd;
      if (ad != null) return -1;
      if (bd != null) return 1;
      return 0;
    });
  }

  return {
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    /* The single most urgent thing, for a notification or a home screen. */
    next_action: [...rows]
      .filter((r) => r.deadline.meta.actionable)
      .sort((a, b) => (a.deadline.days_until ?? 9e9) - (b.deadline.days_until ?? 9e9))[0] ?? null,
    ordered: rows.sort(
      (a, b) =>
        URGENCY_RANK[a.deadline.urgency] - URGENCY_RANK[b.deadline.urgency] ||
        (a.deadline.days_until ?? 9e9) - (b.deadline.days_until ?? 9e9),
    ),
  };
}

/**
 * Calendar events for the things worth a reminder.
 *
 * Two events per programme where we can: one at the deadline, one two weeks
 * before, because a reminder on the closing day is a reminder that arrives
 * too late to write anything.
 */
export function reminders(matches, asOf = Date.now()) {
  const out = [];
  for (const m of matches) {
    const d = deadlineState(m.programme, asOf);
    if (d.at == null || d.at < asOf) continue;
    const name = m.programme.name_en || m.programme.name_local;

    if (d.urgency === 'closing' || d.urgency === 'open') {
      out.push({
        at: d.at,
        kind: 'deadline',
        title: `${name} closes`,
        body: d.detail,
        url: m.programme.application_url,
      });
      const prep = d.at - 14 * DAY;
      if (prep > asOf) {
        out.push({
          at: prep,
          kind: 'prepare',
          title: `Two weeks to apply: ${name}`,
          body: 'Start now if you have not — this one needs documents.',
          url: m.programme.application_url,
        });
      }
    } else if (d.urgency === 'soon' || d.urgency === 'later') {
      out.push({
        at: d.at,
        kind: 'reopen',
        title: `${name} expected to reopen`,
        body: d.projected ? `${d.detail} Confirm on the funder's page.` : d.detail,
        url: m.programme.source_url,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** RFC 5545 export, so reminders land in a real calendar rather than an inbox. */
export function toICS(events, { name = 'Unclaimed deadlines' } = {}) {
  const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const esc = (s) => String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Unclaimed//Grant deadlines//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(name)}`,
  ];
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:unclaimed-${i}-${e.at}@unclaimed.app`,
      `DTSTAMP:${stamp(Date.now())}`,
      `DTSTART:${stamp(e.at)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.body)}${e.url ? esc('\n' + e.url) : ''}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
