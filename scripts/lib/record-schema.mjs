/**
 * What a record field is allowed to hold — one place, used by
 * scripts/apply-verification.mjs to decide whether a value coming out of a
 * verification patch (or a new record) may be written into data/.
 *
 * Two kinds of record, two vocabularies:
 *
 *   household  data/<cc>.json          docs/data-spec.md is the contract.
 *   company    data/startups/<cc>.json no written spec; the allowed values are
 *                                      the ones the data already uses, joined
 *                                      with the constants the engines read
 *                                      (packages/deadlines STATUS, the stage
 *                                      list in src/engine/startup.js, the SME
 *                                      bands in the same file). A value the
 *                                      data has never used and no engine knows
 *                                      is, for an enum, a typo until proved
 *                                      otherwise — and the engine would drop
 *                                      the record on it silently.
 *
 * A validator returns { ok: true, value } (value possibly normalised: trimmed
 * strings, de-duplicated and sorted months) or { ok: false, reason }. Nothing
 * here throws on bad input; a bad value is data to be reported, not a crash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATUS } from '../../packages/deadlines/index.js';

/* ------------------------------------------------------------------ */
/* Primitive validators                                                */
/* ------------------------------------------------------------------ */

const ok = (value) => ({ ok: true, value });
const no = (reason) => ({ ok: false, reason });

export const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const isHttpUrl = (v) => {
  if (typeof v !== 'string' || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname.includes('.');
  } catch {
    return false;
  }
};

const MAX_TEXT = 4000;

