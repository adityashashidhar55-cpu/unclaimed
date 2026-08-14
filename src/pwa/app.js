/**
 * UNCLAIMED — the app.
 *
 * Individual scope only. The enterprise dashboard is deliberately not here:
 * a pipeline board with forty companies and six columns is not a phone
 * screen, and cramming one in would make both products worse.
 *
 * Everything runs on device. The matcher is imported, not called over the
 * wire, so the free check works with no signal and no account — which matters
 * because the people most likely to be owed money are the most likely to be
 * on a metered plan or a bad connection.
 *
 * No framework. Zero dependencies, same as the rest of the project.
 */

import { match } from '../engine/matcher.js';
import { matchStartup, reachFor } from '../engine/startup.js';
import { deadlineState, calendar, reminders, toICS } from '../packages/deadlines/index.js';

/* ------------------------------------------------------------------ */
/* Tiny helpers                                                        */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n).toLocaleString();

const STORE = 'unclaimed.profile.v1';
const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
};
const save = (p) => {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* private mode */ }
};

const state = { profile: load(), manifest: null, result: null, view: 'home', mode: 'person' };

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const BASE = document.body.dataset.base || '';
const json = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
};

async function manifest() {
  if (!state.manifest) state.manifest = await json('/api/v1/countries.json');
  return state.manifest;
}

/* ------------------------------------------------------------------ */
/* The question flow                                                   */
/* ------------------------------------------------------------------ */

const QUESTIONS = [
  {
    id: 'country_code', label: 'Where do you live?', type: 'country',
    help: 'Rules are national, so this decides everything else.',
  },
  {
    id: 'status', label: 'What best describes you right now?', type: 'choice',
    options: [
      ['employee', 'Employed'], ['self_employed', 'Self-employed'], ['unemployed', 'Not working'],
      ['student', 'Studying'], ['retired', 'Retired'], ['carer', 'Caring for someone'],
    ],
  },
  {
    id: 'income_band', label: 'Roughly what does your household bring in?', type: 'choice',
    help: 'A band is enough. Nothing is sent anywhere.',
    options: [['low', 'Low'], ['medium', 'Middle'], ['high', 'Higher'], [null, 'Rather not say']],
  },
  {
    id: 'household', label: 'Who lives with you?', type: 'household',
  },
  {
    id: 'housing_tenure', label: 'Your housing?', type: 'choice',
    options: [['renting', 'Renting'], ['owner', 'Own it'], ['with_family', 'With family'], ['other', 'Other']],
  },
];

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function shell(inner, { back = null, title = '' } = {}) {
  return `
  <header class="appbar">
    ${back ? `<button class="iconbtn" data-nav="${back}" aria-label="Back">←</button>` : '<span class="brand">Unclaimed</span>'}
    ${title ? `<span class="appbar__title">${esc(title)}</span>` : ''}
    <button class="iconbtn" data-nav="settings" aria-label="Settings">⋯</button>
  </header>
  <main class="appmain">${inner}</main>`;
}

function homeView() {
  const p = state.profile;
  const hasProfile = !!p.country_code;
  return shell(`
    <section class="hero">
      <p class="eyebrow">Free forever, no account</p>
      <h1>The money you are owed.</h1>
      <p class="lede">Answer five questions. Everything runs on this device — nothing is sent anywhere,
      and it works with no signal.</p>
      <button class="btn btn-primary btn-block" data-nav="check">
        ${hasProfile ? 'Check again' : 'Start the check'}
      </button>
      ${hasProfile ? `<button class="btn btn-block" data-nav="results">See my last result</button>` : ''}
    </section>

    <section class="tiles">
      <button class="tile" data-nav="check" data-mode="person">
        <span class="tile__k">Benefits</span>
        <span class="tile__v">For you and your household</span>
      </button>
      <button class="tile" data-nav="check" data-mode="startup">
        <span class="tile__k">Startup grants</span>
        <span class="tile__v">If you run a company</span>
      </button>
      <button class="tile" data-nav="deadlines">
        <span class="tile__k">Deadlines</span>
        <span class="tile__v">What closes soon, what reopens</span>
      </button>
      <button class="tile" data-nav="documents">
        <span class="tile__k">Documents</span>
        <span class="tile__v">Kept once, reused everywhere</span>
      </button>
    </section>

    <p class="foot">Discovery tool, not advice. Every figure is the published rule, not a decision on your case.</p>
  `);
}

