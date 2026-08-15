/**
 * UNCLAIMED — client wizard + results.
 *
 * Vanilla ES modules, no framework, no build step, no network calls except
 * fetching the static programme JSON for the country you pick. Nothing you
 * type leaves the browser.
 */
import {
  match,
  formatMoney,
  periodSuffix,
  CATEGORY_LABEL,
  CIRCUMSTANCES,
  estimateShareText,
  DISCLAIMER,
} from './engine/matcher.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const app = document.getElementById('app');

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const S = {
  manifest: null,
  entry: null,
  data: null,
  step: 0,
  result: null,
  profile: {
    country_code: null,
    admin_area: null,
    status: null,
    age: null,
    income_band: null,
    income_annual: null,
    household_size: 1,
    children_count: 0,
    housing_tenure: null,
    nationality_group: null,
    residency_months: null,
    circumstances: [],
  },
};

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- URL state (shareable, no accounts) ---- */
function encodeState() {
  const json = JSON.stringify(S.profile);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(s) {
  try {
    const json = decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const STATUSES = [
  ['employee', 'Working for an employer', 'Full-time, part-time or on a contract'],
  ['self_employed', 'Self-employed or freelance', 'Including sole traders and small business owners'],
  ['student', 'Studying', 'School, college or university'],
  ['unemployed', 'Out of work', 'Between jobs, not currently looking or unable to work'],
  ['jobseeker', 'Actively looking for work', 'Registered or searching'],
  ['retired', 'Retired', 'Drawing a pension or past retirement age'],
  ['parent', 'At home with children', 'Full-time caring, not in paid work'],
];

const TENURES = [
  ['renting', 'I rent', 'Private landlord or social housing'],
  ['owner', 'I own my home', 'With or without a mortgage'],
  ['hosted', 'I live with family or friends', "I don't pay a formal rent"],
  ['student_housing', 'Student accommodation', 'Halls, dorms or campus housing'],
  ['homeless', 'I have no fixed home', 'Temporary, emergency or no accommodation'],
];

const NATIONALITY = [
  ['citizen_or_pr', 'Citizen or permanent resident', 'Unlocks the most programmes'],
  ['any_resident', 'Legal resident on a visa or permit', 'Work, study, family or other permit'],
  ['refugee_or_protected', 'Refugee or protected status', 'Asylum, humanitarian or subsidiary protection'],
];

function steps() {
  const list = ['country'];
  if (S.entry && (S.entry.regions || []).length) list.push('region');
  list.push('status', 'circumstances', 'household', 'income', 'housing');
  return list;
}

/* ------------------------------------------------------------------ */
/* Render helpers                                                      */
/* ------------------------------------------------------------------ */

function rail() {
  const st = steps();
  return `<div class="progress-rail" role="progressbar" aria-valuenow="${S.step + 1}" aria-valuemin="1" aria-valuemax="${st.length}" aria-label="Step ${S.step + 1} of ${st.length}">
    ${st.map((_, i) => `<span class="${i < S.step ? 'done' : i === S.step ? 'current' : ''}"></span>`).join('')}
  </div>
  <p class="tiny" style="margin:-1.6rem 0 1.6rem">Step ${S.step + 1} of ${st.length} · about ${Math.max(1, (st.length - S.step) * 15)} seconds left · nothing is saved to a server</p>`;
}

function optButton(value, label, sub, field) {
  const on = S.profile[field] === value;
  return `<button class="opt" type="button" aria-pressed="${on}" data-field="${field}" data-value="${esc(value)}">
    <span>${esc(label)}${sub ? `<span class="opt__sub">${esc(sub)}</span>` : ''}</span>
  </button>`;
}

function navRow({ back = true, next = null, skip = null } = {}) {
  return `<div class="wizard-nav">
    ${back && S.step > 0 ? `<button class="btn btn-ghost btn-sm" type="button" data-act="back">← Back</button>` : '<span></span>'}
    <span class="row">
      ${skip ? `<button class="btn btn-ghost btn-sm" type="button" data-act="skip">${esc(skip)}</button>` : ''}
      ${next ? `<button class="btn btn-primary" type="button" data-act="next">${esc(next)}</button>` : ''}
    </span>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Step views                                                          */
/* ------------------------------------------------------------------ */

function viewCountry() {
  const cs = S.manifest.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="step">
    ${rail()}
    <h1 class="q">Where do you live?</h1>
    <p class="q-why">Benefits are national. We only load the country you pick — nothing else is downloaded.</p>
    <div class="field"><label for="csearch">Search ${cs.length} countries</label>
      <input id="csearch" type="search" placeholder="Start typing…" autocomplete="country-name"></div>
    <div class="opts" id="clist">
      ${cs
        .map(
          (c) =>
            `<button class="opt" type="button" data-act="country" data-cc="${c.slug}" data-name="${esc(c.name.toLowerCase())}">
              <span style="font-size:1.3rem;line-height:1">${c.flag}</span>
              <span>${esc(c.name)}<span class="opt__sub">${c.programme_count} programmes · ${c.verified_count} verified</span></span>
            </button>`,
        )
        .join('')}
    </div>
    <div class="callout" style="margin-top:1.5rem"><p class="small" style="margin:0">Your country isn't listed? The dataset covers ${cs.length} countries so far.
    <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues/new?title=Country+request">Request one</a> — it's a data job, not a code job.</p></div>
  </div>`;
}

function viewRegion() {
  const regions = S.entry.regions || [];
  return `<div class="step">
    ${rail()}
    <h1 class="q">Which part of ${esc(S.entry.name)}?</h1>
    <p class="q-why">Regional and city schemes are the ones people miss most — council tax reductions, local transport concessions, regional housing grants.</p>
    <div class="opts">
      ${regions.map((r) => optButton(r, r, null, 'admin_area')).join('')}
    </div>
    ${navRow({ skip: 'Somewhere else / not sure' })}
  </div>`;
}

function viewStatus() {
  return `<div class="step">
    ${rail()}
    <h1 class="q">What best describes you right now?</h1>
    <p class="q-why">Most programmes are written around a life situation rather than a job title. Pick the closest one — you can go back and try another.</p>
    <div class="opts">${STATUSES.map(([v, l, s]) => optButton(v, l, s, 'status')).join('')}</div>
    ${navRow({})}
  </div>`;
}

function viewCircumstances() {
  const on = new Set(S.profile.circumstances || []);
  return `<div class="step">
    ${rail()}
    <h1 class="q">Does any of this describe you?</h1>
    <p class="q-why">These are the situations that unlock the largest payments almost everywhere — and the
    ones a generic benefits list will never ask about. Tick all that apply, or none. Your answers stay in
    this browser; there is no server to send them to.</p>
    <div class="opts">
      ${CIRCUMSTANCES.map(
        (c) => `<button class="opt" type="button" aria-pressed="${on.has(c.id)}" data-multi="circumstances" data-value="${esc(c.id)}">
        <span class="opt__key">${on.has(c.id) ? '✓' : ''}</span>
        <span>${esc(c.label)}</span>
      </button>`,
      ).join('')}
    </div>
    <p class="tiny" style="margin-bottom:1.5rem">If you tick nothing, programmes that depend on these
    situations are kept out of your total and listed separately, rather than being counted as money you
    can claim. That is the difference between a real estimate and an inflated one.</p>
    ${navRow({ next: 'Continue', skip: 'None of these' })}
  </div>`;
}

function viewHousehold() {
  const p = S.profile;
  return `<div class="step">
    ${rail()}
    <h1 class="q">Your household</h1>
    <p class="q-why">Age gates and child-related payments are two of the biggest sources of missed money.</p>
    <div class="field-row">
      <div class="field"><label for="age">Your age</label>
        <input id="age" type="number" inputmode="numeric" min="0" max="120" value="${p.age ?? ''}" placeholder="e.g. 34">
        <div class="hint">Leave blank if you'd rather not say — we'll flag age-gated programmes instead of ruling them out.</div>
      </div>
      <div class="field"><label for="hh">People in your household</label>
        <input id="hh" type="number" inputmode="numeric" min="1" max="20" value="${p.household_size}">
        <div class="hint">Including you.</div>
      </div>
    </div>
    <div class="field"><label for="kids">Dependent children</label>
      <input id="kids" type="number" inputmode="numeric" min="0" max="15" value="${p.children_count}">
      <div class="hint">Under 18, or older if still in full-time education or dependent on you.</div>
    </div>
    ${navRow({ next: 'Continue' })}
  </div>`;
}

function viewIncome() {
  const bands = S.entry.income_bands || [];
  const cur = S.entry.currency;
  const fmt = (n) => formatMoney(n, cur);
  return `<div class="step">
    ${rail()}
    <h1 class="q">Roughly what does your household earn?</h1>
    <p class="q-why">We ask because most support is means-tested — income is the single rule that decides the most programmes.
    It stays in your browser. Pick a band, or give an exact figure for sharper matching.</p>
    <div class="opts">
      ${bands
        .map((b) =>
          optButton(
            b.id,
            b.max === null ? `Over ${fmt(b.min)}` : b.min === 0 ? `Under ${fmt(b.max)}` : `${fmt(b.min)} – ${fmt(b.max)}`,
            'per year, before tax, everyone in the household',
            'income_band',
          ),
        )
        .join('')}
    </div>
    <details class="fold" style="margin-bottom:1.5rem"><summary>Give an exact figure instead (sharper results)</summary>
      <div class="field" style="margin-top:1rem"><label for="inc">Annual household income in ${esc(cur)}</label>
        <input id="inc" type="number" inputmode="numeric" min="0" value="${S.profile.income_annual ?? ''}" placeholder="e.g. 42000">
        <div class="hint">An exact figure turns "needs one more answer" into a straight yes or no on income-tested schemes.</div>
      </div>
    </details>
    ${navRow({ next: 'Continue', skip: "I'd rather not say" })}
  </div>`;
}

function viewHousing() {
  return `<div class="step">
    ${rail()}
    <h1 class="q">Housing and residency</h1>
    <p class="q-why">Housing support is the largest unclaimed category almost everywhere. Residency status decides what a country will pay a non-citizen.</p>
    <h4 style="margin-top:1.5rem">Your housing situation</h4>
    <div class="opts">${TENURES.map(([v, l, s]) => optButton(v, l, s, 'housing_tenure')).join('')}</div>
    <h4 style="margin-top:2rem">Your status in ${esc(S.entry.name)}</h4>
    <div class="opts">${NATIONALITY.map(([v, l, s]) => optButton(v, l, s, 'nationality_group')).join('')}</div>
    <div class="field" style="margin-top:1.5rem"><label for="res">How many months have you lived in ${esc(S.entry.name)}?</label>
      <input id="res" type="number" inputmode="numeric" min="0" value="${S.profile.residency_months ?? ''}" placeholder="Leave blank if unsure">
      <div class="hint">Some programmes have a minimum residence period. Blank means we flag them rather than rule them out.</div>
    </div>
    ${navRow({ next: 'See what I can claim →' })}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The wall                                                            */
/*                                                                     */
/* This wizard used to render every matched programme to anyone who    */
/* finished the questions — the whole paid product, free, on the page. */
/* The total stays free because it is the honest teaser and it is what */
/* gets someone to care. The list is what is being sold.               */
/*                                                                     */
/* Entitlement is asked of the server, never assumed. If the API is    */
/* unreachable the answer is "not entitled": guessing generously here  */
/* hands the paid list to anyone who blocks a request.                 */
/* ------------------------------------------------------------------ */

let ENTITLED = false;

async function refreshEntitlement() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) { ENTITLED = false; return; }
    const data = await res.json();
    ENTITLED = !!data?.entitlement?.entitled;
  } catch {
    ENTITLED = false;
  }
}

/**
 * A bucket, or the wall in its place.
 *
 * Takes a thunk rather than a string so the programme markup is never built
 * for an unentitled viewer — nothing to find in the DOM, nothing to un-hide.
 */
function gated(count, noun, buildHtml) {
  if (ENTITLED) return buildHtml();
  if (!count) return '';
  return `<section class="bucket locked-bucket">
    <div class="bucket__head"><h2>${count} ${noun}</h2></div>
    <p class="small">Unlock to see which ones, what each pays, what documents they want and when they close.</p>
    <div class="locked__rows" aria-hidden="true">
      ${Array.from({ length: Math.min(count, 4) }, () => '<div class="locked__row"></div>').join('')}
    </div>
    <p><a class="btn btn-primary" href="/account/">Sign in to unlock</a>
       <a class="btn" href="/pricing/">See pricing</a></p>
    <p class="tiny">Email and a six-digit code. No password to forget.</p>
  </section>`;
}

/* Matcher attribute names, in the words the question used. */
const ATTR_LABEL = {
  nationality: 'your residency status',
  age: 'your age',
  income: 'your household income',
  income_annual_max: 'your household income',
  admin_area: 'your region',
  household: 'who lives with you',
  housing_tenure: 'your housing',
  status: 'your work status',
  residency_months: 'how long you have lived there',
};

function money(n, cur) {
  return formatMoney(n, cur);
}

function progCard(m, kind) {
  const p = m.programme;
  const cur = p.amount_currency || S.data.currency;
  let amt = null;
  if (p.amount_min != null || p.amount_max != null) {
    const suf = periodSuffix(p.amount_period);
    amt =
      p.amount_min != null && p.amount_max != null && p.amount_min !== p.amount_max
        ? `${money(p.amount_min, cur)}–${money(p.amount_max, cur)}${suf}`
        : `${money(p.amount_max ?? p.amount_min, cur)}${suf}`;
  }
  const href = `${BASE}/${S.entry.slug}/${p.category}/${p.slug}/`;
  const verified =
    p.verification_status === 'verified'
      ? '<span class="badge badge-verified">Verified</span>'
      : '<span class="badge badge-auto">Not human-checked</span>';

  let why = '';
  if (kind === 'eligible' && m.rules_met.length) {
    why = `<div class="why"><strong>Why you match:</strong><ul>${m.rules_met.slice(0, 4).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
  } else if (kind === 'maybe' && m.blocking_question) {
    why = `<div class="why why--ask"><strong>One thing missing:</strong> ${esc(m.blocking_question)}
      <div style="margin-top:.6rem"><button class="btn btn-ghost btn-sm" type="button" data-act="answer" data-attr="${esc(m.blocking_attribute)}">Answer this now</button></div></div>`;
  } else if (kind === 'no' && m.rules_failed.length) {
    why = `<div class="why why--fail"><strong>Why not:</strong> ${esc(m.rules_failed[0])}</div>`;
  } else if (kind === 'taper') {
    why = `<div class="why why--ask"><strong>Above the maximum-award ceiling, but probably not ruled out:</strong>
      ${m.taper_note}<br><span class="tiny">We can't compute your reduced amount — the authority does that. Use their calculator on the official page.</span></div>`;
  } else if (kind === 'conditional') {
    why = `<div class="why why--ask"><strong>Only if this is you:</strong> ${esc(m.condition_label)}.
      You didn't tell us it applies, so we've kept it out of your total.
      <div style="margin-top:.6rem"><button class="btn btn-ghost btn-sm" type="button" data-act="answer" data-attr="circumstance">This does apply to me</button></div></div>`;
  }

  return `<article class="card prog-card">
    <div class="prog-card__head">
      <div style="min-width:0">
        <h3 class="prog-card__title"><a href="${href}" style="text-decoration:none">${esc(p.name_en)}</a></h3>
        <p class="prog-card__sub">${esc(p.name_local !== p.name_en ? p.name_local + ' · ' : '')}${esc(p.funder)}</p>
      </div>
      <div class="prog-card__value">
        ${amt ? `<div class="prog-card__amount">${esc(amt)}</div>` : '<div class="tiny">Amount depends on you</div>'}
      </div>
    </div>
    ${why}
    <div class="prog-card__meta">
      ${verified}
      ${p.is_automatic ? '<span class="badge badge-auto-apply">Automatic — no application</span>' : '<span class="badge badge-action">You must apply</span>'}
      ${m.is_capital ? '<span class="badge badge-neutral" title="Borrowing capacity, not money in pocket — excluded from your total">Loan or credit — not counted</span>' : ''}
      <span class="badge badge-neutral">${esc(CATEGORY_LABEL[p.category] || p.category)}</span>
      ${(p.documents_required || []).length ? `<span class="badge badge-neutral">${p.documents_required.length} documents</span>` : ''}
      ${(p.procedure_steps || []).length ? `<span class="badge badge-neutral">${p.procedure_steps.length} steps</span>` : ''}
    </div>
    <div class="row" style="margin-top:1rem">
      <a class="btn btn-sm btn-ghost" href="${href}">Full rules &amp; documents</a>
      ${p.application_url ? `<a class="btn btn-sm" href="${esc(p.application_url)}" target="_blank" rel="nofollow noopener">Apply on official site</a>` : ''}
    </div>
  </article>`;
}


/**
 * Real document lists say the same thing twenty ways ("National Insurance
 * number", "National Insurance number (for DWP benefit verification)"). Keying
 * the checklist on the raw string produced 37 rows of which exactly 1 was
 * shared — a wall, not a plan. Map to a small set of real-world documents first.
 */
const DOC_BUCKETS = [
  [/passport|national id|identity card|photo id|\bid card|aadhaar|residence permit|visa|carte de s[ée]jour|personalausweis/i, 'Photo ID or residence permit'],
  [/proof of address|utility bill|address proof|justificatif de domicile|meldebescheinigung|council tax bill/i, 'Proof of address'],
  [/payslip|proof of income|income (statement|certificate|proof)|salary|p60|avis d.imp[oô]t|einkommensnachweis|earnings/i, 'Proof of income (payslips or tax statement)'],
  [/tax (return|number|reference|identification)|utr\b|tax id|pan card|steuer|num[ée]ro fiscal|social security number|ssn\b|national insurance/i, 'Tax or social-security number'],
  [/bank (details|account|statement)|iban|\brib\b|sort code|void cheque|passbook/i, 'Bank details'],
  [/tenancy|rental agreement|lease|rent (book|receipt|certificate)|\bbail\b|mietvertrag|attestation de loyer|landlord/i, 'Tenancy agreement or rent proof'],
  [/mortgage|title deed|property (deed|document|tax)|ownership/i, 'Property ownership documents'],
  [/birth certificate|child.s? (birth|id)|acte de naissance|geburtsurkunde/i, "Birth certificate(s)"],
  [/marriage|civil partnership|divorce|livret de famille/i, 'Marriage or family status certificate'],
  [/medical|doctor|health (certificate|record)|diagnosis|disability (assessment|certificate)|occupational therapist|fit note|sick note/i, 'Medical or assessment evidence'],
  [/enrol|student (id|card|certificate)|matriculation|immatrikulation|certificat de scolarit|proof of study|school/i, 'Proof of study or enrolment'],
  [/employment contract|job (offer|contract)|employer (letter|certificate)|p45|termination|redundancy|dismissal/i, 'Employment or termination documents'],
  [/business (plan|registration|licence|license)|company (registration|number)|vat|gst|siret|trade licence|udyam/i, 'Business registration documents'],
  [/energy bill|electricity|gas bill|meter|water bill|supplier/i, 'Recent energy or water bill'],
  [/photo(graph)?s?\b|passport-size/i, 'Passport-size photograph'],
];

function canonicalDoc(doc) {
  for (const [re, label] of DOC_BUCKETS) {
    if (re.test(doc)) return [label, label];
  }
  const key = doc.trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return [key, doc];
}

/** Deduplicated document checklist across every eligible programme. */
function documentPlan(r) {
  const map = new Map();
  for (const m of r.eligible) {
    for (const d of m.programme.documents_required || []) {
      const [key, canonical] = canonicalDoc(d.doc);
      if (!map.has(key)) map.set(key, { doc: canonical, unlocks: [], mandatory: false, raw: new Set() });
      map.get(key).raw.add(d.doc);
      const rec = map.get(key);
      rec.unlocks.push(m.programme.name_en);
      if (d.mandatory !== false) rec.mandatory = true;
    }
  }
  const rows = [...map.values()].sort((a, b) => b.unlocks.length - a.unlocks.length);
  if (!rows.length) return '';
  const top = rows.filter((x) => x.unlocks.length > 1).length;
  return `<section class="bucket" id="documents">
    <div class="bucket__head"><h2>Your document checklist</h2><span class="bucket__count">${rows.length} documents unlock ${r.eligible.length} programmes</span></div>
    <p class="small" style="max-width:60ch">Gathered once, reused everywhere. ${
      top ? `<strong>${top} of these are needed by more than one programme</strong> — start with those.` : ''
    } Ticks are stored in this browser only.</p>
    <ul class="docs" style="margin-top:1rem">
      ${rows
        .map(
          (x, i) => `<li>
        <input type="checkbox" id="pd-${i}" data-doc="${esc(x.doc)}">
        <label for="pd-${i}"><strong>${esc(x.doc)}</strong>${x.mandatory ? '' : ' <span class="badge badge-neutral">if applicable</span>'}
        <span class="tiny" style="display:block">Unlocks ${x.unlocks.length}: ${esc(x.unlocks.slice(0, 3).join(', '))}${x.unlocks.length > 3 ? ` +${x.unlocks.length - 3} more` : ''}</span></label>
      </li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

/** Programmes with a real deadline → .ics calendar export. */
function deadlineSection(r) {
  const dated = r.eligible.filter(
    (m) => m.programme.deadline_type && !['none', 'rolling'].includes(m.programme.deadline_type),
  );
  if (!dated.length) return '';
  return `<section class="bucket" id="deadlines">
    <div class="bucket__head"><h2>Deadlines</h2><span class="bucket__count">${dated.length} time-limited</span></div>
    <p class="small">Most support is rolling — you can apply any time. These are not.</p>
    <div class="list-rows">
      ${dated
        .map(
          (m) => `<div class="list-row" style="cursor:default">
        <span><span class="list-row__name">${esc(m.programme.name_en)}</span>
        <span class="list-row__meta">${esc(m.programme.deadline_note || m.programme.deadline_type)}</span></span>
        <span class="list-row__right"><span class="badge badge-neutral">${esc(m.programme.deadline_type)}</span></span>
      </div>`,
        )
        .join('')}
    </div>
    <p style="margin-top:1rem"><button class="btn btn-ghost btn-sm" type="button" data-act="ics">Add reminders to my calendar (.ics)</button></p>
  </section>`;
}

/** Nothing matched. Explain why, using the reasons already in the data. */
function viewNoMatches() {
  const r = S.result;
  const prExtra = r.not_eligible.filter(
    (m) => m.rules_failed.some((x) => /citizens or permanent residents/i.test(x)),
  ).length;
  return `<div class="results" style="max-width:none">
    <section class="result-hero">
      <span class="eyebrow">${esc(S.entry.flag)} ${esc(S.entry.name)} · matched against ${S.data.programmes.length} programmes</span>
      <p class="figure" style="font-size:clamp(2rem,5vw,3.4rem)">Nothing matched — and that's worth knowing why</p>
      <p class="small" style="color:#a89c8a;max-width:60ch;margin-top:1.5rem">
        A blank result is usually a rule about who a country pays, not a bug. Here is exactly what blocked you,
        counted from the ${S.data.programmes.length} ${esc(S.entry.name)} programmes we hold.</p>
      <div class="row" style="margin-top:2rem">
        <button class="btn btn-sm" type="button" data-act="restart">Change my answers</button>
        <a class="btn btn-sm btn-ghost" style="color:#faf6ef;border-color:#4a453c" href="${BASE}/${S.entry.slug}/">Browse all ${S.data.programmes.length} anyway</a>
      </div>
    </section>

    <section class="bucket">
      <div class="bucket__head"><h2>What blocked you</h2></div>
      <div class="list-rows">
        ${(r.blockers || [])
          .map(
            (b) => `<div class="list-row" style="cursor:default">
          <span><span class="list-row__name">${esc(b.reason)}</span></span>
          <span class="list-row__right"><span class="list-row__amount">${b.count}</span><span class="tiny">programmes</span></span>
        </div>`,
          )
          .join('')}
      </div>
    </section>

    ${
      prExtra
        ? `<div class="callout callout--terracotta" style="margin-top:2rem">
      <p><strong>${prExtra} of these open up with permanent residence or citizenship.</strong> If you are on a path to
      PR, that is the single change that unlocks the most money here — worth knowing years in advance rather than
      discovering it afterwards.</p>
    </div>`
        : ''
    }

    <div class="callout callout--sage" style="margin-top:1.5rem">
      <p><strong>Look at statutory entitlements instead.</strong> Residence-based welfare is only part of the picture.
      Employment law usually gives you things regardless of nationality — end-of-service payments, statutory leave,
      wage protection, mandatory insurance. Several are catalogued here:</p>
      <p style="margin-bottom:0"><a class="link-underline" href="${BASE}/${S.entry.slug}/employment/">Work &amp; employment entitlements in ${esc(S.entry.name)}</a></p>
    </div>

    <details class="fold" style="margin-top:2.5rem">
      <summary>Show all ${r.not_eligible.length} programmes and the rule each one failed on</summary>
      <div class="bucket-list" style="margin-top:1rem">${r.not_eligible.slice(0, 40).map((m) => progCard(m, 'no')).join('')}</div>
    </details>
    <p class="tiny" style="margin-top:1.5rem">${esc(DISCLAIMER)} Data as of ${esc(r.data_as_of)}.</p>
  </div>`;
}

function viewResults() {
  const r = S.result;
  if (r.eligible.length === 0 && r.conditional.length === 0 && (r.tapered || []).length === 0) {
    return viewNoMatches();
  }
  const cur = r.currency;
  const auto = r.eligible.filter((m) => m.programme.is_automatic);
  const apply = r.eligible.filter((m) => !m.programme.is_automatic);
  // Eligible programmes whose amount the authority calculates — these count as
  // zero in the headline, so name the biggest ones rather than hiding them.
  const unpricedTop = r.eligible
    .filter((m) => !m.is_capital && m.programme.amount_min == null && m.programme.amount_max == null)
    .sort((a, b) => {
      const rank = (m) => (m.programme.verification_status === 'verified' ? 0 : 1);
      return rank(a) - rank(b);
    })
    .slice(0, 3)
    .map((m) => m.programme.name_en);

  const headline =
    r.total_max > 0
      ? r.total_min > 0 && r.total_min !== r.total_max
        ? `${money(r.total_min, cur)}–${money(r.total_max, cur)}`
        : `up to ${money(r.total_max, cur)}`
      : null;

  /* Nothing qualifies YET, but things are pending on a question that was
     skipped. "0 programmes" is not the answer, it is the absence of one, and
     a reader who takes it as the answer closes the tab still not claiming.
     Same rule as the app: never report a confident zero over an open question. */
  const pending = r.eligible.length === 0 ? r.needs_one_more_answer.length : 0;
  const blockers = pending
    ? [...new Set(r.needs_one_more_answer.map((m) => m.blocking_attribute).filter(Boolean))]
        .map((a) => ATTR_LABEL[a] ?? a)
        .slice(0, 2)
    : [];

  return `<div class="results" style="max-width:none">
  <section class="result-hero">
    <span class="eyebrow">${esc(S.entry.flag)} ${esc(S.entry.name)} · matched against ${S.data.programmes.length} programmes</span>
    ${
      pending
        ? `<p class="figure" style="font-size:clamp(2rem,6vw,3.6rem)">${pending} waiting on you</p>
           <p class="figure-unit" style="margin-top:1rem">We can't put a number on it yet. ${pending} programme${pending === 1 ? '' : 's'}
           depend${pending === 1 ? 's' : ''} on ${blockers.length ? esc(blockers.join(' and ')) : 'a question'}, which you skipped.
           Answer ${blockers.length === 1 ? 'it' : 'them'} and this becomes a figure.</p>
           <p style="margin-top:1.4rem"><button class="btn btn-primary" type="button" data-act="restart">Answer ${blockers.length === 1 ? 'it' : 'them'} now</button></p>`
        : headline
          ? `<p class="figure">${esc(headline)}</p>
           <p class="figure-unit" style="margin-top:1rem">per year in published ceilings you appear to qualify for</p>`
          : `<p class="figure" style="font-size:clamp(2.2rem,7vw,4.5rem)">${r.eligible.length} programmes</p>
           <p class="figure-unit" style="margin-top:1rem">you appear to qualify for</p>`
    }
    <p class="small" style="color:#a89c8a;max-width:60ch;margin-top:1.5rem">
      ${r.eligible.length} eligible · ${r.needs_one_more_answer.length} need one more answer · ${r.conditional.length} depend on a circumstance you didn't claim · ${r.not_eligible.length} ruled out.
      ${r.capital_max > 0 ? `A further ${money(r.capital_max, cur)} in loan and credit ceilings is excluded, because borrowing is not income.` : ''}
    </p>
    ${
      unpricedTop.length
        ? `<div style="position:relative;margin-top:1.5rem;padding:1rem 1.2rem;border:1px solid #3d3831;border-radius:10px;background:rgba(255,255,255,.03)">
        <p class="small" style="color:#cfc7b8;margin:0;max-width:62ch"><strong style="color:#f0c8a8">The figure above is not your real total.</strong>
        ${r.unpriced_count} of your matches publish no fixed amount — the authority calculates it from your circumstances —
        so they count as <strong>zero</strong> here. They are often the largest payments of all. Yours include
        ${unpricedTop.map((n) => `<strong style="color:#faf6ef">${esc(n)}</strong>`).join(', ')}${
          r.unpriced_count > unpricedTop.length ? ` and ${r.unpriced_count - unpricedTop.length} more` : ''
        }. We would rather show you a small honest number than a big invented one.</p>
      </div>`
        : ''
    }
    <div class="row" style="margin-top:2rem" class="no-print">
      <button class="btn btn-sm" type="button" data-act="share">Copy my result link</button>
      <button class="btn btn-sm btn-ghost" style="color:#faf6ef;border-color:#4a453c" type="button" onclick="window.print()">Print / save as PDF</button>
      <button class="btn btn-sm btn-ghost" style="color:#faf6ef;border-color:#4a453c" type="button" data-act="restart">Change my answers</button>
    </div>
  </section>

  <div class="grid grid-3" style="margin-top:2rem">
    <div class="card card-flat"><div class="figure-sm">${auto.length}</div><p class="small" style="margin:.4rem 0 0"><strong>Should arrive automatically.</strong> If you're not getting these, the authority is missing a detail about you — worth one phone call.</p></div>
    <div class="card card-flat"><div class="figure-sm" style="color:var(--terracotta)">${apply.length}</div><p class="small" style="margin:.4rem 0 0"><strong>Need an application.</strong> Nobody will prompt you. This is where the unclaimed money actually is.</p></div>
    <div class="card card-flat"><div class="figure-sm">${r.eligible.filter((m) => m.programme.verification_status === 'verified').length}</div><p class="small" style="margin:.4rem 0 0"><strong>Human-verified matches.</strong> A researcher confirmed these against the official page.</p></div>
  </div>

  ${gated(apply.length, 'programmes you can apply for', () => `<section class="bucket">
    <div class="bucket__head"><h2>Apply for these</h2><span class="bucket__count">${apply.length} programmes · nobody will remind you</span></div>
    <div class="bucket-list">${apply.map((m) => progCard(m, 'eligible')).join('')}</div>
  </section>`)}

  ${gated(auto.length, 'you should already be getting', () => `<section class="bucket">
    <div class="bucket__head"><h2>You should already be getting these</h2><span class="bucket__count">${auto.length} automatic</span></div>
    <p class="small">No application needed — but "automatic" assumes the authority has your correct details. If one of these
    isn't reaching you, that is the gap worth chasing.</p>
    <div class="bucket-list" style="margin-top:1rem">${auto.map((m) => progCard(m, 'eligible')).join('')}</div>
  </section>`)}

  ${gated((r.tapered || []).length, 'at a reduced amount', () => `<section class="bucket">
    <div class="bucket__head"><h2>Reduced amount, probably still yours</h2><span class="bucket__count">${r.tapered.length} programmes</span></div>
    <p class="small" style="max-width:62ch">Your income is above the published ceiling — but that ceiling is the threshold for the
    <em>maximum</em> award, and each of these records says in its own words that the payment tapers rather than stops.
    A tool that treated the ceiling as a cut-off would tell you "no" here. We'd rather tell you "probably less, go and check".</p>
    <div class="bucket-list" style="margin-top:1rem">${r.tapered.slice(0, 15).map((m) => progCard(m, 'taper')).join('')}</div>
  </section>`)}

  ${gated(r.conditional.length, 'that depend on your circumstances', () => `<section class="bucket">
    <div class="bucket__head"><h2>Only if this is you</h2><span class="bucket__count">${r.conditional.length} programmes${
      r.conditional_max > 0 ? ` · ${money(r.conditional_max, cur)} not counted` : ''
    }</span></div>
    <p class="small" style="max-width:62ch">These depend on a situation you didn't tell us about — a disability, caring for
    someone, being off sick, a new baby, a bereavement, military service. They pass every other rule you gave us.
    <strong>They are deliberately excluded from your headline figure</strong>, because counting money you probably can't
    get is how these tools end up useless. If one of them describes you, it's likely the biggest thing on this page.</p>
    <div class="bucket-list" style="margin-top:1rem">${r.conditional.slice(0, 20).map((m) => progCard(m, 'conditional')).join('')}</div>
    ${r.conditional.length > 20 ? `<p class="small">Showing 20 of ${r.conditional.length}.</p>` : ''}
  </section>`)}

  ${gated(r.eligible.length, 'documents and deadlines', () => documentPlan(r) + deadlineSection(r))}

  ${gated(r.needs_one_more_answer.length, 'one answer away', () => `<section class="bucket">
    <div class="bucket__head"><h2>One answer away</h2><span class="bucket__count">${r.needs_one_more_answer.length} programmes</span></div>
    <p class="small">You pass everything we can test. Each of these needs one more detail — answer it and it moves bucket immediately.</p>
    <div class="bucket-list" style="margin-top:1rem">${r.needs_one_more_answer.slice(0, 25).map((m) => progCard(m, 'maybe')).join('')}</div>
  </section>`)}

  <details class="fold" style="margin-top:3rem">
    <summary>Show the ${r.not_eligible.length} programmes you don't qualify for, and why</summary>
    <p class="small" style="margin-top:1rem">Worth a scan: circumstances change, and the failing rule tells you what would have to change.</p>
    <div class="bucket-list" style="margin-top:1rem">${r.not_eligible.slice(0, 40).map((m) => progCard(m, 'no')).join('')}</div>
    ${r.not_eligible.length > 40 ? `<p class="small">Showing 40 of ${r.not_eligible.length}. <a class="link-underline" href="${BASE}/${S.entry.slug}/">Browse all ${S.data.programmes.length} programmes in ${esc(S.entry.name)}</a>.</p>` : ''}
  </details>

  <div class="callout" style="margin-top:3rem">
    <p><strong>What this number is.</strong> ${esc(r.coverage_note)} The figure sums published maximums for the
    programmes you're eligible for. Means-tested schemes taper, so treat it as a ceiling of what is on the table —
    and remember programmes with no published amount counted as zero.</p>
    <p style="margin-bottom:0"><a class="link-underline" href="${BASE}/methodology/">How this is calculated and what's wrong with it</a></p>
  </div>
  <p class="tiny" style="margin-top:1.5rem">${esc(DISCLAIMER)} Data as of ${esc(r.data_as_of)}.</p>
</div>`;
}

/* ------------------------------------------------------------------ */
/* ICS export                                                          */
/* ------------------------------------------------------------------ */

function buildIcs() {
  const dated = S.result.eligible.filter(
    (m) => m.programme.deadline_type && !['none', 'rolling'].includes(m.programme.deadline_type),
  );
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Unclaimed//EN', 'CALSCALE:GREGORIAN'];
  dated.forEach((m, i) => {
    const p = m.programme;
    // No parsed date in the data — schedule a review reminder 30 days out.
    const d = new Date(Date.now() + (30 + i) * 86400000);
    const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:unclaimed-${S.entry.slug}-${p.slug}@unclaimed`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:Apply: ${p.name_en}`,
      `DESCRIPTION:${(p.deadline_note || p.deadline_type || '').replace(/\n/g, ' ')}\\n\\nFunder: ${p.funder}\\nOfficial page: ${p.application_url || p.source_url}\\n\\nReminder created by Unclaimed. Check the official page for the exact deadline.`,
      `URL:${p.application_url || p.source_url}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `unclaimed-${S.entry.slug}-deadlines.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

async function render() {
  const st = steps();
  if (S.result) {
    /* Ask before drawing: rendering the list and then hiding it would put the
       whole paid product one devtools panel away. */
    await refreshEntitlement();
    app.innerHTML = viewResults();
  } else {
    const which = st[S.step];
    app.innerHTML =
      which === 'country'
        ? viewCountry()
        : which === 'region'
          ? viewRegion()
          : which === 'status'
            ? viewStatus()
            : which === 'circumstances'
              ? viewCircumstances()
              : which === 'household'
              ? viewHousehold()
                : which === 'income'
                  ? viewIncome()
                  : viewHousing();
  }
  app.classList.toggle('wizard', !S.result);
  window.scrollTo({ top: 0, behavior: 'instant' });
  const search = document.getElementById('csearch');
  if (search) {
    search.focus();
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      document.querySelectorAll('#clist .opt').forEach((el) => {
        el.style.display = el.dataset.name.includes(q) ? '' : 'none';
      });
    });
  }
}

async function loadCountry(cc) {
  S.entry = S.manifest.countries.find((c) => c.slug === cc);
  S.profile.country_code = S.entry.country_code;
  const res = await fetch(`${BASE}/api/v1/programmes/${cc}.json`);
  S.data = await res.json();
}

function readInputs() {
  const g = (id) => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    return el.value.trim() === '' ? null : Number(el.value);
  };
  const age = g('age');
  if (age !== undefined) S.profile.age = age;
  const hh = g('hh');
  if (hh !== undefined) S.profile.household_size = hh ?? 1;
  const kids = g('kids');
  if (kids !== undefined) S.profile.children_count = kids ?? 0;
  const inc = g('inc');
  if (inc !== undefined) S.profile.income_annual = inc;
  const res = g('res');
  if (res !== undefined) S.profile.residency_months = res;
}

function compute() {
  S.result = match(S.profile, S.data, S.entry);
  const url = new URL(location.href);
  url.hash = `r=${encodeState()}`;
  history.replaceState(null, '', url);
  render();
}

function advance() {
  readInputs();
  const st = steps();
  if (S.step >= st.length - 1) compute();
  else {
    S.step += 1;
    render();
  }
}

app.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button, a[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'country') {
    btn.textContent = 'Loading…';
    await loadCountry(btn.dataset.cc);
    S.step = 1;
    render();
    return;
  }
  if (btn.dataset.multi) {
    const key = btn.dataset.multi;
    const v = btn.dataset.value;
    const cur = new Set(S.profile[key] || []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    S.profile[key] = [...cur];
    render();
    return;
  }
  if (btn.dataset.field) {
    S.profile[btn.dataset.field] = btn.dataset.value;
    // Single-choice steps advance immediately; the housing step has two groups.
    const st = steps()[S.step];
    if (st === 'region' || st === 'status' || st === 'income') {
      setTimeout(advance, 130);
    } else {
      render();
    }
    return;
  }
  if (act === 'back') {
    readInputs();
    S.step = Math.max(0, S.step - 1);
    render();
    return;
  }
  if (act === 'next') return advance();
  if (act === 'skip') {
    const st = steps()[S.step];
    if (st === 'region') S.profile.admin_area = null;
    if (st === 'circumstances') S.profile.circumstances = [];
    if (st === 'income') {
      S.profile.income_band = null;
      S.profile.income_annual = null;
    }
    S.step += 1;
    render();
    return;
  }
  if (act === 'restart') {
    S.result = null;
    S.step = 1;
    render();
    return;
  }
  if (act === 'answer') {
    const attrMap = { income: 'income', age: 'household', admin_area: 'region', housing_tenure: 'housing', nationality: 'housing', residency_months: 'housing', status: 'status', circumstance: 'circumstances' };
    const target = attrMap[btn.dataset.attr] || 'housing';
    S.result = null;
    S.step = Math.max(0, steps().indexOf(target));
    render();
    return;
  }
  if (act === 'ics') return buildIcs();
  if (act === 'share') {
    const url = `${location.origin}${location.pathname}#r=${encodeState()}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Unclaimed', text: estimateShareText(S.result, S.entry.name), url });
      } else {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Link copied ✓';
        setTimeout(() => (btn.textContent = 'Copy my result link'), 2200);
      }
    } catch {
      /* user dismissed */
    }
  }
});

// A shared result link pasted while /check/ is already open changes only the
// hash, which does not re-run the module. Without this the recipient sees the
// wizard's first step instead of the result they were sent.
window.addEventListener('hashchange', async () => {
  const h = location.hash.match(/r=([A-Za-z0-9_-]+)/);
  if (!h) return;
  const p = decodeState(h[1]);
  if (!p || !p.country_code) return;
  if (S.result && encodeState() === h[1]) return;
  Object.assign(S.profile, p);
  await loadCountry(p.country_code.toLowerCase());
  compute();
});

/* ---- boot ---- */
(async () => {
  S.manifest = await (await fetch(`${BASE}/api/v1/countries.json`)).json();

  const hash = location.hash.match(/r=([A-Za-z0-9_-]+)/);
  const qc = new URLSearchParams(location.search).get('country');

  if (hash) {
    const p = decodeState(hash[1]);
    if (p && p.country_code) {
      Object.assign(S.profile, p);
      await loadCountry(p.country_code.toLowerCase());
      compute();
      return;
    }
  }
  if (qc && S.manifest.countries.some((c) => c.slug === qc)) {
    await loadCountry(qc);
    S.step = 1;
  }
  render();
})();
