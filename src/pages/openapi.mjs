/**
 * /api/v1/openapi.json — an OpenAPI 3.1 description of the public endpoints,
 * and /api/v1/csv/startups-{cc}.csv — a free per-country CSV of PUBLIC
 * fields only.
 *
 * Every path and field below was read from the actual route table and
 * handler bodies in worker/index.js (grep `pathname === '/api` there to
 * check), not guessed. Two deliberate omissions, stated so nobody "fixes"
 * them back in:
 *
 *   - No paid-tier fields in the CSV. Public means the fields publicDataset()/
 *     publicStartups() in build.mjs already ship to a signed-out client —
 *     never application_url, procedure_steps or documents_required, which
 *     are the paid tier's application workflow.
 *   - No admin, billing, auth or enterprise-filing routes in the spec. This
 *     describes the endpoints a third-party developer is meant to call
 *     directly; session-cookie and Stripe-webhook routes are not a public
 *     API surface and documenting them here would invite exactly the wrong
 *     kind of integration.
 *
 * Kept in its own file per the multi-builder convention; build.mjs only
 * imports and calls in.
 */
import { effectiveStatus } from '../../packages/deadlines/index.js';

export function openApiSpec({ SITE_URL, STATS, STARTUP_STATS }) {
  const programme = {
    type: 'object',
    description:
      'A public household-benefit record. Showcase records (see free_rows below) are whole; every other record has locked: true with application_url, source_url, procedure_steps and documents_required removed.',
    properties: {
      slug: { type: 'string' },
      name_en: { type: 'string' },
      funder: { type: 'string' },
      category: { type: 'string' },
      benefit_type: { type: 'string' },
      amount_min: { type: ['number', 'null'] },
      amount_max: { type: ['number', 'null'] },
      amount_currency: { type: ['string', 'null'] },
      verification_status: { type: 'string', enum: ['verified', 'auto_extracted'] },
      last_verified_at: { type: 'string', format: 'date' },
      locked: { type: 'boolean' },
    },
    required: ['slug', 'name_en', 'funder'],
  };

  const startupProgramme = {
    type: 'object',
    description:
      'A public company/startup grant record. Free-rows are whole; every other record has application_url, procedure_steps and documents_required removed and locked: true.',
    properties: {
      slug: { type: 'string' },
      name_en: { type: 'string' },
      country_code: { type: 'string' },
      funder: { type: 'string' },
      grant_type: { type: 'string' },
      status: { type: 'string', enum: ['open', 'rolling', 'upcoming', 'closed', 'paused'] },
      closes_at: { type: ['string', 'null'], format: 'date' },
      amount_min: { type: ['number', 'null'] },
      amount_max: { type: ['number', 'null'] },
      amount_currency: { type: ['string', 'null'] },
      last_verified_at: { type: 'string', format: 'date' },
      locked: { type: 'boolean' },
    },
    required: ['slug', 'name_en', 'country_code'],
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Unclaimed — public API',
      version: '1.0.0',
      description: `The public, read-only surface of ${STATS.total} household benefit and ${STARTUP_STATS.total} company/startup grant records, across ${STATS.countryCount} countries and ${STARTUP_STATS.countryCount} jurisdictions. Free fields are described per schema below; the same data is also reachable through an MCP server at /mcp for any MCP-capable AI client — no key, no install.`,
      contact: { url: `${SITE_URL}/api/` },
      license: { name: 'Dataset terms', url: `${SITE_URL}/api/` },
    },
    servers: [{ url: SITE_URL }],
    tags: [
      { name: 'household', description: 'Individual and household benefits' },
      { name: 'startups', description: 'Company and startup grants' },
      { name: 'alerts', description: 'Deadline email alerts' },
      { name: 'mcp', description: 'The Model Context Protocol endpoint' },
    ],
    paths: {
      '/api/check': {
        post: {
          tags: ['household'],
          summary: 'Run the household eligibility check',
          description:
            'Matches a profile (country, age, income band, household, housing) against that country\'s dataset. Returns the eligible total and, for entitled callers, the named programme list; a signed-out or unentitled caller receives the total and a locked count only.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['country_code'],
                  properties: { country_code: { type: 'string', description: 'Two-letter country slug, e.g. "gb".' } },
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Match result',
              content: { 'application/json': { schema: { type: 'object', properties: { country: { type: 'string' }, currency: { type: 'string' }, total_min: { type: 'number' }, total_max: { type: 'number' } } } } },
            },
            400: { description: 'country_code required' },
          },
        },
      },
      '/api/startups/check': {
        post: {
          tags: ['startups'],
          summary: 'Run the company eligibility check',
          description:
            'Matches a company profile (country, stage, headcount, turnover) against every reachable jurisdiction\'s dataset (a company\'s own country plus EU and global pools where applicable).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['country_code'],
                  properties: { country_code: { type: 'string' } },
                  additionalProperties: true,
                },
              },
            },
          },
          responses: { 200: { description: 'Match result' }, 400: { description: 'country_code required' } },
        },
      },
      '/api/v1/countries.json': {
        get: {
          tags: ['household'],
          summary: 'Country index',
          description: 'Codes, currencies, regions, income bands and record counts for every household country.',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/v1/programmes/{cc}.json': {
        get: {
          tags: ['household'],
          summary: 'Every public household programme for one country',
          parameters: [{ name: 'cc', in: 'path', required: true, schema: { type: 'string' }, example: 'gb' }],
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { programmes: { type: 'array', items: programme } } } } },
            },
          },
        },
      },
      '/api/v1/stats.json': {
        get: { tags: ['household'], summary: 'Live dataset statistics', responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/startups/index.json': {
        get: { tags: ['startups'], summary: 'Jurisdiction/pool index for company grants', responses: { 200: { description: 'OK' } } },
      },
      '/api/v1/startups/{slug}.json': {
        get: {
          tags: ['startups'],
          summary: 'Every public company grant for one jurisdiction',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' }, example: 'gb' }],
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { programmes: { type: 'array', items: startupProgramme } } } } },
            },
          },
        },
      },
      '/api/v1/csv/startups-{cc}.csv': {
        get: {
          tags: ['startups'],
          summary: 'Free per-country CSV of public startup-grant fields',
          description:
            'PUBLIC fields only: slug, name, funder, country, grant_type, status, closes_at, page_url. Never application_url, documents_required or procedure_steps — those are the paid tier.',
          parameters: [{ name: 'cc', in: 'path', required: true, schema: { type: 'string' }, example: 'gb' }],
          responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } } },
        },
      },
      '/api/v1/mcp-tools.json': {
        get: { tags: ['mcp'], summary: 'MCP tool schemas (JSON Schema 2020-12)', responses: { 200: { description: 'OK' } } },
      },
      '/api/alerts/status': {
        get: {
          tags: ['alerts'],
          summary: 'Whether email alerts are configured on this deployment',
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { configured: { type: 'boolean' } } } } } } },
        },
      },
      '/api/alerts/subscribe': {
        post: {
          tags: ['alerts'],
          summary: 'Subscribe to deadline alerts (double opt-in)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'jurisdictions', 'audience'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    jurisdictions: { type: 'array', items: { type: 'string' } },
                    audience: { type: 'string', enum: ['companies', 'individuals'] },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Confirmation email sent' },
            503: { description: 'Email is not configured on this deployment' },
            429: { description: 'Rate limited' },
          },
        },
      },
      '/api/alerts/confirm': {
        get: {
          tags: ['alerts'],
          summary: 'Confirm a subscription (the link in the opt-in email)',
          parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Confirmed' } },
        },
      },
      '/api/alerts/unsubscribe': {
        get: {
          tags: ['alerts'],
          summary: 'Unsubscribe (the link in every alert email)',
          parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Unsubscribed' } },
        },
      },
      '/mcp': {
        post: {
          tags: ['mcp'],
          summary: 'MCP Streamable HTTP endpoint (spec 2025-06-18, 2025-03-26 also accepted)',
          description:
            'A stateless JSON-RPC 2.0 endpoint any MCP client can add by URL. Apart from report_issue, which only records a data-quality report, every tool is read-only: it can look up programmes, coverage and, for a signed-in caller with a bearer token, their own entitlement. It cannot sign anyone in, spend money, or submit an application. See /api/v1/mcp-tools.json for the exact tool schemas.',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'A JSON-RPC 2.0 request, e.g. {"method":"tools/list"}.' } } } },
          responses: { 200: { description: 'JSON-RPC 2.0 response' } },
        },
      },
    },
  };
}

/** CSV escaping per RFC 4180: quote a field that contains a comma, quote or newline. */
function csvField(v) {
  let s = String(v ?? '');
  /* A leading = + - @ makes Excel/Sheets treat a cell as a formula (CSV
     injection); prefix with ' as OWASP recommends. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * PUBLIC fields only: slug, name, funder, country, grant_type, status,
 * closes_at, page_url. Never application_url, documents_required or
 * procedure_steps — the paid tier's application workflow.
 */
export function startupCsv(programmes, { SITE_URL, asOf = Date.now() }) {
  const header = ['slug', 'name', 'funder', 'country', 'grant_type', 'status', 'closes_at', 'page_url'];
  const rows = programmes.map((p) =>
    [
      p.slug,
      p.name_en,
      p.funder,
      p.country_code,
      p.grant_type,
      effectiveStatus(p, asOf),
      p.closes_at ? String(p.closes_at).slice(0, 10) : '',
      `${SITE_URL}/startups/${p.country_code}/${p.slug}/`,
    ]
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
