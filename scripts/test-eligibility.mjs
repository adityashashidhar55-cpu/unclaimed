/* The matcher's honesty, asserted against the records that were wrong.
 *
 * A reader on EUR 60,000 a year was shown a half-price Paris travel pass
 * reserved for people on subsistence benefits, a disabled parking permit they
 * had never asked about, a labour-dispute service that is not money, and free
 * university tuition reserved for citizens of a country they were visiting.
 * None of those were ranking nuisances. Each was the product saying "you can
 * claim this" about something the reader cannot claim.
 *
 * Every one had the same shape: the real rule was written in prose, and the
 * matcher only read structured fields. These tests pin the four gates that
 * closed that gap, and — just as important — pin the fact that declaring the
 * condition gives the entitlement back. A gate that only ever subtracts would
 * be a different kind of wrong answer.
 */
import fs from 'node:fs';
import {
  match, passportedFrom, isStatutoryRight, isCitizensOnly, isHardshipAid, CIRCUMSTANCES,
  isStale, STALE_AFTER_DAYS,
} from '../src/engine/matcher.js';

let pass = 0, fail = 0;
const t = (name, ok) => { ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };

const ROOT = new URL('..', import.meta.url);
const man = JSON.parse(fs.readFileSync(new URL('data/manifest.json', ROOT), 'utf8'));
const load = (cc) => JSON.parse(fs.readFileSync(new URL(`data/${cc}.json`, ROOT), 'utf8'));
const entryFor = (cc) => man.countries.find((c) => c.slug === cc);
const find = (r, re) => {
  for (const b of ['eligible', 'conditional', 'needs_one_more_answer', 'not_eligible', 'tapered', 'rights']) {
    const m = (r[b] || []).find((x) => re.test(x.programme.name_en));
    if (m) return { bucket: b, m };
  }
  return { bucket: 'MISSING', m: null };
};

const EARNER = (cc, o = {}) => ({
  country_code: cc.toUpperCase(), admin_area: null, status: 'employee', age: 40,
  income_band: null, income_annual: 60000, household_size: 1, children_count: 0,
  housing_tenure: 'renting', nationality_group: 'citizen_or_pr', residency_months: 120,
  circumstances: [], ...o,
});

/* ---- the circumstance regexes, which had silenced themselves ------------ */
{
  /* Every alternative in these is a stem, and they used to end in \b — so
     `disab` could not match "disability" and `bereave` could not match
     "Bereavement". The disability tag matched almost nothing, which is why a
     disabled parking permit was offered to someone who never mentioned one. */
  const re = (id) => CIRCUMSTANCES.find((c) => c.id === id).re;
  t('"disability" is matched by the disability tag', re('disability').test('Disability Living Allowance'));
  t('"Bereavement" is matched by the bereavement tag', re('bereavement').test('Bereavement Support Payment'));
  t('a Blue Badge is recognised as disability-gated', re('disability').test('Blue Badge parking scheme'));
  t('"people of determination" is recognised too', re('disability').test('People of Determination Card (Federal)'));
  t('no circumstance regex ends in a word boundary again',
    CIRCUMSTANCES.every((c) => !/\)\\b\/$/.test(String(c.re).replace(/i$/, ''))));
}

/* ---- passporting: "you must already receive X" -------------------------- */
{
  const fr = load('fr'), r = match(EARNER('fr', { admin_area: 'Île-de-France' }), fr, entryFor('fr'));
  const navigo = find(r, /Navigo 50/);
  t('the half-price Navigo fare is no longer a straight match for a EUR60k earner', navigo.bucket !== 'eligible');
  t('and it says which benefit it hangs off', /already receive/.test(navigo.m?.condition_label || ''));

  const gb = load('gb'), g = match(EARNER('gb'), gb, entryFor('gb'));
  for (const [label, re] of [['BT Home Essentials', /BT Home Essentials/], ['Virgin Media', /Virgin Media Essential/]]) {
    const hit = find(g, re);
    t(`${label} is conditional, not eligible`, hit.bucket === 'conditional' || hit.bucket === 'MISSING');
  }

  /* The gate must not fire on the benefit that IS the named benefit. */
  const uc = gb.programmes.find((p) => /^Universal Credit/.test(p.name_en));
  t('Universal Credit is not passported from Universal Credit', uc && passportedFrom(uc) === null);
}

