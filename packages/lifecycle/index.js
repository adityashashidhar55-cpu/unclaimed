/**
 * "Email me this result" — validation, link building and email copy.
 *
 * No database and no fetch in this file, the same split as packages/alerts and
 * packages/leads: the Worker, the cron and the test suite all import it, so
 * "what may be in this email" is written once.
 *
 * Three rules govern every line of copy below, and the tests hold them:
 *   1. Only what the free check itself shows. Totals and counts, never a
 *      programme name — the names are the paid product, and an email is a
 *      much easier thing to forward than a results screen.
 *   2. Plain and honest. No countdown theatre, no invented urgency, no claim
 *      that we obtain or secure anything (packages/policy forbids it).
 *   3. Every marketing email says why you are getting it and how to stop.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_PROFILE_BYTES = 4096;

export const DAY = 24 * 60 * 60 * 1000;

/** Follow-up sequence: age in days at which each step becomes due. */
export const SEQUENCE_DAYS = Object.freeze([2, 5, 10, 21]);

/** Weekly digest cadence, and how long after signup the first one may go. */
export const DIGEST_EVERY_DAYS = 7;
export const DIGEST_START_DAYS = 28; // after the sequence has finished: one voice at a time

export const AUDIENCES = Object.freeze(['household', 'company']);
export const LOCALES = Object.freeze(['en', 'fr', 'de', 'es', 'it', 'pt', 'hi']);

/** Where the check lives, per audience. */
const CHECK_PATH = { household: '/check/', company: '/startups/check/' };

/** Validate a POST /api/results/email body. */
export function validateResultsEmailInput(body) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return { ok: false, error: 'valid_email_required' };

  const audience = body?.audience;
  if (!AUDIENCES.includes(audience)) return { ok: false, error: 'audience_required' };

  const profile = body?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { ok: false, error: 'profile_required' };
  const country = String(profile.country_code ?? '').trim().toLowerCase();
  if (!/^[a-z-]{2,16}$/.test(country)) return { ok: false, error: 'country_required' };

  /* Size-capped: this is a form on a public page writing JSON into a database. */
  const profileJson = JSON.stringify(profile); // as entered: the matcher reads country_code in whichever case the wizard wrote it
  if (profileJson.length > MAX_PROFILE_BYTES) return { ok: false, error: 'profile_too_large' };

  const locale = LOCALES.includes(body?.locale) ? body.locale : 'en';

  /* Strictly boolean true: a truthy string from a hand-built request is not a
     tick. The box is the only thing that unlocks follow-up mail. */
  const marketing = body?.consent === true;

  return { ok: true, email, audience, country, profile: JSON.parse(profileJson), profileJson, locale, marketing };
}

/**
 * The #r=<answers> link the visitor could have copied from the results screen
 * themselves — same encoding as encodeState() in src/app.js and
 * src/pwa/startup-check.js (base64url of the profile JSON).
 */
export function buildShareLink(origin, { audience, locale = 'en', profileJson }) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(profileJson)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const prefix = locale && locale !== 'en' && LOCALES.includes(locale) ? `/${locale}` : '';
  return `${origin}${prefix}${CHECK_PATH[audience]}?utm_source=result_email&utm_medium=email#r=${b64}`;
}

/* ------------------------------------------------------------------ */
/* Headlines — built from the same payloads /api/check and             */
/* /api/startups/check return, so the email cannot disagree with them. */
/* ------------------------------------------------------------------ */

