/**
 * /startups/tools/co-funding/ calculator.
 *
 * Emitted at the dist root (see build.mjs), same depth as de-minimis.js, so
 * './packages/rdcalc/index.js' resolves to the copy build.mjs already
 * writes there. Nothing typed into this page is sent anywhere: the only
 * network-free thing that changes is the DOM.
 *
 * A ?pct= query param pre-fills the founder's own co-funding share as a
 * programme page links it (see startupProgrammePage in src/build.mjs) —
 * that field is named cofunding_pct in our data, i.e. the applicant's own
 * share, so grant intensity here is 100 minus it.
 */
import { computeCofunding } from './packages/rdcalc/index.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `€${Math.round(Number(n) || 0).toLocaleString('en')}`;

function loadData() {
  const el = document.getElementById('cofunding-data');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function mount(root, data) {
  const params = new URLSearchParams(location.search);
  const ownPctParam = Number(params.get('pct'));
  const initialIntensity = (params.get('pct') ?? '').trim() !== '' && Number.isFinite(ownPctParam) && ownPctParam >= 0 && ownPctParam <= 100
    ? 100 - ownPctParam
    : 70;

  root.innerHTML = `
    <h2 style="margin-top:0">Your numbers</h2>
    <div class="grid grid-2" style="gap:1rem">
      <label class="small">Project cost (EUR)
        <input type="number" id="cf-cost" min="0" step="1000" value="500000" style="width:100%;margin-top:.3rem">
      </label>
      <label class="small">Grant intensity (%)
        <input type="number" id="cf-intensity" min="0" max="100" step="1" value="${initialIntensity}" style="width:100%;margin-top:.3rem">
      </label>
      <label class="small">Share of your own contribution that is in-kind (%)
        <input type="number" id="cf-inkind" min="0" max="100" step="1" value="0" style="width:100%;margin-top:.3rem">
      </label>
      <label class="small" style="display:flex;align-items:center;gap:.5rem;margin-top:1.5rem">
        <input type="checkbox" id="cf-arrears" checked style="margin:0"> Grant is paid in arrears (reimbursed after spend)
      </label>
    </div>

    <div style="margin-top:1rem">
      <span class="small">Or pick a verified preset:</span>
      <div id="cf-presets" style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem"></div>
    </div>

    <div id="cf-cap-note" class="small" style="margin-top:.8rem"></div>

    <div id="cf-result" style="margin-top:1.6rem" aria-live="polite"></div>
  `;

  const costEl = $('#cf-cost', root);
  const intensityEl = $('#cf-intensity', root);
  const inkindEl = $('#cf-inkind', root);
  const arrearsEl = $('#cf-arrears', root);
  const presetsEl = $('#cf-presets', root);
  const capNoteEl = $('#cf-cap-note', root);
  const resultEl = $('#cf-result', root);

  let activeCapEur = null;

  presetsEl.innerHTML = data.presets
    .map((p) => `<button type="button" class="btn btn-sm" data-intensity="${p.intensityPct}" data-cap="${p.capEur ?? ''}">${esc(p.label)} (${p.intensityPct}%)</button>`)
    .join('');
  presetsEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      intensityEl.value = btn.dataset.intensity;
      activeCapEur = btn.dataset.cap ? Number(btn.dataset.cap) : null;
      recompute();
    });
  });

  function recompute() {
    const projectCostEur = Number(costEl.value) || 0;
    const intensityPct = Number(intensityEl.value) || 0;
    const inKindPct = Number(inkindEl.value) || 0;
    const paidInArrears = arrearsEl.checked;

    const r = computeCofunding({ projectCostEur, intensityPct, inKindPct, paidInArrears, capEur: activeCapEur });

    capNoteEl.innerHTML = activeCapEur
      ? `This preset caps the grant at ${money(activeCapEur)} regardless of the percentage (the EIC expects requests below it unless you justify more).${r.cappedByCeiling ? ' <strong>Your project cost hits that cap.</strong>' : ''}`
      : '';

    resultEl.innerHTML = `
      <div class="grid grid-2" style="gap:1rem">
        <div class="card">
          <span class="eyebrow">Grant amount</span>
          <div class="figure-sm">${money(r.grantAmountEur)}</div>
        </div>
        <div class="card">
          <span class="eyebrow">Your own contribution</span>
          <div class="figure-sm">${money(r.ownContributionEur)}</div>
          <p class="small" style="margin:.3rem 0 0">of which ${money(r.inKindContributionEur)} in-kind, ${money(r.ownCashContributionEur)} cash</p>
        </div>
        <div class="card" style="grid-column:1/-1">
          <span class="eyebrow">Cash you need up front</span>
          <div class="figure-sm">${money(r.cashNeededUpFrontEur)}</div>
          <p class="small" style="margin:.3rem 0 0">${paidInArrears
            ? 'Because the grant is paid in arrears, you must pre-finance the cash costs of the whole project (your own share and the grant’s share) before any reimbursement lands. If your grant pays a pre-financing instalment (Horizon Europe does), untick the box.'
            : 'Because the grant is advanced rather than reimbursed in arrears, you only need to find your own cash share up front.'}</p>
        </div>
      </div>`;
  }

  /* Only editing the rate itself drops a preset's ceiling; changing the
     project cost or in-kind share keeps it, so the cap still bites. */
  intensityEl.addEventListener('input', () => { activeCapEur = null; recompute(); });
  [costEl, inkindEl].forEach((el) => el.addEventListener('input', recompute));
  arrearsEl.addEventListener('change', recompute);

  recompute();
}

function boot() {
  const root = document.getElementById('cofunding-app');
  const data = loadData();
  if (!root || !data) return;
  mount(root, data);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
