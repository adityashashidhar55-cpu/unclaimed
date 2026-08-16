/**
 * The operator dashboard.
 *
 * Every number on this screen comes from an endpoint that checks the session
 * server-side. This file holds no secret, decides no access and caches nothing
 * — if you loaded it without an operator cookie, all three fetches 403 and the
 * panel stays hidden. That is deliberate: the security property lives in the
 * Worker, and this is a renderer.
 *
 * Charts are inline SVG built from the response. No chart library: the whole
 * site ships zero dependencies, and two bar charts are not a reason to break
 * that.
 */
import { stepLabel } from '../packages/analytics/index.js';

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = new Intl.NumberFormat('en');
const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

async function get(path) {
  /* Never from a cache — see the note in auth.js. Every figure here is
     per-operator and a stale one is worse than no figure. */
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  return res.json();
}

/* ---- login ------------------------------------------------------- */

$('#admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#admin-msg');
  msg.textContent = 'Checking…';
  try {
    const res = await fetch('/auth/admin', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('#admin-email').value, password: $('#admin-pass').value }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      msg.textContent = out.message || 'Sign-in failed.';
      return;
    }
    $('#admin-pass').value = '';
    msg.textContent = '';
    open(out.email);
  } catch {
    msg.textContent = 'Could not reach the server.';
  }
});

function open(email) {
  $('#admin-login').hidden = true;
  $('#admin-panel').hidden = false;
  $('#admin-who').textContent = `Signed in as ${email}`;
  load();
}

$('#admin-refresh').addEventListener('click', load);
$('#admin-days').addEventListener('change', load);

/* ---- rendering --------------------------------------------------- */

function kpi(n, label, note) {
  return `<div class="card card-flat">
    <div class="figure-sm">${esc(n)}</div>
    <p class="small" style="margin:.35rem 0 0"><strong>${esc(label)}</strong></p>
    ${note ? `<p class="tiny" style="margin:.2rem 0 0">${esc(note)}</p>` : ''}
  </div>`;
}

/** A labelled horizontal bar. Width is share of the largest row, not of 100%. */
function bars(rows, { max, right } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="list-rows">${rows
    .map(
      (r) => `<div class="list-row" style="cursor:default;align-items:center">
      <span style="flex:1;min-width:0">
        <span class="list-row__name">${esc(r.label)}</span>
        <span style="display:block;height:8px;border-radius:9999px;background:rgba(15,111,118,.12);margin-top:.35rem">
          <span style="display:block;height:8px;border-radius:9999px;width:${((r.value / top) * 100).toFixed(1)}%;background:${r.colour || 'var(--teal)'}"></span>
        </span>
        ${r.note ? `<span class="list-row__meta">${esc(r.note)}</span>` : ''}
      </span>
      <span class="list-row__right"><span class="list-row__amount">${esc(right ? right(r) : nf.format(r.value))}</span></span>
    </div>`,
    )
    .join('')}</div>`;
}

function renderFunnel(data) {
  const rows = data.rows;
  const first = rows[0]?.count || 0;

  $('#admin-funnel').innerHTML = bars(
    rows.map((r) => ({
      label: stepLabel(r.step),
      value: r.count,
      /* The bar shows share-of-entry, so the shape of the whole funnel is
         readable at a glance; the text on the right is the per-step rate,
         which is the one you act on. */
      colour: r.lost && first && r.lost / first > 0.2 ? 'var(--terracotta)' : 'var(--teal)',
      note:
        r.step === rows[0].step
          ? 'everyone who arrived'
          : `${pct(r.stepRate)} of the previous step · ${nf.format(r.lost)} lost here`,
    })),
    { max: first },
  );

  const w = data.worst;
  $('#admin-worst').textContent = w && w.lost
    ? `Biggest drop: ${nf.format(w.lost)} people between “${stepLabel(w.from.step)}” and “${stepLabel(w.to.step)}” (${pct(w.rate)})`
    : 'Not enough traffic yet to name a drop-off.';
}

function renderOverview(d) {
  const t = d.totals || {};
  $('#admin-kpis').innerHTML =
    kpi(nf.format(t.visitors || 0), 'Visitors', `distinct, last ${d.days} days`) +
    kpi(nf.format(t.events || 0), 'Steps taken', 'funnel events recorded') +
    kpi(nf.format(t.n || 0), 'Sign-ins', `${nf.format(t.people || 0)} distinct people`) +
    kpi(nf.format(t.new_accounts || 0), 'New accounts', 'first-ever sign-in');

  const byDay = d.by_day || [];
  $('#admin-days-chart').innerHTML = byDay.length
    ? bars(byDay.map((r) => ({ label: r.day, value: r.visitors, note: `${nf.format(r.events)} events` })))
    : '<p class="small">No traffic recorded in this window.</p>';

  const dim = (rows, empty) =>
    rows && rows.length
      ? bars(rows.map((r) => ({ label: r.k, value: r.n })))
      : `<p class="small">${empty}</p>`;
  $('#admin-countries').innerHTML = dim(d.by_country, 'Nobody has run a check yet.');
  $('#admin-locales').innerHTML = dim(d.by_locale, 'No language data yet.');
}

function renderLogins(d) {
  const rows = d.logins || [];
  if (!rows.length) {
    $('#admin-logins').innerHTML = '<p class="small">Nobody has signed in yet.</p>';
    return;
  }
  const when = (ts) => new Date(ts).toLocaleString();
  $('#admin-logins').innerHTML = `<div class="list-rows">${rows
    .map(
      (r) => `<div class="list-row" style="cursor:default">
      <span>
        <span class="list-row__name">${esc(r.email)}</span>
        <span class="list-row__meta">${esc(when(r.ts))} · ${esc(r.account_type)}${
          r.kind === 'admin' ? ' · operator' : ''
        }${r.is_new ? ' · first sign-in' : ''}</span>
      </span>
      <span class="list-row__right"><span class="badge ${
        r.ent_status === 'active' || r.ent_status === 'trialing' ? 'badge-good' : 'badge-neutral'
      }">${esc(r.ent_plan || r.ent_status || 'free')}</span></span>
    </div>`,
    )
    .join('')}</div>`;
}

async function load() {
  const days = $('#admin-days').value;
  const panel = $('#admin-panel');
  panel.setAttribute('aria-busy', 'true');
  try {
    const [overview, funnel, logins] = await Promise.all([
      get(`/api/admin/overview?days=${days}`),
      get(`/api/admin/funnel?days=${days}`),
      get('/api/admin/logins?limit=200'),
    ]);
    renderOverview(overview);
    renderFunnel(funnel);
    renderLogins(logins);
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      /* The session expired while the tab was open. Back to the door rather
         than to a screen of stale numbers. */
      panel.hidden = true;
      $('#admin-login').hidden = false;
      $('#admin-msg').textContent = 'That session has expired. Sign in again.';
      return;
    }
    $('#admin-funnel').innerHTML =
      '<p class="small">Could not load. The Worker may not be deployed yet — see docs/ADMIN.md.</p>';
  } finally {
    panel.removeAttribute('aria-busy');
  }
}

/* Already signed in from an earlier visit? Skip the form. */
fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
  .then((r) => r.json())
  .then((s) => {
    if (s.admin) open(s.email);
  })
  .catch(() => {});
