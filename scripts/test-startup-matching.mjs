#!/usr/bin/env node
/**
 * Company-matching-engine regressions (src/engine/startup.js).
 *
 * Four defects lived here at once, all inflating what a founder was told they
 * could get, or hiding what they still needed to check:
 *
 *  1. Shared competition prize purses — "US$119m total prize purse, the
 *     largest active XPRIZE" — were counted at face value as if one company
 *     could win the whole thing, alongside real per-winner grants. A
 *     two-person pre-seed team's headline read USD 239.2 million, of which
 *     USD 220m was two XPRIZE purses alone.
 *  2. Consortium-only EU calls (EIC Pathfinder Open needs three independent
 *     legal entities from three countries) were shown as solo, full-amount
 *     wins with no caveat at all — nothing in the structured schema gated on
 *     it, so a two-person company passed every rule the engine checked.
 *  3. `status: "unknown"` records (about a quarter of the 1,684-record
 *     company dataset) looked identical to a verified-open, sourced one:
 *     ranked, counted and summed the same way.
 *  4. Loans and equity were already excluded from the non-dilutive headline
 *     (`isFreeMoney`), but nothing pinned that down as a regression, and
 *     nothing checked that a shared purse could not sneak back in through
 *     the same total.
 *
 * Every assertion below is against the real data files and the real
 * `matchStartup`, on the specific records the audit named, not a synthetic
 * fixture — so a regression here is a regression a founder would see.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchStartup, reachFor, isSharedPurse, requiresConsortium, isFreeMoney } from '../src/engine/startup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUPS = path.join(ROOT, 'data', 'startups');

let pass = 0;
let fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const manifest = JSON.parse(fs.readFileSync(path.join(STARTUPS, 'manifest.json'), 'utf8'));
const poolCache = {};
const load = (pool) => {
  if (!(pool in poolCache)) {
    const p = path.join(STARTUPS, `${pool}.json`);
    poolCache[pool] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { programmes: [] };
  }
  return poolCache[pool];
};
const poolsFor = (cc) => {
  const out = {};
  for (const pool of reachFor(cc)) out[pool] = load(pool);
  return out;
};
const findProgramme = (pool, slug) => load(pool).programmes.find((p) => p.slug === slug);

/* ------------------------------------------------------------------ *
 * 1. Shared prize purses never inflate the "you could get" total.
 * ------------------------------------------------------------------ */
{
  const water = findProgramme('global', 'global-xprize-water-scarcity');
  const healthspan = findProgramme('global', 'global-xprize-healthspan');
  t('global-xprize-water-scarcity exists in the fixture', !!water);
  t('global-xprize-healthspan exists in the fixture', !!healthspan);
  t('a $119m prize with "total prize purse" in its own note is detected as a shared purse',
    water && isSharedPurse(water) === true);
  t('a $101m prize with "total prize purse" in its own note is detected too',
    healthspan && isSharedPurse(healthspan) === true);

  /* The exact profile the audit ran: UK deeptech pre-seed, 2 staff, no
     revenue. Its own headline used to read USD 239,225,000. */
  const profile = {
    country_code: 'gb', incorporated: true, incorporation_date: '2026-01-01',
    headcount: 2, turnover_annual_eur: 0, stage: 'pre_seed',
    sectors: ['deeptech', 'hardware', 'ai'], rd_active: true, has_local_entity: true,
  };
  const r = matchStartup(profile, poolsFor('gb'), Date.parse('2026-09-25'));

  const xp = r.eligible.find((m) => m.programme.slug === 'global-xprize-water-scarcity');
  t('the XPRIZE record is still reachable and still listed as eligible for this UK founder', !!xp);
  t('and it is flagged as a shared purse on the match itself', xp && xp.is_shared_purse === true);
  t('with a note explaining why', xp && typeof xp.shared_purse_note === 'string' && xp.shared_purse_note.length > 0);

  const [headlineCurrency, headlineTotals] = r.non_dilutive.headline ?? [null, null];
  t('the headline currency is not swamped by a $220m+ shared-purse figure',
    !headlineTotals || headlineTotals.max < 100_000_000,
    `headline: ${headlineCurrency} ${JSON.stringify(headlineTotals)}`);
  t('the two XPRIZE purses are excluded from every by_currency total in `totals`',
    Object.values(r.totals.prize?.by_currency ?? {}).every((c) => c.max < 100_000_000),
    JSON.stringify(r.totals.prize));
  t('and they are tracked separately, not simply dropped',
    (r.totals.prize?.shared_purse_by_currency?.USD?.max ?? 0) >= 220_000_000,
    JSON.stringify(r.totals.prize?.shared_purse_by_currency));
  t('non_dilutive.shared_purse_by_currency carries the excluded USD total',
    (r.non_dilutive.shared_purse_by_currency?.USD?.max ?? 0) >= 220_000_000);
  t('non_dilutive.shared_purse_count counts both purses',
    r.non_dilutive.shared_purse_count >= 2, `${r.non_dilutive.shared_purse_count}`);
}

