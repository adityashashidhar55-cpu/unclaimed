/**
 * UNCLAIMED — pure arithmetic behind the two free /startups/tools/ calculators.
 *
 * No DOM, no network, no dependency on the rest of the site: this module is
 * imported by the client-side pages (src/pwa/cofunding.js,
 * src/pwa/forschungszulage.js) AND by scripts/test-rdcalc.mjs, exactly like
 * packages/stateaid does for /startups/de-minimis/. A number a founder sees
 * on either page and a number this test suite asserts come from the same
 * function calls.
 *
 * Every rate baked in below was verified on an official or near-official
 * page before this file was written (see docs comments on each export for
 * the citation); this module does no verification of its own; it only does
 * the arithmetic once the founder (or a preset) supplies a rate.
 */

/* ------------------------------------------------------------------ */
/* Co-funding / match-funding calculator                               */
/* ------------------------------------------------------------------ */

/**
 * Verified EU-programme grant-intensity presets a founder can click instead
 * of guessing a rate. Each one links straight to the official page that
 * states it — nothing here is estimated.
 *
 * Horizon Europe: Research and Innovation Actions (RIA) are funded at 100%
 * of eligible costs for every participant; Innovation Actions (IA) are
 * funded at 70% for for-profit entities, 100% for non-profit legal entities.
 * Source: European Commission funding-rate table, reproduced by the
 * Austrian Research Promotion Agency (FFG) at
 * https://www.ffg.at/en/europe/heu/legal-financial/theme_funding-rates
 * ("Innovation Actions (IA) – regular rate ... 70%"; RIA/CSA 100%).
 *
 * EIC Accelerator: the EIC grant component covers a maximum of 70% of total
 * eligible costs for TRL 6-8 innovation activities, as a lump sum capped
 * below €2.5m over a 24-month project. Source: European Commission, EIC
 * Accelerator application platform FAQ, "Financial template for full
 * proposals" ("The maximum grant amount is 70% of the total eligible
 * costs") — https://eic.ec.europa.eu/eic-accelerator-application-platform-frequently-asked-questions_en
 * and https://eic.ec.europa.eu/eic-funding-opportunities/eic-accelerator_en
 * ("Lump sum contribution below € 2.5 million"); the FAQ adds that applicants
 * "have to request less than €2.5 million unless it is justified to ask for
 * more" — a soft ceiling, which the page says in words.
 */
export const COFUNDING_PRESETS = Object.freeze([
  {
    id: 'heu-ria',
    label: 'Horizon Europe — Research & Innovation Action (RIA)',
    intensityPct: 100,
    note: '100% of eligible costs for every participant, profit or non-profit.',
    sourceUrl: 'https://www.ffg.at/en/europe/heu/legal-financial/theme_funding-rates',
  },
  {
    id: 'heu-ia-forprofit',
    label: 'Horizon Europe — Innovation Action (IA), for-profit',
    intensityPct: 70,
    note: '70% for profit-making participants; non-profit legal entities get 100% instead.',
    sourceUrl: 'https://www.ffg.at/en/europe/heu/legal-financial/theme_funding-rates',
  },
  {
    id: 'heu-ia-nonprofit',
    label: 'Horizon Europe — Innovation Action (IA), non-profit',
    intensityPct: 100,
    note: 'Applies only to entities that are non-profit by legal form or legally barred from distributing profit.',
    sourceUrl: 'https://www.ffg.at/en/europe/heu/legal-financial/theme_funding-rates',
  },
  {
    id: 'eic-accelerator',
    label: 'EIC Accelerator — grant component',
    intensityPct: 70,
    note: 'Maximum 70% of total eligible costs. Applicants are expected to request less than €2.5m unless they justify more, so this preset applies €2.5m as a ceiling.',
    sourceUrl: 'https://eic.ec.europa.eu/eic-accelerator-application-platform-frequently-asked-questions_en',
    capEur: 2_500_000,
  },
]);

/**
 * @param {object} input
 * @param {number} input.projectCostEur - total eligible project cost.
 * @param {number} input.intensityPct - grant intensity, 0-100 (% of project cost the grant covers).
 * @param {number} input.inKindPct - of the founder's OWN contribution, what share (0-100) is in-kind
 *   (donated staff time, equipment, premises) rather than cash the company must find.
 * @param {boolean} input.paidInArrears - true if the grant reimburses costs already incurred
 *   (the normal EU-programme pattern: the beneficiary pre-finances, then claims); false if the
 *   funder advances the grant share before spend.
 * @param {number|null} [input.capEur] - an absolute cap on the grant amount (e.g. the EIC Accelerator's
 *   lump sum ceiling), applied after the percentage calculation.
 */
