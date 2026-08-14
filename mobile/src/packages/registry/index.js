/**
 * UNCLAIMED — company registry auto-fill.
 *
 * This is where startup grants beat personal benefits on automation, and the
 * reason is structural: a person's income is private, but a company's legal
 * identity is a matter of public record. Company number, incorporated-on,
 * registered address, SIC code, directors, filed accounts — all published, all
 * queryable, most of it free.
 *
 * So a grant form asking for eleven facts about the company can be filled from
 * one input: the company number. No credential, no scraping, no login.
 *
 * That distinction is the whole design. Every rail below reads a PUBLIC
 * register. None of them touches a company's own account on a government
 * portal, and none of them is used to submit anything. Consistent with
 * INVARIANTS in packages/policy: we never hold a government credential.
 *
 * Zero dependencies. `fetch` is injected so this runs in the Worker, in Node
 * and on device, and so the tests can run it without a network.
 */

/**
 * Public company registers, per country.
 *
 * `auth` records what it takes to call the thing, honestly:
 *   'none'    — open, no key
 *   'key'     — free API key, self-service
 *   'paid'    — commercial licence required
 *   'partner' — onboarding as an approved organisation
 *
 * A register we cannot actually reach is listed with `available: false` and
 * the reason, rather than omitted — the gap is useful information when
 * deciding which market to build depth in.
 */
export const REGISTRIES = {
  gb: {
    name: 'Companies House',
    available: true,
    auth: 'key',
    cost: 'Free',
    base: 'https://api.company-information.service.gov.uk',
    docs: 'https://developer.company-information.service.gov.uk/',
    id_label: 'Company number',
    id_pattern: /^[A-Z0-9]{8}$/i,
    provides: ['legal_name', 'incorporation_date', 'registered_address', 'sic_codes', 'company_status', 'officers', 'accounts'],
    note: 'The most complete free company API in any market. Basic auth with the API key as username and an empty password.',
  },
  fr: {
    name: 'API Recherche d\'entreprises / SIRENE (INSEE)',
    available: true,
    auth: 'none',
    cost: 'Free',
    base: 'https://recherche-entreprises.api.gouv.fr',
    docs: 'https://recherche-entreprises.api.gouv.fr/docs',
    id_label: 'SIREN',
    id_pattern: /^\d{9}$/,
    provides: ['legal_name', 'incorporation_date', 'registered_address', 'naf_code', 'headcount_band', 'company_status'],
    note: 'Open, no key. Returns the tranche d\'effectif rather than an exact headcount — a band, and must be shown as one.',
  },
  us: {
    name: 'SAM.gov Entity Management',
    available: true,
    auth: 'key',
    cost: 'Free',
    base: 'https://api.sam.gov/entity-information/v3/entities',
    docs: 'https://open.gsa.gov/api/entity-api/',
    id_label: 'UEI',
    id_pattern: /^[A-Z0-9]{12}$/i,
    provides: ['legal_name', 'registered_address', 'naics_codes', 'cage_code', 'registration_status', 'expiry_date'],
    note: 'SAM registration is the practical gate for every federal award, and it EXPIRES ANNUALLY. Surfacing that expiry date is worth more to a founder than any other field here.',
  },
  in: {
    name: 'MCA21 / DigiLocker corporate documents',
    available: true,
    auth: 'partner',
    cost: 'Free at point of use',
    base: null,
    docs: 'https://www.mca.gov.in/',
    id_label: 'CIN',
    id_pattern: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i,
    provides: ['legal_name', 'incorporation_date', 'registered_address', 'company_status'],
    note: 'The CIN itself encodes listing status, industry, state, year and registration number — parseable offline without any API call. DPIIT recognition is the separate gate for most Indian schemes.',
  },
  global: {
    name: 'OpenCorporates',
    available: true,
    auth: 'paid',
    cost: 'Commercial licence',
    base: 'https://api.opencorporates.com/v0.4',
    docs: 'https://api.opencorporates.com/documentation/API-Reference',
    id_label: 'Jurisdiction + company number',
    id_pattern: null,
    provides: ['legal_name', 'incorporation_date', 'registered_address', 'company_status'],
    note: 'Broadest coverage by far, but the open tier was withdrawn — treat as a paid fallback for jurisdictions with no national API rather than the primary rail.',
  },
  de: {
    name: 'Unternehmensregister / Handelsregister',
    available: false,
    auth: 'paid',
    cost: 'Per-document fee',
    base: null,
    docs: 'https://www.unternehmensregister.de/',
    id_label: 'HRB number',
    id_pattern: null,
    provides: [],
    note: 'No free structured API. Data is published but access is document-by-document and fee-bearing. German auto-fill needs manual entry or a commercial provider — say so rather than implying parity with the UK.',
  },
};

