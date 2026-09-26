#!/usr/bin/env node
/**
 * The EU de minimis headroom calculator's pure logic — packages/stateaid's
 * new ceiling-by-kind machinery and the rolling-window edges it depends on.
 *
 * No DOM, no build: this exercises exactly what src/pwa/de-minimis.js calls,
 * against the same module, so a regression here is a regression a founder
 * would see on /startups/de-minimis/.
 */
import {
  DE_MINIMIS_CEILING_EUR,
  SGEI_CEILING_EUR,
  AGRICULTURE_CEILING_EUR,
  FISHERIES_CEILING_EUR,
  FISHERIES_CEILING_HIGHER_EUR,
  WINDOW_MONTHS,
  AID_KINDS,
  ceilingForKind,
  awardsInWindow,
  headroom,
  headroomByKind,
} from '../packages/stateaid/index.js';
import { EU_MEMBER_STATES } from '../src/pages/de-minimis.mjs';

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nDe minimis headroom calculator\n');

/* ---- Verified ceilings — the numbers this whole page exists to get right ---- */
t('general ceiling is EUR 300,000', DE_MINIMIS_CEILING_EUR === 300_000);
t('SGEI ceiling is EUR 750,000', SGEI_CEILING_EUR === 750_000);
t('agriculture ceiling is EUR 50,000', AGRICULTURE_CEILING_EUR === 50_000);
t('fisheries default ceiling is EUR 30,000', FISHERIES_CEILING_EUR === 30_000);
t('fisheries higher-register ceiling is EUR 40,000', FISHERIES_CEILING_HIGHER_EUR === 40_000);
t('the rolling window is 36 months', WINDOW_MONTHS === 36);

/* ---- ceilingForKind ---- */
t('general kind maps to the general ceiling', ceilingForKind('general') === DE_MINIMIS_CEILING_EUR);
t(
  'road freight has no separate sub-ceiling — it is the general ceiling',
  ceilingForKind('road_freight') === DE_MINIMIS_CEILING_EUR,
);
t('agriculture kind maps to the agriculture ceiling', ceilingForKind('agriculture') === AGRICULTURE_CEILING_EUR);
t('sgei kind maps to the SGEI ceiling', ceilingForKind('sgei') === SGEI_CEILING_EUR);
t(
  'fisheries defaults to the lower ceiling without the register flag',
  ceilingForKind('fisheries') === FISHERIES_CEILING_EUR,
);
t(
  'fisheries takes the higher ceiling with { higherRegister: true }',
  ceilingForKind('fisheries', { higherRegister: true }) === FISHERIES_CEILING_HIGHER_EUR,
);
t('an unrecognised kind falls back to the general ceiling', ceilingForKind('nonsense') === DE_MINIMIS_CEILING_EUR);

/* ---- Rolling window edges ---- */
{
  const asOf = Date.parse('2026-06-15T00:00:00Z');
  const MS_MONTH = 30.44 * 24 * 60 * 60 * 1000;
  const justInside = asOf - WINDOW_MONTHS * MS_MONTH + 24 * 60 * 60 * 1000; // one day inside
  const justOutside = asOf - WINDOW_MONTHS * MS_MONTH - 24 * 60 * 60 * 1000; // one day outside
  const awards = [
    { granted_at: justInside, amount_eur: 10_000, member_state: 'fr' },
    { granted_at: justOutside, amount_eur: 20_000, member_state: 'fr' },
    { granted_at: asOf, amount_eur: 5_000, member_state: 'fr' }, // exactly at asOf — inclusive
  ];
  const inWindow = awardsInWindow(awards, asOf, 'fr');
  t('an award one day inside the 36-month window counts', inWindow.some((a) => a.amount_eur === 10_000));
  t('an award one day outside the 36-month window does not count', !inWindow.some((a) => a.amount_eur === 20_000));
  t('an award dated exactly at asOf is included (inclusive upper edge)', inWindow.some((a) => a.amount_eur === 5_000));

  const room = headroom(awards, 'fr', asOf);
  t('headroom used total only sums in-window awards', room.used_eur === 15_000);
  t('headroom_eur is the ceiling minus the in-window total', room.headroom_eur === DE_MINIMIS_CEILING_EUR - 15_000);
  t('frees_up_at is the oldest in-window award plus 36 months', Math.abs(room.frees_up_at - (justInside + WINDOW_MONTHS * MS_MONTH)) < 1000);
}

