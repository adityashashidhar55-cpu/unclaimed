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