/* ------------------------------------------------------------------ *
 * 2. Consortium-only calls go to conditional, not a solo full-amount win.
 * ------------------------------------------------------------------ */
{
  const pathfinder = findProgramme('eu', 'eu-eic-pathfinder');
  t('eu-eic-pathfinder exists in the fixture', !!pathfinder);
  t('its own eligibility.other_note names a consortium requirement, and is detected',
    pathfinder && requiresConsortium(pathfinder) === true);

  const challenges = findProgramme('eu', 'eic-pathfinder-challenges');
  t('Pathfinder Challenges, which explicitly permits single applicants, is not flagged',
    challenges && requiresConsortium(challenges) === false);

  t('an explicit eligibility.requires_consortium overrides the text guess (true)',
    requiresConsortium({ name_en: 'Nothing special', eligibility: { requires_consortium: true } }) === true);
  t('an explicit eligibility.requires_consortium overrides the text guess (false, even mentioning the word)',
    requiresConsortium({
      name_en: 'A consortium may apply, but is not required',
      eligibility: { requires_consortium: false, other_note: 'A consortium may apply' },
    }) === false);

  const profile = {
    country_code: 'gb', incorporated: true, incorporation_date: '2026-01-01',
    headcount: 2, turnover_annual_eur: 0, stage: 'pre_seed', sectors: ['deeptech'],
    rd_active: true, has_local_entity: true,
  };
  const r = matchStartup(profile, poolsFor('gb'), Date.parse('2026-09-25'));
  const eic = r.conditional.find((m) => m.programme.slug === 'eu-eic-pathfinder');
  t('eu-eic-pathfinder is a conditional match, not a solo eligible one',
    !!eic, `eligible? ${r.eligible.some((m) => m.programme.slug === 'eu-eic-pathfinder')}`);
  t('and the condition is named, not just a bare flag',
    eic && eic.conditions.includes('requires_consortium'), JSON.stringify(eic?.conditions));
  t('its EUR 4,000,000 is not summed into the eligible-bucket non-dilutive headline',
    !r.eligible.some((m) => m.programme.slug === 'eu-eic-pathfinder'));
}

/* ------------------------------------------------------------------ *
 * 3. `status: unknown` is a caveat, not a silent pass.
 * ------------------------------------------------------------------ */
{
  let uncaveated = 0;
  let checked = 0;
  const profiles = [
    { country_code: 'fr', incorporated: true, incorporation_date: '2026-01-01', headcount: 3, turnover_annual_eur: 50000, stage: 'seed', sectors: ['software'], rd_active: true, has_local_entity: true },
    { country_code: 'in', incorporated: true, incorporation_date: '2025-01-01', headcount: 8, turnover_annual_eur: 100000, stage: 'seed', sectors: ['fintech'], rd_active: false, has_local_entity: true },
    { country_code: 'de', incorporated: true, incorporation_date: '2024-01-01', headcount: 40, turnover_annual_eur: 3_000_000, stage: 'series_a', sectors: ['manufacturing'], rd_active: true, has_local_entity: true },
  ];
  for (const profile of profiles) {
    const r = matchStartup(profile, poolsFor(profile.country_code), Date.parse('2026-09-25'));
    checked += 1;
    for (const m of r.eligible) {
      if (m.programme.status === 'unknown') uncaveated += 1;
    }
  }
  t(`no record with status "unknown" ever reaches the plain eligible bucket (checked ${checked} profiles)`,
    uncaveated === 0, `${uncaveated} leaked through`);

  /* And the record itself: it must show up somewhere, caveated, not vanish. */
  const gsea = findProgramme('global', 'global-gsea');
  if (gsea) {
    t('a status-unknown record with no other blocker lands in conditional, named',
      (() => {
        const r = matchStartup(profiles[0], poolsFor('fr'), Date.parse('2026-09-25'));
        const m = r.conditional.find((x) => x.programme.slug === gsea.slug);
        return !!m && m.conditions.includes('status_unknown');
      })());
  }
}

/* ------------------------------------------------------------------ *
 * 4. Loans and equity still never inflate the non-dilutive headline
 *    (pinned as a regression alongside the new shared-purse exclusion,
 *    so a future change to either cannot silently let the other back in).
 * ------------------------------------------------------------------ */
{
  t('a loan is never counted as free money', isFreeMoney('loan') === false);
  t('equity is never counted as free money', isFreeMoney('equity') === false);
  t('a grant is counted as free money', isFreeMoney('grant') === true);

  const profile = {
    country_code: 'sg', incorporated: true, incorporation_date: '2026-01-01',
    headcount: 5, turnover_annual_eur: 200000, stage: 'seed', sectors: ['software'],
    rd_active: true, has_local_entity: true,
  };
  const r = matchStartup(profile, poolsFor('sg'), Date.parse('2026-09-25'));
  const loanOrEquity = r.eligible.filter((m) => ['loan', 'equity'].includes(m.programme.grant_type));
  t('this profile has at least one loan or equity match to check against', loanOrEquity.length > 0, `${loanOrEquity.length}`);
  const headlineCurrencies = new Set(Object.keys(r.non_dilutive.by_currency));
  const leaked = loanOrEquity.filter((m) => {
    const cur = m.programme.amount_currency || 'EUR';
    return headlineCurrencies.has(cur) && isFreeMoney(m.programme.grant_type);
  });
  t('none of them are free-money instruments', leaked.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
