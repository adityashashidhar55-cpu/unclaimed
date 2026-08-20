/**
 * The free company check.
 *
 * `/startups/check/` — the page every "Check what my company is owed" button
 * on the site points at — used to mount `<div id="app" data-mode="startup">`
 * and load the household wizard. Nothing in that wizard has ever read
 * `data-mode`. So the primary business CTA asked a founder how many children
 * live in their home, matched them against personal benefits, and never
 * touched the 1,684 company programmes at all.
 *
 * This is the page that should have been there. Six questions, matched with
 * the same `matchStartup` engine the paid workspace uses, so the free answer
 * and the paid answer cannot disagree.
 *
 * The paywall line is the same as the individual side and for the same reason:
 * FREE is how much and how many, PAID is which ones. That is not enforced
 * here — it is enforced by the dataset, which arrives with names stripped for
 * anyone the server has not entitled. This file could not show the names if it
 * wanted to.
 */
import { matchStartup, reachFor, isFreeMoney } from '../engine/startup.js';
import { track } from '../beacon.js';
/* The company funnel's paywall moment had no checkout on it at all: the only
   two controls sent the buyer to /pricing/ to choose again. The individual
   screen has always had a data-checkout button; this one did not import the
   module that binds them. */
/* Specifiers in this directory are relative to where build.mjs EMITS the file,
   not to src/pwa/ — that is why the two imports above reach for '../'. This one
   is emitted at the dist root, so './checkout.js' asked for /checkout.js, which
   does not exist; checkout.js is written to /app/checkout.js. The browser 404ed
   the specifier and dropped the entire module, so the whole company wizard —
   not just checkout — rendered nothing. Nothing errored server-side and the
   page still painted its shell, which is why it looked fine. */
import { bindCheckout } from './app/checkout.js';
import { T, translateTree } from './wizard-i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = new Intl.NumberFormat('en');

const root = document.getElementById('app');
const BASE = root?.dataset.base ?? '';

const S = {
  step: 0,
  manifest: null,
  pools: {},
  result: null,
  profile: {
    country_code: null,
    incorporated: true,
    incorporation_date: null,
    headcount: null,
    turnover_annual_eur: null,
    stage: null,
    sectors: [],
    rd_active: null,
  },
};

/* ---- data ---------------------------------------------------------- */

async function manifest() {
  if (S.manifest) return S.manifest;
  const res = await fetch(`${BASE}/api/v1/startups/index.json`, { credentials: 'same-origin' });
  S.manifest = await res.json();
  return S.manifest;
}

/** Only the pools this company can actually reach — never all 77. */
async function loadPools(cc) {
  const wanted = reachFor(cc);
  await Promise.all(
    wanted.map(async (pool) => {
      if (S.pools[pool]) return;
      try {
        const res = await fetch(`${BASE}/api/v1/startups/${pool}.json`, { credentials: 'same-origin' });
        S.pools[pool] = res.ok ? await res.json() : { programmes: [] };
      } catch {
        S.pools[pool] = { programmes: [] };
      }
    }),
  );
  return S.pools;
}

/* ---- the wall -------------------------------------------------------- *
 *
 * This file had no entitlement branch at all — the string "entitl" appeared in
 * it only in comments — so `locked-bucket` rendered unconditionally. An
 * entitled business subscriber, served the unstripped pool byte-for-byte as
 * worker/index.js hands it to a paying session, still read "Which 15
 * programmes … are on the paid plan" with one control on the screen: "Unlock
 * the full list". Clicking it ran upgrade() → who.entitled → manageBilling(),
 * so the buyer was sent to the Stripe billing portal to buy what they had
 * already bought. The names were in the page's memory the whole time.
 *
 * Asked of the server, never assumed, and the unreachable answer is "no" —
 * the same rule the individual wizard applies at src/app.js:426. A client
 * that can award itself the list is not a paywall.
 */
let ENTITLED = false;
let SIGNED_IN = false;

async function refreshEntitlement() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) { ENTITLED = false; SIGNED_IN = false; return; }
    const data = await res.json();
    ENTITLED = !!data?.entitlement?.entitled;
    SIGNED_IN = !!data?.signed_in;
  } catch {
    ENTITLED = false;
    SIGNED_IN = false;
  }
}

/* ---- questions ------------------------------------------------------ */

