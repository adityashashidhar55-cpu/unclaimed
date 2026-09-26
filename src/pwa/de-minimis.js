/**
 * /startups/de-minimis/ calculator.
 *
 * Emitted at the dist root (see build.mjs), same depth as startup-check.js,
 * so './packages/stateaid/index.js' resolves to the copy build.mjs already
 * writes there for the workspace. Every number a founder sees here comes from
 * that one module — the same one the workspace's postaward tab and the
 * matching engine's canAccept()/planWithinCeiling() use — so this page cannot
 * quote a different ceiling than the rest of the site.
 *
 * Nothing typed into this page is sent anywhere: awards live in an in-memory
 * array for the life of the tab, and the only network-free thing that
 * changes is the DOM.
 */
import { headroomByKind, ceilingForKind, AID_KINDS } from './packages/stateaid/index.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `€${Number(n).toLocaleString('en')}`;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

const KIND_LABEL = {
  general: 'General de minimis',
  road_freight: 'Road freight transport',
  agriculture: 'Agriculture (primary production)',
  fisheries: 'Fishery & aquaculture',
  sgei: 'SGEI',
};

function loadData() {
  const el = document.getElementById('deminimis-data');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function mount(root, data) {
  const countrySlugs = Object.keys(data.countries).sort((a, b) => data.countries[a].name.localeCompare(data.countries[b].name));

  root.innerHTML = `
    <h2 style="margin-top:0">Your headroom</h2>
    <div class="grid grid-2" style="gap:1rem">
      <label class="small">Member State
        <select id="dm-country" style="width:100%;margin-top:.3rem">
          ${countrySlugs.map((s) => `<option value="${esc(s)}">${esc(data.countries[s].flag)} ${esc(data.countries[s].name)}</option>`).join('')}
        </select>
      </label>
      <label class="small">Check headroom as of
        <input type="date" id="dm-asof" style="width:100%;margin-top:.3rem">
      </label>
    </div>

    <h3 style="margin-top:1.6rem">Prior de minimis aid in this Member State (last 3+ years)</h3>
    <div id="dm-rows"></div>
    <button type="button" class="btn btn-sm" id="dm-add">+ Add an award</button>

    <div id="dm-result" style="margin-top:1.6rem" aria-live="polite"></div>
    <div id="dm-programmes" style="margin-top:1.6rem"></div>
  `;

  const rowsEl = $('#dm-rows', root);
  const resultEl = $('#dm-result', root);
  const programmesEl = $('#dm-programmes', root);
  const countryEl = $('#dm-country', root);
  const asOfEl = $('#dm-asof', root);
  asOfEl.value = isoDate(Date.now());

  let rows = [];
  let nextId = 1;

  function addRow(initial = {}) {
    const id = nextId++;
    rows.push({ id, date: initial.date || isoDate(Date.now()), amount: initial.amount ?? '', kind: initial.kind || 'general' });
    renderRows();
  }

  function removeRow(id) {
    rows = rows.filter((r) => r.id !== id);
    renderRows();
    recompute();
  }

  function renderRows() {
    rowsEl.innerHTML = rows
      .map(
        (r) => `<div class="row" data-id="${r.id}" style="display:flex;gap:.6rem;align-items:center;margin:.5rem 0;flex-wrap:wrap">
      <input type="date" data-role="date" aria-label="Date the aid was granted (legal right conferred)" value="${esc(r.date)}" style="max-width:160px">
      <input type="number" data-role="amount" aria-label="Amount in EUR" placeholder="Amount (EUR)" value="${esc(r.amount)}" min="0" style="max-width:160px">
      <select data-role="kind" aria-label="Type of de minimis aid" style="max-width:220px">
        ${AID_KINDS.filter((k) => k !== 'road_freight').concat(['road_freight'])
          .map((k) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${esc(KIND_LABEL[k])}</option>`)
          .join('')}
      </select>
      <button type="button" class="btn btn-sm btn-ghost" data-role="remove" aria-label="Remove this award">Remove</button>
    </div>`,
      )
      .join('') || '<p class="small">No prior awards added — headroom is the full ceiling.</p>';

    rowsEl.querySelectorAll('.row').forEach((rowEl) => {
      const id = Number(rowEl.dataset.id);
      rowEl.querySelector('[data-role="date"]').addEventListener('change', (e) => {
        const r = rows.find((x) => x.id === id);
        if (r) r.date = e.target.value;
        recompute();
      });
      rowEl.querySelector('[data-role="amount"]').addEventListener('input', (e) => {
        const r = rows.find((x) => x.id === id);
        if (r) r.amount = e.target.value;
        recompute();
      });
      rowEl.querySelector('[data-role="kind"]').addEventListener('change', (e) => {
        const r = rows.find((x) => x.id === id);
        if (r) r.kind = e.target.value;
        recompute();
      });
      rowEl.querySelector('[data-role="remove"]').addEventListener('click', () => removeRow(id));
    });
  }

  function awardsForEngine() {
    return rows
      .filter((r) => r.date && r.amount !== '' && !Number.isNaN(Number(r.amount)))
      .map((r) => ({ granted_at: r.date, amount_eur: Number(r.amount), kind: r.kind, member_state: countryEl.value }));
  }

  function recompute() {
    const memberState = countryEl.value;
    const asOf = asOfEl.value ? new Date(`${asOfEl.value}T00:00:00Z`).getTime() : Date.now();
    const awards = awardsForEngine();
    const byKind = headroomByKind(awards, memberState, asOf);

    const usedKinds = new Set(rows.map((r) => (r.kind === 'road_freight' ? 'general' : r.kind)));
    const kindsToShow = usedKinds.size ? [...usedKinds] : ['general'];

    resultEl.innerHTML = kindsToShow
      .map((kind) => {
        const room = byKind[kind];
        const pct = room.ceiling_eur ? Math.min(100, (room.used_eur / room.ceiling_eur) * 100) : 0;
        return `<div class="card" style="margin-bottom:1rem">
          <div class="row-between"><strong>${esc(KIND_LABEL[kind])}</strong><span class="small">${money(room.used_eur)} of ${money(room.ceiling_eur)} used</span></div>
          <div style="background:var(--surface-2,#eee);border-radius:8px;height:8px;margin:.6rem 0;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${room.over ? 'var(--terracotta,#c0533a)' : 'var(--sage,#4a7c59)'}"></div>
          </div>
          <div class="figure-sm">${money(room.headroom_eur)}</div>
          <p class="small" style="margin:.2rem 0 0">headroom on ${esc(asOfEl.value || isoDate(Date.now()))}${room.over ? ' — <strong>over the ceiling</strong>: a new award of this type would fall outside the Regulation in full (Art. 3(7)), not be trimmed to fit.' : '.'}</p>
          ${room.combined_used_eur && room.combined_used_eur !== room.used_eur ? `<p class="small" style="margin:.3rem 0 0">General, agriculture and fishery de minimis together: ${money(room.combined_used_eur)} of the shared ${money(data.ceilings.general)} (Art. 5(2), Reg. (EU) 2023/2831)${room.capped_by_combined ? ' — this combined cap is what limits your headroom here.' : '.'}</p>` : ''}
          ${room.frees_up_at ? `<p class="small" style="margin:.3rem 0 0">${money(room.frees_up_eur)} frees up on <strong>${esc(isoDate(room.frees_up_at))}</strong> as the oldest award leaves the rolling window.</p>` : ''}
          <p class="tiny" style="margin-top:.5rem">${esc(room.basis)}${kind === 'fisheries' ? ' — assessed over three fiscal years in the Regulation; this tool approximates it on the same rolling basis. Confirm the exact date against your fiscal year.' : ''}</p>
        </div>`;
      })
      .join('');

    const progs = (data.programmes[memberState] || []).slice().sort((a, b) => (b.amount_max ?? 0) - (a.amount_max ?? 0));
    if (!progs.length) {
      programmesEl.innerHTML = `<p class="small">No programmes flagged de minimis in our data for ${esc(data.countries[memberState]?.name || memberState)} yet.</p>`;
    } else {
      const general = byKind.general;
      programmesEl.innerHTML = `<h3>De minimis programmes we track in ${esc(data.countries[memberState]?.name || memberState)}</h3>
      <div class="grid grid-2" style="gap:.8rem">
        ${progs
          .map((p) => {
            const ceiling = p.sgei ? byKind.sgei : general;
            const amt = p.amount_max ?? p.amount_min;
            const fits = amt == null ? null : amt <= ceiling.headroom_eur;
            return `<a class="card card-link" href="../${esc(memberState)}/${esc(p.slug)}/">
              <div class="row-between"><strong>${esc(p.name)}</strong>${fits == null ? '' : `<span class="status status--${fits ? 'open' : 'closing'}">${fits ? 'Fits headroom' : 'Would breach ceiling'}</span>`}</div>
              <p class="small" style="margin:.3rem 0 0">${esc(p.funder)} · ${amt != null ? money(amt) : 'Amount unpublished'}</p>
            </a>`;
          })
          .join('')}
      </div>`;
    }
  }

  $('#dm-add', root).addEventListener('click', () => addRow());
  countryEl.addEventListener('change', recompute);
  asOfEl.addEventListener('change', recompute);

  addRow();
  recompute();
}

function boot() {
  const root = document.getElementById('deminimis-app');
  const data = loadData();
  if (!root || !data) return;
  mount(root, data);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
