/**
 * "Report an error" — validation and copy, no database and no fetch in this
 * file (same split as packages/leads and packages/alerts), so the Worker's
 * POST /api/report-issue, the MCP report_issue tool and the test suite all
 * answer "is this a submittable report" the same way.
 *
 * The field names are the MCP tool's (data/mcp-tools.json: country_code, slug,
 * issue_type, description, reporter_contact) plus the three a person on a page
 * can add that an assistant usually cannot: what it should say instead, the
 * official page that shows it, and the page they were on.
 */

export const ISSUE_TYPES = Object.freeze(['wrong_amount', 'dead_link', 'rule_changed', 'wrong_deadline', 'other']);

export const ISSUE_STATUSES = Object.freeze(['open', 'fixed', 'rejected', 'duplicate']);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX = { description: 2000, suggested: 1000, url: 500, contact: 254, slug: 200, locale: 8 };

const cleanUrl = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.length > MAX.url) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
};

/**
 * Validate a report. Returns { ok: true, ...fields } or { ok: false, error }.
 *
 * `website` is a honeypot: a real person never sees it, a form-filling bot
 * does. The caller answers 200 and stores nothing when it is set, so the bot
 * learns nothing.
 */
export function validateIssueInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };
  if (String(body.website ?? '').trim()) return { ok: true, honeypot: true };

  const slug = String(body.slug ?? '').trim().slice(0, MAX.slug);
  if (!slug) return { ok: false, error: 'slug_required' };
  if (!/^[a-z0-9/_-]+$/i.test(slug)) return { ok: false, error: 'invalid_slug' };

  const issueType = String(body.issue_type ?? 'other').trim();
  if (!ISSUE_TYPES.includes(issueType)) return { ok: false, error: 'invalid_issue_type' };

  const description = String(body.description ?? '').trim().slice(0, MAX.description);
  if (description.length < 5) return { ok: false, error: 'description_required' };

  const country = String(body.country_code ?? '').trim().toLowerCase();
  if (country && !/^[a-z]{2,8}$/.test(country)) return { ok: false, error: 'invalid_country' };

  const contact = String(body.reporter_contact ?? '').trim().toLowerCase();
  if (contact && (contact.length > MAX.contact || !EMAIL_RE.test(contact))) return { ok: false, error: 'invalid_contact' };

  const evidence = cleanUrl(body.evidence_url);
  if (evidence === null) return { ok: false, error: 'invalid_evidence_url' };
  const page = cleanUrl(body.page_url);
  if (page === null) return { ok: false, error: 'invalid_page_url' };

  return {
    ok: true,
    slug,
    country_code: country,
    audience: body.audience === 'company' ? 'company' : body.audience === 'household' ? 'household' : '',
    issue_type: issueType,
    description,
    suggested: String(body.suggested ?? '').trim().slice(0, MAX.suggested),
    evidence_url: evidence,
    page_url: page,
    locale: String(body.locale ?? '').trim().toLowerCase().slice(0, MAX.locale),
    reporter_contact: contact,
  };
}

/** The reference a reporter is shown and can quote. */
export const newReference = () => `ir-${[...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)}`;

/** Validate an admin "resolve" body. */
export function validateResolution(body) {
  const id = String(body?.id ?? '').trim();
  if (!id) return { ok: false, error: 'id_required' };
  const status = String(body?.status ?? '').trim();
  if (!ISSUE_STATUSES.includes(status)) return { ok: false, error: 'invalid_status' };
  return { ok: true, id, status, note: String(body?.note ?? '').trim().slice(0, 500) };
}