export function registryFor(cc) {
  return REGISTRIES[String(cc || '').toLowerCase()] ?? null;
}

/** Countries where one identifier genuinely fills most of a form. */
export function autofillAvailable(cc) {
  const r = registryFor(cc);
  return !!r && r.available === true;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Registry responses are shaped nothing like each other. Everything is
 * normalised onto this vocabulary, which is also what the grant field
 * projector consumes — so adding a country means writing one adapter, not
 * touching the form logic.
 */
export const COMPANY_FIELDS = Object.freeze([
  'legal_name',
  'trading_name',
  'company_number',
  'incorporation_date',
  'company_status',
  'registered_address',
  'country_code',
  'industry_code',
  'industry_description',
  'headcount',
  'headcount_band',
  'officers',
  'vat_number',
  'registration_expires_at',
]);

const clean = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s ?? null);

/** Companies House → canonical. */
export function fromCompaniesHouse(res) {
  if (!res) return {};
  const a = res.registered_office_address || {};
  return {
    legal_name: clean(res.company_name),
    company_number: clean(res.company_number),
    incorporation_date: res.date_of_creation ?? null,
    company_status: clean(res.company_status),
    registered_address: [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code]
      .filter(Boolean)
      .join(', ') || null,
    country_code: 'gb',
    industry_code: res.sic_codes?.[0] ?? null,
    industry_description: null,
    source: 'Companies House',
  };
}

/** API Recherche d'entreprises → canonical. */
export function fromSirene(res) {
  const u = res?.results?.[0] ?? res;
  if (!u) return {};
  const s = u.siege || {};
  return {
    legal_name: clean(u.nom_raison_sociale || u.nom_complet),
    company_number: clean(u.siren),
    incorporation_date: u.date_creation ?? null,
    company_status: u.etat_administratif === 'A' ? 'active' : clean(u.etat_administratif),
    registered_address: clean(s.adresse || s.geo_adresse) ?? null,
    country_code: 'fr',
    industry_code: clean(u.activite_principale),
    industry_description: clean(u.libelle_activite_principale),
    /* INSEE publishes a band, never a number. Recording the band as a
       headcount would be a fabrication, so it stays a band. */
    headcount_band: clean(u.tranche_effectif_salarie) ?? null,
    headcount: null,
    source: "API Recherche d'entreprises (INSEE)",
  };
}

/** SAM.gov → canonical. */
export function fromSamGov(res) {
  const e = res?.entityData?.[0] ?? res;
  if (!e) return {};
  const reg = e.entityRegistration || {};
  const core = e.coreData || {};
  const a = core.physicalAddress || {};
  return {
    legal_name: clean(reg.legalBusinessName),
    trading_name: clean(reg.dbaName),
    company_number: clean(reg.ueiSAM),
    company_status: clean(reg.registrationStatus),
    registered_address: [a.addressLine1, a.city, a.stateOrProvinceCode, a.zipCode].filter(Boolean).join(', ') || null,
    country_code: 'us',
    industry_code: core.naicsList?.[0]?.naicsCode ?? null,
    /* The field that actually saves someone a lost fortnight. */
    registration_expires_at: reg.registrationExpirationDate ?? null,
    source: 'SAM.gov',
  };
}

/**
 * An Indian CIN encodes five facts. No API call, no key, no network — the
 * identifier itself is structured, so this is free auto-fill.
 *
 *   L / U      listed or unlisted
 *   5 digits   industry code
 *   2 letters  state
 *   4 digits   year of incorporation
 *   3 letters  ownership class (PTC, PLC, OPC …)
 *   6 digits   registration number
 */
export function parseCIN(cin) {
  const s = String(cin || '').toUpperCase().trim();
  if (!REGISTRIES.in.id_pattern.test(s)) return null;
  return {
    company_number: s,
    listed: s[0] === 'L',
    industry_code: s.slice(1, 6),
    state_code: s.slice(6, 8),
    incorporation_year: Number(s.slice(8, 12)),
    ownership_class: s.slice(12, 15),
    registration_number: s.slice(15, 21),
    country_code: 'in',
    source: 'CIN structure (MCA)',
  };
}

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Look a company up in its national register.
 *
 * `fetchImpl` is injected. Keys are passed in per call and never stored —
 * these are OUR service keys, not the user's credentials, and they belong in
 * Worker secrets.
 */
