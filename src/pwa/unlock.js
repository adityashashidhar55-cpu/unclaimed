/**
 * Give a paying subscriber the page they paid for.
 *
 * Every programme page is a static file built once, with the paid sections
 * replaced by grey placeholder bars. That is the right way to build a paywall:
 * the real content is not in the document, so it cannot be un-hidden with a
 * devtools rule. But nothing ever put it back. A subscriber with an active
 * plan opened the same 4,000 pages and saw the same grey bars and the same
 * "Sign in to unlock" as a stranger — they paid and the product did not
 * change. That is the single worst bug this codebase has had, because unlike
 * the others it is a promise taken and not kept.
 *
 * So: on load, ask the server. `/api/v1/programmes/<cc>.json` returns the
 * stripped file to everyone and the whole file to an entitled session — the
 * decision is the Worker's, on the same URL, which is why a client cannot
 * award itself the paid version by asking differently. If the record comes
 * back whole, fill the panels in. If it does not, the page stays exactly as it
 * was built.
 */

import { formatMoney, periodSuffix, CATEGORY_LABEL } from '../engine/matcher.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Money, or an honest silence. Never a zero standing in for "not published". */
function amountLine(p) {
  const cur = p.amount_currency;
  const lo = p.amount_min;
  const hi = p.amount_max;
  if (lo == null && hi == null) {
    return `<p class="lede" style="margin:0">The amount depends on your circumstances — the authority calculates it.</p>`;
  }
  const per = periodSuffix(p.amount_period) || '';
  const val =
    lo != null && hi != null && lo !== hi
      ? `${formatMoney(lo, cur)} – ${formatMoney(hi, cur)}`
      : formatMoney(hi ?? lo, cur);
  return `<p class="figure-sm" style="margin:0">${esc(val)}<span style="font-size:.9rem;color:var(--ink-4)">${esc(per)}</span></p>`;
}

const RULE_LABEL = {
  statuses: 'Work or life status',
  age_min: 'Minimum age',
  age_max: 'Maximum age',
  income_annual_max: 'Household income must be under',
  requires_children: 'Children in the household',
  nationality: 'Residency status',
  residency_months_min: 'Months of residence required',
  housing_tenure: 'Housing situation',
  student_required: 'Must be a student',
  admin_areas: 'Available in',
};

/* The same vocabulary the built page uses. Enum identifiers are database
   words; a subscriber must not be able to tell which half of the page came
   from the server. */
