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

/* ---- questions ------------------------------------------------------ */

const STAGES = [
  ['idea', 'Idea or pre-incorporation', 'Not trading yet'],
  ['preseed', 'Pre-seed', 'Building, little or no revenue'],
  ['seed', 'Seed', 'Early revenue or first round raised'],
  ['seriesa', 'Series A or later', 'Scaling'],
  ['established', 'Established SME', 'Trading for several years'],
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
  <p class="tiny" style="margin:-1.6rem 0 1.6rem">Step ${S.step + 1} of ${st.length} · nothing you type is sent to a server</p>`;
};

const nav = (next = 'Continue', skip = null) => `<div class="wizard-nav">
  ${S.step > 0 ? '<button class="btn btn-ghost btn-sm" type="button" data-act="back">← Back</button>' : '<span></span>'}
  <span class="row">
    ${skip ? `<button class="btn btn-ghost btn-sm" type="button" data-act="skip">${esc(skip)}</button>` : ''}
    <button class="btn btn-primary" type="button" data-act="next">${esc(next)}</button>
  </span>
</div>`;

const opts = (list, field, multi = false) =>
  `<div class="opts">${list
    .map(([value, label, sub]) => {
      const on = multi ? S.profile[field].includes(value) : S.profile[field] === value;
      return `<button class="opt" type="button" aria-pressed="${on}" data-field="${field}" data-value="${esc(value)}" data-multi="${multi}">
        <span>${esc(label)}${sub ? `<span class="opt__sub">${esc(sub)}</span>` : ''}</span>
      </button>`;
    })
    .join('')}</div>`;

function viewCountry() {
  const cs = (S.manifest?.countries ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="step">${rail()}
    <h1 class="q">Where is the company registered?</h1>
    <p class="q-why">Funding is national, and most programmes will not look at a company registered elsewhere. We only load the jurisdictions you can actually reach.</p>
    <div class="field"><label for="csearch">Search ${cs.length} jurisdictions</label>
      <input id="csearch" type="search" placeholder="Start typing…"></div>
    <div class="opts" id="clist">
      ${cs
        .map(
          (c) => `<button class="opt" type="button" data-act="country" data-cc="${esc(c.slug)}" data-name="${esc(c.name.toLowerCase())}">
            <span style="font-size:1.3rem;line-height:1">${c.flag ?? ''}</span>
            <span>${esc(c.name)}<span class="opt__sub">${nf.format(c.programme_count ?? 0)} programmes</span></span>
          </button>`,
        )
        .join('')}
    </div>
  </div>`;
}

const viewStage = () => `<div class="step">${rail()}
  <h1 class="q">What stage is the company at?</h1>
  <p class="q-why">Most programmes are written for a stage. Getting this wrong is the single biggest source of wasted applications.</p>
  ${opts(STAGES, 'stage')}${nav()}</div>`;

const viewHeadcount = () => `<div class="step">${rail()}
  <h1 class="q">How many people work there?</h1>
  <p class="q-why">The EU SME definition turns on headcount, and it decides eligibility for a large share of what is on this list.</p>
  ${opts(HEADCOUNT, 'headcount')}${nav()}</div>`;

const viewTurnover = () => `<div class="step">${rail()}
  <h1 class="q">Annual turnover?</h1>
  <p class="q-why">The other half of the SME test. A rough band is enough — nothing here is checked against a filing.</p>
  ${opts(TURNOVER, 'turnover_annual_eur')}${nav(undefined, 'Rather not say')}</div>`;

const viewSectors = () => `<div class="step">${rail()}
  <h1 class="q">What does it do?</h1>
  <p class="q-why">Pick any that apply. Sector-restricted programmes are excluded rather than guessed at, so leaving this blank costs you matches.</p>
  ${opts(SECTORS, 'sectors', true)}${nav('Continue', 'None of these')}</div>`;

const viewRd = () => `<div class="step">${rail()}
  <h1 class="q">Does it do research or development?</h1>
  <p class="q-why">R&amp;D unlocks a distinct pool — tax credits, innovation grants, Horizon calls. It is the highest-value question on this page.</p>
  ${opts([[true, 'Yes, actively'], [false, 'No']], 'rd_active')}
  ${nav('See what it qualifies for')}</div>`;

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

  const money = (byCurrency) =>
    Object.entries(byCurrency || {})
      .map(([cur, v]) => `${cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur + ' '}${nf.format(Math.round(v.max ?? v.min ?? 0))}`)
      .join(' + ');

  const free = bands.filter((b) => b.non_dilutive);
  const headline = free.length ? money(free[0].by_currency) : null;

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
                 ? `in published non-dilutive ceilings across ${eligible.length} programmes this company appears to qualify for`
                 : 'this company appears to qualify for'
             }</p>`
          : `<p class="figure" style="font-size:clamp(2rem,5vw,3.4rem)">Nothing matched outright</p>
             <p class="figure-unit" style="margin-top:1rem">${conditional.length + needsAnswer.length} depend on details we did not ask for.</p>`
      }
      <p class="small" style="color:var(--ink-3);max-width:62ch;margin-top:1.4rem">
        ${eligible.length} eligible · ${conditional.length} depend on a circumstance · ${needsAnswer.length} need one more answer.
        Amounts are published ceilings, not offers, and programmes with no published amount count as zero.
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
          b.non_dilutive ? 'Non-dilutive' : 'Dilutive or in kind'
        }${b.unpriced ? ` · ${b.unpriced} publish no amount` : ''}</p>
        ${money(b.by_currency) ? `<p class="tiny" style="margin:.3rem 0 0">up to ${esc(money(b.by_currency))}</p>` : ''}
      </div>`,
        )
        .join('')}
    </div>`
        : ''
    }

    <section class="bucket locked-bucket" style="margin-top:2.4rem">
      <div class="bucket__head"><h2>Which ${eligible.length} programmes</h2></div>
      <p class="small">The names, the amounts each one pays, what documents they want, when they close, and the application links are on the paid plan.</p>
      <div class="locked__rows" aria-hidden="true">
        ${Array.from({ length: Math.min(eligible.length, 4) }, () => '<div class="locked__row"></div>').join('')}
      </div>
      <p style="margin-top:1.2rem">
        <a class="btn btn-primary" href="${BASE}/pricing/">See the plans</a>
        <a class="btn" href="${BASE}/enterprise/">What the workspace does</a>
      </p>
    </section>

    <div class="row no-print" style="margin-top:2rem">
      <button class="btn btn-sm" type="button" data-act="restart">Change my answers</button>
      <a class="btn btn-sm btn-ghost" href="${BASE}/startups/">Browse programmes instead</a>
    </div>

    <p class="tiny" style="margin-top:1.6rem;max-width:70ch">This ran entirely in your browser. Nothing you entered was sent anywhere —
    which is also why nothing was saved. Sign in to keep it.</p>
  </div>`;
}

/* ---- controller ----------------------------------------------------- */

const VIEWS = { country: viewCountry, stage: viewStage, headcount: viewHeadcount, turnover: viewTurnover, sectors: viewSectors, rd: viewRd };

function render() {
  if (!root) return;
  root.innerHTML = S.result ? viewResult() : (VIEWS[steps()[S.step]] ?? viewCountry)();
  root.classList.toggle('wizard', !S.result);
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
    default:
      break;
  }
});

manifest().then(render);