export function formatMoney(n, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n)}`;
  }
}

const plural = (n, one, other) => `${n} ${n === 1 ? one : other}`;

/**
 * Household: from the free payload of handleCheck. Same three facts the results
 * screen opens with — how many programmes, the per-year figure, the one-off
 * figure — each said only when the screen would say it.
 */
export function householdHeadline(free) {
  const eligible = free.counts?.eligible ?? 0;
  const lines = [];
  lines.push(
    eligible
      ? `${plural(eligible, 'programme', 'programmes')} you appear to qualify for in ${free.country}.`
      : `No programme matched outright in ${free.country}.`,
  );
  const cur = free.currency;
  if (eligible && free.total_max > 0) {
    lines.push(
      free.total_max > free.total_min && free.total_min > 0
        ? `Published ceilings: ${formatMoney(free.total_min, cur)}–${formatMoney(free.total_max, cur)} a year.`
        : `Published ceilings: up to ${formatMoney(free.total_max, cur)} a year.`,
    );
  }
  if (free.one_off_max > 0) {
    lines.push(
      `Plus ${formatMoney(free.one_off_max, cur)} paid once, across ${plural(free.one_off_count, 'programme', 'programmes')}.`,
    );
  }
  const pending = (free.counts?.conditional ?? 0) + (free.counts?.needs_answer ?? 0);
  if (pending) lines.push(`${plural(pending, 'more depends', 'more depend')} on one more answer.`);
  return { country: free.country, eligible, lines };
}

/** Company: from the free payload of handleStartupCheck, same sums the screen does. */
export function companyHeadline(free, countryName) {
  const eligible = free.counts?.eligible ?? 0;
  const bands = Object.values(free.totals ?? {}).filter((t) => t && t.count > 0 && t.non_dilutive);
  const byCur = {};
  let counted = 0;
  for (const b of bands) {
    counted += b.count ?? 0;
    for (const [cur, v] of Object.entries(b.by_currency || {})) {
      const acc = (byCur[cur] ||= 0);
      byCur[cur] = acc + (v.max ?? v.min ?? 0);
    }
  }
  const money = Object.entries(byCur).map(([cur, v]) => formatMoney(Math.round(v), cur)).join(' + ');
  const lines = [];
  lines.push(
    eligible
      ? `${plural(eligible, 'programme', 'programmes')} this company appears to qualify for${countryName ? ` in ${countryName}` : ''}.`
      : `Nothing matched outright${countryName ? ` in ${countryName}` : ''}.`,
  );
  if (eligible && money) {
    lines.push(`${money} in published non-dilutive ceilings across ${counted} of them.`);
  }
  const pending = (free.counts?.conditional ?? 0) + (free.counts?.needs_answer ?? 0);
  if (pending) lines.push(`${plural(pending, 'more depends', 'more depend')} on a detail the check did not ask for.`);
  return { country: countryName || '', eligible, lines };
}

/** Stable fingerprint of a free result: what "changed since we last wrote" means. */
export function resultSignature(free, audience) {
  const c = free.counts ?? {};
  if (audience === 'company') {
    const t = Object.entries(free.totals ?? {})
      .map(([k, v]) => [k, v.count, JSON.stringify(v.by_currency ?? {})])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return JSON.stringify({ e: c.eligible, c: c.conditional, n: c.needs_answer, t });
  }
  return JSON.stringify({
    e: c.eligible, t: c.tapered, c: c.conditional, n: c.needs_answer,
    min: free.total_min, max: free.total_max, omin: free.one_off_min, omax: free.one_off_max,
  });
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

const OFFER = {
  household: 'Personal is €50 a year (or €7 a month): the programme names, the steps, the document checklist and prepared applications.',
  company: 'Startup is €49 a seat a month or €490 a year, with a 14-day trial: the programme names, the steps, the de minimis ceiling applied to your plan and prepared applications.',
};

const FOOTER_REASON_CONSENT =
  'You are getting this because you asked us to email you a result on unclaimedgrant.com and ticked the box for follow-ups.';

function footer({ unsubscribeUrl, marketing }) {
  return (
    `\n--\n` +
    `${marketing ? FOOTER_REASON_CONSENT : 'You asked us to email you this result on unclaimedgrant.com. This is the only email we will send.'}\n` +
    `Stop all emails from us: ${unsubscribeUrl}\n` +
    `We compile public programme rules; the funder decides. Always check the rules on the funder's own page before you apply.\n`
  );
}