/* The values here are the vocabulary the DATA speaks, not a second spelling of
   it. src/engine/startup.js gates on `stages.includes(profile.stage)` — an
   exact match — and data/startups/*.json only ever says idea, pre_seed, seed,
   series_a or growth. This list used to offer preseed, seriesa and
   established, so three of the five answers matched nothing anywhere: a UK
   pre-seed company saw 29 eligible programmes become 0, Series A 37 become 0,
   growth 33 become 0, and the screen said "2 programmes" with no money figure
   and no error. src/pwa/dashboard.js has always used the data's spelling; the
   two clients disagreed about one field.
   scripts/test-vocabulary.mjs now diffs this list against the data. */
const STAGES = [
  ['idea', 'Idea or pre-incorporation', 'Not trading yet'],
  ['pre_seed', 'Pre-seed', 'Building, little or no revenue'],
  ['seed', 'Seed', 'Early revenue or first round raised'],
  ['series_a', 'Series A or later', 'Scaling'],
  ['growth', 'Growth', 'Trading for several years and scaling up'],
];

const HEADCOUNT = [
  [1, 'Just me'],
  [4, '2 to 5'],
  [15, '6 to 25'],
  [60, '26 to 99'],
  [180, '100 to 249'],
  [400, '250 or more'],
];

const TURNOVER = [
  [0, 'No revenue yet'],
  [100000, 'Under €250k'],
  [750000, '€250k to €2m'],
  [5000000, '€2m to €10m'],
  [30000000, 'Over €10m'],
];

const SECTORS = [
  ['deeptech', 'Deep tech or R&D heavy'],
  ['software', 'Software or SaaS'],
  ['health', 'Health or life sciences'],
  ['climate', 'Climate, energy or environment'],
  ['manufacturing', 'Manufacturing or hardware'],
  ['creative', 'Creative or media'],
  ['agri', 'Agriculture or food'],
];

const steps = () => ['country', 'stage', 'headcount', 'turnover', 'sectors', 'rd'];

/* ---- views ---------------------------------------------------------- */

const rail = () => {
  const st = steps();
  return `<div class="progress-rail" role="progressbar" aria-valuenow="${S.step + 1}" aria-valuemin="1" aria-valuemax="${st.length}">
    ${st.map((_, i) => `<span class="${i < S.step ? 'done' : i === S.step ? 'current' : ''}"></span>`).join('')}
  </div>
  <p class="tiny progress-caption">${esc(
    T('Step {n} of {total} · nothing you type is sent to a server', { n: S.step + 1, total: st.length }),
  )}</p>`;
};

const nav = (next = 'Continue', skip = null) => `<div class="wizard-nav">
  ${S.step > 0 ? `<button class="btn btn-ghost btn-sm" type="button" data-act="back">${esc(T('← Back'))}</button>` : '<span></span>'}
  <span class="row">
    ${skip ? `<button class="btn btn-ghost btn-sm" type="button" data-act="skip">${esc(T(skip))}</button>` : ''}
    <button class="btn btn-primary" type="button" data-act="next">${esc(T(next))}</button>
  </span>
</div>`;

const opts = (list, field, multi = false) =>
  `<div class="opts">${list
    .map(([value, label, sub]) => {
      const on = multi ? S.profile[field].includes(value) : S.profile[field] === value;
      return `<button class="opt" type="button" aria-pressed="${on}" data-field="${field}" data-value="${esc(value)}" data-multi="${multi}">
        <span>${esc(T(label))}${sub ? `<span class="opt__sub">${esc(T(sub))}</span>` : ''}</span>
      </button>`;
    })
    .join('')}</div>`;

/* The manifest field is `count`, and this read `programme_count`, which no
   entry has ever carried — so `?? 0` turned every one of the 77 jurisdictions
   into "0 programmes", one click after the landing page advertises 1,684. The
   `??` is what made it silent. manifestFieldsRead below is the list the
   vocabulary test checks against the built JSON so the next renamed field
   fails a test instead of printing a zero. */
export const MANIFEST_FIELDS_READ = ['slug', 'name', 'flag', 'count', 'verified'];

function jurisdictionCount(c) {
  const n = c.count ?? c.programme_count;
  if (n == null) return '';
  /* Same shape as the individual wizard's country picker. */
  return `${nf.format(n)} programmes${c.verified ? ` · ${nf.format(c.verified)} verified` : ''}`;
}

