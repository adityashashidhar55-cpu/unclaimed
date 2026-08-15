/**
 * UNCLAIMED — the grants workspace.
 *
 * This is the thing the enterprise page has been describing: a portfolio of
 * companies, matched against the programme dataset, moved through a pipeline,
 * with the deadlines watched, the state-aid ceiling tracked, and an
 * application package generated per opportunity.
 *
 * Three decisions worth defending.
 *
 * 1. It runs on device. The workspace lives in localStorage and the matching
 *    happens in this tab against the same engine the marketing pages are built
 *    from. That means the dashboard is real and usable before the Worker is
 *    deployed, and it means a fund's portfolio — which is commercially
 *    sensitive — does not have to leave the building for the product to work.
 *    When the Worker is live this module gets a sync layer; it does not get
 *    rewritten, because every mutation already goes through one function.
 *
 * 2. Nothing is invented. Amounts come from amount_min/amount_max or they are
 *    reported as not published. Award odds come from packages/scoring, which
 *    shows its working. A dashboard whose numbers are decorative is worse than
 *    no dashboard, because someone will plan a quarter around it.
 *
 * 3. Auto-fill fills what a register and a stored profile can fill, and then
 *    names — field by field — what only a human can write. "Automatic grant
 *    filling" that silently invents a project summary would get an applicant
 *    disqualified for a false declaration, so the boundary is drawn in the UI
 *    rather than hidden behind a progress bar.
 *
 * Zero dependencies, one file, no framework — same as the rest of the project.
 */

import { matchStartup, reachFor, INSTRUMENTS, isFreeMoney, smeCategory } from '../engine/startup.js';
import { rankMatches, awardLikelihood, effortFor, toEur } from '../packages/scoring/index.js';
import { deadlineState, reminders, toICS } from '../packages/deadlines/index.js';
import {
  DE_MINIMIS_CEILING_EUR, REGULATION, headroom, canAccept, declarationText,
} from '../packages/stateaid/index.js';
import { registryFor, autofillAvailable, projectCompany, COMPANY_FIELDS } from '../packages/registry/index.js';
import { classifyRequirement, coverageFor, docLabel, isExpired, DOC_TYPES } from '../packages/vault/index.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n || 0).toLocaleString('en');
const BASE = document.body.dataset.base || '';

/** Money, in the currency it was published in. Never converted for display. */
function money(n, cur = 'EUR') {
  if (n == null) return null;
  const sym = { EUR: '€', GBP: '£', USD: '$' }[cur];
  return sym ? `${sym}${nf(Math.round(n))}` : `${nf(Math.round(n))} ${cur}`;
}

/**
 * What to call a programme we are not allowed to name.
 *
 * The public dataset ships the first two records per country whole and strips
 * the rest, so an unentitled workspace genuinely does not know most names —
 * printing the opaque id (`p_rh63dr`) would read as a bug rather than as a
 * paywall. Say what it is instead. The Worker returns the real records at the
 * same URL once someone is signed in and paid, and every one of these labels
 * becomes a name with no other change.
 */
function programmeName(p, fallback = 'Programme') {
  if (!p) return fallback;
  if (p.locked || !p.name_en) return 'Name on the paid plan';
  return p.name_en || p.name_local;
}

const isLocked = (p) => !!p?.locked;

/** A short, honest id. Not a UUID — this is a local workspace, not a database. */
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const DAY = 86_400_000;
const fmtDate = (ms) =>
  ms == null ? '—' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/* ------------------------------------------------------------------ */
/* Workspace state                                                     */
/* ------------------------------------------------------------------ */

const STORE = 'unclaimed.workspace.v1';

/**
 * Stages, in the order work actually moves.
 *
 * `blocked` is not a failure state and not the end of the board — it is where
 * a de minimis breach or a missing co-funder puts something that is otherwise
 * good, and it exists so those do not quietly become `declined`.
 */
const STAGES = [
  { id: 'watch', label: 'Watching', hint: 'Eligible, not started' },
  { id: 'drafting', label: 'Drafting', hint: 'Being written' },
  { id: 'submitted', label: 'Submitted', hint: 'With the funder' },
  { id: 'awarded', label: 'Awarded', hint: 'Won' },
  { id: 'declined', label: 'Declined', hint: 'Lost, kept for the reopen' },
  { id: 'blocked', label: 'Blocked', hint: 'Ceiling, co-funding or fit' },
];
const STAGE_IDS = STAGES.map((s) => s.id);

const EMPTY = {
  v: 1,
  org: { name: '', country_code: '' },
  companies: [],
  /* One record per grant applied for, or about to be. Created automatically
     when an opportunity is added — see addApplication() — because an
     application log that depends on someone remembering to write a row in it
     is an application log with holes in it exactly where the busy weeks were. */
  pipeline: [],
  /* Projects sit between a company and its applications: most funders fund a
     project, not a company, and the same project is pitched to several calls.
     Optional — an application with no project still works. */
  projects: [],
  /* Documents held once and reused. Metadata only in this build: the encrypted
     bytes need the vault service, and claiming to store a file we have not
     stored would be worse than saying so. */
  documents: [],
  /* Milestones, reports and deliverables owed after an award. */
  postaward: [],
  awards: [],
  grants: [],
  searches: [],
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    if (!raw || raw.v !== 1) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...raw };
  } catch {
    return structuredClone(EMPTY);
  }
}

let ws = load();

/**
 * The single mutation point.
 *
 * Everything that changes the workspace goes through here, which is what makes
 * the eventual server sync a twenty-line addition rather than an audit of
 * every handler. It also means undo and an activity log have one place to
 * hook into, and that a failed write is noticed rather than silently dropped.
 */
let saveFailed = false;
function commit(fn) {
  fn(ws);
  try {
    localStorage.setItem(STORE, JSON.stringify(ws));
    saveFailed = false;
  } catch {
    /* Quota, or Safari private mode. Say so — a workspace that looks saved and
       is not is the worst possible failure for something someone is planning a
       funding round around. */
    saveFailed = true;
  }
  render();
}

const companyById = (id) => ws.companies.find((c) => c.id === id) || null;

/* ------------------------------------------------------------------ */
/* Programme data                                                      */
/* ------------------------------------------------------------------ */

const pools = new Map(); // 'gb' | 'eu' | 'global' -> dataset
let manifest = null;
let loadingPools = new Set();

async function loadPool(name) {
  if (pools.has(name) || loadingPools.has(name)) return;
  loadingPools.add(name);
  try {
    const res = await fetch(`${BASE}/api/v1/startups/${name}.json`);
    if (res.ok) pools.set(name, await res.json());
    else pools.set(name, { programmes: [] }); // no dataset for that country yet
  } catch {
    pools.set(name, null); // offline: distinguishable from "no programmes"
  } finally {
    loadingPools.delete(name);
  }
}

/** Every pool a portfolio needs, fetched once, in parallel. */
async function loadPoolsFor(companies) {
  const wanted = new Set();
  for (const c of companies) for (const p of reachFor(c.country_code)) wanted.add(p);
  await Promise.all([...wanted].map(loadPool));
}

/**
 * Datasets for one company, with the workspace's own grant entries folded in.
 *
 * Custom grants are merged into the country pool rather than kept in a
 * separate list, so a programme someone typed in behaves exactly like a
 * programme we shipped: it matches, it ranks, it lands in the pipeline and it
 * appears in the deadline calendar. A second code path for "your grants" is
 * how those features end up half-working.
 */
function datasetsFor(company) {
  const out = {};
  for (const p of reachFor(company.country_code)) out[p] = pools.get(p) || { programmes: [] };
  const mine = ws.grants.filter(
    (g) => !g.country_code || g.country_code === company.country_code || g.country_code === 'global',
  );
  if (mine.length) {
    const cc = company.country_code;
    out[cc] = { ...(out[cc] || {}), programmes: [...(out[cc]?.programmes || []), ...mine] };
  }
  return out;
}

const matchCache = new Map();
function matchFor(company) {
  const key = `${company.id}:${company.updated_at || 0}:${ws.grants.length}`;
  if (matchCache.has(key)) return matchCache.get(key);
  const r = matchStartup(companyProfile(company), datasetsFor(company), Date.now());
  /* The engine spreads its buckets across the top level of the result. Group
     them here rather than reach for r.eligible in nine places — the day a
     seventh bucket appears, this is the only line that has to know. */
  const out = {
    ...r,
    buckets: {
      eligible: r.eligible || [],
      conditional: r.conditional || [],
      needs_answer: r.needs_answer || [],
      not_eligible: r.not_eligible || [],
      closed: r.closed || [],
    },
  };
  matchCache.set(key, out);
  return out;
}

/** The shape the engine wants, from the shape the form collects. */
function companyProfile(c) {
  return {
    country_code: c.country_code,
    admin_area: c.admin_area || null,
    incorporated: c.incorporated !== false,
    incorporation_date: c.incorporation_date || null,
    headcount: c.headcount ?? null,
    turnover_annual_eur: c.turnover_annual_eur ?? null,
    balance_sheet_eur: c.balance_sheet_eur ?? null,
    stage: c.stage || null,
    sectors: c.sectors || [],
    rd_active: c.rd_active ?? null,
    female_founder: c.female_founder ?? null,
    has_cofunding: c.has_cofunding ?? null,
  };
}

/** Every programme this workspace can see, keyed by slug, for pipeline lookups. */
function programmeBySlug(slug) {
  for (const d of pools.values()) {
    const hit = (d?.programmes || []).find((p) => p.slug === slug);
    if (hit) return hit;
  }
  return ws.grants.find((g) => g.slug === slug) || null;
}

/* ------------------------------------------------------------------ */
/* Derived figures                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pipeline value.
 *
 * Only counts entries whose programme publishes an amount, and says how many
 * it skipped. A pipeline total that quietly treats "amount not published" as
 * zero reads as a smaller opportunity than it is; one that guesses reads as a
 * bigger one. Both are wrong in a way a board paper would repeat.
 */
function pipelineValue(entries) {
  let eur = 0;
  let priced = 0;
  let unpriced = 0;
  for (const e of entries) {
    const v = e.value_eur ?? amountEur(programmeBySlug(e.slug));
    if (v == null) unpriced += 1;
    else {
      eur += v;
      priced += 1;
    }
  }
  return { eur, priced, unpriced };
}

function amountEur(p) {
  if (!p) return null;
  const raw = p.amount_max ?? p.amount_min;
  if (raw == null) return null;
  return toEur(raw, p.amount_currency || 'EUR');
}