/** Headers every marketing email carries (RFC 2369 + RFC 8058 one-click). */
export function unsubscribeHeaders(unsubscribeUrl) {
  return { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/**
 * The one transactional email: the result they asked for. Same copy whether or
 * not they ticked the box — the box changes what happens afterwards, not this.
 */
export function resultEmail({ audience, headline, shareLink, unlockUrl, unsubscribeUrl, marketing }) {
  const subject = headline.eligible
    ? `Your Unclaimed result: ${plural(headline.eligible, 'programme', 'programmes')}${headline.country ? ` in ${headline.country}` : ''}`
    : `Your Unclaimed result${headline.country ? ` for ${headline.country}` : ''}`;
  const text =
    `Here is the result you asked us to email you.\n\n` +
    `${headline.lines.join('\n')}\n\n` +
    `Open it again, or send it to someone: ${shareLink}\n` +
    `(The link contains the answers you gave, so anyone you send it to sees them.)\n\n` +
    `What the free check does not show is which programmes these are. ${OFFER[audience]}\n` +
    `Unlock the full list: ${unlockUrl}\n` +
    `${marketing ? '\nAs you ticked the box, we will send a few short follow-ups over the next three weeks, then at most one email a week when something about your result changes.\n' : ''}` +
    footer({ unsubscribeUrl, marketing });
  return { subject, text };
}

/**
 * Follow-up steps. `ctx.closing` is the number of programmes in the visitor's
 * country closing within 60 days (null when the dataset could not be read —
 * the email then says nothing numeric rather than guess).
 */
export function sequenceEmail(step, ctx) {
  const { audience, headline, shareLink, unlockUrl, unsubscribeUrl, countryUrl, closing, countryName } = ctx;
  const where = countryName || headline.country || 'your country';
  const tail = footer({ unsubscribeUrl, marketing: true });
  switch (step) {
    case 1: {
      const closingLine =
        closing == null
          ? `Deadlines are the thing people miss. The page for ${where} lists every programme with its date: ${countryUrl}`
          : closing > 0
            ? `${plural(closing, 'programme', 'programmes')} in ${where} ${closing === 1 ? 'closes' : 'close'} within the next 60 days. Not all of them will fit you, but the dates are public, and the list is here: ${countryUrl}`
            : `No programme in ${where} closes in the next 60 days. Most schemes are open all year, so this is not a reason to wait. Every programme and its date: ${countryUrl}`;
      return {
        subject: `Deadlines in ${where}`,
        text:
          `A short note on dates, since a missed deadline is the most avoidable way to lose money.\n\n${closingLine}\n\n` +
          `Your result, for reference:\n${headline.lines.join('\n')}\n${shareLink}\n${tail}`,
      };
    }
    case 2:
      return {
        subject: 'How to read your Unclaimed result',
        text:
          `Three things worth knowing about the result you saved.\n\n` +
          `1. The figures are published ceilings, not offers. What you receive is decided by the authority, on your circumstances.\n` +
          `2. A programme that publishes no amount counts as zero in the total. We would rather under-count than invent a number.\n` +
          `3. "Depends on one more answer" means every rule we could test passed, and one fact we did not ask decides it. Change your answers and the result moves.\n\n` +
          `Your result: ${shareLink}\n${tail}`,
      };
    case 3:
      return {
        subject: audience === 'company' ? 'See which programmes your company matched' : 'See which programmes you matched',
        text:
          `Your result said:\n${headline.lines.join('\n')}\n\n` +
          `The free check stops at the numbers. ${OFFER[audience]}\n\n` +
          `Unlock the full list: ${unlockUrl}\n\n` +
          `Nothing is taken from what you receive: a flat subscription, never a share of any award. If it is not for you, ignore this and we will not keep nudging.\n${tail}`,
      };
    default:
      return {
        subject: 'Last note about your result',
        text:
          `This is the last of the follow-ups we said we would send.\n\n` +
          `Your saved result: ${shareLink}\n` +
          `Unlock the names: ${unlockUrl}\n\n` +
          `From here you will only hear from us if something about your result changes (at most once a week). Reply to this email if anything above was unclear. It reaches a person.\n${tail}`,
      };
  }
}

/**
 * Which follow-up (1-4) is due for a subscriber of this age that has already
 * had `sentStep`. The highest due step wins and lower ones are skipped: if the
 * cron was down for a week, day 2's email must not turn up on day 9.
 */
export function dueStep(createdAt, sentStep, asOf) {
  const age = (asOf - createdAt) / DAY;
  let due = 0;
  SEQUENCE_DAYS.forEach((d, i) => { if (age >= d) due = i + 1; });
  return due > sentStep ? due : 0;
}

/**
 * The weekly digest. Counts only — never names — and only said when different
 * from what the person was last told.
 */
export function digestEmail({ audience, headline, shareLink, unlockUrl, unsubscribeUrl, newlyOpen, countryName, changed }) {
  const lines = [];
  if (changed) lines.push(`Your result changed since we last wrote:\n${headline.lines.join('\n')}`);
  if (newlyOpen > 0) {
    lines.push(
      `${plural(newlyOpen, 'programme', 'programmes')} in ${countryName || headline.country || 'your country'} ${newlyOpen === 1 ? 'has' : 'have'} opened since our last email. Whether any of them fit you is in the result above, or in the link below.`,
    );
  }
  return {
    subject: changed ? 'Your Unclaimed result has changed' : 'New programmes have opened',
    text:
      `${lines.join('\n\n')}\n\nCheck it again: ${shareLink}\n` +
      `Names and steps: ${unlockUrl}\n${footer({ unsubscribeUrl, marketing: true })}`,
  };
}
