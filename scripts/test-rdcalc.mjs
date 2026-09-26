#!/usr/bin/env node
/**
 * The two /startups/tools/** calculators' pure logic — packages/rdcalc.
 *
 * No DOM, no build: this exercises exactly what src/pwa/cofunding.js and
 * src/pwa/forschungszulage.js call, against the same module, so a regression
 * here is a regression a founder would see on the live pages.
 */
import {
  COFUNDING_PRESETS,
  computeCofunding,
  FORSCHUNGSZULAGE_RULES_2026,
  computeForschungszulage,
} from '../packages/rdcalc/index.js';

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nCo-funding / Forschungszulage calculators\n');

/* ------------------------------------------------------------------ */
/* Co-funding calculator                                                */
/* ------------------------------------------------------------------ */

/* ---- Verified presets — the numbers this page exists to get right ---- */
t('there are verified co-funding presets', COFUNDING_PRESETS.length >= 3);
t(
  'Horizon Europe RIA preset is 100%',
  COFUNDING_PRESETS.find((p) => p.id === 'heu-ria')?.intensityPct === 100,
);
t(
  'Horizon Europe IA (for-profit) preset is 70%',
  COFUNDING_PRESETS.find((p) => p.id === 'heu-ia-forprofit')?.intensityPct === 70,
);
t(
  'Horizon Europe IA (non-profit) preset is 100%',
  COFUNDING_PRESETS.find((p) => p.id === 'heu-ia-nonprofit')?.intensityPct === 100,
);
t(
  'EIC Accelerator preset is 70% with a EUR 2.5m cap',
  COFUNDING_PRESETS.find((p) => p.id === 'eic-accelerator')?.intensityPct === 70
    && COFUNDING_PRESETS.find((p) => p.id === 'eic-accelerator')?.capEur === 2_500_000,
);
t('every preset cites an official source URL', COFUNDING_PRESETS.every((p) => /^https:\/\//.test(p.sourceUrl)));

/* ---- Basic arithmetic ---- */
{
  const r = computeCofunding({ projectCostEur: 500_000, intensityPct: 70, inKindPct: 0, paidInArrears: true });
  t('grant amount is cost * intensity', r.grantAmountEur === 350_000);
  t('own contribution is the remainder', r.ownContributionEur === 150_000);
  t('with no in-kind, own cash contribution equals own contribution', r.ownCashContributionEur === 150_000);
  t(
    'paid in arrears: cash needed up front is the whole project cost (no in-kind)',
    r.cashNeededUpFrontEur === 500_000,
  );
}

{
  const r = computeCofunding({ projectCostEur: 500_000, intensityPct: 70, inKindPct: 0, paidInArrears: false });
  t('advanced (not arrears): cash needed up front is only the own cash share', r.cashNeededUpFrontEur === 150_000);
}

{
  const r = computeCofunding({ projectCostEur: 100_000, intensityPct: 100, inKindPct: 0, paidInArrears: true });
  t('a 100%-intensity grant leaves no own contribution', r.ownContributionEur === 0);
  t('but the beneficiary still pre-finances the full cost if paid in arrears', r.cashNeededUpFrontEur === 100_000);
}

{
  // Own contribution is 30,000 (100,000 - 70,000). Half of it, 15,000, is in-kind.
  const r = computeCofunding({ projectCostEur: 100_000, intensityPct: 70, inKindPct: 50, paidInArrears: false });
  t('in-kind reduces the cash share of the own contribution', r.inKindContributionEur === 15_000 && r.ownCashContributionEur === 15_000);
}

{
  // Cash costs exclude in-kind even when paid in arrears.
  const r = computeCofunding({ projectCostEur: 100_000, intensityPct: 70, inKindPct: 50, paidInArrears: true });
  t('in-kind is excluded from the cash-up-front figure even in arrears', r.cashNeededUpFrontEur === 85_000);
}

{
  const r = computeCofunding({ projectCostEur: 10_000_000, intensityPct: 70, capEur: 2_500_000 });
  t('an absolute cap overrides the percentage once it is reached', r.grantAmountEur === 2_500_000);
  t('cappedByCeiling is flagged when the cap binds', r.cappedByCeiling === true);
  t('own contribution is computed against the capped grant, not the uncapped one', r.ownContributionEur === 7_500_000);
}

{
  const r = computeCofunding({ projectCostEur: 100_000, intensityPct: 70, capEur: 2_500_000 });
  t('the cap does not bind when the project is small enough', r.cappedByCeiling === false && r.grantAmountEur === 70_000);
}

{
  const negative = computeCofunding({ projectCostEur: -1000, intensityPct: 200, inKindPct: -50 });
  t('negative/out-of-range inputs are clamped, never negative or over 100%', negative.grantAmountEur === 0 && negative.ownContributionEur === 0);
}

/* ------------------------------------------------------------------ */
/* Forschungszulage estimator                                          */
/* ------------------------------------------------------------------ */

/* ---- Verified 2026 rules — the numbers this page exists to get right ---- */
t('SME rate is 35%', FORSCHUNGSZULAGE_RULES_2026.smeRatePct === 35);
t('large-company rate is 25%', FORSCHUNGSZULAGE_RULES_2026.largeCompanyRatePct === 25);
t('the Bemessungsgrundlage cap is EUR 12,000,000', FORSCHUNGSZULAGE_RULES_2026.bemessungsgrundlageCapEur === 12_000_000);
t('contract research counts 70%', FORSCHUNGSZULAGE_RULES_2026.contractResearchEligibleSharePct === 70);
t('the overhead flat rate is 20%', FORSCHUNGSZULAGE_RULES_2026.overheadFlatRatePct === 20);
t('the per-project lifetime cap is EUR 15,000,000', FORSCHUNGSZULAGE_RULES_2026.perProjectLifetimeCapEur === 15_000_000);
t(
  'the max annual SME credit at the cap is EUR 4.2m (12m base * 35%)',
  FORSCHUNGSZULAGE_RULES_2026.bemessungsgrundlageCapEur * FORSCHUNGSZULAGE_RULES_2026.smeRatePct / 100 === 4_200_000,
);
t(
  'the max annual large-company credit at the cap is EUR 3.0m (12m base * 25%)',
  FORSCHUNGSZULAGE_RULES_2026.bemessungsgrundlageCapEur * FORSCHUNGSZULAGE_RULES_2026.largeCompanyRatePct / 100 === 3_000_000,
);

/* ---- Basic arithmetic: personnel only, SME, project after 2025 ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: 200_000, isSme: true, projectStartedAfter2025: true });
  t('direct costs equal personnel costs alone with no other inputs', out.directCostsEur === 200_000);
  t('overhead is 20% of direct costs when the project began after 2025', out.overheadFlatRateEur === 40_000);
  t('eligible base is direct costs plus overhead', out.eligibleBaseEur === 240_000);
  t('estimated credit is 35% of the eligible base for an SME', out.estimatedCreditEur === 84_000);
}

/* ---- The overhead flat rate is conditional on the project start date ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: 200_000, isSme: true, projectStartedAfter2025: false });
  t('no overhead flat rate for a project that began before 1 Jan 2026', out.overheadFlatRateEur === 0);
  t('eligible base then equals direct costs alone', out.eligibleBaseEur === 200_000);
}

/* ---- Contract research only counts at 70% ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: 0, contractResearchEur: 100_000, projectStartedAfter2025: false });
  t('70,000 of a 100,000 contract research invoice counts toward the base', out.contractResearchCountedEur === 70_000);
  t('direct costs reflect only the counted share', out.directCostsEur === 70_000);
}

/* ---- Large company gets the 25% rate ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: 100_000, isSme: false, projectStartedAfter2025: false });
  t('a large company is credited at 25%, not the SME 35%', out.estimatedCreditEur === 25_000);
}

/* ---- The Bemessungsgrundlage cap binds above EUR 12m ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: 20_000_000, isSme: true, projectStartedAfter2025: false });
  t('the eligible base is capped at EUR 12,000,000', out.eligibleBaseEur === 12_000_000);
  t('cappedByBemessungsgrundlage is flagged once the cap binds', out.cappedByBemessungsgrundlage === true);
  t('the credit at the cap for an SME is EUR 4.2m', out.estimatedCreditEur === 4_200_000);
}

{
  const out = computeForschungszulage({ personnelCostsEur: 1_000_000, isSme: true, projectStartedAfter2025: false });
  t('the cap does not bind for a modest base', out.cappedByBemessungsgrundlage === false);
}

/* ---- Depreciation is an eligible cost alongside personnel and contract research ---- */
{
  const out = computeForschungszulage({
    personnelCostsEur: 100_000,
    contractResearchEur: 50_000,
    depreciationEur: 30_000,
    projectStartedAfter2025: false,
  });
  t(
    'direct costs sum personnel, 70% of contract research, and depreciation',
    out.directCostsEur === 100_000 + 35_000 + 30_000,
  );
}

/* ---- Negative/garbage inputs never produce a negative estimate ---- */
{
  const out = computeForschungszulage({ personnelCostsEur: -5000, contractResearchEur: -1000, depreciationEur: -1 });
  t('negative inputs are clamped to zero, never a negative credit', out.estimatedCreditEur === 0 && out.directCostsEur === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