function viewCountry() {
  const cs = (S.manifest?.countries ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="wizard-step">${rail()}
    <h1 class="q">${esc(T('Where is the company registered?'))}</h1>
    <p class="q-why">${esc(T('Funding is national, and most programmes will not look at a company registered elsewhere. We only load the jurisdictions you can actually reach.'))}</p>
    <div class="field"><label for="csearch">${esc(T('Search {n} jurisdictions', { n: cs.length }))}</label>
      <input id="csearch" type="search" placeholder="${esc(T('Start typing…'))}"></div>
    <div class="opts" id="clist">
      ${cs
        .map(
          (c) => `<button class="opt" type="button" data-act="country" data-cc="${esc(c.slug)}" data-name="${esc(c.name.toLowerCase())}">
            <span style="font-size:1.3rem;line-height:1">${c.flag ?? ''}</span>
            <span>${esc(c.name)}<span class="opt__sub">${jurisdictionCount(c)}</span></span>
          </button>`,
        )
        .join('')}
    </div>
  </div>`;
}

const viewStage = () => `<div class="wizard-step">${rail()}
  <h1 class="q">${esc(T('What stage is the company at?'))}</h1>
  <p class="q-why">${esc(T('Most programmes are written for a stage. Getting this wrong is the single biggest source of wasted applications.'))}</p>
  ${opts(STAGES, 'stage')}${nav()}</div>`;

const viewHeadcount = () => `<div class="wizard-step">${rail()}
  <h1 class="q">${esc(T('How many people work there?'))}</h1>
  <p class="q-why">${esc(T('The EU SME definition turns on headcount, and it decides eligibility for a large share of what is on this list.'))}</p>
  ${opts(HEADCOUNT, 'headcount')}${nav()}</div>`;

const viewTurnover = () => `<div class="wizard-step">${rail()}
  <h1 class="q">${esc(T('Annual turnover?'))}</h1>
  <p class="q-why">${esc(T('The other half of the SME test. A rough band is enough — nothing here is checked against a filing.'))}</p>
  ${opts(TURNOVER, 'turnover_annual_eur')}${nav(undefined, 'Rather not say')}</div>`;

const viewSectors = () => `<div class="wizard-step">${rail()}
  <h1 class="q">${esc(T('What does it do?'))}</h1>
  <p class="q-why">${esc(T('Pick any that apply. Sector-restricted programmes are excluded rather than guessed at, so leaving this blank costs you matches.'))}</p>
  ${opts(SECTORS, 'sectors', true)}${nav('Continue', 'None of these')}</div>`;

const viewRd = () => `<div class="wizard-step">${rail()}
  <h1 class="q">${esc(T('Does it do research or development?'))}</h1>
  <p class="q-why">${esc(T('R&amp;D unlocks a distinct pool — tax credits, innovation grants, Horizon calls. It is the highest-value question on this page.'))}</p>
  ${opts([[true, 'Yes, actively'], [false, 'No']], 'rd_active')}
  ${nav('See what it qualifies for')}</div>`;

/* Currencies are never added together — two currencies stay two figures.
   Module scope because the entitled programme rows need it too. */
const money = (byCurrency) =>
  Object.entries(byCurrency || {})
    .map(([cur, v]) => `${cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur + ' '}${nf.format(Math.round(v.max ?? v.min ?? 0))}`)
    .join(' + ');

/* ---- result --------------------------------------------------------- */

/**
 * The free answer: how much, how many, and what would change it.
 *
 * Deliberately no programme names. They are not withheld here — they are
 * absent from the data this page was served, for anyone the server has not
 * entitled. Rendering a list and hiding it would put the whole paid product
 * one devtools panel away.
 */
function viewResult() {
  const r = S.result;
  const eligible = r.buckets?.eligible ?? r.eligible ?? [];
  const conditional = r.buckets?.conditional ?? r.conditional ?? [];
  const needsAnswer = r.buckets?.needs_answer ?? r.needs_answer ?? [];
  const totals = r.totals ?? {};

  /* Non-dilutive first, and separated: adding an equity round to a grant total
     is the same lie as adding cloud credits to cash. */
  const bands = Object.entries(totals)
    .map(([type, t]) => ({ type, ...t }))
    .filter((t) => t.count > 0)
    .sort((a, b) => Number(b.non_dilutive) - Number(a.non_dilutive) || b.count - a.count);

  /* Every non-dilutive band, not the first one.
     `free[0]` meant a GB seed company with a GBP 660,000 Grants band and a
     GBP 10,000 Vouchers band was shown GBP 660,000 under a caption that said
     the figure spanned all 20 eligible programmes — when it spanned four.
     us/seed has three non-dilutive bands. The currency split that money()
     performs is preserved: two currencies stay two figures, they are not
     added together. */
  const free = bands.filter((b) => b.non_dilutive);
  const freeByCurrency = {};
  for (const b of free) {
    for (const [cur, v] of Object.entries(b.by_currency || {})) {
      const acc = (freeByCurrency[cur] ||= { min: 0, max: 0 });
      acc.min += v.min ?? 0;
      acc.max += v.max ?? v.min ?? 0;
    }
  }
  const headline = free.length ? money(freeByCurrency) : null;
  /* The caption counts what CONTRIBUTED, not what matched. */
  const headlineCount = free.reduce((n, b) => n + (b.count ?? 0), 0);

  return `<div class="results" style="max-width:none">
    <section class="result-hero">
      <span class="eyebrow">${esc(S.manifest.countries.find((c) => c.slug === S.profile.country_code)?.name ?? '')} · matched against ${nf.format(
        Object.values(S.pools).reduce((n, p) => n + (p.programmes?.length ?? 0), 0),
      )} programmes</span>
      ${
        eligible.length
          ? `<p class="figure">${headline ? esc(headline) : `${eligible.length} programmes`}</p>
             <p class="figure-unit" style="margin-top:1rem">${
               headline
                 ? T('in published non-dilutive ceilings across {n} of the {total} programmes this company appears to qualify for', { n: headlineCount, total: eligible.length })
                 : T('this company appears to qualify for')
             }</p>`
          : `<p class="figure" style="font-size:clamp(2rem,5vw,3.4rem)">${esc(T('Nothing matched outright'))}</p>
             <p class="figure-unit" style="margin-top:1rem">${esc(T('{n} depend on details we did not ask for.', { n: conditional.length + needsAnswer.length }))}</p>`
      }
      <p class="small" style="color:var(--ink-3);max-width:62ch;margin-top:1.4rem">
        ${esc(T('{a} eligible · {b} depend on a circumstance · {c} need one more answer.', { a: eligible.length, b: conditional.length, c: needsAnswer.length }))}
        ${esc(T('Amounts are published ceilings, not offers, and programmes with no published amount count as zero.'))}
      </p>
    </section>

    ${
      bands.length
        ? `<div class="grid grid-3" style="margin-top:2rem">
      ${bands
        .slice(0, 6)
        .map(
          (b) => `<div class="card card-flat">
        <div class="figure-sm">${b.count}</div>
        <p class="small" style="margin:.35rem 0 0"><strong>${esc(b.label)}</strong></p>
        <p class="tiny" style="margin:.2rem 0 0">${
          b.non_dilutive ? T('Non-dilutive') : T('Dilutive or in kind')
        }${b.unpriced ? ` · ${b.unpriced} publish no amount` : ''}</p>
        ${money(b.by_currency) ? `<p class="tiny" style="margin:.3rem 0 0">${esc(T('up to {v}', { v: money(b.by_currency) }))}</p>` : ''}
      </div>`,
        )
        .join('')}
    </div>`
        : ''
    }

    ${ENTITLED ? eligibleList(eligible) : lockedBucket(eligible)}

    <div class="row no-print" style="margin-top:2rem">
      <button class="btn btn-sm" type="button" data-act="restart">${esc(T('Change my answers'))}</button>
      <a class="btn btn-sm btn-ghost" href="${BASE}/startups/">${esc(T('Browse programmes instead'))}</a>
    </div>

    <p class="tiny" style="margin-top:1.6rem;max-width:70ch">${esc(
      T('This ran entirely in your browser. Nothing you entered was sent anywhere — which is also why nothing was saved. Sign in to keep it.'),
    )}</p>
  </div>`;
}

/** A named programme, for someone who paid for the names. */
function programmeRow(m) {
  const p = m.programme ?? m;
  /* A stripped record has no name_en. If the pool we were served is the free
     one, say nothing rather than render an empty row — the client does not
     get to decide it is entitled, and the server is what strips. */
  if (!p?.name_en) return '';
  const amount = money(
    p.amount_max != null || p.amount_min != null
      ? { [p.amount_currency || 'EUR']: { min: p.amount_min ?? 0, max: p.amount_max ?? p.amount_min ?? 0 } }
      : {},
  );
  const docs = (p.documents_required || []).map((d) => d.doc).filter(Boolean);
  return `<div class="card card-flat" style="margin-top:1rem">
    <div class="list-row__name"><strong>${esc(p.name_en)}</strong>
      ${p.funder ? `<span class="tiny">${esc(p.funder)}</span>` : ''}</div>
    ${amount ? `<p class="figure-sm" style="margin:.3rem 0 0">up to ${esc(amount)}</p>` : '<p class="tiny" style="margin:.3rem 0 0">No published amount — the funder sets it.</p>'}
    ${p.cofunding_pct != null && p.cofunding_pct > 0 ? `<p class="tiny" style="margin:.2rem 0 0">You must co-fund ${p.cofunding_pct}%</p>` : ''}
    ${p.deadline_note ? `<p class="tiny" style="margin:.2rem 0 0">${esc(p.deadline_note)}</p>` : ''}
    ${docs.length ? `<p class="tiny" style="margin:.2rem 0 0">Documents: ${docs.map(esc).join(', ')}</p>` : ''}
    ${
      p.application_url
        ? `<p class="btn-row" style="margin-top:.6rem"><a class="btn btn-sm" href="${esc(
            p.application_url,
          )}" target="_blank" rel="noopener">${esc(T('Apply on the official site'))}</a></p>`
        : ''
    }
  </div>`;
}

function eligibleList(eligible) {
  const rows = eligible.map(programmeRow).filter(Boolean).join('');
  /* Entitled but the pool came back stripped: that is a data incident, not a
     paywall, and it must not silently look like one. */
  if (!rows) {
    return `<section class="bucket" style="margin-top:2.4rem">
      <div class="bucket__head"><h2>Your ${eligible.length} programmes</h2></div>
      <p class="small notice notice--error" role="alert">Your plan is active but the full dataset did not load. Reload the page — if it keeps happening, tell us.</p>
    </section>`;
  }
  return `<section class="bucket" style="margin-top:2.4rem">
    <div class="bucket__head"><h2>Your ${eligible.length} programmes</h2><span class="bucket__count">${eligible.length} eligible</span></div>
    <p class="small">${esc(T('Names, amounts, documents, deadlines and the official application link for every match.'))}</p>
    <p class="btn-row" style="margin-top:1rem"><button class="btn btn-primary" type="button" data-act="prepare-company">${esc(T('Prepare these applications'))}</button></p>
    <div id="startup-plan-out" role="status" aria-live="polite"></div>
    ${rows}
  </section>`;
}

function lockedBucket(eligible) {
  return `<section class="bucket locked-bucket" style="margin-top:2.4rem">
    <div class="bucket__head"><h2>Which ${eligible.length} programmes</h2></div>
    <p class="small">${esc(T('The names, the amounts each one pays, what documents they want, when they close, and the application links are on the paid plan.'))}</p>
    <div class="locked__rows" aria-hidden="true">
      ${Array.from({ length: Math.min(eligible.length, 4) }, (_, i) => `<div class="locked__row withheld">${
        i === 0 ? '<span class="locked__row__lock" aria-hidden="true">\u25CF\u25CF\u25CF\u25CF</span>' : ''
      }</div>`).join('')}
    </div>
    <p style="margin-top:1.2rem">
      <button class="btn btn-primary" type="button" data-checkout data-plan="business_monthly">${
        SIGNED_IN ? T('Upgrade to see the list') : T('Unlock the full list')
      }</button>
      <a class="btn" href="${BASE}/pricing/">${esc(T('See the plans'))}</a>
      <a class="btn btn-ghost" href="${BASE}/enterprise/">${esc(T('What the workspace does'))}</a>
    </p>
  </section>`;
}

/* ---- controller ----------------------------------------------------- */

const VIEWS = { country: viewCountry, stage: viewStage, headcount: viewHeadcount, turnover: viewTurnover, sectors: viewSectors, rd: viewRd };

function render() {
  if (!root) return;
  root.innerHTML = S.result ? viewResult() : (VIEWS[steps()[S.step]] ?? viewCountry)();
  /* Same single point as the individual wizard: the views are English template
     literals, and the localised copy is applied to the rendered subtree. */
  translateTree(root);
  root.classList.toggle('wizard', !S.result);
  /* Re-bound every render: the result screen is drawn from scratch, so a
     listener attached once at boot would be attached to a node that no longer
     exists by the time the buyer reaches the locked panel. */
  bindCheckout(root);
  window.scrollTo({ top: 0, behavior: 'instant' });

  const search = $('#csearch');
  if (search) {
    search.focus();
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      document.querySelectorAll('#clist .opt').forEach((el) => {
        el.style.display = el.dataset.name.includes(q) ? '' : 'none';
      });
    });
  }

  /* Funnel steps, named the same as the individual side so one dashboard
     covers both audiences. */
  track('check_start', { country: S.profile.country_code, surface: 'web' });
  if (S.step >= 1) track('country', { country: S.profile.country_code });
  if (S.step >= 2) track('answers_1', { country: S.profile.country_code });
  if (S.step >= Math.ceil(steps().length / 2)) track('answers_half', { country: S.profile.country_code });
  if (S.result) {
    track('answers_done', { country: S.profile.country_code });
    track('result', { country: S.profile.country_code });
    track('paywall_seen', { country: S.profile.country_code });
  }
}

async function compute() {
  await loadPools(S.profile.country_code);
  S.result = matchStartup(S.profile, S.pools, Date.now());
  render();
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act], [data-field]');
  if (!el) return;

  if (el.dataset.field) {
    const { field, value, multi } = el.dataset;
    const parsed = value === 'true' ? true : value === 'false' ? false : /^-?\d+$/.test(value) ? Number(value) : value;
    if (multi === 'true') {
      const list = S.profile[field];
      const i = list.indexOf(parsed);
      if (i === -1) list.push(parsed);
      else list.splice(i, 1);
      render();
    } else {
      S.profile[field] = parsed;
      render();
    }
    return;
  }

  switch (el.dataset.act) {
    case 'country':
      S.profile.country_code = el.dataset.cc;
      S.step = 1;
      render();
      break;
    case 'next':
      if (S.step >= steps().length - 1) await compute();
      else {
        S.step += 1;
        render();
      }
      break;
    case 'skip':
      if (S.step >= steps().length - 1) await compute();
      else {
        S.step += 1;
        render();
      }
      break;
    case 'back':
      S.step = Math.max(0, S.step - 1);
      render();
      break;
    case 'restart':
      S.result = null;
      S.step = 0;
      render();
      break;
    /* POST /api/startups/plan. The Worker has answered this route since the
       company product landed and nothing called it — it is entitlement-gated
       and belonged on this screen, which until now had no notion of
       entitlement client-side. It is in the SOLD map in
       scripts/test-reachability.mjs now, so deleting the button fails a test
       rather than quietly unselling the feature. */
    case 'prepare-company': {
      const out = document.getElementById('startup-plan-out');
      if (!out) break;
      const label = el.textContent;
      el.disabled = true;
      el.innerHTML = '<span class="btn__spinner" aria-hidden="true"></span>Preparing…';
      out.innerHTML = '<p class="small" style="margin-top:1rem">Building your packs…</p>';
      try {
        const res = await fetch('/api/startups/plan', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profile: S.profile }),
        });
        const data = await res.json().catch(() => ({}));
        out.innerHTML = res.ok
          ? `<p class="small" style="margin-top:1rem">${esc(
              `${data.ready_count ?? (data.packages || []).length} pack${
                (data.packages || []).length === 1 ? '' : 's'
              } prepared.`,
            )}</p>`
          : `<p class="small notice notice--error" role="alert" style="margin-top:1rem">${esc(
              data.message || data.error || 'Something went wrong preparing your packs.',
            )}</p>`;
      } catch {
        out.innerHTML = '<p class="small notice notice--error" role="alert" style="margin-top:1rem">We could not reach the server. Try again.</p>';
      }
      el.disabled = false;
      el.textContent = label;
      break;
    }
    default:
      break;
  }
});

/* Entitlement is resolved before the first paint, so an entitled subscriber
   never sees the lock flash and then disappear — and, more importantly, so
   the result screen has an answer to branch on the moment it is drawn. */
Promise.all([manifest(), refreshEntitlement()]).then(render);