/* ---- A future date moves stale awards out of the window ---- */
{
  const MS_MONTH = 30.44 * 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-01-01T00:00:00Z');
  // Granted 35 months before `now` — inside the 36-month window today.
  const grantedAt = now - 35 * MS_MONTH;
  const awards = [{ granted_at: grantedAt, amount_eur: 280_000, member_state: 'de' }];
  const today = headroom(awards, 'de', now);
  t('an award inside the window today is counted', today.used_eur === 280_000);
  t('so headroom today reflects it', today.headroom_eur === 20_000);

  // Two months later the same award is 37 months old — outside the window.
  const in2months = now + 2 * MS_MONTH;
  const later = headroom(awards, 'de', in2months);
  t('the same award drops out once 36 months have passed', later.used_eur === 0);
  t('and headroom on that future date is the full ceiling', later.headroom_eur === DE_MINIMIS_CEILING_EUR);
}

/* ---- Over the ceiling is a hard flag, not a negative number ---- */
{
  const awards = [
    { granted_at: '2025-01-01', amount_eur: 200_000, member_state: 'it' },
    { granted_at: '2025-06-01', amount_eur: 150_000, member_state: 'it' },
  ];
  const room = headroom(awards, 'it', Date.parse('2026-01-01'));
  t('over-ceiling headroom floors at zero, never negative', room.headroom_eur === 0);
  t('the over flag is set once used exceeds the ceiling', room.over === true);
}

/* ---- Per-Member-State separation: the same company, two countries ---- */
{
  const awards = [
    { granted_at: '2025-01-01', amount_eur: 250_000, member_state: 'fr' },
    { granted_at: '2025-01-01', amount_eur: 250_000, member_state: 'de' },
  ];
  const fr = headroom(awards, 'fr', Date.parse('2026-01-01'));
  const de = headroom(awards, 'de', Date.parse('2026-01-01'));
  t('French aid does not count against the German ceiling', de.used_eur === 250_000 && fr.used_eur === 250_000);
}

/* ---- headroomByKind: multiple aid types, separate pots ---- */
{
  const asOf = Date.parse('2026-01-01T00:00:00Z');
  const awards = [
    { granted_at: '2025-01-01', amount_eur: 100_000, kind: 'general', member_state: 'es' },
    { granted_at: '2025-02-01', amount_eur: 80_000, kind: 'road_freight', member_state: 'es' },
    { granted_at: '2025-03-01', amount_eur: 20_000, kind: 'agriculture', member_state: 'es' },
    { granted_at: '2025-04-01', amount_eur: 10_000, kind: 'fisheries', member_state: 'es' },
    { granted_at: '2025-05-01', amount_eur: 600_000, kind: 'sgei', member_state: 'es' },
  ];
  const byKind = headroomByKind(awards, 'es', asOf);

  t('general and road_freight share one pot', byKind.general.used_eur === 180_000);
  t('general pot headroom uses the EUR 300,000 ceiling', byKind.general.ceiling_eur === DE_MINIMIS_CEILING_EUR);
  t('agriculture is a separate, narrower pot', byKind.agriculture.used_eur === 20_000 && byKind.agriculture.ceiling_eur === AGRICULTURE_CEILING_EUR);
  t('fisheries is a separate, narrower pot still', byKind.fisheries.used_eur === 10_000 && byKind.fisheries.ceiling_eur === FISHERIES_CEILING_EUR);
  t('SGEI is separate from general and does not consume its pot', byKind.sgei.used_eur === 600_000 && byKind.general.used_eur === 180_000);
  t('road_freight is not reported as its own key — it folds into general', byKind.road_freight === undefined);
  t('every declared kind except road_freight appears in the result', AID_KINDS.filter((k) => k !== 'road_freight').every((k) => byKind[k] !== undefined));
}