async function checkView() {
  const man = await manifest();
  const p = state.profile;
  const q = QUESTIONS;

  const field = (question) => {
    const v = p[question.id];
    if (question.type === 'country') {
      return `<select class="field" data-q="${question.id}">
        <option value="">Choose…</option>
        ${man.countries.map((c) => `<option value="${c.slug}"${v === c.slug ? ' selected' : ''}>${c.flag} ${esc(c.name)}</option>`).join('')}
      </select>`;
    }
    if (question.type === 'household') {
      return `<div class="stepper-row">
        <label>Adults<div class="stepper"><button data-step="household_size" data-d="-1">−</button><output id="out-household_size">${p.household_size ?? 1}</output><button data-step="household_size" data-d="1">+</button></div></label>
        <label>Children<div class="stepper"><button data-step="children_count" data-d="-1">−</button><output id="out-children_count">${p.children_count ?? 0}</output><button data-step="children_count" data-d="1">+</button></div></label>
      </div>`;
    }
    return `<div class="choices">${question.options
      .map(
        (o) => `<button class="choice${v === o[0] ? ' is-on' : ''}" data-q="${question.id}" data-v="${o[0] === null ? '' : o[0]}" aria-pressed="${v === o[0]}">${esc(o[1])}</button>`,
      )
      .join('')}</div>`;
  };

  return shell(
    `<div class="qlist">
      ${q
        .map(
          (question) => `<section class="q">
        <h2>${esc(question.label)}</h2>
        ${question.help ? `<p class="small">${esc(question.help)}</p>` : ''}
        ${field(question)}
      </section>`,
        )
        .join('')}
      <button class="btn btn-primary btn-block" data-nav="results">See what I'm owed</button>
      <p class="tiny">Answers stay on this device. You can clear them any time in settings.</p>
    </div>`,
    { back: 'home', title: 'About you' },
  );
}

async function resultsView() {
  const p = state.profile;
  if (!p.country_code) return checkView();

  const cc = p.country_code;
  const man = await manifest();
  const entry = man.countries.find((c) => c.slug === cc);
  const data = await json(`/api/v1/programmes/${cc}.json`);
  const r = match({ ...p, country_code: cc }, data, entry);
  state.result = r;

  const cur = r.currency || entry?.currency || '';
  const sym = { GBP: '£', USD: '$', EUR: '€' }[cur] || '';
  const cal = calendar(r.eligible, Date.now());

  const row = (m) => {
    const d = deadlineState(m.programme, Date.now());
    return `<a class="prow" href="${esc(m.programme.application_url || m.programme.source_url)}" target="_blank" rel="noopener">
      <div class="prow__main">
        <div class="prow__name">${esc(m.programme.name_local || m.programme.name_en)}</div>
        <div class="prow__meta">${esc(m.programme.funder)}</div>
        <span class="chip chip--${d.urgency}">${esc(d.headline)}</span>
      </div>
      <div class="prow__amt">${m.est_annual_max != null ? sym + nf(m.est_annual_max) : '—'}</div>
    </a>`;
  };

  return shell(
    `<section class="total">
      <p class="eyebrow">You could be owed, per year</p>
      <div class="total__n">${sym}${nf(r.total_min)}–${sym}${nf(r.total_max)}</div>
      <p class="small">across ${r.eligible.length} programmes${r.unpriced_count ? `, plus ${r.unpriced_count} with no published amount` : ''}.</p>
      ${cal.counts.closing ? `<p class="warn">${cal.counts.closing} closing within two weeks.</p>` : ''}
    </section>

    <section>
      <h2>What you qualify for</h2>
      <div class="prows">${r.eligible.slice(0, 40).map(row).join('') || '<p class="small">Nothing matched. Try answering the questions you skipped.</p>'}</div>
    </section>

    ${
      r.needs_one_more_answer.length
        ? `<section>
      <h2>One more answer would unlock these</h2>
      <div class="prows">${r.needs_one_more_answer.slice(0, 10).map(row).join('')}</div>
    </section>`
        : ''
    }

    <button class="btn btn-block" data-action="ics">Add deadlines to my calendar</button>
    <p class="tiny">Amounts are published maximums. Means-tested payments taper — most people get less than the ceiling.</p>`,
    { back: 'home', title: entry?.name || '' },
  );
}

async function deadlinesView() {
  const p = state.profile;
  if (!p.country_code) return homeView();
  const man = await manifest();
  const entry = man.countries.find((c) => c.slug === p.country_code);
  const data = await json(`/api/v1/programmes/${p.country_code}.json`);
  const r = match({ ...p, country_code: p.country_code }, data, entry);
  const cal = calendar([...r.eligible, ...r.needs_one_more_answer], Date.now());

  const group = (key, label) =>
    cal.groups[key].length
      ? `<section>
      <h2>${label} <span class="count">${cal.groups[key].length}</span></h2>
      <div class="prows">${cal.groups[key]
        .slice(0, 15)
        .map(
          (m) => `<div class="prow">
        <div class="prow__main">
          <div class="prow__name">${esc(m.programme.name_local || m.programme.name_en)}</div>
          <div class="prow__meta">${esc(m.deadline.detail)}</div>
        </div>
      </div>`,
        )
        .join('')}</div>
    </section>`
      : '';

  return shell(
    `${group('closing', 'Closing soon')}
     ${group('open', 'Open now')}
     ${group('soon', 'Reopening within 90 days')}
     ${group('later', 'Reopening later')}
     ${group('stalled', 'Paused by the funder')}
     ${cal.counts.unknown ? `<p class="small">${cal.counts.unknown} programmes publish no call calendar.</p>` : ''}
     <button class="btn btn-block" data-action="ics">Export all to calendar</button>`,
    { back: 'home', title: 'Deadlines' },
  );
}

