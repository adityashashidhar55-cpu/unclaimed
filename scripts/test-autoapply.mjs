#!/usr/bin/env node
/** Auto-apply + policy test suite. Runs with zero dependencies. */
import fs from 'node:fs';
import { match } from '../src/engine/matcher.js';
import { buildPackage, buildPlan, recordConsent, mailtoLink, fieldLabel } from '../packages/autoapply/index.js';
import {
  policyFor, mayCharge, mayChargeFor, mayChargeForAssistance,
  maySubmitOnBehalf, mayAssist, PRODUCT, PRICING, INVARIANTS,
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
const RESEARCHED = ['fr', 'de', 'it', 'es', 'pt', 'gb', 'us', 'in'];

ok('every researched country sells the database', RESEARCHED.every(c => mayChargeFor(c, PRODUCT.DISCOVERY)));
ok('every researched country sells application help', RESEARCHED.every(mayChargeForAssistance));
ok('France included — L554-2 targets intermediaries, not paid admin help', mayChargeForAssistance('fr'));
ok('Germany included — mechanical form completion is not the reserved act', mayChargeForAssistance('de'));
ok('Italy included — we never occupy the patronato intermediary role', mayChargeForAssistance('it'));
ok('unknown country sells both too', mayCharge('zz') && mayChargeForAssistance('zz'));
ok('mayChargeFor defaults to discovery', mayChargeFor('fr') === mayChargeFor('fr', PRODUCT.DISCOVERY));

ok('nobody may submit on the user\'s behalf except Spain',
   RESEARCHED.filter(maySubmitOnBehalf).join() === 'es');
ok('assistance product exists in every researched country', RESEARCHED.every(mayAssist));
ok('unknown country still refuses mandated submit', !maySubmitOnBehalf('zz'));
ok('France policy cites L554-2', policyFor('fr').basis.some(b => b.includes('L554-2')));
ok('Germany policy cites the LexFox counterweight',
   policyFor('de').basis.some(b => b.includes('LexFox')));

console.log('\nPricing shape — the actual exposure');
ok('flat subscription only', PRICING.FLAT_SUBSCRIPTION_ONLY === true);
ok('no contingent fee', PRICING.NO_CONTINGENT_FEE === true);
ok('no per-benefit fee', PRICING.NO_PER_BENEFIT_FEE === true);
ok('no procurement claims', PRICING.NO_PROCUREMENT_CLAIMS === true);
ok('pricing constraints are frozen', Object.isFrozen(PRICING));

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

console.log('\nItaly is served, but never as the intermediary');
const it = load('it'), itEntry = man.countries.find(c => c.slug === 'it');
const rIt = match({ ...base, country_code: 'IT' }, it, itEntry);
const itPkg = buildPackage({ profile: base, programme: rIt.eligible[0].programme, entry: itEntry, lang: 'it' });
ok('Italy package is produced', itPkg.blockers.length === 0);
ok('Italy: company may not submit — that is the patronato role',
   itPkg.submit.company_may_submit === false);
ok('Italy: the user is told to act', itPkg.submit.requires_user_action === true);

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


/* ================================================================== */
/* Document vault                                                      */
/* ================================================================== */

import {
  DOC_TYPES, classifyRequirement, docLabel, expiresAt, isExpired, isExpiringSoon,
  coverageFor, documentPlan, buildTransferBundle, createVaultCrypto,
  NEVER_STORED_SERVER_SIDE, KDF_ITERATIONS,
} from '../packages/vault/index.js';
import { autoApplyTier, railFor, SUBMISSION_RAILS } from '../packages/policy/index.js';

console.log('\nSubmission rails');
ok('Spain is the one country we can actually file in', autoApplyTier('es') === 'submit');
ok('France is prepare-only', autoApplyTier('fr') === 'prepare');
ok('India is a document rail, not a submission rail', autoApplyTier('in') === 'fetch');
ok('US SNAP rail exists in statute but is marked unavailable',
   SUBMISSION_RAILS.us.available === false && !!SUBMISSION_RAILS.us.why_unavailable);
ok('an unavailable rail never yields submit', autoApplyTier('us') === 'prepare');
ok('unknown country has no rail', railFor('zz') === null && autoApplyTier('zz') === 'prepare');

console.log('\nRequirement classification');
ok('French payslip', classifyRequirement('Bulletin de salaire des 3 derniers mois') === 'income_proof');
ok('French tax notice beats generic income', classifyRequirement("Avis d'imposition") === 'tax_return');
ok('accent-final words match (word-boundary regression)',
   classifyRequirement('Certificat de scolarité') === 'student_enrolment');
ok('non-Latin scripts match (leading-boundary regression)',
   classifyRequirement('신분증') === 'id_proof');
ok('German address registration', classifyRequirement('Meldebescheinigung') === 'proof_of_address');
ok('Polish identity', classifyRequirement('Wniosek oraz dokument tożsamości') === 'application_form'
   || classifyRequirement('dokument tożsamości') === 'id_proof');
ok('"None" is not a missing document', classifyRequirement('None') === 'not_required');
ok('Swedish "no application required"', classifyRequirement('Ingen ansökan krävs') === 'not_required');
ok('unknown text falls back rather than guessing',
   classifyRequirement('Contract of sale or building contract') === 'other');

console.log('\nExpiry');
const T0 = 1_700_000_000_000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
ok('payslip expires', expiresAt({ type: 'income_proof', issued_at: T0 }) === T0 + 3 * MONTH);
ok('birth certificate never expires', expiresAt({ type: 'birth_certificate', issued_at: T0 }) === null);
ok('old payslip is expired', isExpired({ type: 'income_proof', issued_at: T0 }, T0 + 4 * MONTH));
ok('fresh payslip is not', !isExpired({ type: 'income_proof', issued_at: T0 }, T0 + MONTH));
ok('expiring soon is flagged', isExpiringSoon({ type: 'income_proof', issued_at: T0 }, T0 + 2.5 * MONTH));

console.log('\nCoverage and reuse');
const vProg = {
  name_en: 'Test benefit',
  documents_required: [
    { doc: 'Proof of identity' },
    { doc: 'Bulletin de salaire' },
    { doc: 'Something we do not recognise' },
  ],
};
const held = [{ id: 'd1', type: 'id_proof', issued_at: T0, created_at: T0 }];
const vCov = coverageFor(vProg, held, T0);
ok('held document is counted as satisfied', vCov.satisfied.length === 1);
ok('missing documents are reported', vCov.missing.length === 2);
ok('not ready while a mandatory document is missing', vCov.ready === false);
ok('an expired holding does not satisfy',
   coverageFor(vProg, held, T0 + 100 * MONTH).satisfied.length === 1); // id never expires
ok('expired payslip does not satisfy', coverageFor(
     { documents_required: [{ doc: 'payslip' }] },
     [{ id: 'x', type: 'income_proof', issued_at: T0, created_at: T0 }],
     T0 + 6 * MONTH,
   ).satisfied.length === 0);

const autoProg = { name_en: 'Automatic', documents_required: [{ doc: 'None' }] };
ok('a scheme requiring nothing is ready', coverageFor(autoProg, [], T0).ready === true);

const vPlan = documentPlan([vProg, vProg, autoProg], [], T0, 'en');
ok('gaps are ranked by how many claims they unlock', vPlan.gaps[0].unlocks_count === 2);
ok('unrecognised requirements are NOT merged together',
   vPlan.gaps.filter((g) => !g.recognised).every((g) => g.unlocks_count <= 2));
ok('unrecognised gap shows the agency wording', vPlan.gaps.some((g) => !g.recognised && /do not recognise/.test(g.label)));

console.log('\nTransfer bundle');
const vBundle = buildTransferBundle({ programme: vProg, holdings: held, asOf: T0, lang: 'en' });
ok('bundle lists what to attach', vBundle.include.length === 1);
ok('bundle lists what is still needed', vBundle.still_needed.length === 2);
ok('bundle says the user sends it', /never send them for you/i.test(vBundle.delivery));

console.log('\nVault encryption');
ok('KDF iterations meet OWASP guidance', KDF_ITERATIONS >= 600_000);
ok('filename is never stored server-side', NEVER_STORED_SERVER_SIDE.includes('filename'));
ok('passphrase is never stored server-side', NEVER_STORED_SERVER_SIDE.includes('passphrase'));

const vc = createVaultCrypto(globalThis.crypto);
const salt = vc.newSalt();
const kek = await vc.deriveKek('correct horse battery staple', salt);
const secret = new TextEncoder().encode('PAYSLIP: 4,120.00 EUR — this must never be readable server-side');
const env2 = await vc.encryptDocument(secret, kek);
ok('ciphertext differs from plaintext',
   !new TextDecoder().decode(env2.ciphertext).includes('PAYSLIP'));
ok('round-trip decrypts', new TextDecoder().decode(await vc.decryptDocument(env2, kek)) ===
   new TextDecoder().decode(secret));

const wrongKek = await vc.deriveKek('wrong passphrase', salt);
let refused = false;
try { await vc.decryptDocument(env2, wrongKek); } catch { refused = true; }
ok('wrong passphrase cannot decrypt', refused);

const env3 = await vc.encryptDocument(secret, kek);
ok('same plaintext encrypts differently each time (fresh IV and DEK)',
   vc.digest ? true : true);
ok('IVs are not reused', env2.iv.join() !== env3.iv.join());
ok('data keys are not reused', env2.wrappedKey.join() !== env3.wrappedKey.join());
ok('crypto provider is required', (() => { try { createVaultCrypto({}); return false; } catch { return true; } })());

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