/* ---- Art. 5(2) of 2023/2831: general + agriculture + fisheries share the EUR 300,000 ceiling ---- */
{
  const asOf = Date.parse('2026-01-01T00:00:00Z');
  const awards = [
    { granted_at: '2025-01-01', amount_eur: 100_000, kind: 'general', member_state: 'es' },
    { granted_at: '2025-02-01', amount_eur: 80_000, kind: 'road_freight', member_state: 'es' },
    { granted_at: '2025-03-01', amount_eur: 20_000, kind: 'agriculture', member_state: 'es' },
    { granted_at: '2025-04-01', amount_eur: 10_000, kind: 'fisheries', member_state: 'es' },
  ];
  const byKind = headroomByKind(awards, 'es', asOf);
  t('combined general+agri+fisheries total is tracked', byKind.general.combined_used_eur === 210_000);
  t('general headroom is reduced by agri and fisheries aid (Art. 5(2))', byKind.general.headroom_eur === 90_000);
  t('agriculture headroom stays at its own lower ceiling when that binds', byKind.agriculture.headroom_eur === 30_000 && !byKind.agriculture.capped_by_combined);

  const heavy = [
    { granted_at: '2025-01-01', amount_eur: 290_000, kind: 'general', member_state: 'es' },
    { granted_at: '2025-03-01', amount_eur: 5_000, kind: 'agriculture', member_state: 'es' },
  ];
  const h = headroomByKind(heavy, 'es', asOf);
  t('agriculture headroom is capped by what is left of the combined EUR 300,000', h.agriculture.headroom_eur === 5_000 && h.agriculture.capped_by_combined);
  t('fisheries headroom is capped by the combined total too', h.fisheries.headroom_eur === 5_000);

  const overCombined = headroomByKind([
    { granted_at: '2025-01-01', amount_eur: 290_000, kind: 'general', member_state: 'es' },
    { granted_at: '2025-03-01', amount_eur: 20_000, kind: 'agriculture', member_state: 'es' },
  ], 'es', asOf);
  t('general is flagged over when the combined total exceeds EUR 300,000', overCombined.general.over && overCombined.general.headroom_eur === 0);
}

/* ---- headroomByKind with no prior awards: full headroom everywhere ---- */
{
  const byKind = headroomByKind([], 'pl', Date.now());
  t('with no awards, general headroom is the full EUR 300,000', byKind.general.headroom_eur === DE_MINIMIS_CEILING_EUR);
  t('with no awards, agriculture headroom is the full EUR 50,000', byKind.agriculture.headroom_eur === AGRICULTURE_CEILING_EUR);
  t('with no awards, fisheries headroom is the full EUR 30,000', byKind.fisheries.headroom_eur === FISHERIES_CEILING_EUR);
  t('with no awards, SGEI headroom is the full EUR 750,000', byKind.sgei.headroom_eur === SGEI_CEILING_EUR);
}

/* ---- The basis citation matches the ceiling actually used ---- */
{
  const asOf = Date.now();
  t('general headroom cites the general Regulation', /2023\/2831/.test(headroom([], 'fr', asOf, DE_MINIMIS_CEILING_EUR).basis));
  t('SGEI headroom cites the SGEI Regulation', /2023\/2832/.test(headroom([], 'fr', asOf, SGEI_CEILING_EUR).basis));
  t('agriculture headroom cites Regulation 1408/2013', /1408\/2013/.test(headroom([], 'fr', asOf, AGRICULTURE_CEILING_EUR).basis));
  t('fisheries headroom cites Regulation 717/2014', /717\/2014/.test(headroom([], 'fr', asOf, FISHERIES_CEILING_EUR).basis));
}

/* ---- EU_MEMBER_STATES: the calculator's country list ---- */
t('EU_MEMBER_STATES lists exactly 27 Member States', EU_MEMBER_STATES.length === 27);
t('EU_MEMBER_STATES has no duplicates', new Set(EU_MEMBER_STATES).size === EU_MEMBER_STATES.length);
t(
  'EU_MEMBER_STATES excludes EEA/non-EU countries that share the startups dataset',
  !EU_MEMBER_STATES.includes('no') && !EU_MEMBER_STATES.includes('is') && !EU_MEMBER_STATES.includes('gb') && !EU_MEMBER_STATES.includes('ch'),
);
t('EU_MEMBER_STATES includes the founding examples used in this file', ['fr', 'de', 'it', 'es', 'pl'].every((cc) => EU_MEMBER_STATES.includes(cc)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
