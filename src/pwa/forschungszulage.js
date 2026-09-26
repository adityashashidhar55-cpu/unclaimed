/**
 * /startups/tools/forschungszulage/ estimator.
 *
 * Emitted at the dist root (see build.mjs), same depth as de-minimis.js /
 * cofunding.js, so './packages/rdcalc/index.js' resolves the same way.
 * Nothing typed into this page is sent anywhere.
 */
import { computeForschungszulage } from './packages/rdcalc/index.js';

const $ = (s, r = document) => r.querySelector(s);
const money = (n) => `€${Math.round(Number(n) || 0).toLocaleString('en')}`;

function loadData() {
  const el = document.getElementById('fz-data');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function mount(root, data) {
  const r = data.rules;

  root.innerHTML = `
    <h2 style="margin-top:0">Your eligible costs (per business year)</h2>
    <div class="grid grid-2" style="gap:1rem">
      <label class="small">Eligible R&D personnel costs (EUR)
        <input type="number" id="fz-personnel" min="0" step="1000" value="200000" style="width:100%;margin-top:.3rem">
      </label>
      <label class="small">Contract research fees to EEA contractors (EUR)
        <input type="number" id="fz-contract" min="0" step="1000" value="0" style="width:100%;margin-top:.3rem">
        <span class="tiny">Only ${r.contractResearchEligibleSharePct}% of this counts toward the base.</span>
      </label>
      <label class="small">Depreciation of R&D-only fixed assets (EUR)
        <input type="number" id="fz-depreciation" min="0" step="500" value="0" style="width:100%;margin-top:.3rem">
      </label>
      <label class="small">Company size
        <select id="fz-sme" style="width:100%;margin-top:.3rem">
          <option value="1">SME (EU definition) — ${r.smeRatePct}% rate</option>
          <option value="0">Large company — ${r.largeCompanyRatePct}% rate</option>
        </select>
      </label>
      <label class="small" style="display:flex;align-items:center;gap:.5rem;grid-column:1/-1">
        <input type="checkbox" id="fz-after2025" checked style="margin:0"> R&D project began after 31 December 2025 (the ${r.overheadFlatRatePct}% overhead flat rate applies)
      </label>
    </div>

    <div id="fz-result" style="margin-top:1.6rem" aria-live="polite"></div>
  `;

  const personnelEl = $('#fz-personnel', root);
  const contractEl = $('#fz-contract', root);
  const depreciationEl = $('#fz-depreciation', root);
  const smeEl = $('#fz-sme', root);
  const after2025El = $('#fz-after2025', root);
  const resultEl = $('#fz-result', root);

  function recompute() {
    const out = computeForschungszulage({
      personnelCostsEur: Number(personnelEl.value) || 0,
      contractResearchEur: Number(contractEl.value) || 0,
      depreciationEur: Number(depreciationEl.value) || 0,
      isSme: smeEl.value === '1',
      projectStartedAfter2025: after2025El.checked,
    });

    resultEl.innerHTML = `
      <div class="grid grid-2" style="gap:1rem">
        <div class="card" style="grid-column:1/-1">
          <span class="eyebrow">Estimated Forschungszulage credit</span>
          <div class="figure-sm">${money(out.estimatedCreditEur)}</div>
          <p class="small" style="margin:.3rem 0 0">${out.ratePct}% of an eligible-cost base of ${money(out.eligibleBaseEur)}${out.cappedByBemessungsgrundlage ? `, capped from ${money(out.uncappedBaseEur)} at the ${money(data.rules.bemessungsgrundlageCapEur)} annual ceiling` : ''}.</p>
        </div>
        <div class="card">
          <span class="eyebrow">Direct eligible costs</span>
          <div class="figure-sm">${money(out.directCostsEur)}</div>
          <p class="small" style="margin:.3rem 0 0">Personnel + ${money(out.contractResearchCountedEur)} counted contract research + depreciation.</p>
        </div>
        <div class="card">
          <span class="eyebrow">Overhead flat rate (${data.rules.overheadFlatRatePct}%)</span>
          <div class="figure-sm">${money(out.overheadFlatRateEur)}</div>
          <p class="small" style="margin:.3rem 0 0">${after2025El.checked ? 'Applied on top of direct costs, projects begun after 31 Dec 2025.' : 'Not applied — only projects begun after 31 December 2025 get this.'}</p>
        </div>
      </div>
      <p class="tiny" style="margin-top:.8rem">Reminder: combined state aid for the same R&D project, across all
      years, is capped at ${money(out.perProjectLifetimeCapEur)} — this tool estimates a single year and does not
      track your running total across years.</p>`;
  }

  [personnelEl, contractEl, depreciationEl, smeEl, after2025El].forEach((el) => {
    el.addEventListener('input', recompute);
    el.addEventListener('change', recompute);
  });

  recompute();
}

function boot() {
  const root = document.getElementById('fz-app');
  const data = loadData();
  if (!root || !data) return;
  mount(root, data);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
