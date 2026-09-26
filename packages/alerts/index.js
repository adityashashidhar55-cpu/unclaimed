/**
 * Deadline email alerts — the vocabulary, validation and digest logic.
 *
 * No database and no fetch in this file, on purpose: the same split as
 * packages/grants — a database-free module can be unit tested without a
 * Worker, and it is the thing the build, the Worker and the test suite all
 * import so the "which programmes go in today's email" rule is written once.
 *
 * effectiveStatus() is the load-bearing import. A programme's date does not
 * change because a cron ran; what changes is which SIDE of "closes in 14
 * days" today's date now falls on. So the digest is recomputed fresh against
 * `asOf` every run rather than diffed against a stored "next reminder" field,
 * which is exactly the bug class effectiveStatus() already exists to avoid
 * (see packages/deadlines) — a stored fact about a moving target goes stale.
 */

import { effectiveStatus } from '../deadlines/index.js';

const DAY = 24 * 60 * 60 * 1000;

/** Free accounts watch one jurisdiction. Entitled accounts watch as many as they list. */
export const FREE_JURISDICTION_LIMIT = 1;

/** Hard ceiling even for entitled accounts: there are only a few dozen jurisdictions, and each one is a fetch in the daily cron. */
export const MAX_JURISDICTIONS = 64;

export const AUDIENCES = Object.freeze(['companies', 'individuals']);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lowercase, trim, dedupe, drop anything that is not a plausible cc/pool slug. */
export function normaliseJurisdictions(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const cc = String(raw ?? '').trim().toLowerCase();
    if (!cc || !/^[a-z-]{2,16}$/.test(cc) || seen.has(cc)) continue;
    seen.add(cc);
    out.push(cc);
  }
  return out;
}

/**
 * Validate a POST /api/alerts/subscribe body.
 *
 * `entitled` is resolved by the caller (it needs a session and entitlementFor,
 * neither of which belongs in a database-free module) and decides the cap:
 * free is one jurisdiction, entitled is unlimited.
 */
export function validateSubscribeInput(body, entitled) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'valid_email_required' };

  const audience = body?.audience;
  if (!AUDIENCES.includes(audience)) return { ok: false, error: 'audience_required' };

  const jurisdictions = normaliseJurisdictions(body?.jurisdictions);
  if (!jurisdictions.length) return { ok: false, error: 'jurisdiction_required' };

  if (jurisdictions.length > MAX_JURISDICTIONS) {
    return { ok: false, error: 'jurisdiction_limit', limit: MAX_JURISDICTIONS };
  }
  if (!entitled && jurisdictions.length > FREE_JURISDICTION_LIMIT) {
    return { ok: false, error: 'jurisdiction_limit', limit: FREE_JURISDICTION_LIMIT };
  }

  return { ok: true, email, audience, jurisdictions };
}

/** A capability token: unguessable, and long enough that brute force is not a strategy. */
export function genToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 'YYYY-MM-DD', UTC. The unit the idempotency index is keyed on. */
export function dayKeyUTC(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Which programmes belong in today's digest, and why.
 *
 * Three, and only three, reasons an alert is worth sending — anything else is
 * noise, and noise is how people unsubscribe from the whole feature:
 *
 *   - `closing_14` / `closing_3`  — open now, and closes in exactly 14 or 3
 *     days from `asOf`. Two nudges, not a countdown: a daily "12 days left,
 *     11 days left, ..." email is the thing this is explicitly not building.
 *   - `newly_open` / `newly_upcoming` — effectiveStatus() flipped to open or
 *     upcoming since `lastSentAt`. A programme a subscriber could not have
 *     acted on last time they heard from us and can act on (or prepare for)
 *     now.
 *
 * `lastSentAt` is null for a subscriber's first-ever digest, so nothing can
 * register as "newly" anything on it — there is no prior state to have
 * changed from. Their first email is deadline-only, which is correct: we do
 * not know what they already knew.
 */
export function planDigest(programmes, { asOf = Date.now(), lastSentAt = null } = {}) {
  const items = [];
  for (const programme of programmes) {
    const es = effectiveStatus(programme, asOf);

    if (es === 'open' && programme?.closes_at != null) {
      const closesAt = typeof programme.closes_at === 'number' ? programme.closes_at : Date.parse(programme.closes_at);
      if (!Number.isNaN(closesAt)) {
        const daysLeft = Math.round((closesAt - asOf) / DAY);
        if (daysLeft === 14 || daysLeft === 3) {
          items.push({ programme, reason: `closing_${daysLeft}`, days_left: daysLeft });
          continue;
        }
      }
    }

    if (lastSentAt != null && (es === 'open' || es === 'upcoming')) {
      const wasEs = effectiveStatus(programme, lastSentAt);
      if (wasEs !== es) items.push({ programme, reason: `newly_${es}` });
    }
  }
  return items;
}

const fmtDate = (ts) => new Date(ts).toISOString().slice(0, 10);

const REASON_LABEL = {
  closing_14: 'Closes in 2 weeks',
  closing_3: 'Closes in 3 days',
  newly_open: 'Just opened',
  newly_upcoming: 'Opening soon',
};

const programmeLine = (item) => {
  const p = item.programme;
  const name = p.name_en || p.name_local || p.slug;
  const label = REASON_LABEL[item.reason] ?? item.reason;
  const deadline = item.reason.startsWith('closing_') && p.closes_at ? ` — closes ${fmtDate(Date.parse(p.closes_at))}` : '';
  const url = p.application_url || p.source_url || '';
  return `  - [${label}] ${name}${deadline}${url ? `\n    ${url}` : ''}`;
};

/**
 * Plain, honest email copy. Every fact here is either the count of matches,
 * the as-of date the underlying record was verified against, or a link — no
 * urgency copy invented past what the data actually says, and every digest
 * repeats the one instruction that matters more than anything else in the
 * email: check the funder's own page, because we compile this, we do not run
 * the programme.
 */
export function digestEmailText(items, { asOf = Date.now(), unsubscribeUrl } = {}) {
  const subject = items.length === 1
    ? `1 deadline update: ${items[0].programme.name_en || items[0].programme.name_local || items[0].programme.slug}`
    : `${items.length} deadline updates on your watchlist`;

  const text =
    `Here's what changed on the programmes you're tracking, as of ${fmtDate(asOf)}:\n\n` +
    `${items.map(programmeLine).join('\n\n')}\n\n` +
    `Always confirm the deadline and the rules on the funder's own page before you apply — this is a ` +
    `compiled record, not the programme itself, and funders do sometimes move a date without telling us first.\n\n` +
    `Stop these emails: ${unsubscribeUrl}\n`;

  return { subject, text };
}

/** The double opt-in email. Nothing is subscribed until this link is clicked. */
export function confirmEmailText(confirmUrl, jurisdictions) {
  const subject = 'Confirm your deadline alerts';
  const text =
    `Almost done — click to start getting deadline alerts for ${jurisdictions.join(', ').toUpperCase()}:\n\n` +
    `${confirmUrl}\n\n` +
    `If you didn't ask for this, ignore this email and nothing will be sent.\n`;
  return { subject, text };
}