function documentsView() {
  return shell(
    `<section class="hero">
      <h1>Your documents</h1>
      <p class="lede">Every claim wants a payslip, a proof of address, a birth certificate. Keep each one
      here and the next claim that asks for it is already answered.</p>
    </section>
    <div class="note">
      <strong>Encrypted on this device.</strong> Files are locked with a key derived from your passphrase
      before they leave your phone. We hold scrambled bytes and a label like "proof of income" — we cannot
      open them, and neither can anyone who breaks into our servers.
    </div>
    <p class="small">Sign in on the web to add documents to your vault. They will appear here.</p>
    <button class="btn btn-block" data-action="signin">Sign in</button>`,
    { back: 'home', title: 'Documents' },
  );
}

function settingsView() {
  return shell(
    `<section>
      <h2>Your data</h2>
      <p class="small">Your answers are stored only on this device. Nothing has been sent to us.</p>
      <button class="btn btn-block" data-action="clear">Clear my answers</button>
    </section>
    <section>
      <h2>Offline</h2>
      <p class="small" id="offline-state">Checking…</p>
    </section>
    <section>
      <h2>About</h2>
      <p class="small">Unclaimed is a discovery tool, not legal, tax or financial advice. Only the official
      body named on each programme can confirm what you are entitled to.</p>
      <a class="btn btn-block" href="${BASE}/methodology/">How we know this</a>
    </section>`,
    { back: 'home', title: 'Settings' },
  );
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

const VIEWS = {
  home: homeView,
  check: checkView,
  results: resultsView,
  deadlines: deadlinesView,
  documents: documentsView,
  settings: settingsView,
};

async function render(view) {
  state.view = view;
  const root = $('#app');
  root.classList.add('is-out');
  const html = await (VIEWS[view] || homeView)();
  root.innerHTML = html;
  requestAnimationFrame(() => root.classList.remove('is-out'));
  window.scrollTo(0, 0);
  if (view === 'settings') updateOfflineState();
}

async function updateOfflineState() {
  const el = $('#offline-state');
  if (!el) return;
  if (!('caches' in window)) return void (el.textContent = 'This browser cannot store the app offline.');
  const keys = await caches.keys();
  el.textContent = keys.length
    ? 'The app and your country data are stored on this device. It works with no signal.'
    : 'Not cached yet — open the check once with a connection.';
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    if (nav.dataset.mode) state.mode = nav.dataset.mode;
    return void render(nav.dataset.nav);
  }

  const choice = e.target.closest('.choice');
  if (choice) {
    const v = choice.dataset.v;
    state.profile[choice.dataset.q] = v === '' ? null : v;
    save(state.profile);
    $$(`.choice[data-q="${choice.dataset.q}"]`).forEach((b) => {
      const on = b === choice;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    return;
  }

  const step = e.target.closest('[data-step]');
  if (step) {
    const k = step.dataset.step;
    const floor = k === 'household_size' ? 1 : 0;
    const next = Math.max(floor, (state.profile[k] ?? floor) + Number(step.dataset.d));
    state.profile[k] = next;
    save(state.profile);
    const out = $(`#out-${k}`);
    if (out) out.textContent = next;
    return;
  }

  const action = e.target.closest('[data-action]');
  if (!action) return;

  if (action.dataset.action === 'clear') {
    localStorage.removeItem(STORE);
    state.profile = {};
    return void render('home');
  }
  if (action.dataset.action === 'signin') {
    location.href = `${BASE}/account/`;
    return;
  }
  if (action.dataset.action === 'ics' && state.result) {
    const evts = reminders(state.result.eligible, Date.now());
    const blob = new Blob([toICS(evts)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'unclaimed-deadlines.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

document.addEventListener('change', (e) => {
  const f = e.target.closest('.field');
  if (!f) return;
  state.profile[f.dataset.q] = f.value || null;
  save(state.profile);
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {});
  });
}

/* iOS will not show an install prompt, so we tell the user how instead —
   silently failing to install is the single biggest reason PWAs go unused. */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const bar = $('#install');
  if (bar) bar.hidden = false;
});
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#install-go')) return;
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $('#install').hidden = true;
});

render('home');
