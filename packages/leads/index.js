/**
 * "Get expert help" lead capture — validation and copy, no database and no
 * fetch in this file, same split as packages/alerts: a database-free module
 * that the Worker, the build and the test suite all import, so the rule for
 * "is this a submittable lead" is written once.
 *
 * This is a referral into involve-consulting.com, the owner's separate paid
 * consulting business — flat-fee only. There is no contingent-fee or
 * success-fee pricing anywhere in this module or in the copy it renders,
 * and MAX_MESSAGE_LEN / the consent requirement exist to keep the form a
 * short, honest handoff rather than a place to paste an entire application.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME_LEN = 200;
const MAX_MESSAGE_LEN = 2000;
const MAX_COUNTRY_LEN = 8;
const MAX_PROGRAMME_LEN = 200;
const MAX_EMAIL_LEN = 254; // RFC 5321 path limit

/** Validate a POST /api/leads body. Returns { ok, ...fields } or { ok:false, error }. */
export function validateLeadInput(body) {
  const name = String(body?.name ?? '').trim().slice(0, MAX_NAME_LEN);
  if (!name) return { ok: false, error: 'name_required' };

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return { ok: false, error: 'valid_email_required' };

  const country = String(body?.country ?? '').trim().toLowerCase().slice(0, MAX_COUNTRY_LEN);

  const programmeSlug = String(body?.programme_slug ?? '').trim().slice(0, MAX_PROGRAMME_LEN);
  if (programmeSlug && !/^[a-z0-9/_-]+$/i.test(programmeSlug)) return { ok: false, error: 'invalid_programme_slug' };

  const message = String(body?.message ?? '').trim().slice(0, MAX_MESSAGE_LEN);

  const consent = body?.consent === true;
  if (!consent) return { ok: false, error: 'consent_required' };

  const audience = body?.audience === 'company' ? 'company' : body?.audience === 'household' ? 'household' : '';

  return { ok: true, name, email, country, programme_slug: programmeSlug, message, audience };
}

/** The plain-text email sent to LEADS_TO, when configured. */
export function leadNotificationText(lead) {
  return [
    'New "get expert help" lead from Unclaimed.',
    '',
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.country ? `Country: ${lead.country}` : null,
    lead.audience ? `Audience: ${lead.audience}` : null,
    lead.programme_slug ? `Programme: ${lead.programme_slug}` : null,
    lead.message ? `Message:\n${lead.message}` : null,
    '',
    'This is a flat-fee referral, never a success fee — see involve-consulting.com.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}