/** Awards / decided. Undecided applications are excluded, not counted as losses. */
function hitRate(entries) {
  const won = entries.filter((e) => e.stage === 'awarded').length;
  const lost = entries.filter((e) => e.stage === 'declined').length;
  const decided = won + lost;
  return { won, lost, decided, pct: decided ? Math.round((won / decided) * 100) : null };
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

const NAV = [
  ['overview', 'Overview'],
  ['companies', 'Companies'],
  ['projects', 'Projects'],
  ['opportunities', 'Opportunities'],
  ['pipeline', 'Pipeline'],
  ['applications', 'Applications'],
  ['documents', 'Documents'],
  ['deadlines', 'Deadlines'],
  ['postaward', 'Post-award'],
  ['stateaid', 'State aid'],
  ['grants', 'Grant entry'],
  ['reports', 'Reports'],
];

const view = { name: 'overview', companyId: null, entryId: null, projectId: null, filter: {} };

function chrome(inner) {
  const counts = {
    companies: ws.companies.length,
    projects: ws.projects.length,
    pipeline: ws.pipeline.length,
    applications: ws.pipeline.length,
    documents: ws.documents.length,
    postaward: ws.postaward.filter((i) => !i.done).length,
    grants: ws.grants.length,
  };
  return `
<div class="dash">
  <nav class="dash__nav" aria-label="Workspace">
    ${NAV.map(
      ([id, label]) => `<button class="dash__navitem${view.name === id ? ' is-on' : ''}" data-view="${id}">
      ${esc(label)}${counts[id] ? `<span class="dash__count">${counts[id]}</span>` : ''}
    </button>`,
    ).join('')}
  </nav>
  <main class="dash__main">
    ${saveFailed ? `<div class="callout callout--warn"><p><strong>This browser refused to save.</strong> Your changes are in this tab only and will be lost when you close it. Private browsing and a full disk both do this.</p></div>` : ''}
    ${lockedBanner()}
    ${inner}
  </main>
</div>`;
}

/**
 * Said once, at the top, rather than implied by forty placeholders.
 *
 * The workspace loads the same public dataset as everything else, and that
 * dataset only names the first two programmes per pool. Everything else works
 * — matching, ranking, deadlines, the ceiling ledger — because none of it
 * needs a name. The row labels do, so this explains why they read the way they
 * do instead of leaving someone to conclude the data is broken.
 */
/* Only where programme names actually appear. On Companies or Documents it is
   a paragraph explaining something the screen never showed. */
const NAME_VIEWS = new Set(['overview', 'company', 'opportunities', 'pipeline', 'entry', 'applications', 'deadlines', 'postaward', 'project']);

function lockedBanner() {
  if (!NAME_VIEWS.has(view.name)) return '';
  let locked = 0;
  let named = 0;
  for (const d of pools.values()) {
    for (const p of d?.programmes || []) (p.locked ? locked++ : named++);
  }
  if (!locked) return '';
  return `<div class="callout"><p><strong>${nf(named)} of ${nf(named + locked)} programme names are visible.</strong>
  Matching, ranking, deadlines and the state-aid ledger all work on every programme — none of them need the
  name. The names themselves are on the paid plan, so most rows below read "Name on the paid plan" until this
  workspace is signed in to a paid account.</p></div>`;
}

function empty(title, blurb, cta) {
  return `<div class="dash__empty">
    <h2>${esc(title)}</h2>
    <p class="small">${blurb}</p>
    ${cta || ''}
  </div>`;
}

const stat = (n, l, sub) =>
  `<div class="stat"><span class="stat__n">${n}</span><span class="stat__l">${esc(l)}</span>${sub ? `<span class="stat__sub">${esc(sub)}</span>` : ''}</div>`;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function overviewView() {
  if (!ws.companies.length) {
    return empty(
      'Start with one company.',
      'Add a company and this fills with what it can apply for, what closes soon, and how much state aid it has room for.',
      `<button class="btn btn-primary" data-action="new-company">Add a company</button>
       <button class="btn" data-action="import">Import a CSV</button>
       <button class="btn btn-ghost" data-action="demo">Load sample data</button>`,
    );
  }

  const value = pipelineValue(ws.pipeline);
  const rate = hitRate(ws.pipeline);
  const soon = closingSoon(21);

  return `
  <header class="dash__head">
    <div>
      <span class="eyebrow">Portfolio</span>
      <h1>${nf(ws.companies.length)} ${ws.companies.length === 1 ? 'company' : 'companies'}</h1>
    </div>
    <div class="row">
      <button class="btn btn-sm" data-action="new-company">Add company</button>
      <button class="btn btn-sm btn-ghost" data-action="export-csv">Export CSV</button>
    </div>
  </header>

  <div class="grid grid-4 dash__stats">
    ${stat(money(value.eur, 'EUR') || '€0', 'In pipeline', value.unpriced ? `${value.unpriced} with no published amount` : 'every entry priced')}
    ${stat(nf(ws.pipeline.filter((e) => e.stage === 'submitted').length), 'Submitted', 'awaiting a decision')}
    ${stat(nf(rate.won), 'Awarded', rate.decided ? `${rate.decided} decided` : 'none decided yet')}
    ${stat(rate.pct == null ? '—' : `${rate.pct}%`, 'Hit rate', rate.pct == null ? 'needs a decision first' : `${rate.won} of ${rate.decided}`)}
  </div>

  ${(() => {
    /* The whole portfolio's problems, on the first screen. A dashboard that
       makes you open forty records to discover one of them breaches the state
       aid ceiling has told you nothing you could not have found yourself. */
    const issues = allIssues();
    const blocking = issues.filter((i) => i.level === 'block' || i.level === 'urgent');
    if (!issues.length) return '';
    return `<section class="dash__section">
    <div class="row-between">
      <h2>${issues.length} thing${issues.length === 1 ? '' : 's'} need attention</h2>
      ${blocking.length ? `<span class="status status--closing">${blocking.length} blocking</span>` : ''}
    </div>
    <div class="list-rows">
      ${[...blocking, ...issues.filter((i) => !blocking.includes(i))]
        .slice(0, 6)
        .map((i) => {
          const [cls, label] = ISSUE_STYLE[i.level] || ISSUE_STYLE.info;
          const p2 = programmeBySlug(i.entry.slug);
          return `<button class="list-row list-row--btn" data-entry-open="${i.entry.id}">
        <div class="list-row__body">
          <div class="list-row__name">${esc(i.title)}</div>
          <div class="list-row__meta">${esc(programmeName(p2))} · ${esc(companyById(i.entry.company_id)?.legal_name || '')}</div>
        </div>
        <div class="list-row__right"><span class="status status--${cls}">${esc(label)}</span></div>
      </button>`;
        })
        .join('')}
    </div>
    ${issues.length > 6 ? `<p class="tiny dash__muted">and ${issues.length - 6} more across the portfolio.</p>` : ''}
  </section>`;
  })()}

  <section class="dash__section">
    <div class="row-between">
      <h2>Closing in the next three weeks</h2>
      <button class="btn btn-sm btn-ghost" data-view="deadlines">All deadlines</button>
    </div>
    ${
      soon.length
        ? `<div class="list-rows">${soon.slice(0, 6).map(deadlineRow).join('')}</div>`
        : `<p class="small dash__muted">Nothing in your pipeline closes in the next three weeks. That is either calm or a gap — the opportunities tab will tell you which.</p>`
    }
  </section>

  <section class="dash__section">
    <h2>By company</h2>
    <div class="list-rows">
      ${ws.companies
        .map((c) => {
          const mine = ws.pipeline.filter((e) => e.company_id === c.id);
          const v = pipelineValue(mine);
          const room = companyHeadroom(c);
          return `<button class="list-row list-row--btn" data-company="${c.id}">
            <div>
              <div class="list-row__name">${esc(c.legal_name || 'Unnamed company')}</div>
              <div class="list-row__meta">${esc((c.country_code || '').toUpperCase())} · ${mine.length} in pipeline · ${money(v.eur, 'EUR') || '€0'}</div>
            </div>
            <div class="list-row__right">${
              room == null
                ? ''
                : `<span class="status status--${room.pct > 80 ? 'closing' : room.pct > 50 ? 'soon' : 'open'}">${room.pct}% of ceiling used</span>`
            }</div>
          </button>`;
        })
        .join('')}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

const STAGE_OPTIONS = ['idea', 'pre_seed', 'seed', 'series_a', 'growth'];

function companiesView() {
  if (!ws.companies.length) {
    return empty(
      'No companies yet.',
      'Add one by hand, or paste a CSV of company numbers and let the public registers fill the rest.',
      `<button class="btn btn-primary" data-action="new-company">Add a company</button>
       <button class="btn" data-action="import">Import a CSV</button>`,
    );
  }
  return `
  <header class="dash__head">
    <div><span class="eyebrow">Portfolio</span><h1>Companies</h1></div>
    <div class="row">
      <button class="btn btn-sm btn-primary" data-action="new-company">Add company</button>
      <button class="btn btn-sm" data-action="import">Import CSV</button>
    </div>
  </header>
  <div class="grid grid-2">
    ${ws.companies
      .map((c) => {
        const m = pools.size ? matchFor(c) : null;
        const eligible = m ? m.buckets.eligible.length : null;
        const sme = smeCategory(companyProfile(c));
        return `<button class="card card-link dash__company" data-company="${c.id}">
        <div class="row-between">
          <strong>${esc(c.legal_name || 'Unnamed company')}</strong>
          <span class="pill">${esc((c.country_code || '??').toUpperCase())}</span>
        </div>
        <p class="small dash__muted" style="margin:.35rem 0 0">
          ${esc(c.company_number || 'no company number')}${c.incorporation_date ? ` · incorporated ${esc(c.incorporation_date.slice(0, 10))}` : ''}
        </p>
        <p class="small" style="margin:.6rem 0 0">
          ${eligible == null ? 'Loading programmes…' : `<strong>${eligible}</strong> programmes it qualifies for`}
          · ${ws.pipeline.filter((e) => e.company_id === c.id).length} in pipeline
        </p>
        <p class="tiny dash__muted" style="margin:.4rem 0 0">${esc(sme ? `${sme.replace('_', ' ')} under the EU definition` : 'size not given')}</p>
      </button>`;
      })
      .join('')}
  </div>`;
}

/** The add/edit form. One form, both jobs — divergence here is how fields rot. */
function companyFormView(c) {
  const v = (k, d = '') => esc(c?.[k] ?? d);
  const reg = registryFor(c?.country_code || '');
  return `
  <header class="dash__head">
    <div><span class="eyebrow">${c?.id ? 'Edit' : 'New'}</span><h1>${c?.id ? esc(c.legal_name || 'Company') : 'Add a company'}</h1></div>
    <button class="btn btn-sm btn-ghost" data-view="companies">Cancel</button>
  </header>
  <form class="dash__form" id="company-form" data-id="${c?.id || ''}">
    <div class="fieldgrid">
      <label class="fld"><span>Legal name</span><input class="field" name="legal_name" value="${v('legal_name')}" required></label>
      <label class="fld"><span>Country</span><input class="field" name="country_code" value="${v('country_code')}" placeholder="gb" maxlength="2" required></label>
      <label class="fld"><span>Company number</span><input class="field" name="company_number" value="${v('company_number')}" placeholder="${esc(reg?.id_label || '')}"></label>
      <label class="fld"><span>Incorporated on</span><input class="field" type="date" name="incorporation_date" value="${v('incorporation_date').slice(0, 10)}"></label>
      <label class="fld"><span>Headcount</span><input class="field" type="number" min="0" name="headcount" value="${v('headcount')}"></label>
      <label class="fld"><span>Turnover (EUR/yr)</span><input class="field" type="number" min="0" name="turnover_annual_eur" value="${v('turnover_annual_eur')}"></label>
      <label class="fld"><span>Balance sheet (EUR)</span><input class="field" type="number" min="0" name="balance_sheet_eur" value="${v('balance_sheet_eur')}"></label>
      <label class="fld"><span>Stage</span><select class="field" name="stage">
        <option value="">—</option>
        ${STAGE_OPTIONS.map((s) => `<option value="${s}"${c?.stage === s ? ' selected' : ''}>${esc(s.replace('_', ' '))}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Region</span><input class="field" name="admin_area" value="${v('admin_area')}" placeholder="optional"></label>
      <label class="fld"><span>Sectors</span><input class="field" name="sectors" value="${esc((c?.sectors || []).join(', '))}" placeholder="deeptech, health"></label>
      <label class="fld"><span>Owner</span><input class="field" name="owner" value="${v('owner')}" placeholder="who runs this account"></label>
    </div>
    <fieldset class="fld-set">
      <legend>Flags that change what it qualifies for</legend>
      <label class="chk"><input type="checkbox" name="rd_active"${c?.rd_active ? ' checked' : ''}> Doing R&amp;D</label>
      <label class="chk"><input type="checkbox" name="has_cofunding"${c?.has_cofunding ? ' checked' : ''}> Has co-funding available</label>
      <label class="chk"><input type="checkbox" name="incorporated"${c?.incorporated !== false ? ' checked' : ''}> Incorporated</label>
    </fieldset>

    <details class="dash__details">
      <summary>The narrative fields no register can fill</summary>
      <p class="small dash__muted">These are what auto-fill cannot write for you, and they are the same
      seven answers most applications want. Write them once here and every package reuses them.</p>
      ${NARRATIVE_FIELDS.map(
        (f) => `<label class="fld"><span>${esc(f.label)}</span>
        <textarea class="field" name="${f.field}" rows="3">${esc(c?.narrative?.[f.field] ?? '')}</textarea></label>`,
      ).join('')}
    </details>

    <div class="row" style="margin-top:1.4rem">
      <button class="btn btn-primary" type="submit">${c?.id ? 'Save' : 'Add company'}</button>
      ${c?.id ? `<button class="btn btn-ghost" type="button" data-action="delete-company" data-id="${c.id}">Delete</button>` : ''}
    </div>
    ${
      reg
        ? `<p class="tiny dash__muted" style="margin-top:1rem">${esc(reg.name)}${
            autofillAvailable(c?.country_code || '')
              ? ' can fill most of this from the company number once the API key is set on the server.'
              : ' has no open API we can use, so these fields are yours to enter.'
          }</p>`
        : ''
    }
  </form>`;
}

const NARRATIVE_FIELDS = [
  { field: 'project_summary', label: 'What you are building, in plain terms' },
  { field: 'innovation_claim', label: 'What is genuinely new about it' },
  { field: 'work_plan', label: 'Work packages and milestones' },
  { field: 'budget_breakdown', label: 'Budget by cost category' },
  { field: 'cofunding_source', label: 'Where your share of the funding comes from' },
  { field: 'team_cvs', label: 'Team and relevant track record' },
  { field: 'market_evidence', label: 'Evidence of the market and route to it' },
];

/* ------------------------------------------------------------------ */
/* Company detail — the match list                                     */
/* ------------------------------------------------------------------ */

function companyView() {
  const c = companyById(view.companyId);
  if (!c) return empty('That company is gone.', 'It may have been deleted in another tab.', '<button class="btn" data-view="companies">Back</button>');
  if (!pools.size) return `<p class="small">Loading programmes…</p>`;

  const m = matchFor(c);
  const inPipeline = new Set(ws.pipeline.filter((e) => e.company_id === c.id).map((e) => e.slug));
  const room = companyHeadroom(c);

  const bucket = (key, title, blurb) => {
    const rows = m.buckets[key] || [];
    if (!rows.length) return '';
    return `<section class="dash__section">
      <h2>${esc(title)} <span class="dash__muted">${rows.length}</span></h2>
      <p class="small dash__muted">${blurb}</p>
      <div class="list-rows">${rows.slice(0, 40).map((r) => matchRow(r, c, inPipeline)).join('')}</div>
      ${rows.length > 40 ? `<p class="tiny dash__muted">Showing the top 40 of ${rows.length}, ranked by what this company can realistically win.</p>` : ''}
    </section>`;
  };

  return `
  <header class="dash__head">
    <div>
      <button class="dash__back" data-view="companies">← Companies</button>
      <h1>${esc(c.legal_name || 'Company')}</h1>
      <p class="small dash__muted">${esc((c.country_code || '').toUpperCase())}${c.company_number ? ` · ${esc(c.company_number)}` : ''}${c.owner ? ` · ${esc(c.owner)}` : ''}</p>
    </div>
    <div class="row">
      <button class="btn btn-sm" data-action="edit-company" data-id="${c.id}">Edit</button>
      <button class="btn btn-sm btn-ghost" data-action="export-company" data-id="${c.id}">Export</button>
    </div>
  </header>

  <div class="grid grid-4 dash__stats">
    ${stat(nf(m.buckets.eligible.length), 'Qualifies for', 'passes every published rule')}
    ${stat(nf(m.buckets.needs_answer.length), 'One answer away', 'a field we have not been given')}
    ${stat(nf(m.buckets.not_eligible.length), 'Not eligible', 'and we name which rule')}
    ${room == null ? stat('—', 'De minimis room', 'outside the EU rules') : stat(money(room.remaining, 'EUR'), 'De minimis room', `${room.pct}% of the ceiling used`)}
  </div>

  ${bucket('eligible', 'Qualifies now', 'Every published rule passes. Ranked by amount × award odds × how feasible it is for a company this size.')}
  ${bucket('conditional', 'Qualifies, with a condition', 'Passes every rule, but the funder gives priority or preference to something this company has not claimed — worth applying, worth reading the call first.')}
  ${bucket('needs_answer', 'One answer away', 'We could not test one rule because a field is blank. Fill it on the company and these move.')}
  ${bucket('closed', 'Closed, watch for the reopen', 'Past the deadline. Kept because most of these run annually and the next round is where your applications come from.')}
  ${bucket('not_eligible', 'Not eligible', 'Shown with the reason, because "why not" is the half you can sometimes fix.')}`;
}

function matchRow(r, company, inPipeline) {
  const p = r.programme;
  const amt = p.amount_max ?? p.amount_min;
  const d = deadlineState(p, Date.now());
  const odds = awardLikelihood(p);
  const effort = effortFor(p);
  const added = inPipeline.has(p.slug);
  return `<div class="list-row">
    <div class="list-row__body">
      <div class="list-row__name">${esc(programmeName(p))}</div>
      <div class="list-row__meta">${esc(p.funder || (isLocked(p) ? 'funder on the paid plan' : ''))} · ${esc(INSTRUMENTS[p.grant_type]?.label || p.grant_type)}${
        isFreeMoney(p.grant_type) ? ' · non-dilutive' : ''
      }</div>
      <div class="list-row__meta">
        ${amt != null ? `<strong>${esc(money(amt, p.amount_currency))}</strong>` : '<span class="dash__muted">amount not published</span>'}
        ${odds?.p != null ? ` · ~${Math.round(odds.p * 100)}% award rate <span class="tiny dash__muted">(${esc(odds.basis === 'published' ? "funder's published rate" : odds.basis === 'derived' ? 'derived from published data' : 'estimated from similar programmes')})</span>` : ''}
        ${effort?.label ? ` · ${esc(effort.label)}` : ''}
      </div>
      ${r.unknowns?.length ? `<div class="list-row__meta tiny">Needs: ${r.unknowns.map(esc).join(', ')}</div>` : ''}
      ${r.fails?.length ? `<div class="list-row__meta tiny">Blocked by: ${esc(r.fails[0])}</div>` : ''}
    </div>
    <div class="list-row__right">
      <span class="status status--${esc(d.urgency)}">${esc(d.headline)}</span>
      ${
        added
          ? '<span class="pill pill-accent">In pipeline</span>'
          : `<button class="btn btn-sm" data-action="add-to-pipeline" data-company="${company.id}" data-slug="${esc(p.slug)}">Add</button>`
      }
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Opportunities — the whole portfolio at once                         */
/* ------------------------------------------------------------------ */

function opportunitiesView() {
  if (!ws.companies.length) {
    return empty('Add a company first.', 'This view matches every company in the portfolio at once.', '<button class="btn btn-primary" data-action="new-company">Add a company</button>');
  }
  if (!pools.size) return `<p class="small">Loading programmes…</p>`;

  const q = (view.filter.q || '').toLowerCase();
  const onlyOpen = view.filter.open !== false;
  const onlyFree = !!view.filter.free;

  /* One row per company × programme. Deduplicating by programme would hide
     that three portfolio companies each qualify for the same call, which is
     exactly the thing a programme manager needs to see. */
  const rows = [];
  for (const c of ws.companies) {
    const m = matchFor(c);
    for (const r of m.buckets.eligible) {
      const p = r.programme;
      if (onlyFree && !isFreeMoney(p.grant_type)) continue;
      const d = deadlineState(p, Date.now());
      if (onlyOpen && ['later', 'stalled'].includes(d.urgency)) continue;
      if (q && !`${p.name_en} ${p.funder} ${c.legal_name}`.toLowerCase().includes(q)) continue;
      rows.push({ c, r, p, d, eur: amountEur(p) ?? 0 });
    }
  }
  rows.sort((a, b) => b.eur - a.eur);

  const inPipeline = new Set(ws.pipeline.map((e) => `${e.company_id}:${e.slug}`));

  return `
  <header class="dash__head">
    <div><span class="eyebrow">Across the portfolio</span><h1>Opportunities</h1></div>
    <button class="btn btn-sm btn-ghost" data-action="save-search">Save this search</button>
  </header>

  <div class="dash__filters">
    <input class="field" id="opp-q" placeholder="Filter by programme, funder or company" value="${esc(view.filter.q || '')}">
    <label class="chk"><input type="checkbox" id="opp-open"${onlyOpen ? ' checked' : ''}> Open or rolling only</label>
    <label class="chk"><input type="checkbox" id="opp-free"${onlyFree ? ' checked' : ''}> Non-dilutive cash only</label>
  </div>

  ${
    ws.searches.length
      ? `<div class="row dash__chips">${ws.searches
          .map((s) => `<button class="tag" data-action="run-search" data-id="${s.id}">${esc(s.name)}</button>`)
          .join('')}</div>`
      : ''
  }

  <p class="small dash__muted">${nf(rows.length)} matches across ${nf(ws.companies.length)} companies.</p>
  <div class="list-rows">
    ${
      rows.length
        ? rows
            .slice(0, 200)
            .map(
              ({ c, p, d }) => `<div class="list-row">
      <div class="list-row__body">
        <div class="list-row__name">${esc(programmeName(p))}</div>
        <div class="list-row__meta">${esc(c.legal_name)} · ${esc(p.funder || (isLocked(p) ? 'funder on the paid plan' : ''))}</div>
        <div class="list-row__meta">${
          amountEur(p) != null ? `<strong>${esc(money(p.amount_max ?? p.amount_min, p.amount_currency))}</strong>` : '<span class="dash__muted">amount not published</span>'
        }</div>
      </div>
      <div class="list-row__right">
        <span class="status status--${esc(d.urgency)}">${esc(d.headline)}</span>
        ${
          inPipeline.has(`${c.id}:${p.slug}`)
            ? '<span class="pill pill-accent">In pipeline</span>'
            : `<button class="btn btn-sm" data-action="add-to-pipeline" data-company="${c.id}" data-slug="${esc(p.slug)}">Add</button>`
        }
      </div>
    </div>`,
            )
            .join('')
        : '<p class="small dash__muted">Nothing matches that filter.</p>'
    }
  </div>
  ${rows.length > 200 ? `<p class="tiny dash__muted">Showing the 200 largest of ${nf(rows.length)}. Narrow the filter to see the rest — nothing has been dropped.</p>` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

function pipelineView() {
  if (!ws.pipeline.length) {
    return empty(
      'Nothing in the pipeline yet.',
      'Add an opportunity from a company or from the portfolio view and it lands here, with a stage, an owner and a next action.',
      '<button class="btn btn-primary" data-view="opportunities">Find opportunities</button>',
    );
  }
  const value = pipelineValue(ws.pipeline);
  return `
  <header class="dash__head">
    <div><span class="eyebrow">${money(value.eur, 'EUR')} across ${ws.pipeline.length}</span><h1>Pipeline</h1></div>
    <button class="btn btn-sm btn-ghost" data-action="export-pipeline">Export CSV</button>
  </header>
  ${value.unpriced ? `<p class="tiny dash__muted">${value.unpriced} of these publish no amount and contribute nothing to the total. The real figure is higher than the one above, not lower.</p>` : ''}
  <div class="board">
    ${STAGES.map((s) => {
      const entries = ws.pipeline.filter((e) => e.stage === s.id);
      const v = pipelineValue(entries);
      return `<div class="board__col" data-stage="${s.id}">
        <div class="board__head">
          <strong>${esc(s.label)}</strong>
          <span class="tiny dash__muted">${entries.length}${v.eur ? ` · ${money(v.eur, 'EUR')}` : ''}</span>
        </div>
        <div class="board__drop" data-stage="${s.id}">
          ${entries.map(cardFor).join('') || `<p class="tiny dash__muted board__hint">${esc(s.hint)}</p>`}
        </div>
      </div>`;
    }).join('')}
  </div>
  <p class="tiny dash__muted" style="margin-top:1rem">Drag a card between columns, or open it and change the stage — both work, because dragging is impossible with a keyboard.</p>`;
}

function cardFor(e) {
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  const d = p ? deadlineState(p, Date.now()) : null;
  const v = e.value_eur ?? amountEur(p);
  return `<article class="board__card" draggable="true" data-entry="${e.id}" tabindex="0">
    <div class="board__cardname">${esc(programmeName(p))}</div>
    <div class="tiny dash__muted">${esc(c?.legal_name || 'unknown company')}</div>
    ${v != null ? `<div class="board__val">${esc(money(v, 'EUR'))}</div>` : '<div class="tiny dash__muted">amount not published</div>'}
    ${d ? `<span class="status status--${esc(d.urgency)}">${esc(d.headline)}</span>` : ''}
    ${e.owner ? `<div class="tiny dash__muted">${esc(e.owner)}</div>` : ''}
    ${e.next_action ? `<div class="tiny board__next">→ ${esc(e.next_action)}</div>` : ''}
  </article>`;
}

function entryView() {
  const e = ws.pipeline.find((x) => x.id === view.entryId);
  if (!e) return empty('That entry is gone.', '', '<button class="btn" data-view="pipeline">Back</button>');
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  const d = p ? deadlineState(p, Date.now()) : null;
  const aid = p && c ? aidCheck(c, p) : null;

  return `
  <header class="dash__head">
    <div>
      <button class="dash__back" data-view="pipeline">← Pipeline</button>
      <h1>${esc(programmeName(p))}</h1>
      <p class="small dash__muted">${esc(e.reference || '')}${e.reference ? ' · ' : ''}${esc(c?.legal_name || '')}${p?.funder ? ` · ${esc(p.funder)}` : ''}</p>
    </div>
    <div class="row">
      ${p?.application_url ? `<a class="btn btn-sm" href="${esc(p.application_url)}" target="_blank" rel="noopener noreferrer">Funder's page</a>` : ''}
      <button class="btn btn-sm btn-ghost" data-action="remove-entry" data-id="${e.id}">Remove</button>
    </div>
  </header>

  ${
    aid
      ? `<div class="callout${aid.ok ? '' : ' callout--warn'}"><p><strong>${esc(aid.headline)}</strong> ${esc(aid.detail)}</p></div>`
      : ''
  }

  ${issuesPanel(e)}
  ${readinessPanel(e)}

  <form class="dash__form" id="entry-form" data-id="${e.id}">
    <div class="fieldgrid">
      <label class="fld"><span>Stage</span><select class="field" name="stage">
        ${STAGES.map((s) => `<option value="${s.id}"${e.stage === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Project</span><select class="field" name="project_id">
        <option value="">— none —</option>
        ${ws.projects
          .filter((x) => x.company_id === e.company_id)
          .map((x) => `<option value="${x.id}"${e.project_id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`)
          .join('')}
      </select></label>
      <label class="fld"><span>Owner</span><input class="field" name="owner" value="${esc(e.owner || '')}"></label>
      <label class="fld"><span>Amount requested (EUR)</span><input class="field" type="number" name="requested_eur" value="${esc(e.requested_eur ?? '')}" placeholder="${amountEur(p) ?? ''}"></label>
      <label class="fld"><span>Amount awarded (EUR)</span><input class="field" type="number" name="awarded_eur" value="${esc(e.awarded_eur ?? '')}"></label>
      <label class="fld"><span>Submitted on</span><input class="field" type="date" name="submitted_at" value="${esc(e.submitted_at || '')}"></label>
      <label class="fld"><span>Decision on</span><input class="field" type="date" name="decided_at" value="${esc(e.decided_at || '')}"></label>
      <label class="fld"><span>Funder's reference</span><input class="field" name="funder_reference" value="${esc(e.funder_reference || '')}"></label>
      <label class="fld"><span>Pipeline value (EUR)</span><input class="field" type="number" name="value_eur" value="${esc(e.value_eur ?? '')}" placeholder="${amountEur(p) ?? ''}"></label>
      <label class="fld"><span>Next action</span><input class="field" name="next_action" value="${esc(e.next_action || '')}"></label>
      <label class="fld"><span>Internal due date</span><input class="field" type="date" name="due" value="${esc(e.due || '')}"></label>
    </div>
    <label class="fld"><span>Notes</span><textarea class="field" name="notes" rows="4">${esc(e.notes || '')}</textarea></label>
    <div class="row" style="margin-top:1rem"><button class="btn btn-primary" type="submit">Save</button></div>
  </form>

  ${checklistPanel(e)}

  ${d ? `<section class="dash__section"><h2>Deadline</h2><p class="small"><strong>${esc(d.headline)}</strong> — ${esc(d.detail)}</p>${d.stale ? '<p class="tiny dash__muted">The published date has passed and the funder has not posted a new one. Treat the record as out of date.</p>' : ''}</section>` : ''}

  ${p && c ? autofillSection(c, p) : ''}
  `;
}


/* ------------------------------------------------------------------ */
/* Application panels                                                  */
/* ------------------------------------------------------------------ */

const ISSUE_STYLE = {
  block: ['closing', 'Blocking'],
  urgent: ['closing', 'Urgent'],
  warn: ['soon', 'Worth fixing'],
  info: ['later', 'Note'],
};

function issuesPanel(e) {
  const list = issuesFor(e);
  if (!list.length) {
    return `<div class="callout callout--sage"><p><strong>Nothing flagged.</strong> Eligibility passes, the
    mandatory documents are held, the deadline is not close and the ceiling has room.</p></div>`;
  }
  return `<section class="dash__section">
    <h2>${list.length} thing${list.length === 1 ? '' : 's'} to deal with</h2>
    <div class="list-rows">
      ${list
        .map((i) => {
          const [cls, label] = ISSUE_STYLE[i.level] || ISSUE_STYLE.info;
          return `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${esc(i.title)}</div>
          <div class="list-row__meta">${esc(i.detail)}</div>
          <div class="list-row__meta tiny">→ ${esc(i.fix)}</div>
        </div>
        <div class="list-row__right"><span class="status status--${cls}">${esc(label)}</span></div>
      </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

/**
 * The score, with its working shown.
 *
 * A bare percentage next to a grant application gets read as a probability of
 * winning. This one is a readiness score against the funder's own published
 * criteria and nothing else, so every component is listed with its own
 * fraction — you can disagree with the number by looking at it.
 */
function readinessPanel(e) {
  const r = readinessFor(e);
  if (!r) return '';
  return `<section class="dash__section">
    <div class="row-between">
      <h2>Readiness</h2>
      <strong>${r.score}%</strong>
    </div>
    <div class="meter"><div class="meter__bar meter__bar--${r.score < 40 ? 'hot' : r.score < 75 ? 'warm' : ''}" style="width:${r.score}%"></div></div>
    <ul class="small" style="margin:.4rem 0 0;padding-left:1.1rem">
      ${r.parts.map((x) => `<li>${esc(x.label)}</li>`).join('')}
    </ul>
    <p class="tiny dash__muted" style="margin-top:.6rem">This is how complete the application is against the
    criteria the funder published. It is not a probability of winning — nobody can compute that, and a number
    that looked like one would get planned around.</p>
  </section>`;
}

function checklistPanel(e) {
  const cov = checklistFor(e);
  if (!cov || !cov.required.length) {
    return `<section class="dash__section"><h2>Documents</h2>
    <p class="small dash__muted">This programme's record lists no required documents. That usually means the
    funder does not publish the list, not that there are none — check the official page.</p></section>`;
  }
  const have = new Set(cov.satisfied.map((r) => r.doc));
  return `<section class="dash__section">
    <div class="row-between">
      <h2>Document checklist</h2>
      <span class="small">${cov.satisfied.length} of ${cov.required.length}</span>
    </div>
    <div class="meter"><div class="meter__bar" style="width:${cov.pct}%"></div></div>
    <div class="list-rows">
      ${cov.required
        .map((r) => {
          const ok = have.has(r.doc);
          return `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${ok ? '✓ ' : ''}${esc(r.doc)}</div>
          <div class="list-row__meta">${r.mandatory ? 'Mandatory' : 'Optional'}${r.type !== 'other' ? ` · counts as ${esc(docLabel(r.type))}` : ' · nothing in the shared library matches this one'}</div>
        </div>
        <div class="list-row__right">${
          ok
            ? '<span class="status status--open">held</span>'
            : r.type === 'other'
              ? '<span class="status status--later">one-off</span>'
              : `<button class="btn btn-sm" data-action="new-document" data-type="${esc(r.type)}">Add it</button>`
        }</div>
      </div>`;
        })
        .join('')}
    </div>
    <p class="tiny dash__muted" style="margin-top:.6rem">Ticks come from the shared library, so adding one
    document here ticks it on every other application that wants the same thing.</p>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Auto-fill — "automatic grant filling", scoped honestly              */
/* ------------------------------------------------------------------ */

/**
 * What we can fill, what we filled it from, and what only a human can write.
 *
 * The last part is the point. Every grant tool promises to fill the form; the
 * useful version says which twelve of the nineteen fields it filled, names its
 * source for each so a reviewer can check it, and then lists the seven it will
 * not invent. An application containing a machine-written innovation claim
 * that the applicant then signs is a false declaration with their name on it.
 */
function autofillSection(c, p) {
  const proj = projectCompany({
    company: {
      legal_name: c.legal_name,
      company_number: c.company_number,
      incorporation_date: c.incorporation_date,
      registered_address: c.registered_address,
      company_status: c.company_status,
      industry_code: c.industry_code,
      industry_description: c.industry_description,
      headcount_band: c.headcount_band,
      /* Provenance is only claimed for a lookup we actually performed. The
         register adapters need a server-held API key, so until that is wired
         up every field here came from a human typing it, and labelling it
         "Public register" would put a false provenance in front of a reviewer. */
      source: c.registry_synced_at ? 'Public register' : 'You told us',
    },
    programme: p,
    profile: { ...companyProfile(c), vat_number: c.vat_number, ...(c.narrative || {}) },
  });

  const filled = Object.entries(proj.filled);
  const pct = Math.round((filled.length / (filled.length + proj.needs_narrative.length || 1)) * 100);

  return `
  <section class="dash__section">
    <div class="row-between">
      <h2>Application draft</h2>
      <div class="row">
        <button class="btn btn-sm" data-action="copy-fields" data-entry="${view.entryId}">Copy filled fields</button>
        <button class="btn btn-sm btn-ghost" data-action="download-pack" data-entry="${view.entryId}">Download pack</button>
      </div>
    </div>
    <div class="meter"><div class="meter__bar" style="width:${pct}%"></div></div>
    <p class="small">${esc(proj.honest_summary)}</p>

    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card">
        <h3 style="font-size:1rem">Filled — ${filled.length} fields</h3>
        <dl class="kv">
          ${filled
            .map(
              ([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(
                Array.isArray(v) ? v.join(', ') : String(v),
              )}<span class="tiny dash__muted"> — ${esc(proj.source[k] || 'you')}</span></dd></div>`,
            )
            .join('')}
        </dl>
      </div>
      <div class="card">
        <h3 style="font-size:1rem">Only you can write these — ${proj.needs_narrative.length}</h3>
        ${
          proj.needs_narrative.length
            ? `<ul class="small">${proj.needs_narrative.map((n) => `<li>${esc(n.label)}</li>`).join('')}</ul>
               <p class="tiny dash__muted">Write them once on the company and every application reuses them.</p>
               <button class="btn btn-sm" data-action="edit-company" data-id="${c.id}">Write them now</button>`
            : '<p class="small">All seven narrative answers are written. This application is ready to assemble.</p>'
        }
      </div>
    </div>

    ${
      (p.documents_required || []).length
        ? `<div class="card" style="margin-top:1rem">
        <h3 style="font-size:1rem">Documents the funder asks for</h3>
        <ul class="small">${p.documents_required
          .map((d) => `<li>${esc(d.doc)}${d.mandatory === false ? ' <span class="tiny dash__muted">(optional)</span>' : ''}${d.note ? ` — ${esc(d.note)}` : ''}</li>`)
          .join('')}</ul>
      </div>`
        : ''
    }

    ${
      (p.procedure_steps || []).length
        ? `<div class="card" style="margin-top:1rem">
        <h3 style="font-size:1rem">Steps, from the funder's own page</h3>
        <ol class="small">${p.procedure_steps
          .slice()
          .sort((a, b) => a.step - b.step)
          .map((s) => `<li>${esc(s.text || s.description || '')}</li>`)
          .join('')}</ol>
      </div>`
        : ''
    }

    <p class="tiny dash__muted" style="margin-top:1rem">We never sign in to a funder's portal as you and never
    press submit on your behalf. The pack is yours to check and send from your own account — a funding
    declaration is sworn by the person making it.</p>
  </section>`;
}

/** The downloadable pack: everything above, as text a human can paste. */
function packText(e) {
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  if (!p || !c) return '';
  const proj = projectCompany({
    company: {
      legal_name: c.legal_name, company_number: c.company_number,
      incorporation_date: c.incorporation_date,
      source: c.registry_synced_at ? 'Public register' : 'You told us',
    },
    programme: p,
    profile: { ...companyProfile(c), ...(c.narrative || {}) },
  });
  const lines = [
    `APPLICATION PACK — ${programmeName(p)}`,
    `Funder: ${p.funder || 'unknown'}`,
    `Applicant: ${c.legal_name}`,
    `Prepared: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'FILLED FIELDS',
    ...Object.entries(proj.filled).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}   [${proj.source[k] || 'you'}]`),
    '',
    'STILL NEEDED — nobody can write these for you',
    ...proj.needs_narrative.map((n) => `  - ${n.label}`),
    '',
    'DOCUMENTS REQUIRED',
    ...((p.documents_required || []).map((d) => `  - ${d.doc}${d.mandatory === false ? ' (optional)' : ''}`) || []),
    '',
    'STEPS',
    ...((p.procedure_steps || [])
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((s, i) => `  ${i + 1}. ${s.text || s.description || ''}`)),
    '',
    `Apply at: ${p.application_url || p.source_url || ''}`,
    `Source: ${p.source_url || ''} (last verified ${p.last_verified_at || 'unknown'})`,
    '',
    'This pack was assembled from published programme rules and the details you entered.',
    'Check every field before you submit. You submit it; we do not.',
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

function closingSoon(days) {
  const now = Date.now();
  const out = [];
  for (const e of ws.pipeline) {
    const p = programmeBySlug(e.slug);
    if (!p) continue;
    const d = deadlineState(p, now);
    if (d.at != null && d.at >= now && d.at - now <= days * DAY) out.push({ e, p, d });
  }
  return out.sort((a, b) => a.d.at - b.d.at);
}

function deadlineRow({ e, p, d }) {
  const c = companyById(e.company_id);
  const days = Math.max(0, d.days_until ?? 0);
  return `<button class="list-row list-row--btn" data-entry-open="${e.id}">
    <div class="list-row__body">
      <div class="list-row__name">${esc(programmeName(p))}</div>
      <div class="list-row__meta">${esc(c?.legal_name || '')} · ${esc(STAGES.find((s) => s.id === e.stage)?.label || e.stage)}</div>
    </div>
    <div class="list-row__right">
      <span class="status status--${days <= 7 ? 'closing' : 'open'}">${days === 0 ? 'closes today' : `${days} day${days === 1 ? '' : 's'}`}</span>
      <span class="tiny dash__muted">${fmtDate(d.at)}</span>
    </div>
  </button>`;
}

function deadlinesView() {
  const soon = closingSoon(365);
  const matches = ws.pipeline
    .map((e) => ({ programme: programmeBySlug(e.slug) }))
    .filter((m) => m.programme);
  const events = reminders(matches, Date.now());
  return `
  <header class="dash__head">
    <div><span class="eyebrow">${soon.length} dated</span><h1>Deadlines</h1></div>
    <button class="btn btn-sm" data-action="download-ics" ${events.length ? '' : 'disabled'}>Add to calendar (.ics)</button>
  </header>
  ${
    soon.length
      ? `<div class="list-rows">${soon.map(deadlineRow).join('')}</div>`
      : '<p class="small dash__muted">Nothing in the pipeline has a dated close. Rolling and always-open calls do not appear here — that is correct, not a gap.</p>'
  }
  <section class="dash__section">
    <h2>Closed, paused or undated</h2>
    <p class="small dash__muted">No date to plan around — either the call has closed for now or the funder
    publishes no calendar. Kept in view, because most awards come from a round somebody watched for.</p>
    <div class="list-rows">
      ${
        ws.pipeline
          .map((e) => ({ e, p: programmeBySlug(e.slug) }))
          .filter(({ p }) => p && ['later', 'stalled', 'unknown'].includes(deadlineState(p, Date.now()).urgency))
          .map(({ e, p }) => {
            const d = deadlineState(p, Date.now());
            return `<button class="list-row list-row--btn" data-entry-open="${e.id}">
              <div class="list-row__body"><div class="list-row__name">${esc(programmeName(p))}</div>
              <div class="list-row__meta">${esc(companyById(e.company_id)?.legal_name || '')} — ${esc(d.detail)}</div></div>
              <div class="list-row__right"><span class="status status--${esc(d.urgency)}">${esc(d.headline)}</span></div>
            </button>`;
          })
          .join('') || '<p class="small dash__muted">Everything in the pipeline has a date. Unusual and good.</p>'
      }
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* State aid                                                           */
/* ------------------------------------------------------------------ */

function awardsFor(companyId) {
  return ws.awards.filter((a) => a.company_id === companyId);
}

function companyHeadroom(c) {
  const ms = (c.country_code || '').toLowerCase();
  const list = awardsFor(c.id);
  try {
    const h = headroom(list, ms, Date.now());
    return {
      ...h,
      remaining: h.headroom_eur,
      pct: Math.min(100, Math.round((h.used_eur / h.ceiling_eur) * 100)),
    };
  } catch {
    return null;
  }
}

function aidCheck(c, p) {
  try {
    const r = canAccept({
      programme: p,
      awards: awardsFor(c.id),
      memberState: (c.country_code || '').toLowerCase(),
      asOf: Date.now(),
      amountEur: amountEur(p),
    });
    if (!r.applies) return null;
    if (r.allowed === true) return { ok: true, headline: 'De minimis, within the ceiling.', detail: r.message };
    return {
      ok: false,
      headline: r.allowed === null ? 'De minimis aid, amount not published.' : 'This award would breach the de minimis ceiling.',
      detail: r.message,
    };
  } catch {
    return null;
  }
}

function stateaidView() {
  if (!ws.companies.length) {
    return empty('Add a company first.', 'The ledger is per company per member state.', '<button class="btn btn-primary" data-action="new-company">Add a company</button>');
  }
  return `
  <header class="dash__head">
    <div><span class="eyebrow">€${nf(DE_MINIMIS_CEILING_EUR)} per company per member state, rolling ${36} months</span><h1>State aid ledger</h1></div>
    <button class="btn btn-sm btn-primary" data-action="new-award">Record an award</button>
  </header>

  <div class="callout">
    <p><strong>Why this exists.</strong> ${esc(REGULATION.general.id)}, ${esc(REGULATION.general.article)}:
    go over the ceiling and the new award is disqualified in full — it is not reduced to the remaining
    headroom. Companies find this out after the work, which is the expensive time to find it out.</p>
  </div>

  ${ws.companies
    .map((c) => {
      const h = companyHeadroom(c);
      const list = awardsFor(c.id).slice().sort((a, b) => (b.granted_at || 0) - (a.granted_at || 0));
      return `<section class="dash__section">
      <div class="row-between">
        <h2>${esc(c.legal_name)}</h2>
        ${h ? `<span class="small">${money(h.remaining, 'EUR')} of room</span>` : ''}
      </div>
      ${h ? `<div class="meter"><div class="meter__bar meter__bar--${h.pct > 80 ? 'hot' : h.pct > 50 ? 'warm' : ''}" style="width:${h.pct}%"></div></div>` : ''}
      ${
        list.length
          ? `<div class="list-rows">${list
              .map(
                (a) => `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${esc(a.programme || 'Award')}</div>
          <div class="list-row__meta">${esc((a.member_state || '').toUpperCase())} · granted ${fmtDate(a.granted_at)}</div>
        </div>
        <div class="list-row__right"><strong>${esc(money(a.amount_eur, 'EUR'))}</strong>
        <button class="btn btn-sm btn-ghost" data-action="remove-award" data-id="${a.id}">Remove</button></div>
      </div>`,
              )
              .join('')}</div>`
          : '<p class="small dash__muted">No de minimis aid recorded. If this company has taken small public grants in the last three years, they count — record them here before the next application.</p>'
      }
      ${list.length ? `<details class="dash__details"><summary>Declaration text for this company</summary><pre class="pre">${esc(declarationText(list, (c.country_code || '').toLowerCase(), Date.now()))}</pre></details>` : ''}
    </section>`;
    })
    .join('')}`;
}

/* ------------------------------------------------------------------ */
/* Grant entry                                                         */
/* ------------------------------------------------------------------ */

/**
 * Add a programme the dataset does not have.
 *
 * Funds and accelerators track calls we have not curated — a regional fund, a
 * corporate call, an internal budget line. Rather than have those live in a
 * spreadsheet beside the dashboard, they are entered here in the same shape as
 * a shipped record, so they match, rank, deadline-track and generate a pack
 * like everything else. They are marked `own_record` so nobody mistakes one
 * for something we verified.
 */
function grantsView() {
  return `
  <header class="dash__head">
    <div><span class="eyebrow">Your own records</span><h1>Grant entry</h1></div>
    <button class="btn btn-sm btn-primary" data-action="new-grant">Add a programme</button>
  </header>
  <p class="small dash__muted" style="max-width:60ch">Programmes you enter here are matched, ranked and
  deadline-tracked exactly like the ${'ones we ship'} — and clearly marked as yours, because we did not
  verify them and should not appear to have done.</p>
  ${
    ws.grants.length
      ? `<div class="list-rows" style="margin-top:1.2rem">${ws.grants
          .map(
            (g) => `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${esc(g.name_en)} <span class="pill">yours</span></div>
          <div class="list-row__meta">${esc(g.funder || '')} · ${esc((g.country_code || 'global').toUpperCase())} · ${esc(INSTRUMENTS[g.grant_type]?.label || g.grant_type)}</div>
          <div class="list-row__meta">${g.amount_max != null ? esc(money(g.amount_max, g.amount_currency)) : '<span class="dash__muted">amount not published</span>'}${g.deadline ? ` · closes ${esc(g.deadline)}` : ''}</div>
        </div>
        <div class="list-row__right">
          <button class="btn btn-sm" data-action="edit-grant" data-id="${g.slug}">Edit</button>
          <button class="btn btn-sm btn-ghost" data-action="remove-grant" data-id="${g.slug}">Remove</button>
        </div>
      </div>`,
          )
          .join('')}</div>`
      : `<div class="dash__empty"><p class="small">Nothing entered yet.</p></div>`
  }`;
}

function grantFormView(g) {
  const v = (k, d = '') => esc(g?.[k] ?? d);
  return `
  <header class="dash__head">
    <div><span class="eyebrow">${g ? 'Edit' : 'New'}</span><h1>${g ? esc(g.name_en) : 'Add a programme'}</h1></div>
    <button class="btn btn-sm btn-ghost" data-view="grants">Cancel</button>
  </header>
  <form class="dash__form" id="grant-form" data-slug="${esc(g?.slug || '')}">
    <div class="fieldgrid">
      <label class="fld"><span>Programme name</span><input class="field" name="name_en" value="${v('name_en')}" required></label>
      <label class="fld"><span>Funder</span><input class="field" name="funder" value="${v('funder')}"></label>
      <label class="fld"><span>Country (or "global")</span><input class="field" name="country_code" value="${v('country_code')}" placeholder="gb"></label>
      <label class="fld"><span>Instrument</span><select class="field" name="grant_type">
        ${Object.entries(INSTRUMENTS).map(([k, i]) => `<option value="${k}"${g?.grant_type === k ? ' selected' : ''}>${esc(i.label)}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Amount, minimum</span><input class="field" type="number" name="amount_min" value="${v('amount_min')}"></label>
      <label class="fld"><span>Amount, maximum</span><input class="field" type="number" name="amount_max" value="${v('amount_max')}"></label>
      <label class="fld"><span>Currency</span><input class="field" name="amount_currency" value="${v('amount_currency', 'EUR')}" maxlength="3"></label>
      <label class="fld"><span>Closes on</span><input class="field" type="date" name="deadline" value="${v('deadline')}"></label>
      <label class="fld"><span>Application URL</span><input class="field" type="url" name="application_url" value="${v('application_url')}"></label>
      <label class="fld"><span>Max company age (months)</span><input class="field" type="number" name="company_age_months_max" value="${esc(g?.eligibility?.company_age_months_max ?? '')}"></label>
      <label class="fld"><span>Max headcount</span><input class="field" type="number" name="headcount_max" value="${esc(g?.eligibility?.headcount_max ?? '')}"></label>
    </div>
    <label class="chk"><input type="checkbox" name="de_minimis"${g?.eligibility?.de_minimis ? ' checked' : ''}> Counts against the de minimis ceiling</label>
    <label class="fld"><span>Notes on the amount</span><textarea class="field" name="amount_note" rows="2">${v('amount_note')}</textarea></label>
    <p class="tiny dash__muted">Leave an amount blank if the programme does not publish one. A guessed
    figure propagates into your pipeline total and into whatever you report from it.</p>
    <div class="row" style="margin-top:1.2rem"><button class="btn btn-primary" type="submit">Save programme</button></div>
  </form>`;
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

function reportsView() {
  const rate = hitRate(ws.pipeline);
  const value = pipelineValue(ws.pipeline);
  const byStage = STAGES.map((s) => {
    const entries = ws.pipeline.filter((e) => e.stage === s.id);
    return { s, n: entries.length, v: pipelineValue(entries).eur };
  });
  const max = Math.max(1, ...byStage.map((b) => b.n));
  const awarded = ws.pipeline.filter((e) => e.stage === 'awarded');
  const awardedValue = pipelineValue(awarded);

  return `
  <header class="dash__head">
    <div><span class="eyebrow">Board-ready</span><h1>Reports</h1></div>
    <button class="btn btn-sm btn-ghost" data-action="export-pipeline">Export CSV</button>
  </header>

  <div class="grid grid-4 dash__stats">
    ${stat(money(awardedValue.eur, 'EUR') || '€0', 'Awarded to date', `${awarded.length} awards`)}
    ${stat(money(value.eur, 'EUR') || '€0', 'Open pipeline', `${value.unpriced} unpriced`)}
    ${stat(rate.pct == null ? '—' : `${rate.pct}%`, 'Hit rate', `${rate.won} won / ${rate.lost} lost`)}
    ${stat(nf(ws.companies.length), 'Companies', 'in the portfolio')}
  </div>

  <section class="dash__section">
    <h2>Funnel</h2>
    <div class="funnel">
      ${byStage
        .map(
          (b) => `<div class="funnel__row">
        <span class="funnel__label">${esc(b.s.label)}</span>
        <span class="funnel__bar" style="width:${Math.round((b.n / max) * 100)}%"></span>
        <span class="funnel__n">${b.n}${b.v ? ` · ${money(b.v, 'EUR')}` : ''}</span>
      </div>`,
        )
        .join('')}
    </div>
    <p class="tiny dash__muted">Counts, not conversions. A funnel that showed conversion rates off six
    applications would be a chart of noise.</p>
  </section>

  <section class="dash__section">
    <h2>What the numbers exclude</h2>
    <ul class="small">
      <li>${value.unpriced} pipeline entries publish no amount and count as zero. The real pipeline is larger.</li>
      <li>Loans, equity and in-kind credits are not added to grant totals anywhere on this page.</li>
      <li>Hit rate counts only decided applications. ${ws.pipeline.filter((e) => e.stage === 'submitted').length} are still out.</li>
      <li>Amounts published in other currencies are converted at a fixed reference rate for totals only, never for a figure shown against one programme.</li>
    </ul>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Applications — created automatically, never by hand                 */
/* ------------------------------------------------------------------ */

/**
 * Turn an opportunity into an application record.
 *
 * "Automatic application entries" means this: the moment a programme enters
 * the pipeline it becomes a row in the applications log, with the reference,
 * the amount the funder publishes, the document checklist derived from that
 * programme's own `documents_required`, and the owner inherited from the
 * company. Nothing about it waits for a human to fill a form.
 *
 * What it does NOT do is invent facts. `requested_eur` starts at the published
 * ceiling because that is a published number; the narrative fields start empty
 * because nobody has written them; `submitted_at` stays null until someone
 * says it was submitted, because the log is evidence and a guessed date in it
 * is worse than a blank.
 */
function addApplication(companyId, slug, { projectId = null } = {}) {
  const p = programmeBySlug(slug);
  const c = companyById(companyId);
  const required = (p?.documents_required || [])
    .map((d) => ({ doc: d.doc, mandatory: d.mandatory !== false, type: classifyRequirement(d.doc) }))
    .filter((r) => r.type !== 'not_required');

  return {
    id: uid(),
    company_id: companyId,
    project_id: projectId,
    slug,
    /* Human-readable and stable, so it can be quoted in an email to a funder
       before the funder has issued a reference of their own. */
    reference: `UG-${(c?.legal_name || 'CO').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'CO'}-${String(ws.pipeline.length + 1).padStart(3, '0')}`,
    stage: 'watch',
    owner: c?.owner || '',
    value_eur: null,
    requested_eur: amountEur(p),
    awarded_eur: null,
    submitted_at: null,
    decided_at: null,
    funder_reference: '',
    next_action: '',
    due: '',
    notes: '',
    /* One entry per document the funder asks for, resolved against the shared
       library at render time rather than copied — a document added later must
       tick this checklist without anyone reopening the application. */
    required_docs: required,
    auto: true,
    created_at: Date.now(),
  };
}

const applicationsFor = (companyId) => ws.pipeline.filter((e) => e.company_id === companyId);

/** Applications that have actually been sent — the log a board asks about. */
const submitted = () => ws.pipeline.filter((e) => e.submitted_at || ['submitted', 'awarded', 'declined'].includes(e.stage));

/* ------------------------------------------------------------------ */
/* Documents — held once, counted everywhere                           */
/* ------------------------------------------------------------------ */

/**
 * Holdings visible to one application.
 *
 * A document belongs either to a company or to the whole workspace. Shared is
 * the default for things like a standard capability statement; company-scoped
 * for a certificate of incorporation. Both are in scope for that company's
 * applications, and only those.
 */
function holdingsFor(companyId) {
  return ws.documents
    .filter((d) => !d.company_id || d.company_id === companyId)
    .map((d) => ({ id: d.id, type: d.type, issuedAt: d.issued_at ? Date.parse(d.issued_at) : null, createdAt: d.added_at }));
}

/** Checklist state for one application, resolved live against the library. */
function checklistFor(e) {
  const p = programmeBySlug(e.slug);
  if (!p) return null;
  return coverageFor(p, holdingsFor(e.company_id), Date.now());
}

/* ------------------------------------------------------------------ */
/* Issue flagging                                                      */
/* ------------------------------------------------------------------ */

/**
 * Everything wrong with an application, found rather than waited for.
 *
 * Ordered by how expensive the mistake is: a de minimis breach disqualifies
 * the award in full and is worth knowing before anyone drafts; a missing
 * optional document is worth knowing the week before submission. Each issue
 * names the fix, because a warning you cannot act on is just anxiety.
 */
function issuesFor(e) {
  const out = [];
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  if (!p || !c) return out;
  const now = Date.now();

  const aid = aidCheck(c, p);
  if (aid && !aid.ok && aid.headline.includes('breach')) {
    out.push({ level: 'block', title: 'Would breach the de minimis ceiling', detail: aid.detail, fix: 'Record the earlier awards, or wait for headroom to free up.' });
  }

  const cov = checklistFor(e);
  if (cov) {
    const missingMandatory = cov.missing.filter((r) => r.mandatory && r.type !== 'other');
    if (missingMandatory.length) {
      out.push({
        level: 'warn',
        title: `${missingMandatory.length} mandatory document${missingMandatory.length === 1 ? '' : 's'} missing`,
        detail: missingMandatory.map((r) => r.doc).join('; '),
        fix: 'Add them once in Documents and every other application that wants them ticks too.',
      });
    }
    if (cov.stale.length) {
      out.push({ level: 'warn', title: `${cov.stale.length} document${cov.stale.length === 1 ? '' : 's'} out of date`, detail: 'Held, but past the validity window for this kind of evidence.', fix: 'Replace the expired copy in Documents.' });
    }
  }

  const d = deadlineState(p, now);
  if (d.days_until != null && d.days_until <= 14 && ['watch', 'drafting'].includes(e.stage)) {
    out.push({ level: 'urgent', title: d.headline, detail: `Still at "${STAGES.find((s) => s.id === e.stage)?.label}" with ${d.days_until} day${d.days_until === 1 ? '' : 's'} to go.`, fix: 'Move it forward or drop it, but do not leave it here.' });
  }
  if (d.stale) {
    out.push({ level: 'warn', title: 'The published deadline has passed', detail: d.detail, fix: "Check the funder's page for a new round." });
  }

  const cofunding = p.cofunding_pct ?? 0;
  if (cofunding > 0 && c.has_cofunding !== true) {
    const need = amountEur(p) != null ? money((amountEur(p) * cofunding) / (100 - cofunding), 'EUR') : null;
    out.push({
      level: 'warn',
      title: `Needs ${cofunding}% co-funding`,
      detail: need ? `Roughly ${need} of your own money alongside the grant.` : 'The funder covers only part of the project cost.',
      fix: 'Confirm the co-funding on the company, or deprioritise this one.',
    });
  }

  const narrative = c.narrative || {};
  const unwritten = NARRATIVE_FIELDS.filter((f) => !narrative[f.field]);
  if (unwritten.length) {
    out.push({ level: 'info', title: `${unwritten.length} narrative answer${unwritten.length === 1 ? '' : 's'} unwritten`, detail: unwritten.slice(0, 3).map((f) => f.label).join('; '), fix: 'Write them once on the company; every application reuses them.' });
  }

  if (e.stage === 'submitted' && !e.submitted_at) {
    out.push({ level: 'info', title: 'Marked submitted with no date', detail: 'The applications log shows a blank where the submission date should be.', fix: 'Set the date on the application.' });
  }

  const RANK = { block: 0, urgent: 1, warn: 2, info: 3 };
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

const allIssues = () => ws.pipeline.flatMap((e) => issuesFor(e).map((i) => ({ ...i, entry: e })));

/* ------------------------------------------------------------------ */
/* Readiness score                                                     */
/* ------------------------------------------------------------------ */

/**
 * How ready this application is, against the programme's own published
 * criteria. Not a prediction of whether it will win.
 *
 * That distinction is the whole design. A number labelled "score" next to a
 * grant application will be read as a probability, and a probability we cannot
 * measure is a made-up number that people plan around. So every component here
 * is something countable that the funder actually published: rules passed,
 * documents held, narrative answers written, issues outstanding. The panel
 * shows the components, not just the total, so the number can be argued with.
 */
function readinessFor(e) {
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  if (!p || !c) return null;

  const parts = [];

  const verdict = (matchFor(c).buckets.eligible || []).some((m) => m.programme.slug === p.slug)
    ? { got: 1, of: 1, label: 'Passes every published eligibility rule' }
    : (matchFor(c).buckets.needs_answer || []).some((m) => m.programme.slug === p.slug)
      ? { got: 0.5, of: 1, label: 'One eligibility field still blank' }
      : { got: 0, of: 1, label: 'Fails at least one published rule' };
  parts.push({ ...verdict, weight: 3 });

  const cov = checklistFor(e);
  parts.push({
    got: cov ? cov.satisfied.length : 0,
    of: cov ? Math.max(1, cov.required.length) : 1,
    label: cov && cov.required.length ? `${cov.satisfied.length} of ${cov.required.length} documents held` : 'No documents required',
    weight: 2,
  });

  const narrative = c.narrative || {};
  const written = NARRATIVE_FIELDS.filter((f) => narrative[f.field]).length;
  parts.push({ got: written, of: NARRATIVE_FIELDS.length, label: `${written} of ${NARRATIVE_FIELDS.length} narrative answers written`, weight: 3 });

  const blocking = issuesFor(e).filter((i) => i.level === 'block' || i.level === 'urgent').length;
  parts.push({ got: blocking ? 0 : 1, of: 1, label: blocking ? `${blocking} blocking issue${blocking === 1 ? '' : 's'}` : 'No blocking issues', weight: 2 });

  const total = parts.reduce((s, x) => s + x.weight, 0);
  const score = Math.round((parts.reduce((s, x) => s + (x.got / x.of) * x.weight, 0) / total) * 100);
  return { score, parts };
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function projectsView() {
  if (!ws.companies.length) {
    return empty('Add a company first.', 'A project belongs to a company, and gets pitched to several calls.', '<button class="btn btn-primary" data-action="new-company">Add a company</button>');
  }
  return `
  <header class="dash__head">
    <div><span class="eyebrow">What you are actually funding</span><h1>Projects</h1></div>
    <button class="btn btn-sm btn-primary" data-action="new-project">Add a project</button>
  </header>
  <p class="small dash__muted" style="max-width:62ch">Most funders fund a project, not a company, and the same
  project goes to several calls. Grouping applications by project is what lets you answer "how much have we
  raised for this" without adding the rows up by hand.</p>
  ${
    ws.projects.length
      ? `<div class="list-rows" style="margin-top:1.2rem">${ws.projects
          .map((pr) => {
            const apps = ws.pipeline.filter((e) => e.project_id === pr.id);
            const won = apps.filter((e) => e.stage === 'awarded');
            const wonEur = won.reduce((s, e) => s + (e.awarded_eur ?? 0), 0);
            return `<button class="list-row list-row--btn" data-project="${pr.id}">
        <div class="list-row__body">
          <div class="list-row__name">${esc(pr.name)}</div>
          <div class="list-row__meta">${esc(companyById(pr.company_id)?.legal_name || 'unknown company')}${pr.budget_eur ? ` · budget ${esc(money(pr.budget_eur, 'EUR'))}` : ''}</div>
          <div class="list-row__meta">${apps.length} application${apps.length === 1 ? '' : 's'} · ${won.length} awarded${wonEur ? ` · ${esc(money(wonEur, 'EUR'))} raised` : ''}</div>
        </div>
        <div class="list-row__right">${
          pr.budget_eur && wonEur
            ? `<span class="status status--${wonEur >= pr.budget_eur ? 'open' : 'soon'}">${Math.round((wonEur / pr.budget_eur) * 100)}% funded</span>`
            : ''
        }</div>
      </button>`;
          })
          .join('')}</div>`
      : '<div class="dash__empty" style="margin-top:1.2rem"><p class="small">No projects yet. Applications work without one — this is for when the same project goes to more than one funder.</p></div>'
  }`;
}

function projectFormView(pr) {
  const v = (k, d = '') => esc(pr?.[k] ?? d);
  return `
  <header class="dash__head">
    <div><span class="eyebrow">${pr?.id ? 'Edit' : 'New'}</span><h1>${pr?.id ? esc(pr.name) : 'Add a project'}</h1></div>
    <button class="btn btn-sm btn-ghost" data-view="projects">Cancel</button>
  </header>
  <form class="dash__form" id="project-form" data-id="${pr?.id || ''}">
    <div class="fieldgrid">
      <label class="fld"><span>Project name</span><input class="field" name="name" value="${v('name')}" required></label>
      <label class="fld"><span>Company</span><select class="field" name="company_id">
        ${ws.companies.map((c) => `<option value="${c.id}"${pr?.company_id === c.id ? ' selected' : ''}>${esc(c.legal_name)}</option>`).join('')}
      </select></label>
      <label class="fld"><span>Total budget (EUR)</span><input class="field" type="number" name="budget_eur" value="${v('budget_eur')}"></label>
      <label class="fld"><span>Starts</span><input class="field" type="date" name="starts" value="${v('starts')}"></label>
      <label class="fld"><span>Ends</span><input class="field" type="date" name="ends" value="${v('ends')}"></label>
    </div>
    <label class="fld"><span>What the project does</span><textarea class="field" name="summary" rows="4">${v('summary')}</textarea></label>
    <div class="row" style="margin-top:1rem">
      <button class="btn btn-primary" type="submit">Save</button>
      ${pr?.id ? `<button class="btn btn-ghost" type="button" data-action="delete-project" data-id="${pr.id}">Delete</button>` : ''}
    </div>
  </form>`;
}

function projectView() {
  const pr = ws.projects.find((x) => x.id === view.projectId);
  if (!pr) return empty('That project is gone.', '', '<button class="btn" data-view="projects">Back</button>');
  const apps = ws.pipeline.filter((e) => e.project_id === pr.id);
  return `
  <header class="dash__head">
    <div>
      <button class="dash__back" data-view="projects">← Projects</button>
      <h1>${esc(pr.name)}</h1>
      <p class="small dash__muted">${esc(companyById(pr.company_id)?.legal_name || '')}</p>
    </div>
    <button class="btn btn-sm" data-action="edit-project" data-id="${pr.id}">Edit</button>
  </header>
  ${pr.summary ? `<p class="small" style="max-width:64ch">${esc(pr.summary)}</p>` : ''}
  <section class="dash__section">
    <h2>Applications for this project</h2>
    ${apps.length ? `<div class="list-rows">${apps.map(applicationRow).join('')}</div>` : '<p class="small dash__muted">None yet. Add an opportunity from the company or the portfolio view and set its project.</p>'}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */

function applicationRow(e) {
  const p = programmeBySlug(e.slug);
  const c = companyById(e.company_id);
  const r = readinessFor(e);
  const issues = issuesFor(e);
  const blocking = issues.filter((i) => i.level === 'block' || i.level === 'urgent').length;
  return `<button class="list-row list-row--btn" data-entry-open="${e.id}">
    <div class="list-row__body">
      <div class="list-row__name">${esc(programmeName(p))}</div>
      <div class="list-row__meta">${esc(e.reference || '')} · ${esc(c?.legal_name || '')}${e.owner ? ` · ${esc(e.owner)}` : ''}</div>
      <div class="list-row__meta">
        ${e.submitted_at ? `submitted ${fmtDate(Date.parse(e.submitted_at))}` : 'not yet submitted'}
        ${e.requested_eur != null ? ` · asked ${esc(money(e.requested_eur, 'EUR'))}` : ''}
        ${e.awarded_eur != null ? ` · <strong>awarded ${esc(money(e.awarded_eur, 'EUR'))}</strong>` : ''}
      </div>
    </div>
    <div class="list-row__right">
      ${blocking ? `<span class="status status--closing">${blocking} to fix</span>` : ''}
      ${r ? `<span class="pill">${r.score}% ready</span>` : ''}
      <span class="status status--${e.stage === 'awarded' ? 'open' : e.stage === 'declined' ? 'stalled' : e.stage === 'submitted' ? 'soon' : 'later'}">${esc(STAGES.find((s) => s.id === e.stage)?.label || e.stage)}</span>
    </div>
  </button>`;
}

function applicationsView() {
  if (!ws.pipeline.length) {
    return empty(
      'No applications yet.',
      'Every opportunity you add becomes an application record here automatically, with its own reference, checklist and log.',
      '<button class="btn btn-primary" data-view="opportunities">Find opportunities</button>',
    );
  }
  const sent = submitted();
  const awarded = ws.pipeline.filter((e) => e.stage === 'awarded');
  const askedTotal = sent.reduce((s, e) => s + (e.requested_eur ?? 0), 0);
  const wonTotal = awarded.reduce((s, e) => s + (e.awarded_eur ?? 0), 0);
  const rate = hitRate(ws.pipeline);

  const group = (title, list, blurb) =>
    list.length
      ? `<section class="dash__section"><h2>${esc(title)} <span class="dash__muted">${list.length}</span></h2>
      ${blurb ? `<p class="small dash__muted">${blurb}</p>` : ''}
      <div class="list-rows">${list.map(applicationRow).join('')}</div></section>`
      : '';

  return `
  <header class="dash__head">
    <div><span class="eyebrow">Every grant applied for</span><h1>Applications</h1></div>
    <button class="btn btn-sm btn-ghost" data-action="export-applications">Export CSV</button>
  </header>

  <div class="grid grid-4 dash__stats">
    ${stat(nf(ws.pipeline.length), 'Applications', 'created automatically')}
    ${stat(nf(sent.length), 'Submitted', askedTotal ? `${money(askedTotal, 'EUR')} requested` : 'no amounts recorded')}
    ${stat(money(wonTotal, 'EUR') || '€0', 'Awarded', `${awarded.length} won`)}
    ${stat(rate.pct == null ? '—' : `${rate.pct}%`, 'Hit rate', rate.decided ? `${rate.decided} decided` : 'nothing decided yet')}
  </div>

  ${group('Awarded', awarded, 'What came in, and what it was for.')}
  ${group('With the funder', ws.pipeline.filter((e) => e.stage === 'submitted'), 'Submitted and awaiting a decision.')}
  ${group('Being written', ws.pipeline.filter((e) => e.stage === 'drafting'))}
  ${group('Watching', ws.pipeline.filter((e) => e.stage === 'watch'), 'Eligible, not started.')}
  ${group('Blocked', ws.pipeline.filter((e) => e.stage === 'blocked'), 'Something has to be resolved before these can move.')}
  ${group('Declined', ws.pipeline.filter((e) => e.stage === 'declined'), 'Kept, because most of these run again.')}`;
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

function documentsView() {
  const progs = ws.pipeline.map((e) => programmeBySlug(e.slug)).filter(Boolean);
  /* Which single missing document unblocks the most applications. This is the
     entire reason to hold documents centrally rather than per application. */
  const unlocks = new Map();
  for (const e of ws.pipeline) {
    const cov = checklistFor(e);
    if (!cov) continue;
    for (const r of cov.missing) {
      if (r.type === 'other') continue;
      if (!unlocks.has(r.type)) unlocks.set(r.type, { type: r.type, label: docLabel(r.type), count: 0 });
      unlocks.get(r.type).count += 1;
    }
  }
  const ranked = [...unlocks.values()].sort((a, b) => b.count - a.count);

  return `
  <header class="dash__head">
    <div><span class="eyebrow">Held once, reused everywhere</span><h1>Documents</h1></div>
    <button class="btn btn-sm btn-primary" data-action="new-document">Add a document</button>
  </header>

  <p class="small dash__muted" style="max-width:64ch">Every application asks for the same handful of things.
  Record a document here once and it ticks itself off on every application that wants it — including ones you
  add next month. ${progs.length ? `Checked against the ${progs.length} programme${progs.length === 1 ? '' : 's'} in your pipeline.` : ''}</p>

  ${
    ranked.length
      ? `<section class="dash__section">
    <h2>Add these first</h2>
    <p class="small dash__muted">Ordered by how many applications each one unblocks.</p>
    <div class="list-rows">
      ${ranked
        .slice(0, 8)
        .map(
          (u) => `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${esc(u.label)}</div>
          <div class="list-row__meta">Wanted by ${u.count} application${u.count === 1 ? '' : 's'}</div>
        </div>
        <div class="list-row__right"><button class="btn btn-sm" data-action="new-document" data-type="${esc(u.type)}">Add</button></div>
      </div>`,
        )
        .join('')}
    </div>
  </section>`
      : ''
  }

  <section class="dash__section">
    <h2>Your library <span class="dash__muted">${ws.documents.length}</span></h2>
    ${
      ws.documents.length
        ? `<div class="list-rows">${ws.documents
            .map((d) => {
              const expired = isExpired({ type: d.type, issuedAt: d.issued_at ? Date.parse(d.issued_at) : null, createdAt: d.added_at }, Date.now());
              return `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${esc(d.label || docLabel(d.type))}</div>
          <div class="list-row__meta">${esc(docLabel(d.type))} · ${d.company_id ? esc(companyById(d.company_id)?.legal_name || 'a company') : 'shared across the workspace'}${d.issued_at ? ` · issued ${esc(d.issued_at)}` : ''}</div>
        </div>
        <div class="list-row__right">
          ${expired ? '<span class="status status--closing">out of date</span>' : '<span class="status status--open">current</span>'}
          <button class="btn btn-sm btn-ghost" data-action="remove-document" data-id="${d.id}">Remove</button>
        </div>
      </div>`;
            })
            .join('')}</div>`
        : '<p class="small dash__muted">Nothing recorded yet.</p>'
    }
  </section>

  <div class="callout" style="margin-top:1.6rem">
    <p><strong>This records that you hold a document, not the document.</strong> The encrypted file store needs
    the hosted service, and telling you a file is safely kept when it is not would be the worst kind of
    reassurance. What this gives you today is the checklist: what each funder asks for, what you already have,
    and what is out of date.</p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Post-award                                                          */
/* ------------------------------------------------------------------ */

const OBLIGATION_KINDS = [
  ['milestone', 'Milestone'],
  ['report', 'Report'],
  ['deliverable', 'Deliverable'],
  ['payment', 'Payment claim'],
];

function postawardView() {
  const awarded = ws.pipeline.filter((e) => e.stage === 'awarded');
  if (!awarded.length) {
    return empty(
      'Nothing awarded yet.',
      'When an application is marked awarded, its reporting obligations live here — milestones, reports, deliverables and payment claims, each with a date.',
      '<button class="btn btn-primary" data-view="applications">Applications</button>',
    );
  }
  const now = Date.now();
  const items = ws.postaward
    .slice()
    .sort((a, b) => (Date.parse(a.due || '') || 9e15) - (Date.parse(b.due || '') || 9e15));
  const overdue = items.filter((i) => !i.done && i.due && Date.parse(i.due) < now);

  return `
  <header class="dash__head">
    <div><span class="eyebrow">${awarded.length} awarded · ${items.filter((i) => !i.done).length} outstanding</span><h1>Post-award</h1></div>
    <div class="row">
      <button class="btn btn-sm btn-primary" data-action="new-obligation">Add an obligation</button>
      <button class="btn btn-sm btn-ghost" data-action="download-postaward-ics"${items.some((i) => i.due) ? '' : ' disabled'}>Add to calendar</button>
    </div>
  </header>

  ${overdue.length ? `<div class="callout callout--warn"><p><strong>${overdue.length} overdue.</strong> Late reporting is the most common reason a paid grant is clawed back — the money arrived, so nobody is chasing it, and the deadline passes.</p></div>` : ''}

  ${
    items.length
      ? `<div class="list-rows">${items
          .map((i) => {
            const e = ws.pipeline.find((x) => x.id === i.application_id);
            const p = e ? programmeBySlug(e.slug) : null;
            const late = !i.done && i.due && Date.parse(i.due) < now;
            const days = i.due ? Math.round((Date.parse(i.due) - now) / DAY) : null;
            return `<div class="list-row">
        <div class="list-row__body">
          <div class="list-row__name">${i.done ? '<span class="dash__muted">✓ </span>' : ''}${esc(i.title)}</div>
          <div class="list-row__meta">${esc(OBLIGATION_KINDS.find((k) => k[0] === i.kind)?.[1] || i.kind)} · ${esc(p ? programmeName(p) : 'unlinked')} · ${esc(companyById(e?.company_id)?.legal_name || '')}</div>
        </div>
        <div class="list-row__right">
          ${i.due ? `<span class="status status--${i.done ? 'later' : late ? 'closing' : days <= 30 ? 'soon' : 'open'}">${late ? 'overdue' : i.done ? 'done' : `${days} day${days === 1 ? '' : 's'}`} · ${fmtDate(Date.parse(i.due))}</span>` : ''}
          <button class="btn btn-sm" data-action="toggle-obligation" data-id="${i.id}">${i.done ? 'Reopen' : 'Done'}</button>
          <button class="btn btn-sm btn-ghost" data-action="remove-obligation" data-id="${i.id}">Remove</button>
        </div>
      </div>`;
          })
          .join('')}</div>`
      : '<p class="small dash__muted">No obligations recorded. Add the reporting dates from your grant agreement — they are the ones nobody diarises.</p>'
  }`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

const VIEWS = {
  overview: overviewView,
  companies: companiesView,
  company: companyView,
  'company-form': () => companyFormView(view.companyId ? companyById(view.companyId) : null),
  opportunities: opportunitiesView,
  pipeline: pipelineView,
  entry: entryView,
  deadlines: deadlinesView,
  stateaid: stateaidView,
  grants: grantsView,
  'grant-form': () => grantFormView(ws.grants.find((g) => g.slug === view.grantSlug) || null),
  reports: reportsView,
  projects: projectsView,
  project: projectView,
  'project-form': () => projectFormView(ws.projects.find((x) => x.id === view.projectId) || null),
  applications: applicationsView,
  documents: documentsView,
  postaward: postawardView,
};

function render() {
  const root = $('#dashboard');
  if (!root) return;
  root.innerHTML = chrome((VIEWS[view.name] || overviewView)());
}

function go(name, patch = {}) {
  Object.assign(view, patch, { name });
  render();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
/* Files in and out                                                    */
/* ------------------------------------------------------------------ */

function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

function exportPipeline() {
  const rows = [['company', 'programme', 'funder', 'stage', 'value_eur', 'owner', 'next_action', 'due', 'closes', 'application_url']];
  for (const e of ws.pipeline) {
    const p = programmeBySlug(e.slug);
    const c = companyById(e.company_id);
    const d = p ? deadlineState(p, Date.now()) : null;
    rows.push([
      c?.legal_name, programmeName(p), p?.funder, e.stage, e.value_eur ?? amountEur(p),
      e.owner, e.next_action, e.due, d?.at ? new Date(d.at).toISOString().slice(0, 10) : '',
      p?.application_url,
    ]);
  }
  download('unclaimed-pipeline.csv', toCsv(rows), 'text/csv');
}

/**
 * CSV import.
 *
 * Deliberately forgiving about headers and deliberately strict about what it
 * will invent, which is nothing: an unrecognised column is reported, not
 * guessed at. Someone pasting a portfolio export should not have to discover
 * later that a mis-mapped column quietly became the headcount.
 */
const IMPORT_ALIASES = {
  legal_name: ['legal_name', 'name', 'company', 'company_name', 'entity', 'portfolio_company'],
  country_code: ['country_code', 'country', 'cc', 'jurisdiction'],
  company_number: ['company_number', 'number', 'reg_no', 'registration_number', 'crn'],
  incorporation_date: ['incorporation_date', 'incorporated', 'founded', 'incorporated_on'],
  headcount: ['headcount', 'employees', 'fte', 'staff'],
  turnover_annual_eur: ['turnover_annual_eur', 'turnover', 'revenue'],
  stage: ['stage', 'round'],
  owner: ['owner', 'manager', 'analyst'],
};

function parseCsv(text) {
  /* A real parser, because portfolio exports contain commas inside company
     names and a split(',') import corrupts exactly the rows people notice
     last. */
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, skipped: 0, unmapped: [] };
  /* Normalise spaces and hyphens to underscores before matching, so "Company
     Name", "company-name" and "company_name" are the same header. Every
     unmatched header is one more column silently dropped from someone's
     import, and portfolio exports never agree on the separator. */
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const map = {};
  for (const [field, aliases] of Object.entries(IMPORT_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) map[field] = i;
  }
  const mapped = new Set(Object.values(map));
  const unmapped = header.filter((_, i) => !mapped.has(i));

  let added = 0;
  let skipped = 0;
  commit((w) => {
    for (const r of rows.slice(1)) {
      const get = (f) => (map[f] != null ? String(r[map[f]] ?? '').trim() : '');
      const name = get('legal_name');
      if (!name) { skipped += 1; continue; }
      w.companies.push({
        id: uid(),
        legal_name: name,
        country_code: (get('country_code') || w.org.country_code || '').toLowerCase().slice(0, 2),
        company_number: get('company_number') || null,
        incorporation_date: get('incorporation_date') || null,
        headcount: get('headcount') ? Number(get('headcount')) : null,
        turnover_annual_eur: get('turnover_annual_eur') ? Number(get('turnover_annual_eur')) : null,
        stage: get('stage') || null,
        owner: get('owner') || null,
        incorporated: true,
        sectors: [],
        narrative: {},
        updated_at: Date.now(),
      });
      added += 1;
    }
  });
  return { added, skipped, unmapped };
}

/* ------------------------------------------------------------------ */
/* Sample data                                                         */
/* ------------------------------------------------------------------ */

/**
 * Sample data is loaded on request and labelled, never pre-seeded.
 *
 * The enterprise page shows an illustrative board because a screenshot has to
 * show something. A workspace that arrives with four fake companies in it is a
 * different thing: someone will screenshot it for a board pack.
 */
function loadDemo() {
  commit((w) => {
    w.companies = [
      { id: uid(), legal_name: 'Northwind Bio (sample)', country_code: 'de', incorporation_date: '2023-04-01', headcount: 9, turnover_annual_eur: 240000, stage: 'seed', rd_active: true, incorporated: true, sectors: ['biotech'], narrative: {}, updated_at: Date.now() },
      { id: uid(), legal_name: 'Kestrel Energy (sample)', country_code: 'gb', incorporation_date: '2021-09-14', headcount: 24, turnover_annual_eur: 1900000, stage: 'series_a', rd_active: true, incorporated: true, sectors: ['energy'], narrative: {}, updated_at: Date.now() },
      { id: uid(), legal_name: 'Halden Robotics (sample)', country_code: 'fr', incorporation_date: '2024-01-20', headcount: 4, turnover_annual_eur: 0, stage: 'pre_seed', rd_active: true, incorporated: true, sectors: ['robotics'], narrative: {}, updated_at: Date.now() },
    ];
  });
  refresh();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-view]');
  if (nav) return void go(nav.dataset.view);

  const co = ev.target.closest('[data-company]');
  if (co && !ev.target.closest('[data-action]')) return void go('company', { companyId: co.dataset.company });

  const proj = ev.target.closest('[data-project]');
  if (proj && !ev.target.closest('[data-action]')) return void go('project', { projectId: proj.dataset.project });

  const openEntry = ev.target.closest('[data-entry-open]');
  if (openEntry) return void go('entry', { entryId: openEntry.dataset.entryOpen });

  const card = ev.target.closest('.board__card');
  if (card) return void go('entry', { entryId: card.dataset.entry });

  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;

  if (a === 'new-company') return void go('company-form', { companyId: null });
  if (a === 'edit-company') return void go('company-form', { companyId: btn.dataset.id });
  if (a === 'delete-company') {
    const id = btn.dataset.id;
    commit((w) => {
      w.companies = w.companies.filter((c) => c.id !== id);
      w.pipeline = w.pipeline.filter((e) => e.company_id !== id);
      w.awards = w.awards.filter((x) => x.company_id !== id);
    });
    return void go('companies');
  }
  if (a === 'demo') return void loadDemo();

  if (a === 'add-to-pipeline') {
    const { company, slug } = btn.dataset;
    const rec = addApplication(company, slug);
    commit((w) => { w.pipeline.push(rec); });
    return;
  }
  if (a === 'remove-entry') {
    const id = btn.dataset.id;
    commit((w) => { w.pipeline = w.pipeline.filter((e) => e.id !== id); });
    return void go('pipeline');
  }

  if (a === 'new-project') return void go('project-form', { projectId: null });
  if (a === 'edit-project') return void go('project-form', { projectId: btn.dataset.id });
  if (a === 'delete-project') {
    const id = btn.dataset.id;
    commit((w) => {
      w.projects = w.projects.filter((x) => x.id !== id);
      /* Unlink rather than delete: the applications are the log, and deleting
         a project must not delete the record that money was applied for. */
      for (const e of w.pipeline) if (e.project_id === id) e.project_id = null;
    });
    return void go('projects');
  }

  if (a === 'new-document') return void addDocumentPrompt(btn.dataset.type || null);
  if (a === 'remove-document') {
    const id = btn.dataset.id;
    commit((w) => { w.documents = w.documents.filter((d) => d.id !== id); });
    return;
  }

  if (a === 'new-obligation') return void addObligationPrompt();
  if (a === 'toggle-obligation') {
    const id = btn.dataset.id;
    commit((w) => {
      const i = w.postaward.find((x) => x.id === id);
      if (i) i.done = !i.done;
    });
    return;
  }
  if (a === 'remove-obligation') {
    const id = btn.dataset.id;
    commit((w) => { w.postaward = w.postaward.filter((x) => x.id !== id); });
    return;
  }
  if (a === 'download-postaward-ics') {
    const events = ws.postaward
      .filter((i) => i.due && !i.done)
      .map((i) => {
        const e = ws.pipeline.find((x) => x.id === i.application_id);
        const p2 = e ? programmeBySlug(e.slug) : null;
        return {
          at: Date.parse(i.due),
          title: `${i.title} — ${programmeName(p2, 'grant')}`,
          body: `${OBLIGATION_KINDS.find((k) => k[0] === i.kind)?.[1] || i.kind} for ${companyById(e?.company_id)?.legal_name || 'your company'}.`,
          url: p2?.application_url || '',
        };
      });
    download('unclaimed-post-award.ics', toICS(events, { name: 'Grant reporting' }), 'text/calendar');
    return;
  }
  if (a === 'export-applications') return void exportApplications();

  if (a === 'new-grant') return void go('grant-form', { grantSlug: null });
  if (a === 'edit-grant') return void go('grant-form', { grantSlug: btn.dataset.id });
  if (a === 'remove-grant') {
    const slug = btn.dataset.id;
    commit((w) => { w.grants = w.grants.filter((g) => g.slug !== slug); });
    matchCache.clear();
    return;
  }

  if (a === 'new-award') return void addAwardPrompt();
  if (a === 'remove-award') {
    const id = btn.dataset.id;
    commit((w) => { w.awards = w.awards.filter((x) => x.id !== id); });
    return;
  }

  if (a === 'export-pipeline' || a === 'export-csv') return void exportPipeline();
  if (a === 'export-company') {
    const c = companyById(btn.dataset.id);
    if (c) download(`${(c.legal_name || 'company').replace(/\W+/g, '-').toLowerCase()}.json`, JSON.stringify(c, null, 2), 'application/json');
    return;
  }
  if (a === 'download-ics') {
    const matches = ws.pipeline.map((e) => ({ programme: programmeBySlug(e.slug) })).filter((m) => m.programme);
    download('unclaimed-deadlines.ics', toICS(reminders(matches, Date.now())), 'text/calendar');
    return;
  }
  if (a === 'download-pack') {
    const e = ws.pipeline.find((x) => x.id === btn.dataset.entry);
    if (e) download(`${e.slug}-pack.txt`, packText(e));
    return;
  }
  if (a === 'copy-fields') {
    const e = ws.pipeline.find((x) => x.id === btn.dataset.entry);
    if (e && navigator.clipboard) {
      navigator.clipboard.writeText(packText(e)).then(
        () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy filled fields'; }, 1500); },
        () => { btn.textContent = 'Clipboard blocked — use Download'; },
      );
    }
    return;
  }

  if (a === 'import') return void pickFile();
  if (a === 'save-search') {
    const name = prompt('Name this search');
    if (!name) return;
    commit((w) => { w.searches.push({ id: uid(), name, filter: { ...view.filter } }); });
    return;
  }
  if (a === 'run-search') {
    const s = ws.searches.find((x) => x.id === btn.dataset.id);
    if (s) go('opportunities', { filter: { ...s.filter } });
  }
});

/* Drag and drop, with a keyboard path that does the same job — see the
   stage <select> on the entry view. A board you can only use with a mouse
   excludes people and fails an accessibility audit on the same day. */
document.addEventListener('dragstart', (ev) => {
  const card = ev.target.closest('.board__card');
  if (!card) return;
  ev.dataTransfer.setData('text/plain', card.dataset.entry);
  ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (ev) => {
  if (ev.target.closest('.board__drop')) ev.preventDefault();
});
document.addEventListener('drop', (ev) => {
  const drop = ev.target.closest('.board__drop');
  if (!drop) return;
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/plain');
  const stage = drop.dataset.stage;
  if (!id || !STAGE_IDS.includes(stage)) return;
  commit((w) => {
    const e = w.pipeline.find((x) => x.id === id);
    if (e) { e.stage = stage; e.updated_at = Date.now(); }
  });
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  const fd = new FormData(form);
  const g = (k) => String(fd.get(k) ?? '').trim();
  const num = (k) => (g(k) === '' ? null : Number(g(k)));

  if (form.id === 'company-form') {
    const id = form.dataset.id || uid();
    const narrative = {};
    for (const f of NARRATIVE_FIELDS) if (g(f.field)) narrative[f.field] = g(f.field);
    const next = {
      id,
      legal_name: g('legal_name'),
      country_code: g('country_code').toLowerCase().slice(0, 2),
      company_number: g('company_number') || null,
      incorporation_date: g('incorporation_date') || null,
      headcount: num('headcount'),
      turnover_annual_eur: num('turnover_annual_eur'),
      balance_sheet_eur: num('balance_sheet_eur'),
      stage: g('stage') || null,
      admin_area: g('admin_area') || null,
      sectors: g('sectors') ? g('sectors').split(',').map((s) => s.trim()).filter(Boolean) : [],
      owner: g('owner') || null,
      rd_active: fd.get('rd_active') === 'on',
      has_cofunding: fd.get('has_cofunding') === 'on',
      incorporated: fd.get('incorporated') === 'on',
      narrative,
      updated_at: Date.now(),
    };
    commit((w) => {
      const i = w.companies.findIndex((c) => c.id === id);
      if (i >= 0) w.companies[i] = { ...w.companies[i], ...next };
      else w.companies.push(next);
    });
    matchCache.clear();
    refresh();
    return void go('company', { companyId: id });
  }

  if (form.id === 'entry-form') {
    const id = form.dataset.id;
    commit((w) => {
      const e = w.pipeline.find((x) => x.id === id);
      if (!e) return;
      e.stage = g('stage');
      e.owner = g('owner');
      e.value_eur = num('value_eur');
      e.next_action = g('next_action');
      e.due = g('due');
      e.notes = g('notes');
      e.project_id = g('project_id') || null;
      e.requested_eur = num('requested_eur');
      e.awarded_eur = num('awarded_eur');
      e.submitted_at = g('submitted_at') || null;
      e.decided_at = g('decided_at') || null;
      e.funder_reference = g('funder_reference');
      /* Moving a card to submitted without a date leaves a hole in the log
         that nobody fills in later. Stamp today rather than nag. */
      /* Awarded and declined both imply it was submitted. Without this the log
         read "awarded €120,000 · not yet submitted", which is nonsense on the
         one screen a board looks at. */
      if (['submitted', 'awarded', 'declined'].includes(e.stage) && !e.submitted_at) {
        e.submitted_at = new Date().toISOString().slice(0, 10);
      }
      if (['awarded', 'declined'].includes(e.stage) && !e.decided_at) e.decided_at = new Date().toISOString().slice(0, 10);
      /* An award is de minimis aid the moment it lands. Recording it here is
         what keeps the ceiling ledger honest without a second data entry. */
      if (e.stage === 'awarded' && e.awarded_eur && !w.awards.some((x) => x.application_id === e.id)) {
        const p2 = programmeBySlug(e.slug);
        if (p2?.eligibility?.de_minimis) {
          w.awards.push({
            id: uid(), application_id: e.id, company_id: e.company_id,
            programme: programmeName(p2), amount_eur: e.awarded_eur,
            member_state: (companyById(e.company_id)?.country_code || '').toLowerCase(),
            granted_at: Date.parse(e.decided_at || '') || Date.now(),
          });
        }
      }
      e.updated_at = Date.now();
    });
    return;
  }

  if (form.id === 'project-form') {
    const id = form.dataset.id || uid();
    const rec = {
      id,
      name: g('name'),
      company_id: g('company_id'),
      budget_eur: num('budget_eur'),
      starts: g('starts'),
      ends: g('ends'),
      summary: g('summary'),
    };
    commit((w) => {
      const i = w.projects.findIndex((x) => x.id === id);
      if (i >= 0) w.projects[i] = rec;
      else w.projects.push(rec);
    });
    return void go('project', { projectId: id });
  }

  if (form.id === 'grant-form') {
    const slug = form.dataset.slug || `own-${uid()}`;
    const rec = {
      slug,
      own_record: true,
      name_en: g('name_en'),
      name_local: g('name_en'),
      funder: g('funder') || 'Entered by you',
      funder_type: 'private',
      country_code: (g('country_code') || 'global').toLowerCase(),
      grant_type: g('grant_type') || 'grant',
      category: 'startup',
      amount_min: num('amount_min'),
      amount_max: num('amount_max'),
      amount_currency: (g('amount_currency') || 'EUR').toUpperCase(),
      amount_note: g('amount_note') || null,
      is_automatic: false,
      status: 'open',
      deadline_type: g('deadline') ? 'cutoff' : 'rolling',
      deadline: g('deadline') || null,
      application_url: g('application_url') || null,
      application_channel: 'online',
      source_url: g('application_url') || null,
      verification_status: 'own_record',
      last_verified_at: new Date().toISOString().slice(0, 10),
      documents_required: [],
      procedure_steps: [],
      eligibility: {
        company_age_months_max: num('company_age_months_max'),
        headcount_max: num('headcount_max'),
        de_minimis: fd.get('de_minimis') === 'on',
      },
    };
    commit((w) => {
      const i = w.grants.findIndex((x) => x.slug === slug);
      if (i >= 0) w.grants[i] = rec;
      else w.grants.push(rec);
    });
    matchCache.clear();
    return void go('grants');
  }
});

/* Filters are live, not behind an Apply button — the list is local, so there
   is nothing to wait for and nothing to batch. */
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'opp-q') {
    view.filter.q = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const again = $('#opp-q');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'opp-open') { view.filter.open = ev.target.checked; render(); }
  if (ev.target.id === 'opp-free') { view.filter.free = ev.target.checked; render(); }
});

function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const res = importCsv(await f.text());
    await refresh();
    alert(
      `Imported ${res.added} ${res.added === 1 ? 'company' : 'companies'}.` +
        (res.skipped ? `\n${res.skipped} rows had no company name and were skipped.` : '') +
        (res.unmapped.length ? `\n\nColumns we did not recognise and therefore ignored:\n${res.unmapped.join(', ')}` : ''),
    );
  });
  input.click();
}

function pickCompany(promptText) {
  if (!ws.companies.length) return null;
  if (ws.companies.length === 1) return ws.companies[0];
  const name = prompt(`${promptText}\n\n${ws.companies.map((c) => `· ${c.legal_name}`).join('\n')}`, ws.companies[0].legal_name);
  if (!name) return null;
  return ws.companies.find((c) => (c.legal_name || '').toLowerCase() === name.trim().toLowerCase()) || null;
}

function addDocumentPrompt(presetType) {
  const types = Object.keys(DOC_TYPES);
  const type = presetType || prompt(`Which kind of document?\n\n${types.join(', ')}`, types[0]);
  if (!type || !DOC_TYPES[type]) return void (type && alert('Not a document type this build knows about.'));
  const label = prompt('Give it a label you will recognise', docLabel(type));
  if (label === null) return;
  const issued = prompt('Issued on (YYYY-MM-DD), or leave blank', '');
  const scope = ws.companies.length
    ? confirm('OK = shared across the whole workspace.\nCancel = tie it to one company.')
    : true;
  let companyId = null;
  if (!scope) {
    const c = pickCompany('Which company holds it?');
    if (!c) return;
    companyId = c.id;
  }
  commit((w) => {
    w.documents.push({
      id: uid(), type, label: label || docLabel(type),
      issued_at: issued || null, company_id: companyId, added_at: Date.now(),
    });
  });
}

function addObligationPrompt() {
  const awarded = ws.pipeline.filter((e) => e.stage === 'awarded');
  if (!awarded.length) return void alert('Mark an application as awarded first — obligations hang off an award.');
  if (awarded.length === 1) return void obligationFor(awarded[0]);
  const list = awarded.map((e) => `· ${programmeName(programmeBySlug(e.slug))}`).join('\n');
  const which = prompt(`Which award?\n\n${list}`, programmeName(programmeBySlug(awarded[0].slug)));
  if (!which) return;
  const e = awarded.find((x) => programmeName(programmeBySlug(x.slug)).toLowerCase() === which.trim().toLowerCase());
  if (!e) return void alert('No award by that name.');
  return void obligationFor(e);
}

function obligationFor(e) {
  const kind = prompt(`What kind?\n\n${OBLIGATION_KINDS.map((k) => k[0]).join(', ')}`, 'report');
  if (!kind || !OBLIGATION_KINDS.some((k) => k[0] === kind)) return;
  const title = prompt('What is owed?');
  if (!title) return;
  const due = prompt('Due on (YYYY-MM-DD)', '');
  commit((w) => {
    w.postaward.push({ id: uid(), application_id: e.id, kind, title, due: due || '', done: false, created_at: Date.now() });
  });
}

/** The applications log, as the sheet a finance team already keeps. */
function exportApplications() {
  const rows = [[
    'reference', 'company', 'project', 'programme', 'funder', 'stage', 'owner',
    'requested_eur', 'awarded_eur', 'submitted_at', 'decided_at', 'funder_reference',
    'readiness_pct', 'open_issues', 'application_url',
  ]];
  for (const e of ws.pipeline) {
    const p = programmeBySlug(e.slug);
    const c = companyById(e.company_id);
    const pr = ws.projects.find((x) => x.id === e.project_id);
    rows.push([
      e.reference, c?.legal_name, pr?.name, programmeName(p), p?.funder, e.stage, e.owner,
      e.requested_eur, e.awarded_eur, e.submitted_at, e.decided_at, e.funder_reference,
      readinessFor(e)?.score, issuesFor(e).length, p?.application_url,
    ]);
  }
  download('unclaimed-applications.csv', toCsv(rows), 'text/csv');
}

function addAwardPrompt() {
  const c = ws.companies[0];
  if (!c) return;
  const name = prompt('Which company? Type the name.', c.legal_name);
  if (!name) return;
  const target = ws.companies.find((x) => (x.legal_name || '').toLowerCase() === name.trim().toLowerCase());
  if (!target) return void alert('No company by that name in this workspace.');
  const programme = prompt('What was the award for?');
  if (!programme) return;
  const amount = Number(prompt('Amount in EUR'));
  if (!Number.isFinite(amount) || amount <= 0) return void alert('That is not an amount.');
  const when = prompt('Granted on (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
  const at = Date.parse(when || '');
  commit((w) => {
    w.awards.push({
      id: uid(), company_id: target.id, programme,
      amount_eur: amount, member_state: (target.country_code || '').toLowerCase(),
      granted_at: Number.isNaN(at) ? Date.now() : at,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function refresh() {
  await loadPoolsFor(ws.companies);
  matchCache.clear();
  render();
}

render();
refresh();

/* Another tab changed the workspace. Reload rather than let the two diverge
   and have one silently overwrite the other on the next keystroke. */
window.addEventListener('storage', (e) => {
  if (e.key !== STORE) return;
  ws = load();
  matchCache.clear();
  render();
});

export { importCsv, parseCsv, pipelineValue, hitRate, packText, STAGES, OBLIGATION_KINDS, programmeName, issuesFor, readinessFor };