/* ---- and the entitlement comes back when you say the condition applies --- */
{
  const gb = load('gb'), e = entryFor('gb');
  const poor = { ...EARNER('gb'), status: 'unemployed', income_annual: 9000, admin_area: 'England' };
  const before = match({ ...poor, circumstances: [] }, gb, e);
  const after = match({ ...poor, circumstances: ['on_benefits'] }, gb, e);
  t('declaring an income-related benefit unlocks more, not less', after.eligible.length > before.eligible.length);
  t('and the total goes up with it', after.total_max > before.total_max);
  t('there is a declarable circumstance for it', CIRCUMSTANCES.some((c) => c.id === 'on_benefits'));
}

/* ---- statutory rights are not claimable money --------------------------- */
{
  const ae = load('ae'), r = match(EARNER('ae', { nationality_group: 'other_legal' }), ae, entryFor('ae'));
  for (const re of [/Labour Claims/, /Statutory Annual Leave/, /Wage Protection System/]) {
    const hit = find(r, re);
    t(`${re.source} is not offered as something to claim`, hit.bucket !== 'eligible');
  }
  t('rights are kept in their own bucket rather than deleted', Array.isArray(r.rights));
  t('and never counted in the total', r.rights.every((m) => !r.eligible.includes(m)));

  const leave = ae.programmes.find((p) => /Statutory Annual Leave/.test(p.name_en));
  t('a statutory right is identified as one', leave && isStatutoryRight(leave) === true);
}

/* ---- citizens-only, said in the title ----------------------------------- */
{
  const ae = load('ae'), e = entryFor('ae');
  const expat = match(EARNER('ae', { nationality_group: 'other_legal' }), ae, e);
  const citizen = match(EARNER('ae', { nationality_group: 'citizen_or_pr' }), ae, e);
  const uni = /Free Public School and Federal University Education/;
  t('an expatriate is not offered tuition reserved for nationals', find(expat, uni).bucket === 'not_eligible');
  t('and a national still is', find(citizen, uni).bucket !== 'not_eligible');

  const p = ae.programmes.find((x) => uni.test(x.name_en));
  t('the rule is read off the title when the field is silent', p && isCitizensOnly(p) === true);
}

/* ---- discretionary hardship aid ----------------------------------------- */
{
  const ae = load('ae'), r = match(EARNER('ae', { nationality_group: 'other_legal' }), ae, entryFor('ae'));
  const rc = find(r, /Red Crescent/);
  t('a charity hardship fund is not presented as an entitlement', rc.bucket !== 'eligible');
  const p = ae.programmes.find((x) => /Red Crescent/.test(x.name_en));
  t('and it is identified as caseworker-assessed', p && isHardshipAid(p) === true);
}

/* ---- a parent with a job is still a parent ------------------------------ */
{
  const gb = load('gb'), e = entryFor('gb');
  const workingParent = { ...EARNER('gb'), children_count: 2, income_annual: 30000, admin_area: 'England' };
  const cb = find(match(workingParent, gb, e), /^Child Benefit/);
  t('an employed parent does not fail Child Benefit on "this is for parents"',
    !(cb.m?.rules_failed || []).some((x) => /for parents/i.test(x)));
  const none = find(match({ ...workingParent, children_count: 0 }, gb, e), /^Child Benefit/);
  t('and someone with no children still does not get it', none.bucket === 'not_eligible');
}

/* ---- the gates survive the paywall strip -------------------------------- */
{
  /* Every one of these reads a name, a funder or a source snippet — fields the
     public dataset removes. If they are not precomputed at build time, a
     locked record silently loses its condition and comes back as a match. */
  const build = fs.readFileSync(new URL('src/build.mjs', ROOT), 'utf8');
  for (const flag of ['passported', 'statutory_right', 'citizens_only', 'hardship_aid']) {
    t(`${flag} is precomputed into the public dataset`, new RegExp(`${flag}: `).test(build));
  }
  const src = fs.readFileSync(new URL('src/engine/matcher.js', ROOT), 'utf8');
  for (const flag of ['passported', 'statutory_right', 'citizens_only', 'hardship_aid']) {
    t(`and the matcher reads derived.${flag} rather than the stripped prose`,
      new RegExp(`derived\\?\\.${flag}`).test(src));
  }
}