const VALUE_LABEL = {
  employee: 'employees',
  jobseeker: 'jobseekers',
  parent: 'parents',
  retired: 'pensioners',
  self_employed: 'self-employed people',
  student: 'students',
  unemployed: 'people out of work',
  homeless: 'People without settled housing',
  owner: 'Homeowners',
  renting: 'Renters',
  student_housing: 'People in student housing',
  any_resident: 'Any legal resident',
  citizen_or_pr: 'Citizens and permanent residents',
  refugee_or_protected: 'Refugees and people with protected status',
};
const label1 = (x) => VALUE_LABEL[x] ?? String(x).replace(/_/g, ' ');
const listAnd = (a) => (a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const sentenceCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const humanise = (v) =>
  Array.isArray(v)
    ? sentenceCase(listAnd(v.map(label1)))
    : typeof v === 'boolean'
      ? (v ? 'Yes' : 'No')
      : sentenceCase(label1(v));

function rulesTable(p) {
  const e = p.eligibility || {};
  const rows = Object.entries(RULE_LABEL)
    .filter(([k]) => {
      const v = e[k];
      return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== false && v !== 'any';
    })
    .map(([k, label]) => {
      const v = k === 'income_annual_max' ? formatMoney(e[k], p.amount_currency) + ' a year' : humanise(e[k]);
      return `<tr><th scope="row">${esc(label)}</th><td>${esc(v)}</td></tr>`;
    });
  if (e.income_note) rows.push(`<tr><th scope="row">Income rule</th><td>${esc(e.income_note)}</td></tr>`);
  return rows.length
    ? `<table class="rule-table">${rows.join('')}</table>`
    : `<p class="small">This programme publishes no structured eligibility rules — read the official page.</p>`;
}

function documentsList(p) {
  const docs = p.documents_required || [];
  if (!docs.length) return `<p class="small">No supporting documents are listed on the official page.</p>`;
  return `<ul class="ticks">${docs
    .map(
      (d) =>
        `<li>${esc(d.doc)}${d.mandatory === false ? ' <span class="tiny">(optional)</span>' : ''}${
          d.note ? `<div class="tiny">${esc(d.note)}</div>` : ''
        }</li>`,
    )
    .join('')}</ul>`;
}

function stepsList(p) {
  const steps = (p.procedure_steps || []).slice().sort((a, b) => a.step - b.step);
  if (!steps.length) return '';
  return `<h2 style="margin-top:2.5rem">How to apply</h2>
    <ol class="steps">${steps
      .map(
        (s) =>
          `<li>${esc(s.detail)}${s.url ? ` <a class="link-underline" href="${esc(s.url)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`,
      )
      .join('')}</ol>`;
}

/** Swap one locked panel for the real thing, keeping its heading. */
function fill(el, html) {
  if (!el) return;
  const head = el.querySelector('.bucket__head');
  el.classList.remove('locked-bucket');
  el.classList.add('bucket', 'bucket--unlocked');
  el.innerHTML = (head ? head.outerHTML : '') + html;
}

/* ---- lists ------------------------------------------------------- */

/* One fetch per country per page, shared between the row amounts and the
   teases, and cached so three category blocks on one country page do not ask
   three times. */
const countryCache = new Map();
function countryRecords(cc) {
  if (!countryCache.has(cc)) {
    countryCache.set(
      cc,
      fetch(`/api/v1/programmes/${cc}.json`, { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const list = d?.programmes || [];
          /* A stripped record has no name. If the server sent stripped
             records, this session is not entitled and nothing below runs. */
          if (!list.length || !list[0].name_en) return null;
          return new Map(list.map((p) => [p.slug, p]));
        })
        .catch(() => null),
    );
  }
  return countryCache.get(cc);
}

function amountChip(p) {
  const lo = p.amount_min;
  const hi = p.amount_max;
  if (lo == null && hi == null) return 'Calculated';
  const per = periodSuffix(p.amount_period) || '';
  const val = lo != null && hi != null && lo !== hi
    ? `${formatMoney(lo, p.amount_currency)}–${formatMoney(hi, p.amount_currency)}`
    : formatMoney(hi ?? lo, p.amount_currency);
  return `${val}${per}`;
}

function rowHtml(base, cc, p) {
  return `<a class="list-row" href="${base}/${cc}/${esc(p.category)}/${esc(p.slug)}/">
  <span>
    <span class="list-row__name">${esc(p.name_en)}</span>
    <span class="list-row__meta">${esc(p.name_local && p.name_local !== p.name_en ? `${p.name_local} · ` : '')}${esc(p.funder)}</span>
  </span>
  <span class="list-row__right"><span class="list-row__amount">${esc(amountChip(p))}</span></span>
</a>`;
}

/**
 * Put the amounts back into every list, and turn every "26 more programmes,
 * see plans" block into the 26 programmes.
 *
 * A subscriber was being shown ●●●● where the figure should be and then sold
 * the plan they already hold, on the country pages, the category pages and
 * the bottom of every programme page. Both are the same failure as the locked
 * panels: the static page cannot know who is reading it, so it ships the
 * locked version and this asks the server afterwards.
 */
export async function unlockLists() {
  const rows = [...document.querySelectorAll('[data-row][data-row-cc]')];
  const teases = [...document.querySelectorAll('[data-tease-cc][data-tease-slugs]')];
  if (!rows.length && !teases.length) return;

  const codes = new Set([...rows.map((r) => r.dataset.rowCc), ...teases.map((t) => t.dataset.teaseCc)]);
  const byCc = new Map(await Promise.all([...codes].map(async (cc) => [cc, await countryRecords(cc)])));

  for (const el of rows) {
    const p = byCc.get(el.dataset.rowCc)?.get(el.dataset.row);
    const chip = el.querySelector('[data-row-amount]');
    if (!p || !chip) continue;
    chip.textContent = amountChip(p);
    chip.classList.remove('lock-chip');
    chip.removeAttribute('aria-label');
  }

  for (const el of teases) {
    const recs = byCc.get(el.dataset.teaseCc);
    if (!recs) continue;
    const base = el.dataset.teaseBase || '';
    const html = el.dataset.teaseSlugs
      .split(',')
      .map((slug) => recs.get(slug))
      .filter(Boolean)
      .map((p) => rowHtml(base, el.dataset.teaseCc, p))
      .join('');
    if (!html) continue;
    const holder = document.createElement('div');
    holder.className = 'list-rows';
    holder.innerHTML = html;
    el.replaceWith(holder);
  }
}

export async function unlockProgramme() {
  const root = document.querySelector('[data-programme]');
  if (!root) return;
  const { programme: slug, country: cc } = root.dataset;
  if (!slug || !cc) return;

  let data;
  try {
    const res = await fetch(`/api/v1/programmes/${cc}.json`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    /* Offline, or the API is not reachable. The page keeps the version it was
       built with, which is the correct thing to fail back to. */
    return;
  }

  const p = (data.programmes || []).find((x) => x.slug === slug);
  /* A stripped record has no name. Getting one back means we are not entitled,
     and the page must stay locked — the client does not decide this. */
  if (!p || !p.name_en) return;

  fill(
    document.querySelector('[data-locked="pays"]'),
    amountLine(p) + (p.amount_note ? `<p class="small" style="margin-top:.6rem">${esc(p.amount_note)}</p>` : ''),
  );
  fill(document.querySelector('[data-locked="rules"]'), rulesTable(p));
  fill(
    document.querySelector('[data-locked="documents"]'),
    documentsList(p) +
      stepsList(p) +
      (p.application_url
        ? `<p class="btn-row" style="margin-top:1.4rem"><a class="btn btn-primary" href="${esc(
            p.application_url,
          )}" target="_blank" rel="noopener">Apply on the official site</a></p>`
        : ''),
  );

  document.querySelectorAll('[data-paywall-note]').forEach((n) => n.remove());
  root.classList.add('is-unlocked');
}

