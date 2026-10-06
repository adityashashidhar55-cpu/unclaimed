#!/usr/bin/env node
/**
 * Apply the output of the verification run to data/.
 *
 * Inputs (default /home/claude/verify, override with --verify-dir):
 *
 *   patches/<batch>.json  {"batch", "results":[{slug, file, action, set, ...}]}
 *   reviews/<batch>.json  {"reject_slugs":[...]}   the supervisor's veto
 *   adds/<batch>.json     {"adds":[{file, record}]}  records the data lacks
 *
 * What it does, in order, and why:
 *
 *   1. Drops every result and every add whose slug a supervisor rejected.
 *   2. Validates every value against the vocabularies (docs/data-spec.md for
 *      household records; for company records, the values the data already
 *      uses joined with what the engines read — scripts/lib/record-schema.mjs).
 *      A value that does not validate is DROPPED, not coerced, and listed in
 *      the report. The rest of that result still applies: one bad field on a
 *      record the agent otherwise got right should not throw the record away.
 *   3. Applies `set` — top-level keys, and "eligibility.<field>" for the
 *      nested ones — to the record in the file named, preserving that file's
 *      own serialisation (some data/startups files are single-line JSON, some
 *      indent by one space, some by two; scripts/lib/json-io.mjs).
 *   4. "retired" additionally guarantees the marker the engines read: a
 *      company record ends up status "closed" + deadline_type "closed"; a
 *      household record's deadline_note starts "Ended:" (matcher.js
 *      isEndedScheme reads it). Nothing is deleted — a retired scheme keeps
 *      its page and says so.
 *   5. Appends adds: skipped when the slug already exists, or when the
 *      normalised name + funder matches an existing record (company records
 *      also use the duplicate finder's name-similarity rule). Every add gets
 *      every field the file's records have; a field the agent did not supply
 *      is null — or, where null would change what the engine does with the
 *      record (arrays, booleans, gender, sme_category), the neutral value
 *      listed in ADD_DEFAULTS.
 *   6. Writes the report and, unless --dry-run, regenerates the derived
 *      counts (scripts/regen-counts.mjs) and the region vocabulary
 *      (scripts/gen-manifest.mjs).
 *
 * Idempotent: a second run over the same inputs changes no byte of data/ —
 * set is a pure overwrite, and adds are skipped as duplicates of themselves.
 *
 *   node scripts/apply-verification.mjs                # apply
 *   node scripts/apply-verification.mjs --dry-run      # report only
 *
 * Options: --verify-dir <dir>  --root <repo>  --report <file>
 *          --stamp-date YYYY-MM-DD  --no-regen
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/json-io.mjs';
import {
  listDatasets, deriveCompanyVocab, householdFields, companyFields,
  IMMUTABLE_TOP, ADD_DEFAULTS, VALUE_ALIASES, crossChecks,
} from './lib/record-schema.mjs';
import { jaccard, normaliseFunder, urlPath, loadAllowlist, isAllowlisted } from './find-duplicates.mjs';
import { isVagueSource } from './harvest-sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ACTIONS = ['confirmed', 'updated', 'retired', 'unverifiable'];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };

const normName = (s) => String(s ?? '')
  .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const relFile = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^.*?\/((?:data)\/(?:startups\/)?[a-z0-9-]+\.json)$/i, '$1');

function readJsonSafe(file, problems) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${file}: ${err.message}`);
    return null;
  }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

/**
 * turnover_annual_max_eur is derived, never typed: the startup engine compares
 * a EUR profile figure against it, and scripts/verify.mjs asserts it equals the
 * local ceiling divided by data/fx-rates.json. So whenever a patch moves the
 * ceiling or the record's currency, the sibling is recomputed here. Returns
 * undefined when there is no rate for the currency (the caller then refuses
 * the new ceiling rather than leave a sibling that disagrees with it).
 */
export function derivedTurnoverEur(rec, docCurrency, fx) {
  const e = rec.eligibility || {};
  if (e.turnover_annual_max == null) return null;
  const cur = e.turnover_annual_max_currency || rec.amount_currency || docCurrency || 'EUR';
  const rate = fx?.units_per_eur?.[cur];
  return rate ? Math.round(e.turnover_annual_max / rate) : undefined;
}