const str = ({ nullable = true, max = MAX_TEXT, min = 1 } = {}) => (v) => {
  if (v === null || v === undefined) return nullable ? ok(null) : no('must not be null');
  if (typeof v !== 'string') return no(`expected a string, got ${typeof v}`);
  const t = v.trim();
  if (!t) return nullable ? ok(null) : no('empty string');
  if (t.length < min) return no('too short');
  if (t.length > max) return no(`longer than ${max} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) return no('contains control characters');
  return ok(t);
};

const bool = (v) => (typeof v === 'boolean' ? ok(v) : no(`expected true/false, got ${JSON.stringify(v)}`));

const num = ({ nullable = true, min = 0, max = 1e13, int = false } = {}) => (v) => {
  if (v === null || v === undefined) return nullable ? ok(null) : no('must not be null');
  if (typeof v !== 'number' || !Number.isFinite(v)) return no(`expected a number, got ${JSON.stringify(v)}`);
  if (int && !Number.isInteger(v)) return no(`expected a whole number, got ${v}`);
  if (v < min) return no(`below ${min}`);
  if (v > max) return no(`above ${max}`);
  return ok(v);
};

const date = ({ nullable = true } = {}) => (v) => {
  if (v === null || v === undefined) return nullable ? ok(null) : no('must not be null');
  return isDate(v) ? ok(v) : no(`not a YYYY-MM-DD date: ${JSON.stringify(v)}`);
};

const url = ({ nullable = true } = {}) => (v) => {
  if (v === null || v === undefined || v === '') return nullable ? ok(null) : no('must not be null');
  return isHttpUrl(v) ? ok(v.trim()) : no(`not an http(s) URL: ${JSON.stringify(v)}`);
};

const oneOf = (set, { nullable = false } = {}) => (v) => {
  if (v === null || v === undefined) return nullable ? ok(null) : no('must not be null');
  return set.has(v) ? ok(v) : no(`${JSON.stringify(v)} is not one of: ${[...set].join(' | ')}`);
};

const subsetOf = (set, { allowAny = false } = {}) => (v) => {
  if (!Array.isArray(v)) return no('expected an array');
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string' || !(set.has(x) || (allowAny && x === 'any'))) {
      return no(`${JSON.stringify(x)} is not one of: ${[...set].join(' | ')}`);
    }
    if (!out.includes(x)) out.push(x);
  }
  return ok(out);
};

const strArray = (v) => {
  if (!Array.isArray(v)) return no('expected an array');
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string' || !x.trim()) return no('array entries must be non-empty strings');
    if (x.length > 200) return no('array entry too long');
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return ok(out);
};

const months = (v) => {
  if (!Array.isArray(v)) return no('expected an array');
  const out = [];
  for (const m of v) {
    if (!Number.isInteger(m) || m < 1 || m > 12) return no(`${JSON.stringify(m)} is not a month 1-12`);
    if (!out.includes(m)) out.push(m);
  }
  return ok(out.sort((a, b) => a - b));
};

const stepsList = (v) => {
  if (!Array.isArray(v)) return no('expected an array');
  const out = [];
  for (const [i, raw] of v.entries()) {
    /* A bare string is a step with no link — agents often write them that way. */
    const s = typeof raw === 'string' ? { detail: raw } : raw;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return no(`step ${i + 1} is not an object`);
    const detail = str({ nullable: false })(s.detail);
    if (!detail.ok) return no(`step ${i + 1} detail: ${detail.reason}`);
    const u = typeof s.url === 'string' && /^mailto:[^\s@]+@[^\s@]+$/.test(s.url) ? ok(s.url) : url()(s.url ?? null);
    if (!u.ok) return no(`step ${i + 1} url: ${u.reason}`);
    out.push({ step: i + 1, detail: detail.value, url: u.value });
  }
  return ok(out);
};

const docsList = (v) => {
  if (!Array.isArray(v)) return no('expected an array');
  const out = [];
  for (const [i, raw] of v.entries()) {
    const d = typeof raw === 'string' ? { doc: raw } : raw; // a bare string is a mandatory document with no note
    if (!d || typeof d !== 'object' || Array.isArray(d)) return no(`document ${i + 1} is not an object`);
    const doc = str({ nullable: false })(d.doc);
    if (!doc.ok) return no(`document ${i + 1} doc: ${doc.reason}`);
    const note = str()(d.note ?? null);
    if (!note.ok) return no(`document ${i + 1} note: ${note.reason}`);
    out.push({ doc: doc.value, mandatory: d.mandatory !== false, note: note.value });
  }
  return ok(out);
};

/* ------------------------------------------------------------------ */
/* Fixed vocabularies                                                  */
/* ------------------------------------------------------------------ */

const S = (...xs) => new Set(xs);

/** docs/data-spec.md, "Field vocabularies". */
export const HOUSEHOLD_VOCAB = Object.freeze({
  admin_level: S('national', 'region', 'state', 'city', 'private'),
  category: S('housing', 'income_support', 'health', 'transport', 'energy', 'education', 'family', 'employment', 'tax', 'business'),
  benefit_type: S('cash_monthly', 'cash_one_off', 'tax_credit', 'discount', 'in_kind', 'free_slab'),
  amount_period: S('weekly', 'fortnightly', 'monthly', 'annual', 'one_off'),
  application_channel: S('online', 'in_person', 'post', 'via_employer', 'automatic'),
  deadline_type: S('rolling', 'annual', 'window', 'none'),
  statuses: S('student', 'employee', 'self_employed', 'unemployed', 'retired', 'parent', 'jobseeker'),
  nationality: S('any', 'citizen_or_pr', 'any_resident', 'refugee_or_protected'),
  gender: S('any', 'female', 'male'),
  housing_tenure: S('renting', 'owner', 'hosted', 'student_housing', 'homeless'),
  verification_status: S('verified', 'auto_extracted', 'unverified'),
  income_test: S('numeric', 'unpublished', 'none'),
  income_confidence: S('high', 'medium', 'low'),
});

/** Company values the engines read, independent of what the data happens to use. */
export const COMPANY_FIXED = Object.freeze({
  status: S(...Object.values(STATUS)),
  deadline_type: S('rolling', 'annual_call', 'cutoff', 'closed', 'irregular'),
  grant_type: S('grant', 'loan', 'equity', 'in_kind', 'accelerator', 'prize', 'tax_credit', 'voucher'),
  cycle: S('continuous', 'annual', 'biannual', 'quarterly', 'irregular', 'one_off'),
  stages: S('idea', 'pre_seed', 'seed', 'series_a', 'growth'),
  sme_category: S('any', 'micro', 'small', 'medium'),
  verification_status: S('verified', 'unverified', 'auto_extracted'),
});

/* ------------------------------------------------------------------ */
/* Vocabulary derived from the data                                    */
/* ------------------------------------------------------------------ */

const NON_RECORD_FILES = new Set(['manifest.json', 'mcp-tools.json', 'fx-rates.json', 'dedupe-log.json', 'duplicate-allowlist.json', 'redirects.json']);

export function listDatasets(root) {
  const out = [];
  for (const [dir, kind] of [['data', 'household'], ['data/startups', 'company']]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      if (!f.endsWith('.json') || NON_RECORD_FILES.has(f)) continue;
      out.push({ kind, rel: `${dir}/${f}`, abs: path.join(abs, f) });
    }
  }
  return out;
}

/**
 * Company vocabularies = what the data already uses ∪ what the engines know.
 * `records` is every company record (parsed), passed in so the caller reads
 * the corpus once.
 */
export function deriveCompanyVocab(records) {
  const seen = {
    status: new Set(), deadline_type: new Set(), grant_type: new Set(), cycle: new Set(),
    admin_level: new Set(), funder_type: new Set(), application_channel: new Set(),
    sectors: new Set(), stages: new Set(), sme_category: new Set(), verification_status: new Set(),
  };
  for (const p of records) {
    for (const k of ['status', 'deadline_type', 'grant_type', 'cycle', 'admin_level', 'funder_type', 'application_channel', 'verification_status']) {
      if (typeof p[k] === 'string') seen[k].add(p[k]);
    }
    const e = p.eligibility || {};
    for (const s of e.sectors || []) if (typeof s === 'string') seen.sectors.add(s);
    for (const s of e.stages || []) if (typeof s === 'string') seen.stages.add(s);
    if (typeof e.sme_category === 'string') seen.sme_category.add(e.sme_category);
  }
  const join = (a, b) => new Set([...a, ...(b || [])]);
  return {
    status: join(seen.status, COMPANY_FIXED.status),
    deadline_type: join(seen.deadline_type, COMPANY_FIXED.deadline_type),
    grant_type: join(seen.grant_type, COMPANY_FIXED.grant_type),
    cycle: join(seen.cycle, COMPANY_FIXED.cycle),
    admin_level: seen.admin_level,
    funder_type: seen.funder_type,
    application_channel: seen.application_channel,
    sectors: seen.sectors,
    stages: join(seen.stages, COMPANY_FIXED.stages),
    sme_category: join(seen.sme_category, COMPANY_FIXED.sme_category),
    verification_status: join(seen.verification_status, COMPANY_FIXED.verification_status),
  };
}

/* ------------------------------------------------------------------ */
/* Field tables                                                        */
/* ------------------------------------------------------------------ */

const CUR = (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? ok(v) : no(`not a 3-letter currency code: ${JSON.stringify(v)}`));
const CUR_NULLABLE = (v) => (v === null || v === undefined ? ok(null) : CUR(v));

export function householdFields() {
  const V = HOUSEHOLD_VOCAB;
  return {
    top: {
      name_local: str({ max: 300 }),
      name_en: str({ nullable: false, max: 300 }),
      admin_level: oneOf(V.admin_level),
      admin_area: str({ max: 200 }),
      funder: str({ nullable: false, max: 300 }),
      category: oneOf(V.category),
      benefit_type: oneOf(V.benefit_type),
      amount_min: num(),
      amount_max: num(),
      amount_currency: CUR,
      amount_period: oneOf(V.amount_period, { nullable: true }),
      amount_note: str(),
      is_automatic: bool,
      application_url: url(),
      application_channel: oneOf(V.application_channel),
      deadline_type: oneOf(V.deadline_type),
      deadline_note: str(),
      procedure_steps: stepsList,
      documents_required: docsList,
      source_url: url({ nullable: false }),
      source_snippet: str({ max: 1200 }),
      last_verified_at: date({ nullable: false }),
      verification_status: oneOf(V.verification_status),
      income_reviewed_at: date(),
    },
    eligibility: {
      statuses: subsetOf(V.statuses),
      age_min: num({ max: 120 }),
      age_max: num({ max: 120 }),
      income_annual_max: num(),
      income_note: str(),
      requires_children: bool,
      requires_children_min: num({ int: true, min: 1, max: 20 }),
      nationality: oneOf(V.nationality),
      residency_months_min: num({ int: true, max: 1200 }),
      housing_tenure: oneOf(V.housing_tenure, { nullable: true }),
      student_required: bool,
      admin_areas: strArray,
      gender: oneOf(V.gender),
      income_test: oneOf(V.income_test, { nullable: true }),
      income_source_url: url(),
      income_confidence: oneOf(V.income_confidence, { nullable: true }),
      rule_source: str({ max: 200 }),
    },
  };
}

export function companyFields(vocab) {
  return {
    top: {
      name_local: str({ max: 300 }),
      name_en: str({ nullable: false, max: 300 }),
      category: oneOf(new Set(['startup'])),
      admin_level: oneOf(vocab.admin_level),
      admin_area: str({ max: 200 }),
      funder: str({ nullable: false, max: 300 }),
      funder_type: oneOf(vocab.funder_type),
      grant_type: oneOf(vocab.grant_type),
      amount_min: num(),
      amount_max: num(),
      amount_currency: CUR,
      amount_note: str(),
      cofunding_pct: num({ max: 100 }),
      is_automatic: bool,
      application_url: url(),
      application_channel: oneOf(vocab.application_channel),
      status: oneOf(vocab.status),
      deadline_type: oneOf(vocab.deadline_type),
      deadline_note: str(),
      opens_at: date(),
      closes_at: date(),
      reopen_note: str(),
      cycle: oneOf(vocab.cycle, { nullable: true }),
      typical_months: months,
      last_call_closed_at: date(),
      procedure_steps: stepsList,
      documents_required: docsList,
      source_url: url({ nullable: false }),
      source_snippet: str({ max: 1200 }),
      last_verified_at: date({ nullable: false }),
      verification_status: oneOf(vocab.verification_status),
    },
    eligibility: {
      entity: oneOf(new Set(['startup'])),
      company_age_months_min: num({ int: true, max: 2400 }),
      company_age_months_max: num({ int: true, max: 2400 }),
      headcount_min: num({ int: true, max: 1e7 }),
      headcount_max: num({ int: true, max: 1e7 }),
      turnover_annual_max: num(),
      turnover_annual_max_eur: num(),
      sme_category: oneOf(vocab.sme_category),
      sectors: subsetOf(vocab.sectors, { allowAny: true }),
      stages: subsetOf(vocab.stages),
      requires_local_entity: bool,
      requires_incorporation: bool,
      rd_focus: bool,
      female_founder_only: bool,
      underrepresented_focus: bool,
      de_minimis: bool,
      other_note: str(),
      requires_consortium: (v) => (v === null || v === undefined ? ok(null) : bool(v)),
    },
  };
}

/**
 * Words an agent used from the other record type's vocabulary that mean one
 * specific thing in this one. Anything not listed here is dropped, not guessed.
 * Keyed by kind, then by dotted field.
 */
export const VALUE_ALIASES = Object.freeze({
  household: {
    deadline_type: { annual_call: 'annual', cutoff: 'window' },
  },
  company: {
    deadline_type: { annual: 'annual_call', window: 'cutoff' },
  },
});

/** Fields a patch may never touch: identity. */
export const IMMUTABLE_TOP = new Set(['slug', 'country_code', 'eligibility', 'derived']);

/**
 * Fields whose absence on an add is filled with something other than null,
 * because null would change what the engine does with the record. Anything not
 * listed defaults to null, as the brief says.
 */
export const ADD_DEFAULTS = Object.freeze({
  household: {
    top: { is_automatic: false, procedure_steps: [], documents_required: [], verification_status: 'auto_extracted' },
    eligibility: { statuses: [], requires_children: false, student_required: false, admin_areas: [], gender: 'any' },
  },
  company: {
    top: { is_automatic: false, typical_months: [], procedure_steps: [], documents_required: [], verification_status: 'unverified' },
    eligibility: {
      entity: 'startup', sectors: ['any'], stages: [], sme_category: 'any', requires_local_entity: true,
      requires_incorporation: true, rd_focus: false, female_founder_only: false, underrepresented_focus: false, de_minimis: false,
    },
  },
});

/** Cross-field rules on a whole record. Returns [{fields:[...], reason}]. */
export function crossChecks(kind, rec) {
  const bad = [];
  const e = rec.eligibility || {};
  const lt = (a, b, fields, what) => {
    if (a != null && b != null && a > b) bad.push({ fields, reason: `${what}: ${a} > ${b}` });
  };
  lt(rec.amount_min, rec.amount_max, ['amount_min', 'amount_max'], 'amount_min above amount_max');
  if (kind === 'household') {
    lt(e.age_min, e.age_max, ['eligibility.age_min', 'eligibility.age_max'], 'age_min above age_max');
  } else {
    lt(e.headcount_min, e.headcount_max, ['eligibility.headcount_min', 'eligibility.headcount_max'], 'headcount_min above headcount_max');
    lt(e.company_age_months_min, e.company_age_months_max, ['eligibility.company_age_months_min', 'eligibility.company_age_months_max'], 'company age min above max');
    if (rec.opens_at && rec.closes_at && rec.opens_at > rec.closes_at) {
      bad.push({ fields: ['opens_at', 'closes_at'], reason: `opens_at ${rec.opens_at} is after closes_at ${rec.closes_at}` });
    }
  }
  return bad;
}