export async function lookupCompany({ countryCode, identifier, fetchImpl, keys = {} }) {
  const cc = String(countryCode || '').toLowerCase();
  const reg = registryFor(cc);

  if (!reg) return { ok: false, reason: 'no_registry_for_country', country: cc };
  if (!reg.available) return { ok: false, reason: 'registry_not_machine_readable', registry: reg };

  const id = String(identifier || '').trim();
  if (reg.id_pattern && !reg.id_pattern.test(id)) {
    return { ok: false, reason: 'malformed_identifier', expected: reg.id_label, registry: reg };
  }

  /* India needs no call at all. */
  if (cc === 'in') {
    const parsed = parseCIN(id);
    return parsed
      ? { ok: true, offline: true, company: parsed, registry: reg }
      : { ok: false, reason: 'malformed_identifier', expected: reg.id_label, registry: reg };
  }

  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no_fetch_provided' };

  try {
    let res;
    if (cc === 'gb') {
      const auth = typeof btoa === 'function' ? btoa(`${keys.companiesHouse}:`) : '';
      res = await fetchImpl(`${reg.base}/company/${encodeURIComponent(id)}`, {
        headers: { authorization: `Basic ${auth}` },
      });
      if (!res.ok) return { ok: false, reason: `registry_http_${res.status}`, registry: reg };
      return { ok: true, company: fromCompaniesHouse(await res.json()), registry: reg };
    }

    if (cc === 'fr') {
      res = await fetchImpl(`${reg.base}/search?q=${encodeURIComponent(id)}&page=1&per_page=1`);
      if (!res.ok) return { ok: false, reason: `registry_http_${res.status}`, registry: reg };
      return { ok: true, company: fromSirene(await res.json()), registry: reg };
    }

    if (cc === 'us') {
      res = await fetchImpl(`${reg.base}?ueiSAM=${encodeURIComponent(id)}&api_key=${keys.samGov ?? ''}`);
      if (!res.ok) return { ok: false, reason: `registry_http_${res.status}`, registry: reg };
      return { ok: true, company: fromSamGov(await res.json()), registry: reg };
    }

    return { ok: false, reason: 'adapter_not_implemented', registry: reg };
  } catch (err) {
    return { ok: false, reason: 'registry_unreachable', detail: String(err?.message ?? err), registry: reg };
  }
}

/* ------------------------------------------------------------------ */
/* Projection onto a grant application                                 */
/* ------------------------------------------------------------------ */

/**
 * Fill what the register knows, list what it cannot.
 *
 * The second half is the honest part. A register supplies legal identity; it
 * has nothing to say about your R&D plan, your milestones or your
 * co-financing. Showing "9 of 14 fields filled, here are the 5 only you can
 * answer" is a truthful and much more useful claim than "auto-apply".
 */
export function projectCompany({ company, programme, profile = {} }) {
  const filled = {};
  const source = {};

  const put = (field, value, from) => {
    if (value == null || value === '') return;
    filled[field] = value;
    source[field] = from;
  };

  put('legal_name', company?.legal_name, company?.source);
  put('trading_name', company?.trading_name, company?.source);
  put('company_number', company?.company_number, company?.source);
  put('incorporation_date', company?.incorporation_date, company?.source);
  put('registered_address', company?.registered_address, company?.source);
  put('company_status', company?.company_status, company?.source);
  put('industry_code', company?.industry_code, company?.source);
  put('industry_description', company?.industry_description, company?.source);
  put('registration_expires_at', company?.registration_expires_at, company?.source);
  put('headcount_band', company?.headcount_band, company?.source);

  /* Profile answers the founder gave us fill the rest. */
  for (const f of ['headcount', 'turnover_annual_eur', 'stage', 'sectors', 'rd_active', 'vat_number']) {
    put(f, profile[f], 'You told us');
  }

  /* What no register can supply. Named explicitly so the UI can ask. */
  const NARRATIVE = [
    { field: 'project_summary', label: 'What you are building, in plain terms' },
    { field: 'innovation_claim', label: 'What is genuinely new about it' },
    { field: 'work_plan', label: 'Work packages and milestones' },
    { field: 'budget_breakdown', label: 'Budget by cost category' },
    { field: 'cofunding_source', label: 'Where your share of the funding comes from' },
    { field: 'team_cvs', label: 'Team CVs and relevant track record' },
    { field: 'market_evidence', label: 'Evidence of the market and route to it' },
  ];

  const needsNarrative = NARRATIVE.filter((n) => profile[n.field] == null);
  const required = (programme?.documents_required || []).map((d) => d.doc);

  return {
    filled,
    source,
    filled_count: Object.keys(filled).length,
    /* Facts we could not get and the founder must supply. */
    needs_narrative: needsNarrative,
    documents_required: required,
    autofilled_from_registry: Object.entries(source).filter(([, v]) => v !== 'You told us').length,
    honest_summary:
      `${Object.entries(source).filter(([, v]) => v !== 'You told us').length} fields filled from the public register, ` +
      `${needsNarrative.length} that only you can write.`,
  };
}