/**
 * Two geography invariants the repo's tests hold (scripts/test-eligibility.mjs,
 * scripts/verify.mjs), applied to a household record the run has just changed
 * or added, so a patch cannot quietly break them:
 *   - a record's own `admin_area` is a member of `eligibility.admin_areas`
 *     (the list the matcher gates on; the label alone gates nothing);
 *   - a sub-national record with no area at all is flagged
 *     rule_source "geography_unknown", which routes it to "needs one more
 *     answer" instead of offering it to the whole country.
 * Returns a list of what it did, for the report.
 */
export function foldGeography(rec) {
  const done = [];
  const e = (rec.eligibility ??= {});
  const areas = Array.isArray(e.admin_areas) ? e.admin_areas : (e.admin_areas = []);
  const label = typeof rec.admin_area === 'string' ? rec.admin_area.trim() : '';
  if (label && !areas.includes(label)) { areas.push(label); done.push(`admin_areas += "${label}"`); }
  const subNational = rec.admin_level && rec.admin_level !== 'national' && rec.admin_level !== 'private';
  if (subNational && areas.length === 0 && e.rule_source !== 'geography_unknown') {
    e.rule_source = 'geography_unknown';
    done.push('rule_source = geography_unknown');
  }
  return done;
}

/**
 * scripts/test-amounts.mjs holds that an automatic record says so in its steps
 * ("No application needed" is written down, not left blank). A patch that
 * turns is_automatic on, or an add that arrives with it on and no steps, gets
 * the one sentence the repo already uses on 108 records. Returns true if it
 * added the step.
 */
export const AUTOMATIC_STEP = 'No application needed — this is paid automatically to everyone who qualifies. Check that the authority holds your current address and bank details; a missing detail is the usual reason an automatic payment does not arrive.';
export function ensureAutomaticRoute(rec) {
  if (rec.is_automatic !== true) return false;
  if ((rec.procedure_steps || []).length || (rec.documents_required || []).length) return false;
  rec.procedure_steps = [{ step: 1, detail: AUTOMATIC_STEP, url: rec.application_url ?? rec.source_url ?? null }];
  return true;
}

/**
 * The duplicate finder's rule (scripts/find-duplicates.mjs), run over the
 * in-memory company files this run changed: same funder with near-identical
 * names, or one specific source page cited by two records. Pairs not already
 * on the allowlist are "introduced" — and scripts/test-duplicates.mjs would fail
 * on every one of them.
 */
