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
      body: JSON.stringify({
        email: $('#admin-email').value,
        password: $('#admin-pass').value,
        code: $('#admin-code').value,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      /* The server only says a code is wanted once the password has checked
         out, so this is the first moment the field is worth showing — and
         showing it any earlier would publish whether a second factor exists. */
      if (out.error === 'code_required') {
        $('#admin-code-wrap').hidden = false;
        $('#admin-code').focus();
      }
      msg.textContent = out.message || 'Sign-in failed.';
      return;
    }
    $('#admin-pass').value = '';
    $('#admin-code').value = '';
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
    /* Customers and the audit trail are not windowed by the date selector and
       are slower to change, so they load alongside rather than blocking the
       numbers. A failure in either must not blank the dashboard. */
    loadSecurity().catch(() => {});
    loadCustomers().catch(() => {});
    loadAudit().catch(() => {});
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


/* ------------------------------------------------------------------ */
/* Customers, and granting them a plan                                 */
/* ------------------------------------------------------------------ */

/**
 * The half of this page that changes something.
 *
 * Everything above is a renderer over read-only endpoints. Below, two buttons
 * decide who can see the paid product — so the rules are stricter:
 *
 *   - The plan list is whatever `/api/admin/customers` returned, never a copy
 *     hardcoded here. A form offering a plan the Worker rejects is a dead
 *     button, and this codebase has shipped one of those before.
 *   - Revoking asks first, because it is the one action here that takes
 *     something away from a customer who is using it.
 *   - Every response is re-read from the server rather than patched into the
 *     table optimistically. The whole point of this screen is that it agrees
 *     with what the Worker will actually do on the next request.
 */

let PLANS = [];
let lastQuery = '';

const when = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function grantBadge(c) {
  if (c.paying) return `<span class="badge badge-good">Paying · ${esc(c.ent_plan || 'active')}</span>`;
  const g = c.grant;
  if (!g) return '<span class="badge badge-neutral">Free</span>';
  const label = PLANS.find((p) => p.plan === g.plan)?.label || g.plan;
  const ends = g.expires_at ? ` · until ${esc(when(g.expires_at))}` : ' · no end date';
  return `<span class="badge badge-good">Granted · ${esc(label)}${ends}</span>`;
}

function renderCustomers(d) {
  PLANS = d.plans || PLANS;
  const rows = d.customers || [];
  const host = $('#admin-customer-list');
  if (!rows.length) {
    host.innerHTML = `<p class="small">No account matches that.${
      lastQuery.includes('@')
        ? ` <button class="btn btn-sm" type="button" data-grant-new="${esc(lastQuery)}">Grant to ${esc(lastQuery)} anyway</button>`
        : ''
    }</p>`;
    return;
  }
  host.innerHTML = `<div class="list-rows">${rows
    .map(
      (c) => `<div class="list-row" style="cursor:default;align-items:center">
      <span style="flex:1;min-width:0">
        <span class="list-row__name">${esc(c.email)}</span>
        <span class="list-row__meta">${esc(c.account_type || 'individual')} · joined ${esc(when(c.created_at))}${
          c.grant && c.grant.reason ? ` · ${esc(c.grant.reason)}` : ''
        }</span>
      </span>
      <span class="list-row__right" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${grantBadge(c)}
        <button class="btn btn-sm" type="button" data-grant="${esc(c.id)}" data-email="${esc(c.email)}">${
          c.grant ? 'Change' : 'Grant'
        }</button>
        ${c.grant ? `<button class="btn btn-sm btn-ghost" type="button" data-revoke="${esc(c.grant.id)}" data-email="${esc(c.email)}">Revoke</button>` : ''}
      </span>
    </div>`,
    )
    .join('')}</div>`;
}

async function loadCustomers(q = lastQuery) {
  lastQuery = q;
  renderCustomers(await get(`/api/admin/customers?q=${encodeURIComponent(q)}&limit=50`));
}

function renderAudit(d) {
  const rows = d.audit || [];
  const host = $('#admin-audit');
  if (d.unavailable) {
    host.innerHTML = '<p class="small">The audit table is not there yet. Apply <code>migrations/0008_grants.sql</code>.</p>';
    return;
  }
  if (!rows.length) {
    host.innerHTML = '<p class="small">Nothing has been granted or revoked yet.</p>';
    return;
  }
  const verb = { grant: 'granted', revoke: 'revoked', supersede: 'replaced the plan of', create_user: 'created an account for' };
  host.innerHTML = `<div class="list-rows">${rows
    .map((r) => {
      let detail = '';
      try {
        const d2 = r.detail ? JSON.parse(r.detail) : null;
        if (d2) {
          detail = [d2.plan && (PLANS.find((p) => p.plan === d2.plan)?.label || d2.plan), d2.seats > 1 && `${d2.seats} seats`, d2.days ? `${d2.days} days` : d2.plan && 'no end date', d2.reason]
            .filter(Boolean)
            .join(' · ');
        }
      } catch {
        /* A detail we cannot parse is not a reason to hide the event. */
      }
      return `<div class="list-row" style="cursor:default">
        <span>
          <span class="list-row__name">${esc(r.actor)} ${esc(verb[r.action] || r.action)} ${esc(r.subject || '—')}</span>
          <span class="list-row__meta">${esc(new Date(r.ts).toLocaleString())}${detail ? ` · ${esc(detail)}` : ''}</span>
        </span>
      </div>`;
    })
    .join('')}</div>`;
}

async function loadAudit() {
  renderAudit(await get('/api/admin/audit?limit=100'));
}

/* ---- the grant dialog -------------------------------------------- */

const dialog = $('#admin-grant-dialog');
let target = null; // { user_id } or { email, create: true }

function openGrant(t, label) {
  target = t;
  $('#admin-grant-who').textContent = label;
  $('#admin-grant-plan').innerHTML = PLANS.map((p) => `<option value="${esc(p.plan)}">${esc(p.label)}</option>`).join('');
  $('#admin-grant-msg').textContent = '';
  $('#admin-grant-reason').value = '';
  $('#admin-grant-create-wrap').hidden = !t.create;
  $('#admin-grant-create').checked = !!t.create;
  dialog.showModal();
}

$('#admin-grant-cancel').addEventListener('click', () => dialog.close());

$('#admin-grant-form').addEventListener('submit', async (e) => {
  /* The dialog's own method="dialog" would close it on submit before the
     request finished, and the operator would never see the error. */
  e.preventDefault();
  const msg = $('#admin-grant-msg');
  const submit = $('#admin-grant-submit');
  submit.disabled = true;
  msg.textContent = 'Granting…';
  try {
    const res = await fetch('/api/admin/grant', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...target,
        create: $('#admin-grant-create').checked,
        plan: $('#admin-grant-plan').value,
        seats: parseInt($('#admin-grant-seats').value, 10) || 1,
        days: parseInt($('#admin-grant-days').value, 10) || 0,
        reason: $('#admin-grant-reason').value,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      msg.textContent = out.message || `Refused (${res.status}).`;
      if (out.error === 'no_such_user') {
        $('#admin-grant-create-wrap').hidden = false;
        target = { ...target, create: true };
      }
      return;
    }
    dialog.close();
    await Promise.all([loadCustomers(), loadAudit()]);
  } catch {
    msg.textContent = 'Could not reach the server.';
  } finally {
    submit.disabled = false;
  }
});

/* ---- wiring ------------------------------------------------------ */

$('#admin-search').addEventListener('submit', (e) => {
  e.preventDefault();
  loadCustomers($('#admin-q').value.trim()).catch(() => {
    $('#admin-customer-list').innerHTML = '<p class="small">Could not load customers.</p>';
  });
});

/* ---- the second factor's two buttons ------------------------------ */

$('#admin-security').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const msg = $('#admin-2fa-msg');
  const say = (m) => { if (msg) msg.textContent = m; };

  if (btn.dataset.action === 'totp-enable') {
    if (!offered) return;
    btn.disabled = true;
    say('Checking…');
    try {
      const res = await fetch('/api/admin/totp/enable', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: offered.secret, code: $('#admin-2fa-code').value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return void say(out.message || 'That did not work.');
      await loadSecurity();
    } catch {
      say('Could not reach the server.');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.action === 'totp-disable') {
    btn.disabled = true;
    say('Checking…');
    try {
      const res = await fetch('/api/admin/totp/disable', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: $('#admin-2fa-off-code').value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return void say(out.message || 'That did not work.');
      await loadSecurity();
    } catch {
      say('Could not reach the server.');
    } finally {
      btn.disabled = false;
    }
  }
});

$('#admin-customers-section').addEventListener('click', async (e) => {
  const grant = e.target.closest('[data-grant]');
  if (grant) {
    openGrant({ user_id: grant.dataset.grant }, grant.dataset.email);
    return;
  }
  const fresh = e.target.closest('[data-grant-new]');
  if (fresh) {
    openGrant({ email: fresh.dataset.grantNew, create: true }, fresh.dataset.grantNew);
    return;
  }
  const revoke = e.target.closest('[data-revoke]');
  if (revoke) {
    /* The only destructive action on this page, so it is the only one that
       asks. `prompt` rather than `confirm`: the reason goes in the trail, and
       asking for it is also the confirmation. */
    const reason = window.prompt(`Revoke granted access for ${revoke.dataset.email}?\n\nWhy:`, '');
    if (reason === null) return;
    await fetch('/api/admin/revoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_id: revoke.dataset.revoke, reason }),
    });
    await Promise.all([loadCustomers(), loadAudit()]);
  }
});


/* ------------------------------------------------------------------ */
/* The second factor                                                   */
/* ------------------------------------------------------------------ */

/**
 * The setup key, in fours.
 *
 * There is deliberately no QR code here. Rendering one means either a QR
 * library as a dependency — this repo has none, by design — or handing the
 * TOTP secret to an image service to be drawn, which would give the second
 * factor away to whoever renders it. Writing an encoder by hand was the third
 * option and it is untestable here: a subtly wrong matrix produces a picture
 * that looks like a QR code and encodes the wrong secret.
 *
 * Every authenticator app has "enter a setup key". Grouped in fours, this is
 * about fifteen seconds of typing, once.
 */
const groups = (secret) => String(secret).replace(/(.{4})/g, '$1 ').trim();

/**
 * Enrolling, from the panel, with a phone in hand.
 *
 * The secret the server offers is not stored until a code generated from it
 * comes back — so a QR code that fails to scan, or a tab closed halfway,
 * leaves the door exactly as it was. That is the difference between a second
 * factor somebody actually turns on and one that sits in a runbook.
 *
 * The QR image is drawn by an inline SVG built here rather than fetched from
 * a chart service: handing a TOTP secret to a third-party image API to render
 * would defeat the entire point.
 */
let offered = null;

async function loadSecurity() {
  const host = $('#admin-2fa');
  const state = $('#admin-2fa-state');
  try {
    const d = await get('/api/admin/totp');
    if (d.enrolled) {
      offered = null;
      state.textContent = 'protected by a second factor';
      host.innerHTML = `<div class="row" style="gap:.6rem;align-items:flex-end;flex-wrap:wrap">
        <span><label class="tiny" for="admin-2fa-off-code">Current code</label>
          <input class="field" type="text" id="admin-2fa-off-code" inputmode="numeric" maxlength="6"
                 style="width:9rem;margin-top:.35rem;letter-spacing:.3em"></span>
        <button class="btn btn-sm btn-ghost" type="button" data-action="totp-disable">Turn it off</button>
        <span class="small" id="admin-2fa-msg" role="status" aria-live="polite"></span>
      </div>
      <p class="tiny" style="margin:.8rem 0 0;opacity:.75">Lost the phone? Delete the
      <code>admin_totp_secret</code> row from <code>worker_config</code> in D1 and the door is back to a password.</p>`;
      return;
    }

    offered = d;
    state.textContent = 'password only';
    host.innerHTML = `<div class="row" style="gap:1.2rem;align-items:flex-start;flex-wrap:wrap">
      <span style="flex:1;min-width:16rem">
        <p class="small" style="margin:0 0 .6rem">In your authenticator app choose <strong>enter a setup key</strong>,
        name it <em>Unclaimed Grants</em>, and type this:</p>
        <code class="admin-key">${esc(groups(d.secret))}</code>
        <label class="tiny" for="admin-2fa-code">Then enter the six digits it shows</label>
        <div class="row" style="gap:.6rem;align-items:flex-end;margin-top:.35rem">
          <input class="field" type="text" id="admin-2fa-code" inputmode="numeric" maxlength="6"
                 style="width:9rem;letter-spacing:.3em">
          <button class="btn btn-sm btn-primary" type="button" data-action="totp-enable">Turn it on</button>
        </div>
        <p class="tiny" style="margin:.7rem 0 0;opacity:.75">Nothing is stored until that code checks out, so a
        scan that fails cannot lock you out.</p>
        <p class="small" id="admin-2fa-msg" role="status" aria-live="polite" style="margin:.6rem 0 0;min-height:1.2em"></p>
      </span>
    </div>`;
  } catch (err) {
    state.textContent = '';
    host.innerHTML = `<p class="small">Could not read the door's state${err.status === 403 ? '' : ' — the Worker may not be deployed yet'}.</p>`;
  }
}
