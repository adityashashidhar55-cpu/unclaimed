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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