/* ---- the whole point: no bucket claims more than it knows ---------------- */
{
  let unconditioned = 0, checked = 0;
  for (const c of man.countries) {
    const d = load(c.slug);
    const r = match(EARNER(c.slug), d, entryFor(c.slug));
    checked += 1;
    for (const m of r.eligible) {
      const p = m.programme;
      if (passportedFrom(p) || isStatutoryRight(p) || isHardshipAid(p)) unconditioned += 1;
    }
  }
  t(`no gated record reaches the eligible bucket in any of ${checked} countries (found ${unconditioned})`, unconditioned === 0);
}

/* ------------------------------------------------------------------ *
 * The breakdown on the results screen must account for everything.
 *
 * The screen says "MATCHED AGAINST 114 PROGRAMMES" over "8 eligible · 0 need
 * one more answer · 41 depend on a circumstance · 64 ruled out" — which is
 * 113. The missing record was the taper bucket, omitted from the sentence and
 * shown separately two lines down as "1 at a reduced amount". Personas with no
 * taper matches summed to exactly 114, which is why it read as correct.
 *
 * Asserted on the matcher's own buckets rather than on the rendered string:
 * the render can only be right if the partition is total, and a partition is
 * a property of the engine.
 * ------------------------------------------------------------------ */
{
  const manifest = JSON.parse(fs.readFileSync(new URL('data/manifest.json', ROOT), 'utf8'));
  const PERSONAS = [
    { label: 'employed, one child, renting', status: 'employee', age: 34, income_annual: 22000, household_size: 3, children_count: 1, housing_tenure: 'renting' },
    { label: 'retired owner', status: 'retired', age: 72, income_annual: 14000, household_size: 2, children_count: 0, housing_tenure: 'owner' },
    { label: 'student', status: 'student', age: 21, income_annual: 4000, household_size: 1, children_count: 0, housing_tenure: 'student_housing' },
    { label: 'out of work, low income', status: 'unemployed', age: 45, income_annual: 6000, household_size: 4, children_count: 2, housing_tenure: 'renting' },
    { label: 'high earner', status: 'employee', age: 41, income_annual: 185000, household_size: 4, children_count: 2, housing_tenure: 'owner' },
    { label: 'self-employed', status: 'self_employed', age: 38, income_annual: 31000, household_size: 2, children_count: 0, housing_tenure: 'renting' },
    { label: 'everything skipped', status: null, age: null, income_annual: null, household_size: 1, children_count: 0, housing_tenure: null },
    { label: 'resident on a permit', status: 'employee', age: 29, income_annual: 18000, household_size: 1, children_count: 0, housing_tenure: 'renting', nationality_group: 'any_resident' },
  ];

  let pairs = 0;
  let short = 0;
  let first = '';
  for (const entry of manifest.countries) {
    const data = JSON.parse(fs.readFileSync(new URL(`data/${entry.slug}.json`, ROOT), 'utf8'));
    for (const persona of PERSONAS) {
      const r = match(
        { nationality_group: 'citizen_or_pr', circumstances: [], admin_area: null, ...persona, country_code: entry.country_code },
        data,
        entry,
      );
      pairs += 1;
      const parts =
        r.eligible.length + (r.tapered || []).length + (r.rights || []).length +
        r.conditional.length + r.needs_one_more_answer.length + r.not_eligible.length;
      if (parts !== data.programmes.length) {
        short += 1;
        if (!first) first = `${entry.slug} / ${persona.label}: parts sum to ${parts}, matched against ${data.programmes.length}`;
      }
    }
  }
  t(
    `the breakdown accounts for every programme across ${pairs} country/persona pairs${short ? ` (first gap: ${first})` : ''}`,
    short === 0,
  );
}

