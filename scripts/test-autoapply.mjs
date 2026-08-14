#!/usr/bin/env node
/** Auto-apply + policy test suite. Runs with zero dependencies. */
import fs from 'node:fs';
import { match } from '../src/engine/matcher.js';
import { buildPackage, buildPlan, recordConsent, mailtoLink, fieldLabel } from '../packages/autoapply/index.js';
import {
  policyFor, mayCharge, mayChargeFor, mayChargeForAssistance,
  maySubmitOnBehalf, mayAssist, PRODUCT, INVARIANTS,
} from '../packages/policy/index.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

const man = JSON.parse(fs.readFileSync(new URL('../data/manifest.json', import.meta.url)));
const load = (cc) => JSON.parse(fs.readFileSync(new URL(`../data/${cc}.json`, import.meta.url)));

const base = {
  id: 'u_test', given_name: 'Alex', family_name: 'Martin', date_of_birth: '1992-04-11',
  email: 'a@example.com', address_line1: '12 Rue des Lilas', address_postcode: '75011',
  address_city: 'Paris', status: 'employee', age: 34, income_annual: 22000,
  household_size: 3, children_count: 2, housing_tenure: 'renting',
  nationality_group: 'citizen_or_pr', residency_months: 120, income_band: null,
  admin_area: null, circumstances: [],
};

console.log('\nJurisdiction policy');
ok('France: the database and calculator ARE sellable', mayChargeFor('fr', PRODUCT.DISCOVERY));
ok('France: preparing the claim for a fee is not (L554-2)', !mayChargeForAssistance('fr'));
ok('Germany: discovery sellable after LexFox', mayChargeFor('de', PRODUCT.DISCOVERY));
ok('Germany: paid assistance withheld pending counsel (RDG)', !mayChargeForAssistance('de'));
ok('Italy: discovery sellable — 152/2001 reserves the intermediary, not publishing',
   mayChargeFor('it', PRODUCT.DISCOVERY));
ok('Italy: assistance refused entirely (patronato)', !mayAssist('it') && !mayChargeForAssistance('it'));
ok('Spain: both products sellable, mandated submit permitted',
   mayChargeForAssistance('es') && maySubmitOnBehalf('es'));
ok('UK: both sellable, submit not', mayChargeForAssistance('gb') && !maySubmitOnBehalf('gb'));
ok('Subscription is sellable in every researched country',
   ['fr','de','it','es','pt','gb','us','in'].every(mayCharge));
ok('Unknown country falls back to cautious default', !maySubmitOnBehalf('zz') && mayAssist('zz'));
ok('France policy cites L554-2', policyFor('fr').basis.some(b => b.includes('L554-2')));
ok('Germany policy cites the LexFox counterweight',
   policyFor('de').basis.some(b => b.includes('LexFox')));
ok('mayChargeFor defaults to discovery', mayChargeFor('fr') === mayChargeFor('fr', PRODUCT.DISCOVERY));

console.log('\nInvariants');
ok('never holds government credentials', INVARIANTS.NEVER_HOLD_GOV_CREDENTIALS === true);
ok('consent required per submission', INVARIANTS.EXPLICIT_CONSENT_PER_SUBMISSION === true);
ok('halts on agency objection', INVARIANTS.HALT_ON_AGENCY_OBJECTION === true);

console.log('\nPackage building');
const fr = load('fr'), frEntry = man.countries.find(c => c.slug === 'fr');
const rFr = match({ ...base, country_code: 'FR' }, fr, frEntry);
const prog = rFr.eligible[0].programme;
const pkg = buildPackage({ profile: base, programme: prog, entry: frEntry, lang: 'fr' });

ok('package names the programme', pkg.programme_slug === prog.slug);
ok('company may NOT submit in France', pkg.submit.company_may_submit === false);
ok('user action always required in France', pkg.submit.requires_user_action === true);
ok('drafted message is in French', /Madame, Monsieur/.test(pkg.message.body));
ok('field labels are localised', /Prénom|Nom/.test(pkg.message.body) && !/Surname/.test(pkg.message.body));
ok('attestations are present and in French', pkg.attestations.length >= 3 && /sur l'honneur/.test(pkg.attestations[0]));
ok('attestation disclaims agency', pkg.attestations.some(a => /mandataire/.test(a)));
ok('source is carried through', !!pkg.source.url && !!pkg.source.last_verified_at);
ok('readiness is computed', typeof pkg.readiness.fields_pct === 'number');
ok('missing fields are reported, not invented', Array.isArray(pkg.fields_missing));

const missingKeys = pkg.fields_missing;
ok('no missing field is silently filled', missingKeys.every(k => !pkg.fields[k]));

console.log('\nItaly is blocked, not silently served');
const it = load('it'), itEntry = man.countries.find(c => c.slug === 'it');
const rIt = match({ ...base, country_code: 'IT' }, it, itEntry);
const itPkg = buildPackage({ profile: base, programme: rIt.eligible[0].programme, entry: itEntry, lang: 'it' });
ok('Italy package carries a blocker', itPkg.blockers.length > 0);
ok('blocker explains the reservation', /reserved/i.test(itPkg.blockers[0].message));

console.log('\nSpain permits mandated submit');
const es = load('es'), esEntry = man.countries.find(c => c.slug === 'es');
const rEs = match({ ...base, country_code: 'ES' }, es, esEntry);
const esPkg = buildPackage({ profile: base, programme: rEs.eligible[0].programme, entry: esEntry, lang: 'es' });
ok('Spain allows company submit', esPkg.submit.company_may_submit === true);
ok('Spain package is unblocked', esPkg.blockers.length === 0);

console.log('\nClaim plan');
const plan = buildPlan({ profile: base, matches: rFr.eligible, entry: frEntry, lang: 'fr' });
ok('plan excludes automatic programmes', plan.packages.every(p => !p.match.programme.is_automatic));
ok('gaps are consolidated across applications', plan.gaps.length > 0 && plan.gaps[0].unlocks.length >= 1);
ok('gaps are ordered by how much they unlock',
   plan.gaps.every((g, i) => i === 0 || plan.gaps[i - 1].unlocks.length >= g.unlocks.length));
ok('ready packages sort first',
   plan.packages.every((p, i) => i === 0 || !(p.pkg.readiness.ready && !plan.packages[i - 1].pkg.readiness.ready)));

console.log('\nConsent ledger');
const c = recordConsent({ userId: 'u_1', programmeSlug: prog.slug, attestations: pkg.attestations, values: pkg.fields, at: 1_760_000_000_000 });
ok('stores the verbatim text shown', JSON.stringify(c.attested_text) === JSON.stringify(pkg.attestations));
ok('stores a digest, not a copy of personal data', typeof c.values_digest === 'string' && !JSON.stringify(c).includes('Rue des Lilas'));
ok('scope is single submission, never blanket', c.scope === 'single_submission');
const c2 = recordConsent({ userId: 'u_1', programmeSlug: prog.slug, attestations: pkg.attestations, values: { ...pkg.fields, income_annual: 99999 }, at: 1 });
ok('digest changes when values change', c.values_digest !== c2.values_digest);

console.log('\nExports');
ok('mailto link is well formed', mailtoLink(pkg, 'x@y.z').startsWith('mailto:x%40y.z?subject='));
ok('field labels fall back to English', fieldLabel('given_name', 'zz') === 'First name(s)');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