function introducedDuplicates(entries, allowlist) {
  const out = [];
  for (const entry of entries) {
    const list = entry.doc.data.programmes;
    const country = path.basename(entry.rel, '.json');
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]; const b = list[j];
        const nameSim = jaccard(a.name_en, b.name_en);
        const fa = normaliseFunder(a.funder);
        const sameFunder = fa !== '' && fa === normaliseFunder(b.funder);
        const pa = urlPath(a.source_url);
        const sameSource = pa !== null && pa === urlPath(b.source_url) && !isVagueSource(a.source_url) && !isVagueSource(b.source_url) && nameSim >= 0.3;
        const reason = sameFunder && nameSim >= 0.7 ? `same funder, name similarity ${nameSim.toFixed(2)}` : sameSource ? `identical (specific) source_url, name similarity ${nameSim.toFixed(2)}` : null;
        if (!reason) continue;
        const pair = { country, a: a.slug, b: b.slug, a_name: a.name_en, b_name: b.name_en, reason, nameSim };
        if (!isAllowlisted(pair, allowlist)) out.push(pair);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Core                                                                */
/* ------------------------------------------------------------------ */

export function applyVerification(opts = {}) {
  const root = path.resolve(opts.root ?? REPO);
  const verifyDir = path.resolve(opts.verifyDir ?? '/home/claude/verify');
  const dryRun = !!opts.dryRun;
  const stampDate = opts.stampDate ?? '2026-10-05';
  const problems = []; // unreadable inputs
  const fxPath = path.join(root, 'data/fx-rates.json');
  const fx = fs.existsSync(fxPath) ? JSON.parse(fs.readFileSync(fxPath, 'utf8')) : null;

  /* ---- load data ---- */
  const docs = new Map(); // rel path -> {kind, doc, byslug, changed}
  for (const d of listDatasets(root)) {
    const doc = readJson(d.abs);
    if (!Array.isArray(doc.data.programmes)) continue;
    docs.set(d.rel, { kind: d.kind, doc, rel: d.rel, changed: false, added: 0 });
  }
  const companyRecords = [...docs.values()].filter((d) => d.kind === 'company').flatMap((d) => d.doc.data.programmes);
  const FIELDS = { household: householdFields(), company: companyFields(deriveCompanyVocab(companyRecords)) };

  const indexOf = (entry) => {
    if (!entry.byslug) entry.byslug = new Map(entry.doc.data.programmes.map((p, i) => [p.slug, i]));
    return entry.byslug;
  };
  /** slug -> [{entry, i}] across every file of a kind, for results whose `file` is wrong. */
  const globalSlug = { household: new Map(), company: new Map() };
  for (const entry of docs.values()) {
    for (const p of entry.doc.data.programmes) {
      const m = globalSlug[entry.kind];
      if (!m.has(p.slug)) m.set(p.slug, []);
      m.get(p.slug).push(entry);
    }
  }

  /* ---- load inputs ---- */
  const patchFiles = listJson(path.join(verifyDir, 'patches'));
  const reviewFiles = listJson(path.join(verifyDir, 'reviews'));
  const addFiles = listJson(path.join(verifyDir, 'adds'));

  const rejects = new Map(); // batch -> Set(slug)
  let rejectedListed = 0;
  for (const f of reviewFiles) {
    const j = readJsonSafe(f, problems);
    if (!j) continue;
    const batch = j.batch || path.basename(f, '.json');
    const set = rejects.get(batch) ?? new Set();
    for (const s of j.reject_slugs || []) { set.add(String(s)); rejectedListed += 1; }
    rejects.set(batch, set);
  }
  const knownBatches = new Set([
    ...patchFiles.map((f) => path.basename(f, '.json')),
    ...addFiles.map((f) => path.basename(f, '.json')),
  ]);
  /* A review whose name matches no patch or add file still means what it
     says about those slugs: apply it to every batch rather than lose the veto. */
  const globalRejects = new Set();
  for (const [batch, set] of rejects) if (!knownBatches.has(batch)) for (const s of set) globalRejects.add(s);
  const isRejected = (batch, slug) => !!(rejects.get(batch)?.has(slug) || globalRejects.has(slug));

  const stats = {
    dryRun,
    batches: { patches: patchFiles.length, reviews: reviewFiles.length, adds: addFiles.length },
    results: 0,
    byAction: {},
    byFile: {},
    appliedFields: 0,
    unchangedNoOp: 0,
    rejected: [],
    invalid: [],
    unresolved: [],
    conflicts: [],
    retireEnforced: [],
    stamped: 0,
    normalised: [],
    adds: { seen: 0, added: 0, byFile: {}, skippedDuplicate: [], skippedRejected: [], invalid: [], defaulted: 0, unknownFile: [] },
    problems,
    recordsChanged: new Set(),
  };
  const fileStat = (rel) => (stats.byFile[rel] ??= { results: 0, changed: 0, fields: 0, retired: 0, added: 0 });

  /* ---------------- patches ---------------- */
  const touched = new Map(); // `${rel}#${slug}` -> batch (conflict detection)

  for (const pf of patchFiles) {
    const j = readJsonSafe(pf, problems);
    if (!j) continue;
    const batch = j.batch || path.basename(pf, '.json');
    if (!Array.isArray(j.results)) { problems.push(`${pf}: no results array`); continue; }

    for (const r of j.results) {
      stats.results += 1;
      const slug = String(r?.slug ?? '');
      const action = String(r?.action ?? '');
      bump(stats.byAction, ACTIONS.includes(action) ? action : `invalid:${action || 'missing'}`);

      if (!slug || !ACTIONS.includes(action)) {
        stats.unresolved.push({ batch, slug, reason: `bad result (action ${JSON.stringify(r?.action)})` });
        continue;
      }
      if (isRejected(batch, slug)) {
        stats.rejected.push({ batch, slug, action, kind: 'patch' });
        continue;
      }

      /* Locate the record: the named file first, then the slug anywhere (one
         unambiguous home) — agents were handed `_file`, but a wrong path should
         not lose a verified record. */
      let entry = docs.get(relFile(r.file));
      let idx = entry ? indexOf(entry).get(slug) : undefined;
      if (idx === undefined) {
        const homes = [...new Set([...globalSlug.household.get(slug) ?? [], ...globalSlug.company.get(slug) ?? []])];
        if (homes.length === 1) { entry = homes[0]; idx = indexOf(entry).get(slug); } else entry = undefined;
      }
      if (!entry || idx === undefined) {
        stats.unresolved.push({ batch, slug, file: r.file, reason: 'record not found' });
        continue;
      }
      fileStat(entry.rel).results += 1;

      if (action === 'unverifiable') continue; // by definition: no change

      const key = `${entry.rel}#${slug}`;
      if (touched.has(key)) stats.conflicts.push({ slug, file: entry.rel, batches: [touched.get(key), batch], resolution: 'later batch overwrote' });
      touched.set(key, batch);

      const original = entry.doc.data.programmes[idx];
      const next = clone(original);
      const table = FIELDS[entry.kind];
      const set = r.set && typeof r.set === 'object' && !Array.isArray(r.set) ? r.set : {};
      const accepted = []; // [dottedKey, value]

      for (const [k, raw] of Object.entries(set)) {
        const isElig = k.startsWith('eligibility.');
        const field = isElig ? k.slice('eligibility.'.length) : k;
        const validator = isElig ? table.eligibility[field] : table.top[field];
        if (!isElig && IMMUTABLE_TOP.has(field)) {
          stats.invalid.push({ batch, slug, file: entry.rel, field: k, value: raw, reason: 'identity field, never patched' });
          continue;
        }
        if (!validator) {
          stats.invalid.push({ batch, slug, file: entry.rel, field: k, value: raw, reason: 'not a field of this record type' });
          continue;
        }
        const alias = VALUE_ALIASES[entry.kind]?.[k]?.[raw];
        const v = validator(alias ?? raw);
        if (alias !== undefined && v.ok) stats.normalised.push({ batch, slug, field: k, from: raw, to: alias });
        if (!v.ok) {
          stats.invalid.push({ batch, slug, file: entry.rel, field: k, value: raw, reason: v.reason });
          continue;
        }
        accepted.push([k, v.value]);
      }

      const put = (rec, k, v) => {
        if (k.startsWith('eligibility.')) { rec.eligibility ??= {}; rec.eligibility[k.slice(12)] = v; } else rec[k] = v;
      };
      for (const [k, v] of accepted) put(next, k, v);

      /* Cross-field rules: only violations this patch introduced count. */
      const before = new Set(crossChecks(entry.kind, original).map((c) => c.reason));
      for (const c of crossChecks(entry.kind, next)) {
        if (before.has(c.reason)) continue;
        for (const f of c.fields) {
          const old = f.startsWith('eligibility.') ? original.eligibility?.[f.slice(12)] : original[f];
          put(next, f, old === undefined ? null : old);
          if (accepted.some(([ak]) => ak === f)) {
            stats.invalid.push({ batch, slug, file: entry.rel, field: f, value: set[f], reason: `rolled back — ${c.reason}` });
          }
        }
      }

      if (ensureAutomaticRoute(next)) stats.normalised.push({ batch, slug, field: 'procedure_steps', from: '', to: 'standard "No application needed" step' });

      if (entry.kind === 'household') {
        for (const what of foldGeography(next)) {
          if (!same(original.eligibility?.admin_areas, next.eligibility.admin_areas) || original.eligibility?.rule_source !== next.eligibility.rule_source) {
            stats.normalised.push({ batch, slug, field: 'geography', from: '', to: what });
          }
        }
      }

      if (entry.kind === 'company' && fx) {
        const eur = derivedTurnoverEur(next, entry.doc.data.currency, fx);
        if (eur === undefined) {
          /* No rate for this currency: keep the old ceiling and its sibling. */
          next.eligibility.turnover_annual_max = original.eligibility?.turnover_annual_max ?? null;
          if (accepted.some(([k]) => k === 'eligibility.turnover_annual_max')) {
            stats.invalid.push({ batch, slug, file: entry.rel, field: 'eligibility.turnover_annual_max', value: set['eligibility.turnover_annual_max'], reason: `rolled back — no rate for ${next.amount_currency} in data/fx-rates.json` });
          }
        } else if ('turnover_annual_max_eur' in (next.eligibility || {}) || eur !== null) {
          next.eligibility.turnover_annual_max_eur = eur;
        }
      }

      /* A confirmed, updated or retired record was read against the official
         page: say so, whatever the patch forgot to set. */
      if (!accepted.some(([k]) => k === 'last_verified_at')) {
        if (next.last_verified_at !== stampDate) stats.stamped += 1;
        next.last_verified_at = stampDate;
      }
      if (!accepted.some(([k]) => k === 'verification_status')) next.verification_status = 'verified';

      if (action === 'retired') {
        const notes = [];
        if (entry.kind === 'company') {
          if (next.status !== 'closed') { next.status = 'closed'; notes.push('status'); }
          if (next.deadline_type !== 'closed') { next.deadline_type = 'closed'; notes.push('deadline_type'); }
        } else if (!/^\s*Ended\b/i.test(next.deadline_note ?? '')) {
          next.deadline_note = next.deadline_note ? `Ended: ${next.deadline_note}` : 'Ended: this scheme is no longer offered by the funder.';
          notes.push('deadline_note');
        }
        if (notes.length) stats.retireEnforced.push({ slug, file: entry.rel, enforced: notes });
        fileStat(entry.rel).retired += 1;
      }

      if (same(original, next)) { stats.unchangedNoOp += 1; continue; }
      entry.doc.data.programmes[idx] = next;
      entry.changed = true;
      stats.recordsChanged.add(key);
      fileStat(entry.rel).changed += 1;
      const nFields = accepted.filter(([k, v]) => {
        const o = k.startsWith('eligibility.') ? original.eligibility?.[k.slice(12)] : original[k];
        return !same(o, v);
      }).length;
      fileStat(entry.rel).fields += nFields;
      stats.appliedFields += nFields;
    }
  }

  /* ---------------- adds ---------------- */
  const seenSlug = { household: new Set(), company: new Set() };
  const seenName = { household: new Set(), company: new Set() };
  const keyOf = (p) => `${normName(p.name_en)}|${normaliseFunder(p.funder)}`;
  for (const entry of docs.values()) {
    for (const p of entry.doc.data.programmes) {
      seenSlug[entry.kind].add(p.slug);
      seenName[entry.kind].add(keyOf(p));
    }
  }

  /** Field template per kind: the keys at least half the records have, in the order of the commonest shape. */
  const templates = {};
  for (const kind of ['household', 'company']) {
    const all = [...docs.values()].filter((d) => d.kind === kind).flatMap((d) => d.doc.data.programmes);
    const topCount = {}; const eCount = {};
    for (const p of all) {
      for (const k of Object.keys(p)) bump(topCount, k);
      for (const k of Object.keys(p.eligibility || {})) bump(eCount, k);
    }
    const exemplar = all.reduce((best, p) => (Object.keys(p).length > Object.keys(best).length ? p : best), all[0] ?? {});
    const order = (counts, ex) => {
      const keys = Object.keys(counts).filter((k) => counts[k] >= all.length / 2);
      const ranked = Object.keys(ex).filter((k) => keys.includes(k));
      return [...ranked, ...keys.filter((k) => !ranked.includes(k))];
    };
    templates[kind] = { top: order(topCount, exemplar), eligibility: order(eCount, exemplar.eligibility || {}) };
  }

  for (const af of addFiles) {
    const j = readJsonSafe(af, problems);
    if (!j) continue;
    const batch = j.batch || path.basename(af, '.json');
    if (!Array.isArray(j.adds)) { problems.push(`${af}: no adds array`); continue; }

    for (const a of j.adds) {
      stats.adds.seen += 1;
      const rec = a?.record;
      const slug = String(rec?.slug ?? '');
      const entry = docs.get(relFile(a?.file));
      if (!entry) { stats.adds.unknownFile.push({ batch, slug, file: a?.file }); continue; }
      if (!rec || typeof rec !== 'object') { stats.adds.invalid.push({ batch, slug, file: entry.rel, reason: 'no record' }); continue; }
      if (isRejected(batch, slug)) { stats.adds.skippedRejected.push({ batch, slug }); continue; }

      const kind = entry.kind;
      const table = FIELDS[kind];
      const tpl = templates[kind];
      const defaults = ADD_DEFAULTS[kind];

      if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(slug)) { stats.adds.invalid.push({ batch, slug, file: entry.rel, reason: 'slug is not lowercase-hyphenated' }); continue; }
      if (seenSlug[kind].has(slug)) { stats.adds.skippedDuplicate.push({ batch, slug, file: entry.rel, reason: 'slug exists' }); continue; }

      const out = {};
      const dropped = [];
      const take = (k, raw, validator, fallback) => {
        if (raw === undefined || raw === null) return fallback;
        const alias = VALUE_ALIASES[kind]?.[k]?.[raw];
        const v = validator(alias ?? raw);
        if (v.ok) return v.value;
        dropped.push({ field: k, value: raw, reason: v.reason });
        return fallback;
      };
      const cc = path.basename(entry.rel, '.json');
      for (const k of tpl.top) {
        if (k === 'slug') { out.slug = slug; continue; }
        if (k === 'country_code') { out.country_code = cc; continue; }
        if (k === 'eligibility') continue;
        const fb = k in defaults.top ? clone(defaults.top[k]) : null;
        out[k] = table.top[k] ? take(k, rec[k], table.top[k], fb) : fb;
      }
      const elig = {};
      const re = rec.eligibility && typeof rec.eligibility === 'object' ? rec.eligibility : {};
      for (const k of tpl.eligibility) {
        const fb = k in defaults.eligibility ? clone(defaults.eligibility[k]) : null;
        elig[k] = table.eligibility[k] ? take(`eligibility.${k}`, re[k], table.eligibility[k], fb) : fb;
      }
      /* Optional fields the file's records carry sometimes: keep when valid. */
      for (const k of Object.keys(rec)) {
        if (k in out || k === 'eligibility' || k === 'slug' || k === 'country_code') continue;
        if (table.top[k]) out[k] = take(k, rec[k], table.top[k], null);
        else dropped.push({ field: k, value: rec[k], reason: 'not a field of this record type' });
      }
      for (const k of Object.keys(re)) {
        if (k in elig) continue;
        if (table.eligibility[k]) elig[k] = take(`eligibility.${k}`, re[k], table.eligibility[k], null);
        else dropped.push({ field: `eligibility.${k}`, value: re[k], reason: 'not a field of this record type' });
      }
      out.eligibility = elig;
      /* Key order follows the file's own records (eligibility sits before the
         source fields, not at the end) so a diff of the file reads as a record
         added, not as a record of a different shape. */
      for (const k of tpl.top) if (k in out) { const v = out[k]; delete out[k]; out[k] = v; }
      if (kind === 'company' && !out.category) out.category = 'startup';
      if (!out.amount_currency && 'amount_currency' in out) out.amount_currency = entry.docCurrency || (kind === 'household' ? null : 'EUR');

      const missing = ['name_en', 'funder', 'source_url'].filter((k) => !out[k]);
      if (missing.length) { stats.adds.invalid.push({ batch, slug, file: entry.rel, reason: `required field missing or invalid: ${missing.join(', ')}` }); continue; }
      if (!out.last_verified_at) out.last_verified_at = stampDate;

      for (const c of crossChecks(kind, out)) {
        for (const f of c.fields) {
          if (f.startsWith('eligibility.')) out.eligibility[f.slice(12)] = null; else out[f] = null;
        }
        dropped.push({ field: c.fields.join(' / '), value: null, reason: `cleared — ${c.reason}` });
      }

      if (ensureAutomaticRoute(out)) stats.normalised.push({ batch, slug, field: 'procedure_steps', from: '', to: 'standard "No application needed" step' });

      if (kind === 'household') {
        for (const what of foldGeography(out)) stats.normalised.push({ batch, slug, field: 'geography', from: '', to: what });
      }

      if (kind === 'company' && fx) {
        const eur = derivedTurnoverEur(out, entry.doc.data.currency, fx);
        if (eur === undefined) {
          dropped.push({ field: 'eligibility.turnover_annual_max', value: out.eligibility.turnover_annual_max, reason: `cleared — no rate for ${out.amount_currency} in data/fx-rates.json` });
          out.eligibility.turnover_annual_max = null;
        } else if (eur !== null || 'turnover_annual_max_eur' in out.eligibility) out.eligibility.turnover_annual_max_eur = eur;
      }

      /* Duplicates: same normalised name + funder anywhere in the kind; for
         company records also the duplicate finder's rule within the file. */
      const nk = keyOf(out);
      let dupReason = seenName[kind].has(nk) ? 'normalised name + funder already exists' : null;
      if (!dupReason && kind === 'company') {
        const nf = normaliseFunder(out.funder);
        const hit = entry.doc.data.programmes.find((p) => nf && normaliseFunder(p.funder) === nf && jaccard(p.name_en, out.name_en) >= 0.7);
        if (hit) dupReason = `looks like ${hit.slug} (same funder, name similarity ${jaccard(hit.name_en, out.name_en).toFixed(2)})`;
      }
      if (dupReason) { stats.adds.skippedDuplicate.push({ batch, slug, file: entry.rel, reason: dupReason }); continue; }

      for (const d of dropped) stats.adds.invalid.push({ batch, slug, file: entry.rel, field: d.field, value: d.value, reason: d.reason, record: 'kept without this value' });
      stats.adds.defaulted += tpl.top.filter((k) => rec[k] === undefined).length + tpl.eligibility.filter((k) => re[k] === undefined).length;

      entry.doc.data.programmes.push(out);
      entry.byslug = null;
      entry.changed = true;
      entry.added += 1;
      seenSlug[kind].add(slug);
      seenName[kind].add(nk);
      bump(stats.adds.byFile, entry.rel);
      fileStat(entry.rel).added += 1;
      stats.adds.added += 1;
    }
  }

  /* ---------------- duplicates this run introduced ---------------- */
  const allowPath = path.join(root, 'data/startups/duplicate-allowlist.json');
  const allowlist = fs.existsSync(allowPath) ? JSON.parse(fs.readFileSync(allowPath, 'utf8')) : [];
  const introduced = introducedDuplicates([...docs.values()].filter((d) => d.kind === 'company' && d.changed), allowlist);
  /* Two records that cite one official page but have clearly different names are
     distinct calls or tracks (Innovation Fund: battery, hydrogen, heat auctions;
     Station F: Founders, Fighters). Those are allowlisted, with the reason on the
     entry and in the report. A pair whose NAMES also match is probably the same
     programme twice — never allowlisted automatically; merge it. */
  const toAllow = introduced.filter((d) => d.nameSim < 0.6 && /identical \(specific\) source_url/.test(d.reason));
  stats.duplicates = {
    allowlisted: toAllow,
    needMerge: introduced.filter((d) => !toAllow.includes(d)),
  };
  if (!dryRun && toAllow.length) {
    const next = [...allowlist, ...toAllow.map((d) => ({
      country: d.country, a: d.a, b: d.b,
      reason: `auto-allowlisted by apply-verification: distinct programmes that cite one official page (name similarity ${d.nameSim.toFixed(2)}) — confirm or merge`,
    }))];
    fs.writeFileSync(allowPath, `${JSON.stringify(next, null, 1)}\n`);
    stats.allowlistWritten = true;
  }

  /* ---------------- write ---------------- */
  const wrote = [];
  if (!dryRun) {
    for (const entry of docs.values()) {
      if (!entry.changed) continue;
      writeJson(entry.doc);
      wrote.push(entry.rel);
    }
  }
  stats.wrote = wrote;
  stats.wouldWrite = [...docs.values()].filter((e) => e.changed).map((e) => e.rel);
  stats.recordsChanged = stats.recordsChanged.size;
  stats.serialisationCheck = [...docs.values()].filter((e) => e.changed).length
    ? 'each changed file re-serialised with its own indent and trailing newline'
    : 'nothing to write';

  const report = renderReport(stats, { verifyDir, root });
  const reportPath = opts.report ?? path.join(verifyDir, 'APPLY_REPORT.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  stats.reportPath = reportPath;
  return stats;
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? 'undefined').length > 90 ? `${s.slice(0, 87)}...` : s;
};
const cell = (v) => short(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function renderReport(s, { verifyDir, root }) {
  const L = [];
  L.push(`# Verification apply report${s.dryRun ? ' — DRY RUN (no data file was written)' : ''}`, '');
  L.push(`- inputs: \`${verifyDir}\` — ${s.batches.patches} patch files, ${s.batches.reviews} review files, ${s.batches.adds} add files`);
  L.push(`- data root: \`${root}\``, '');
  L.push('## Counts per action', '', '| action | results |', '|---|---:|');
  for (const a of [...ACTIONS, ...Object.keys(s.byAction).filter((k) => !ACTIONS.includes(k))]) L.push(`| ${a} | ${s.byAction[a] ?? 0} |`);
  L.push(`| **total results** | **${s.results}** |`, '');
  L.push(`- records changed: ${s.recordsChanged} (${s.appliedFields} field values changed); results that were already applied (no-op): ${s.unchangedNoOp}`);
  L.push(`- last_verified_at stamped by the script where the patch omitted it: ${s.stamped}`);
  L.push(`- records rejected by supervisor review: ${s.rejected.length}`);
  L.push(`- values dropped as invalid: ${s.invalid.length}`);
  L.push(`- results that named no findable record: ${s.unresolved.length}`);
  L.push(`- new records added: ${s.adds.added} of ${s.adds.seen} (duplicates skipped: ${s.adds.skippedDuplicate.length}, rejected: ${s.adds.skippedRejected.length}, invalid: ${s.adds.invalid.filter((i) => !i.record).length}, unknown file: ${s.adds.unknownFile.length})`, '');

  L.push('## Per file', '', '| file | results | records changed | fields changed | retired | added |', '|---|---:|---:|---:|---:|---:|');
  for (const [f, v] of Object.entries(s.byFile).sort()) L.push(`| ${f} | ${v.results} | ${v.changed} | ${v.fields} | ${v.retired} | ${v.added} |`);
  L.push('');

  const section = (title, rows, head, fmt) => {
    L.push(`## ${title} (${rows.length})`, '');
    if (!rows.length) { L.push('None.', ''); return; }
    L.push(head[0], head[1]);
    for (const r of rows) L.push(fmt(r));
    L.push('');
  };
  section('Rejected by supervisor', s.rejected, ['| batch | slug | action |', '|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${r.action} |`);
  section('Invalid values dropped from patches', s.invalid, ['| batch | slug | field | value | why |', '|---|---|---|---|---|'],
    (r) => `| ${r.batch} | ${r.slug} | ${r.field ?? ''} | ${cell(r.value)} | ${cell(r.reason)} |`);
  section('Values normalised (vocabulary words mapped, geography invariants filled in)', s.normalised, ['| batch | slug | field | from | to |', '|---|---|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${r.field} | ${cell(r.from)} | ${cell(r.to)} |`);
  section('Duplicate candidates — probably the same programme twice: merge (scripts/merge-duplicates.mjs) before tests/test-duplicates will pass', s.duplicates.needMerge, ['| country | a | b | why |', '|---|---|---|---|'], (r) => `| ${r.country} | ${r.a} | ${r.b} | ${cell(r.reason)} |`);
  section(`Duplicate candidates auto-allowlisted${s.dryRun ? ' (would be, on a real run)' : ''} — distinct names, one shared official page; confirm or merge`, s.duplicates.allowlisted, ['| country | a | b | why |', '|---|---|---|---|'], (r) => `| ${r.country} | ${r.a} | ${r.b} | ${cell(r.reason)} |`);
  section('Unresolved results', s.unresolved, ['| batch | slug | reason |', '|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${cell(r.reason)} (${cell(r.file ?? '')}) |`);
  section('Slug patched by more than one batch', s.conflicts, ['| slug | file | batches |', '|---|---|---|'], (r) => `| ${r.slug} | ${r.file} | ${r.batches.join(' → ')} |`);
  section('Retirements where the script had to add the marker', s.retireEnforced, ['| slug | file | enforced |', '|---|---|---|'], (r) => `| ${r.slug} | ${r.file} | ${r.enforced.join(', ')} |`);
  section('Adds skipped as duplicates', s.adds.skippedDuplicate, ['| batch | slug | file | why |', '|---|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${r.file} | ${cell(r.reason)} |`);
  section('Adds rejected by supervisor', s.adds.skippedRejected, ['| batch | slug |', '|---|---|'], (r) => `| ${r.batch} | ${r.slug} |`);
  section('Adds refused as invalid', s.adds.invalid.filter((i) => !i.record), ['| batch | slug | file | why |', '|---|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${r.file} | ${cell(r.reason)} |`);
  section('Add fields dropped (record added without them)', s.adds.invalid.filter((i) => i.record), ['| batch | slug | field | value | why |', '|---|---|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${r.field} | ${cell(r.value)} | ${cell(r.reason)} |`);
  section('Adds naming an unknown data file', s.adds.unknownFile, ['| batch | slug | file |', '|---|---|---|'], (r) => `| ${r.batch} | ${r.slug} | ${cell(r.file)} |`);
  if (s.problems.length) { L.push(`## Unreadable inputs (${s.problems.length})`, ''); for (const p of s.problems) L.push(`- ${p}`); L.push(''); }
  L.push(`## Files ${s.dryRun ? 'that would be written' : 'written'}`, '');
  const files = s.dryRun ? s.wouldWrite : s.wrote;
  L.push(files.length ? files.map((f) => `- ${f}`).join('\n') : 'None.', '');
  return `${L.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = {
    dryRun: argv.includes('--dry-run'),
    verifyDir: val('--verify-dir'),
    root: val('--root'),
    report: val('--report'),
    stampDate: val('--stamp-date'),
  };
  const s = applyVerification(opts);
  console.log(`${s.dryRun ? '[dry run] ' : ''}${s.results} results (${Object.entries(s.byAction).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); `
    + `${s.recordsChanged} records changed, ${s.adds.added}/${s.adds.seen} adds, ${s.rejected.length} rejected, `
    + `${s.invalid.length} invalid values dropped, ${s.unresolved.length} unresolved.`);
  console.log(`report: ${s.reportPath}`);
  if (!s.dryRun && !argv.includes('--no-regen') && path.resolve(opts.root ?? REPO) === REPO && s.wrote.length) {
    for (const script of ['gen-manifest.mjs', 'regen-counts.mjs']) {
      execFileSync(process.execPath, [path.join(HERE, script)], { stdio: 'inherit', cwd: REPO });
    }
  }
}