/**
 * POST /api/apply/plan — the prepared-application pack.
 *
 * The Worker has answered this route since auto-apply landed and no shipped
 * client ever called it: the one control that reaches it, "Prepare my
 * applications" on the /check/ results screen, had no handler branch, so a
 * subscriber clicked it and nothing happened — no request, no error, no
 * change on screen. The route lives here rather than inline in the caller so
 * scripts/test-reachability.mjs can prove there is exactly one call site and
 * that it is real.
 *
 * mobile/src/lib/api.js has its own copy of this contract. It cannot import
 * this one: that module is an Expo bundle (expo-secure-store, expo-constants)
 * and replays a session cookie by hand because React Native's fetch does not
 * persist cookies. The two are kept in step by test-reachability.mjs, which
 * checks both clients against the Worker's route table.
 */
/* The route is written out at the fetch, not held in a constant.
   scripts/test-reachability.mjs resolves a call site by reading the argument
   of the call, which is the only thing a browser resolves either — and a
   route that only a variable knows is a route the guard cannot see. */
export async function applyPlan(profile, lang = 'en') {
  const res = await fetch('/api/apply/plan', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile, lang }),
  });
  /* 402 is a real answer, not a transport failure: it carries the paywall
     reason. Hand it back rather than throwing, so the caller can say which
     of "sign in", "subscribe" and "we broke" actually happened. */
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * POST /api/apply/consent — the declaration record.
 *
 * Every pack carries `attestations`: the statements the applicant is signing
 * up to. The Worker has stored them since auto-apply landed and, like
 * /api/apply/plan, nothing shipped ever asked. A pack handed over with no
 * recorded declaration is the one artefact in this product that a regulator
 * would ask about, so the control that produces it lives beside the pack.
 */
export async function recordApplyConsent({ programmeSlug, country, attestations, values }) {
  const res = await fetch('/api/apply/consent', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      programme_slug: programmeSlug,
      country,
      attestations,
      values: values ?? {},
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