/* ---- gender: a dead field that was silently passing ---------------- *
 *
 * eligibility.gender was populated on 1,235 of 2,216 records and read by no
 * code at all — the matcher, the build, both wizards and every pwa module all
 * returned 0 for `grep -c gender`. Four sex-restricted programmes reached the
 * eligible bucket for male-plausible profiles, and six Indian cash schemes
 * were offered to a male profile at up to INR 30,000/yr on pages that
 * themselves say "pays ₹2,500 a month to eligible women heads of households".
 *
 * The wizard asks no gender question yet, by design, so the profile is silent
 * and the correct outcome is "needs one more answer". The one outcome that
 * must never come back is a silent pass.
 */
{
  const man2 = JSON.parse(fs.readFileSync(new URL('data/manifest.json', ROOT), 'utf8'));
  const leaked = [];
  for (const entry of man2.countries) {
    const data = JSON.parse(fs.readFileSync(new URL(`data/${entry.slug}.json`, ROOT), 'utf8'));
    for (const age of [25, 35, 45, 60]) {
      const r = match(
        {
          country_code: entry.country_code, admin_area: null, status: 'employee', age,
          income_band: null, income_annual: null, household_size: 1, children_count: 0,
          housing_tenure: 'renting', nationality_group: 'citizen_or_pr', residency_months: 600,
          circumstances: [],
        },
        data, entry,
      );
      for (const m of r.eligible) {
        if (m.programme.eligibility?.gender === 'female') leaked.push(`${entry.slug}/${m.programme.slug} at ${age}`);
      }
      /* Same profile, same records, with the answer given: the gate has to
         subtract AND give back, or it is just a different wrong answer. */
      const withAnswer = match(
        {
          country_code: entry.country_code, admin_area: null, status: 'employee', age,
          income_band: null, income_annual: null, household_size: 1, children_count: 0,
          housing_tenure: 'renting', nationality_group: 'citizen_or_pr', residency_months: 600,
          circumstances: [], gender: 'female',
        },
        data, entry,
      );
      if (entry.slug === 'in' && age === 35) {
        t('declaring female gives the women-only schemes back',
          withAnswer.eligible.some((m) => m.programme.eligibility?.gender === 'female'));
      }
    }
  }
  t(`no women-only record reaches the eligible bucket for a profile that never said so (${man2.countries.length} countries × 4 ages)`,
    leaked.length === 0, leaked.slice(0, 6).join(', '));

  /* And the data half: the field is REQUIRED by docs/data-spec.md. */
  const absent = [];
  const FEMALE_NAME = /women|mothers?|maternity|pregnan|breast ?(cancer|screening)|cervical|femminile|mujeres|frauen/i;
  /* Reviewed and deliberately left `any`: each of these has a route open to
     anyone in its own prose, so restricting it would reject real claimants.
     Checked one by one against source_snippet, not pattern-matched. */
  const REVIEWED_ANY = new Set([
    'ei-maternity-parental-benefits',   // parental half is open to either parent
    'erstausstattung-sgb2',             // household and clothing grants, pregnancy is one trigger
    'stand-up-india',                   // SC/ST *or* women entrepreneurs
    'on-nuove-imprese-tasso-zero',      // youth-led *or* women-led
    'incapacidad-temporal-imss',        // sickness *and* maternity
    'kraamzorg-vergoeding',             // "everyone with Dutch basic health insurance"
    'swiadczenie-rodzicielskie-kosiniakowe', // "osobom" — persons without maternity allowance
    'zasilek-macierzynski',             // maternity *and* parental leave
    'za-zyciem-opieka-medyczna',        // pregnant women *and* children
    'szczepienia-grypa-bezplatne',      // children, 65+, *and* pregnant women
    'wic-women-infants-children',       // women, infants *and* children under 5
  ]);
  const stillAny = [];
  for (const entry of man2.countries) {
    const data = JSON.parse(fs.readFileSync(new URL(`data/${entry.slug}.json`, ROOT), 'utf8'));
    for (const p of data.programmes) {
      if (p.eligibility?.gender == null) absent.push(`${entry.slug}/${p.slug}`);
      else if (FEMALE_NAME.test(p.name_en || '') && p.eligibility.gender === 'any' && !REVIEWED_ANY.has(p.slug)) {
        stillAny.push(`${entry.slug}/${p.slug}`);
      }
    }
  }
  t('every record carries eligibility.gender', absent.length === 0, `${absent.length} absent, e.g. ${absent.slice(0, 4).join(', ')}`);
  t('no unreviewed women-only-by-name record is still marked "any"', stillAny.length === 0, stillAny.slice(0, 8).join(', '));
}