export function computeCofunding({ projectCostEur, intensityPct, inKindPct = 0, paidInArrears = true, capEur = null }) {
  const cost = Math.max(0, Number(projectCostEur) || 0);
  const intensity = Math.min(100, Math.max(0, Number(intensityPct) || 0));
  const inKind = Math.min(100, Math.max(0, Number(inKindPct) || 0));

  let grantAmountEur = cost * (intensity / 100);
  const cappedByCeiling = capEur != null && grantAmountEur > capEur;
  if (cappedByCeiling) grantAmountEur = capEur;

  const ownContributionEur = cost - grantAmountEur;
  const inKindContributionEur = ownContributionEur * (inKind / 100);
  const ownCashContributionEur = ownContributionEur - inKindContributionEur;

  /* If the grant is paid in arrears, the beneficiary must first pay the
   * cash costs of the WHOLE project (its own share and the grant's share
   * alike — the funder has not sent anything yet) and only recovers the
   * grant portion afterwards on a reimbursement claim. In-kind contributions
   * are never a cash outlay either way, so they are excluded from both. */
  const totalCashCostEur = cost - inKindContributionEur;
  const cashNeededUpFrontEur = paidInArrears ? totalCashCostEur : ownCashContributionEur;

  return {
    grantAmountEur,
    ownContributionEur,
    inKindContributionEur,
    ownCashContributionEur,
    cashNeededUpFrontEur,
    cappedByCeiling,
  };
}

/* ------------------------------------------------------------------ */
/* Forschungszulage (German R&D tax credit) estimator                  */
/* ------------------------------------------------------------------ */

/**
 * Every figure here is the current (from 1 January 2026) Forschungszulage
 * rule under the Forschungszulagengesetz (FZulG), cross-verified across:
 *  - https://www.wirtschaft.nrw/steuerliche-forschungszulage (rate table:
 *    25%/35%, EUR 12m base, EUR 4.2m/3.0m caps, 70% contract-research share,
 *    20% overhead flat rate, all effective 1 January 2026)
 *  - https://www.bundesfinanzministerium.de/.../forschungszulage.html
 *    (70% of contract-research fees eligible; depreciation of moveable fixed
 *    assets used exclusively for the R&D project is an eligible cost)
 *  - https://www.ihk-muenchen.de/ratgeber/steuern/steuerliche-sonderthemen/foerderung-forschung-entwicklung/
 *    (the 20% overhead flat rate — Gemeinkostenpauschale — is calculated on
 *    the sum of personnel costs, the countable share of contract research,
 *    owner's own-labour costs and depreciation; applies to R&D projects
 *    that began after 31 December 2025; § 3 Abs. 3b FZulG n.F.)
 *  - the de-forschungszulage record in data/startups/de.json, itself sourced
 *    the same way (see its own source_url / source_snippet fields).
 *
 * This is a statutory tax credit, not a competitive grant with a fixed pot —
 * every taxpayer meeting the criteria gets it, including a loss-making
 * pre-revenue company, as a cash refund.
 */
export const FORSCHUNGSZULAGE_RULES_2026 = Object.freeze({
  contractResearchEligibleSharePct: 70,
  overheadFlatRatePct: 20,
  smeRatePct: 35,
  largeCompanyRatePct: 25,
  bemessungsgrundlageCapEur: 12_000_000,
  perProjectLifetimeCapEur: 15_000_000,
  overheadRuleAppliesFromProjectsStartedAfter: '2025-12-31',
  sourceUrls: [
    'https://www.wirtschaft.nrw/steuerliche-forschungszulage',
    'https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/Steuerliche_Themengebiete/Forschungszulage/forschungszulage.html',
    'https://www.ihk-muenchen.de/ratgeber/steuern/steuerliche-sonderthemen/foerderung-forschung-entwicklung/',
  ],
});

/**
 * @param {object} input
 * @param {number} input.personnelCostsEur - eligible R&D staff gross wages for the business year.
 * @param {number} input.contractResearchEur - fees paid to EEA-based contract-research providers
 *   (the full invoiced amount; only 70% of it counts toward the base).
 * @param {number} input.depreciationEur - depreciation of moveable fixed assets required for and
 *   used exclusively in the R&D project.
 * @param {boolean} input.isSme - whether the claimant is an SME under the EU definition (35% rate)
 *   or a large company (25% rate).
 * @param {boolean} input.projectStartedAfter2025 - whether the R&D project began after
 *   31 December 2025 — only then does the 20% overhead flat rate apply.
 */
export function computeForschungszulage({
  personnelCostsEur,
  contractResearchEur = 0,
  depreciationEur = 0,
  isSme = true,
  projectStartedAfter2025 = true,
}) {
  const r = FORSCHUNGSZULAGE_RULES_2026;
  const personnel = Math.max(0, Number(personnelCostsEur) || 0);
  const contractResearch = Math.max(0, Number(contractResearchEur) || 0);
  const depreciation = Math.max(0, Number(depreciationEur) || 0);

  const contractResearchCountedEur = contractResearch * (r.contractResearchEligibleSharePct / 100);
  const directCostsEur = personnel + contractResearchCountedEur + depreciation;
  const overheadFlatRateEur = projectStartedAfter2025 ? directCostsEur * (r.overheadFlatRatePct / 100) : 0;

  const uncappedBaseEur = directCostsEur + overheadFlatRateEur;
  const cappedByBemessungsgrundlage = uncappedBaseEur > r.bemessungsgrundlageCapEur;
  const eligibleBaseEur = Math.min(uncappedBaseEur, r.bemessungsgrundlageCapEur);

  const ratePct = isSme ? r.smeRatePct : r.largeCompanyRatePct;
  const estimatedCreditEur = eligibleBaseEur * (ratePct / 100);

  return {
    contractResearchCountedEur,
    directCostsEur,
    overheadFlatRateEur,
    uncappedBaseEur,
    eligibleBaseEur,
    cappedByBemessungsgrundlage,
    ratePct,
    estimatedCreditEur,
    perProjectLifetimeCapEur: r.perProjectLifetimeCapEur,
  };
}