/* ---- staleness: a field that could never mean anything ------------- *
 *
 * All 2,216 records carry the identical last_verified_at 2026-08-12, so
 * `if (verification_status === 'stale') continue` was unreachable and no
 * record could ever age out. The rule now derives staleness from the date at a
 * named threshold — and produces a caveat, never a drop, because deleting real
 * money from a real answer on the strength of a constant date is worse than
 * showing it.
 */
{
  const day = 86400000;
  const now = Date.parse('2026-08-20T00:00:00Z');
  const dated = (days) => ({ last_verified_at: new Date(now - days * day).toISOString().slice(0, 10) });
  t(`isStale fires at ${STALE_AFTER_DAYS + 1} days`, isStale(dated(STALE_AFTER_DAYS + 1), now));
  t(`isStale does not fire at ${STALE_AFTER_DAYS - 1} days`, !isStale(dated(STALE_AFTER_DAYS - 1), now));
  t('a record with no date is not called stale', !isStale({ last_verified_at: null }, now));

  /* Behaviour, not just the predicate: a stale record still lands in the
     eligible bucket, carrying a note. */
  const gbEntry = man.countries.find((c) => c.slug === 'gb');
  const gb = load('gb');
  const synthetic = JSON.parse(JSON.stringify(gb));
  for (const p of synthetic.programmes) p.last_verified_at = new Date(now - (STALE_AFTER_DAYS + 30) * day).toISOString().slice(0, 10);
  const fresh = match(EARNER('gb'), gb, gbEntry, now);
  const old = match(EARNER('gb'), synthetic, gbEntry, now);
  t('going stale does not drop a single programme from the eligible bucket',
    old.eligible.length === fresh.eligible.length, `${old.eligible.length} vs ${fresh.eligible.length}`);
  t('going stale does not change the total',
    old.total_max === fresh.total_max, `${old.total_max} vs ${fresh.total_max}`);
  t('a stale match carries a note the screen can print',
    old.eligible.length === 0 || old.eligible.every((m) => typeof m.stale_note === 'string' && m.stale_note.length > 0));
  t('a fresh match carries no stale note', fresh.eligible.every((m) => !m.stale_note));
}

/* ---- one_off money never enters a per-year total ------------------- *
 * Full coverage lives in scripts/test-amounts.mjs; this is the persona the
 * bug was reported against, kept here because this is the file anyone reads
 * when a total looks wrong.
 */
{
  const sg = load('sg');
  const entry = entryFor('sg');
  const r = match(
    {
      country_code: 'SG', admin_area: null, status: 'retired', age: 72, income_band: 'b2',
      income_annual: null, household_size: 2, children_count: 0, housing_tenure: 'owner',
      nationality_group: 'citizen_or_pr', residency_months: 600, circumstances: [],
    },
    sg, entry,
  );
  const oneOffInTotal = r.eligible
    .filter((m) => !m.is_capital && m.programme.amount_period === 'one_off')
    .reduce((n, m) => n + (m.est_annual_max ?? 0), 0);
  t('the SG retiree has one-off grants at all', oneOffInTotal > 0, `${oneOffInTotal}`);
  t('none of that one-off money is inside the per-year total',
    r.total_max + oneOffInTotal === r.total_max + r.one_off_max && r.one_off_max === oneOffInTotal,
    `per-year ${r.total_max}, one-off ${r.one_off_max}, expected one-off ${oneOffInTotal}`);
}

/* ---- the no-match screen must not claim you qualify ---------------- */
{
  const sg = load('sg');
  const r = match(
    {
      country_code: 'SG', admin_area: null, status: 'employee', age: 28, income_band: 'b5',
      income_annual: null, household_size: 1, children_count: 0, housing_tenure: 'hosted',
      nationality_group: 'any_resident', residency_months: 6, circumstances: [],
    },
    sg, entryFor('sg'),
  );
  t('the Singapore migrant persona matches nothing', r.eligible.length === 0, `${r.eligible.length} eligible`);
  t('with nothing eligible the disclaimer drops "You appear to meet the published criteria"',
    !/appear to meet/.test(r.disclaimer), r.disclaimer);
  const some = match(EARNER('gb'), load('gb'), entryFor('gb'));
  t('with something eligible the clause is back',
    some.eligible.length === 0 || /appear to meet/.test(some.disclaimer));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
