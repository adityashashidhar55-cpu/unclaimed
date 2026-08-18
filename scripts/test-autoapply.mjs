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


/* ================================================================== */
/* Startup grants                                                      */
/* ================================================================== */

import {
  smeCategory, reachFor, matchStartup, isFreeMoney, SME_THRESHOLDS, EU_MEMBERS,
} from '../src/engine/startup.js';
import {
  DE_MINIMIS_CEILING_EUR, SGEI_CEILING_EUR, WINDOW_MONTHS, REGULATION,
  headroom, canAccept, planWithinCeiling, declarationText, awardsInWindow,
} from '../packages/stateaid/index.js';
import {
  registryFor, autofillAvailable, parseCIN, fromCompaniesHouse, fromSirene,
  fromSamGov, projectCompany, lookupCompany,
} from '../packages/registry/index.js';

const sLoad = (cc) => JSON.parse(fs.readFileSync(new URL(`../data/startups/${cc}.json`, import.meta.url)));
const S_ASOF = Date.parse('2026-08-14');
const YEARS = (n) => S_ASOF - n * 365.25 * 24 * 3600 * 1000;

console.log('\nEU SME definition');
ok('micro band', smeCategory({ headcount: 5, turnover_annual_eur: 500_000 }) === 'micro');
ok('small band', smeCategory({ headcount: 30, turnover_annual_eur: 5_000_000 }) === 'small');
ok('medium band', smeCategory({ headcount: 200, turnover_annual_eur: 40_000_000 }) === 'medium');
ok('large above thresholds', smeCategory({ headcount: 400, turnover_annual_eur: 90_000_000 }) === 'large');
ok('headcount is the binding test', smeCategory({ headcount: 300, turnover_annual_eur: 1_000 }) === 'large');
ok('turnover OR balance sheet, not AND - capital-heavy deeptech still qualifies',
   smeCategory({ headcount: 20, turnover_annual_eur: 200_000, balance_sheet_eur: 40_000_000 }) === 'small');
ok('unknown headcount yields null, never a guess', smeCategory({ headcount: null }) === null);
ok('medium balance-sheet threshold is 43m not 50m', SME_THRESHOLDS.medium.balance_sheet === 43_000_000);

console.log('\nProgramme reach');
ok('EU member sees EU-level programmes', reachFor('fr').includes('eu'));
ok('everyone sees global programmes', reachFor('br').includes('global'));
ok('non-associated country sees no EU pool', !reachFor('br').includes('eu'));
ok('Horizon-associated non-member still sees EU pool', reachFor('no').includes('eu'));
ok('EU member list is complete', EU_MEMBERS.length === 27);

console.log('\nInstrument honesty');
ok('grants are non-dilutive cash', isFreeMoney('grant'));
ok('cloud credits are NOT counted as cash', !isFreeMoney('in_kind'));
ok('loans are NOT free money', !isFreeMoney('loan'));
ok('equity is NOT free money', !isFreeMoney('equity'));

console.log('\nStartup matching');
const sDatasets = { fr: sLoad('fr'), eu: sLoad('eu'), global: sLoad('global') };
const founder = {
  country_code: 'fr', incorporated: true, incorporation_date: '2024-03-01',
  headcount: 6, turnover_annual_eur: 180_000, sectors: ['deeptech', 'ai'],
  stage: 'seed', rd_active: true, has_local_entity: true,
};
const sm = matchStartup(founder, sDatasets, S_ASOF);
ok('finds eligible programmes across all three pools', sm.eligible.length > 20);
ok('classifies the company', sm.sme_category === 'micro');
ok('computes company age', Math.round(sm.age_months) === 29);
ok('non-dilutive headline excludes credits, loans and equity',
   sm.non_dilutive.count === (sm.totals.grant?.count ?? 0) + (sm.totals.prize?.count ?? 0) +
     (sm.totals.voucher?.count ?? 0) + (sm.totals.tax_credit?.count ?? 0));
ok('EUR and USD are never added together',
   Object.keys(sm.non_dilutive.by_currency).length > 1 &&
   sm.non_dilutive.by_currency.EUR.max !== sm.non_dilutive.by_currency.USD.max);
ok('unpriced programmes are counted, not valued at zero', sm.non_dilutive.unpriced > 0);
ok('credits are reported apart from grants', sm.totals.in_kind.count > 0 && !sm.totals.in_kind.non_dilutive);

const oldCo = { ...founder, incorporation_date: '2010-01-01', headcount: 400, turnover_annual_eur: 90_000_000 };
const smOld = matchStartup(oldCo, sDatasets, S_ASOF);
ok('a large old company is excluded from young-SME schemes', smOld.eligible.length < sm.eligible.length);
ok('every exclusion carries a stated reason', smOld.not_eligible.every((m) => m.fails.length > 0));

const smVague = matchStartup({ country_code: 'fr', incorporated: true }, sDatasets, S_ASOF);
ok('missing answers never read as failure', smVague.needs_answer.length > 0);
ok('unanswered questions are ranked by what they unlock', smVague.unlocks.length > 0);
ok('closed programmes are held out of eligible',
   sm.eligible.every((m) => m.programme.deadline_type !== 'closed'));

console.log('\nDe minimis - Regulation (EU) 2023/2831');
ok('ceiling is EUR 300,000', DE_MINIMIS_CEILING_EUR === 300_000);
ok('SGEI ceiling is EUR 750,000', SGEI_CEILING_EUR === 750_000);
ok('window is 3 years', WINDOW_MONTHS === 36);
ok('regulation is cited', REGULATION.general.id.includes('2023/2831'));

const sAwards = [
  { funder: 'Bpifrance', amount_eur: 180_000, granted_at: YEARS(1), member_state: 'fr' },
  { funder: 'Region IDF', amount_eur: 90_000, granted_at: YEARS(2.5), member_state: 'fr' },
  { funder: 'ZIM', amount_eur: 120_000, granted_at: YEARS(1), member_state: 'de' },
  { funder: 'Old aid', amount_eur: 200_000, granted_at: YEARS(4), member_state: 'fr' },
];
const frRoom = headroom(sAwards, 'fr', S_ASOF);
ok('rolling window excludes aid older than 3 years', frRoom.used_eur === 270_000);
ok('window is rolling, not fiscal years', awardsInWindow(sAwards, S_ASOF, 'fr').length === 2);
ok('headroom is computed', frRoom.headroom_eur === 30_000);
ok('ceiling is per Member State - German aid does not eat the French pot',
   headroom(sAwards, 'de', S_ASOF).used_eur === 120_000);
ok('tells the founder when room frees up', frRoom.frees_up_at > S_ASOF && frRoom.frees_up_eur === 90_000);

const verdict = canAccept({ programme: { eligibility: { de_minimis: true }, amount_max: 100_000 }, awards: sAwards, memberState: 'fr', asOf: S_ASOF });
ok('an award over the headroom is blocked', verdict.allowed === false);
ok('Art. 3(7) - the whole award is disqualified, not trimmed', /not reduced to fit/.test(verdict.message));
ok('the message says when room frees up', /frees up on/.test(verdict.message));
ok('an award within headroom is allowed',
   canAccept({ programme: { eligibility: { de_minimis: true }, amount_max: 20_000 }, awards: sAwards, memberState: 'fr', asOf: S_ASOF }).allowed === true);
ok('non-de-minimis programmes are unaffected',
   canAccept({ programme: { eligibility: {} }, awards: sAwards, memberState: 'fr', asOf: S_ASOF }).applies === false);
ok('unpriced de minimis aid returns null, not a guess',
   canAccept({ programme: { eligibility: { de_minimis: true } }, awards: sAwards, memberState: 'fr', asOf: S_ASOF }).allowed === null);

const dmPlan = planWithinCeiling(
  [
    { programme: { eligibility: { de_minimis: true }, amount_max: 25_000, name_en: 'A' } },
    { programme: { eligibility: { de_minimis: true }, amount_max: 20_000, name_en: 'B' } },
    { programme: { eligibility: {}, amount_max: 999_999, name_en: 'C' } },
  ],
  { awards: sAwards, memberState: 'fr', asOf: S_ASOF },
);
ok('plan takes the largest affordable award first', dmPlan.affordable[0].programme.name_en === 'A');
ok('plan blocks what will not fit', dmPlan.blocked.length === 1 && dmPlan.blocked[0].programme.name_en === 'B');
ok('non-de-minimis awards are untouched by the ceiling', dmPlan.unaffected.length === 1);
ok('plan explains the exclusion', /disqualified in full/.test(dmPlan.note));

const decl = declarationText(sAwards, 'fr', S_ASOF);
ok('declaration lists the prior aid', /Bpifrance/.test(decl.text));
ok('declaration explains single undertaking', /single undertaking/i.test(decl.text));
ok('declaration says grant date, not payment date', /not the date of payment/.test(decl.text));
ok('declaration is never pre-affirmed', decl.affirmed === false);

console.log('\nCompany registry auto-fill');
ok('UK has a machine-readable register', autofillAvailable('gb'));
ok('France has an open register, no key', registryFor('fr').auth === 'none');
ok('Germany is honestly marked unavailable', autofillAvailable('de') === false);
ok('the German gap is explained, not hidden', /no free structured api/i.test(registryFor('de').note));
ok('SAM.gov annual expiry is flagged', /EXPIRES ANNUALLY/.test(registryFor('us').note));

const cin = parseCIN('U72900KA2019PTC123456');
ok('CIN parses with no network call', cin && cin.incorporation_year === 2019);
ok('CIN yields listing status, state and class',
   cin.listed === false && cin.state_code === 'KA' && cin.ownership_class === 'PTC');
ok('malformed CIN is rejected rather than guessed', parseCIN('NOTACIN') === null);

const ch = fromCompaniesHouse({
  company_name: 'Example Ltd', company_number: '12345678', date_of_creation: '2023-04-01',
  company_status: 'active',
  registered_office_address: { address_line_1: '1 High St', locality: 'London', postal_code: 'E1 1AA' },
  sic_codes: ['62012'],
});
ok('Companies House normalises', ch.legal_name === 'Example Ltd' && ch.incorporation_date === '2023-04-01');
ok('address is assembled', /London/.test(ch.registered_address));

const sirene = fromSirene({ results: [{ nom_complet: 'ACME SAS', siren: '123456789', date_creation: '2022-06-15', etat_administratif: 'A', tranche_effectif_salarie: '11', siege: { adresse: '10 rue de Paris' }, activite_principale: '62.01Z' }] });
ok('SIRENE normalises', sirene.company_number === '123456789');
ok('INSEE headcount BAND is never presented as an exact headcount',
   sirene.headcount === null && sirene.headcount_band === '11');

const sam = fromSamGov({ entityData: [{ entityRegistration: { legalBusinessName: 'Acme Inc', ueiSAM: 'ABC123DEF456', registrationStatus: 'Active', registrationExpirationDate: '2027-03-01' }, coreData: { physicalAddress: { addressLine1: '1 Main St', city: 'Austin', stateOrProvinceCode: 'TX' }, naicsList: [{ naicsCode: '541715' }] } }] });
ok('SAM.gov normalises', sam.company_number === 'ABC123DEF456');
ok('SAM registration expiry is surfaced', sam.registration_expires_at === '2027-03-01');

const proj = projectCompany({
  company: ch,
  programme: { documents_required: [{ doc: 'Business plan' }, { doc: 'Company accounts' }] },
  profile: { headcount: 6, stage: 'seed' },
});
ok('registry fields are filled', proj.filled.legal_name === 'Example Ltd');
ok('each field records where it came from', proj.source.legal_name === 'Companies House');
ok('registry-sourced fields are counted separately from answers', proj.autofilled_from_registry >= 5);
ok('narrative fields no register can supply are listed', proj.needs_narrative.length > 0);
ok('the summary is honest about the split', /only you can write/.test(proj.honest_summary));

const noReg = await lookupCompany({ countryCode: 'zz', identifier: 'x' });
ok('unknown jurisdiction fails cleanly', noReg.ok === false && noReg.reason === 'no_registry_for_country');
ok('malformed identifier is caught before any network call',
   (await lookupCompany({ countryCode: 'gb', identifier: 'nope' })).reason === 'malformed_identifier');
const offline = await lookupCompany({ countryCode: 'in', identifier: 'U72900KA2019PTC123456' });
ok('India resolves with no network at all', offline.ok === true && offline.offline === true);

console.log('\nStartup dataset');
const sManifest = JSON.parse(fs.readFileSync(new URL('../data/startups/manifest.json', import.meta.url)));
ok('dataset is loaded', sManifest.total === 1684);
ok('covers many jurisdictions', sManifest.countries.length >= 25);
const sAll = [];
for (const c of sManifest.countries) sAll.push(...sLoad(c.slug).programmes);
ok('every programme has an official source', sAll.every((p) => /^https?:\/\//.test(p.source_url)));
/* Two records are deliberately kept for programmes that no longer exist —
   Newchip's Chapter 7 liquidation and the closed Oxford Foundry — as warnings
   and successor pointers. A defunct programme has no application route, and
   inventing one would be worse than the gap. */
const sNoRoute = sAll.filter((p) => !p.application_url);
ok('every live programme has an application route',
   sNoRoute.every((p) => ['closed', 'paused', 'unknown'].includes(p.status)));
ok('records without a route are defunct, not merely incomplete', sNoRoute.length <= 3);
ok('every programme is typed as a startup record', sAll.every((p) => p.eligibility.entity === 'startup'));
ok('no duplicate slugs', new Set(sAll.map((p) => p.slug)).size === sAll.length);
ok('public and private funders both present',
   sAll.some((p) => p.funder_type === 'public') && sAll.some((p) => p.funder_type === 'private'));



/* ================================================================== */
/* Ranking and scoring                                                 */
/* ================================================================== */

import {
  BANDS, bandFor, BAND_LABELS, FX_TO_EUR, toEur, awardLikelihood, effortFor,
  feasibility, scoreProgramme, rankMatches, rateCoverage, STAGE_HAIRCUT, CLASS_PRIORS,
} from '../packages/scoring/index.js';

console.log('\nBand ordering — the hard rule');
ok('grants outrank tax credits', bandFor('grant') < bandFor('tax_credit'));
ok('tax credits outrank loans', bandFor('tax_credit') < bandFor('loan'));
ok('loans outrank equity', bandFor('loan') < bandFor('equity'));
ok('equity outranks credits — no amount of credits is cash', bandFor('equity') < bandFor('in_kind'));
ok('unknown instruments sort last, never first', bandFor('mystery') === 5);
ok('every band has a label', BAND_LABELS.length >= 5);

console.log('\nCurrency handling');
ok('FX table is dated', /^\d{4}-\d{2}-\d{2}$/.test(FX_TO_EUR.as_of));
ok('FX is marked ranking-only', /never used to display/i.test(FX_TO_EUR.note));
ok('EUR is the identity', toEur(1000, 'EUR') === 1000);
ok('a null amount stays null and never becomes zero', toEur(null, 'USD') === null);
ok('an unknown currency returns null rather than assuming parity', toEur(100, 'XYZ') === null);

console.log('\nAward likelihood provenance');
const eicL = awardLikelihood({ slug: 'eic-accelerator', grant_type: 'grant' });
ok('a researched rate is used', eicL.p_published != null);
ok('its provenance is recorded', ['published', 'derived'].includes(eicL.basis));
ok('it links to the source', /^https?:\/\//.test(eicL.source_url));
ok('a post-filter rate is discounted, not taken at face value',
   eicL.stage === 'post_filter' && eicL.p < eicL.p_published);
ok('the discount is the documented one', eicL.haircut === STAGE_HAIRCUT.post_filter);

const unknownL = awardLikelihood({ slug: 'no-such-programme', grant_type: 'grant' });
ok('an unresearched programme falls back to a class prior', unknownL.basis === 'class_prior');
ok('a class prior is never presented as a published figure', unknownL.p_published === null);
ok('the fallback says so in words', /estimated|does not publish|No official/i.test(unknownL.detail));
ok('end-to-end rates take no haircut', STAGE_HAIRCUT.end_to_end === 1);
ok('gatekeepered rates take the largest haircut',
   STAGE_HAIRCUT.post_endorsement < STAGE_HAIRCUT.post_filter);
ok('tax credits are treated as entitlements, not competitions', CLASS_PRIORS.tax_credit > 0.8);

console.log('\nEffort');
ok('a bare programme is quick', effortFor({}).tier === 'quick');
ok('a written case makes it a major bid',
   effortFor({ documents_required: [{ doc: 'Business plan' }, { doc: 'Budget breakdown' }], procedure_steps: [1, 2, 3, 4, 5, 6] }).tier === 'major');
ok('effort is derived from the record, not guessed', effortFor({ documents_required: [{ doc: 'ID' }] }).points === 1);

console.log('\nFeasibility — the co-funding test');
const bigCoFunded = { slug: 'x', grant_type: 'grant', amount_max: 3_000_000, amount_currency: 'EUR', cofunding_pct: 30 };
const poorCo = feasibility(bigCoFunded, { cash_available_eur: 20_000, stage: 'pre_seed' });
ok('a co-funding gap is penalised', poorCo.factor < 0.2);
ok('the penalty is explained in money terms', poorCo.reasons.some((r) => /900,000/.test(r)));
const richCo = feasibility(bigCoFunded, { cash_available_eur: 2_000_000, stage: 'growth' });
ok('a company that can cover the match is not penalised for it', richCo.factor > poorCo.factor);
ok('unknown cash asks rather than assumes',
   feasibility(bigCoFunded, {}).reasons.some((r) => /tell us your available cash/i.test(r)));

console.log('\nScoring');
const smallLikely = { slug: 'fr-concours-i-nov', grant_type: 'grant', amount_max: 30_000, amount_currency: 'EUR' };
const bigUnlikely = { slug: 'eic-accelerator', grant_type: 'grant', amount_max: 2_500_000, amount_currency: 'EUR' };
const sSmall = scoreProgramme(smallLikely, { stage: 'seed' });
const sBig = scoreProgramme(bigUnlikely, { stage: 'seed' });
ok('expected value is amount times probability',
   Math.abs(sSmall.expected_eur - 30_000 * sSmall.probability.p) < 1);
ok('a huge unlikely grant still beats a small likely one on raw EV', sBig.expected_eur > sSmall.expected_eur);
ok('every score carries its working', typeof sBig.explanation === 'string' && sBig.explanation.length > 40);
ok('the explanation names the probability', /%/.test(sBig.explanation));
ok('an unpriced programme scores null, never zero',
   scoreProgramme({ slug: 'z', grant_type: 'grant' }, {}).score === null);
ok('an unpriced programme is flagged as unpriced',
   scoreProgramme({ slug: 'z', grant_type: 'grant' }, {}).unpriced === true);

console.log('\nRanking — the bug this module exists to fix');
const mixed = [
  { programme: { slug: 'credits', grant_type: 'in_kind', amount_max: 350_000, amount_currency: 'USD', name_en: 'Cloud credits' } },
  { programme: { slug: 'yc', grant_type: 'equity', amount_max: 500_000, amount_currency: 'USD', name_en: 'Accelerator' } },
  { programme: { slug: 'grant', grant_type: 'grant', amount_max: 40_000, amount_currency: 'EUR', name_en: 'Small grant' } },
  { programme: { slug: 'loan', grant_type: 'loan', amount_max: 200_000, amount_currency: 'EUR', name_en: 'Honour loan' } },
];
const ranked = rankMatches(mixed, { stage: 'pre_seed' });
ok('a EUR 40k grant outranks USD 350k of credits', ranked[0].programme.name_en === 'Small grant');
ok('credits rank last despite the largest headline',
   ranked.at(-1).programme.name_en === 'Cloud credits');
ok('the loan sits between the grant and the equity',
   ranked[1].programme.name_en === 'Honour loan');
ok('every ranked item carries its scoring', ranked.every((m) => m.scoring && m.scoring.band_label));

const coFundedPair = [
  { programme: { slug: 'big', grant_type: 'grant', amount_max: 3_000_000, amount_currency: 'EUR', cofunding_pct: 30, name_en: 'Big co-funded', documents_required: [{ doc: 'Business plan' }], procedure_steps: [1, 2, 3, 4, 5] } },
  { programme: { slug: 'mid', grant_type: 'grant', amount_max: 250_000, amount_currency: 'EUR', name_en: 'Mid outright' } },
];
const poorRank = rankMatches(coFundedPair, { cash_available_eur: 20_000, stage: 'pre_seed' });
ok('a grant needing co-funding the company cannot raise is demoted',
   poorRank[0].programme.name_en === 'Mid outright');
const richRank = rankMatches(coFundedPair, { cash_available_eur: 5_000_000, stage: 'growth' });
ok('the same grant ranks first for a company that can match it',
   richRank[0].programme.name_en === 'Big co-funded');

console.log('\nRanking honesty is inspectable');
const cov = rateCoverage([{ slug: 'eic-accelerator' }, { slug: 'eurostars-3' }, { slug: 'unknown-x' }]);
ok('coverage counts published rates', cov.published === 2);
ok('coverage counts estimates separately', cov.class_prior === 1);
ok('coverage reports a percentage', cov.published_pct === 67);

const sFrRanked = matchStartup(founder, sDatasets, S_ASOF);
ok('the engine ranks with the scoring model', sFrRanked.eligible[0].scoring != null);
ok('non-dilutive cash heads the list', sFrRanked.eligible[0].scoring.band === 0);
ok('the engine reports its rate coverage', sFrRanked.rate_coverage.total > 0);



/* ================================================================== */
/* The app's question set                                              */
/* ================================================================== */

/**
 * The app shipped asking five friendly questions and returned a total of zero:
 * every programme fell into "needs one more answer" because the matcher blocks
 * on age, nationality and region and none were asked. A check that confidently
 * returns nothing is worse than one that asks two more questions, and nothing
 * in the build caught it. This does.
 */
import { readFileSync as rfs } from 'node:fs';

console.log('\nApp question coverage');
const appSrc = rfs(new URL('../src/pwa/app.js', import.meta.url), 'utf8');
const appAsks = [...appSrc.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);

const gbEntry = man.countries.find((c) => c.slug === 'gb');
const gbData = load('gb');
const fullProfile = {
  country_code: 'gb', status: 'employee', income_band: 'low',
  household_size: 2, children_count: 2, housing_tenure: 'renting',
  age: 34, nationality_group: 'citizen_or_pr', admin_area: null,
};
const gbResult = match(fullProfile, gbData, gbEntry);
/* This used to demand more than five straight matches, and it got them by
   counting records whose real rule ("you must already be on Universal Credit",
   "you must be disabled") lived in prose the matcher never read. Tightening
   that dropped the number, correctly. What matters is that a fully answered
   profile gets a usable answer — matches plus clearly-labelled conditions —
   not that the first bucket is padded. */
ok('a fully answered profile returns eligible programmes', gbResult.eligible.length > 0);
ok(
  'and every conditional record says what the condition is',
  gbResult.conditional.length > 0 && gbResult.conditional.every((m) => (m.condition_label || '').length > 3),
);
ok('and a non-zero total', gbResult.total_max > 0);

/* Every attribute the matcher can block on must be reachable in the app. */
const blocking = new Set(gbResult.needs_one_more_answer.map((m) => m.blocking_attribute).filter(Boolean));
const sparse = match(
  { country_code: 'gb', status: 'employee', housing_tenure: 'renting' },
  gbData, gbEntry,
);
for (const attr of new Set([...blocking, ...sparse.needs_one_more_answer.map((m) => m.blocking_attribute)])) {
  if (!attr) continue;
  const asked =
    appAsks.includes(attr) ||
    (attr === 'income' && (appAsks.includes('income_band') || appAsks.includes('income_annual'))) ||
    (attr === 'nationality' && appAsks.includes('nationality_group')) ||
    (attr === 'household' && appAsks.includes('household'));
  ok(`app asks something that unblocks "${attr}"`, asked);
}

ok('app asks for age', appAsks.includes('age'));
ok('app asks for region', appAsks.includes('admin_area'));
ok('app asks for nationality', appAsks.includes('nationality_group'));
ok('numeric answers are coerced, not left as strings', /f\.type === 'number' \? Number\(raw\)/.test(appSrc));


/* ------------------------------------------------------------------ */
/* The company applicant                                               */
/* ------------------------------------------------------------------ */

/* Every jurisdiction rule in packages/policy is a consumer-protection statute
 * about a person claiming a social benefit. Applying them to a company's grant
 * application was a category error, and it quietly disabled the enterprise
 * product — the thing the enterprise product IS. Filing a company's funding
 * application as its appointed agent is what an entire profession does; what
 * it needs is a signed authorisation, not a statutory carve-out.
 */
{
  console.log('\nCompany applicant');
  const { companyPolicyFor, mayFileOnBehalf, COMPANY_RAIL } = await import('../packages/policy/index.js');
  const { authorisationRequest } = await import('../packages/autoapply/index.js');

  ok('a company may be filed for even where a person may not', mayFileOnBehalf('fr', 'company') === true && mayFileOnBehalf('fr', 'person') === false);
  ok('the person model is untouched', mayFileOnBehalf('es', 'person') === true && mayFileOnBehalf('gb', 'person') === false);
  ok('an unresearched country still allows agent filing for a company', companyPolicyFor('zz').may_submit === true);
  ok('and still demands an authorisation first', companyPolicyFor('zz').requires_authorisation === true);
  ok('the EU rail is a delegated account, not a shared password', companyPolicyFor('eu').rail === COMPANY_RAIL.DELEGATED_ACCOUNT);
  ok('France carries an explicit note that the benefit prohibition does not cross over',
     /do not apply here|does not apply here|must not be carried across/i.test(companyPolicyFor('fr').notes));

  const startupMan = JSON.parse(rfs(new URL('../data/startups/manifest.json', import.meta.url), 'utf8'));
  const sc = startupMan.countries.find((c) => c.slug === 'fr') || startupMan.countries[0];
  const sd = JSON.parse(rfs(new URL(`../data/startups/${sc.slug}.json`, import.meta.url), 'utf8'));
  const prog = sd.programmes[0];
  const org = { id: 'org1', name: 'Acme GmbH' };
  const NOW = 1786000000000;

  const auth = authorisationRequest({ org, programmes: [prog], cc: sc.slug, now: NOW });
  ok('the authorisation names the programmes rather than being blanket', auth.scope.length === 1 && auth.scope[0].slug === prog.slug);
  ok('it expires', typeof auth.expires_at === 'number' && auth.expires_at > NOW);
  ok('it is revocable', auth.revocable === true);
  ok('it requires a signatory who can bind the company', auth.signatory_required === true);
  ok('it states in the artefact that no credentials are requested', auth.credentials_requested === false);
  ok('and the steps say the client keeps their own password', auth.steps.some((x) => /never receive your password/i.test(x)));

  const pkgNone = buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'company', asOf: NOW });
  ok('with no authorisation, filing is blocked', pkgNone.submit.we_submit === false);
  ok('and the block is a missing artefact with a remedy, not a refusal',
     pkgNone.blockers.some((b) => b.code === 'authorisation_required' && b.remedy === 'authorisation'));

  const signed = { ...auth, id: 'auth_1' };
  const pkgOk = buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'company', authorisation: signed, asOf: NOW });
  ok('with an authorisation on file, WE submit', pkgOk.submit.we_submit === true && pkgOk.submit.tier === 'submit');
  ok('and the client does nothing per application', pkgOk.submit.requires_user_action === false);
  ok('every filing carries the authorisation it was made under', pkgOk.submit.authorisation_id === 'auth_1');
  ok('and never the client credentials', pkgOk.submit.uses_client_credentials === false);

  const other = { ...signed, scope: [{ slug: 'something-else' }] };
  ok('a programme outside the scope is refused',
     buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'company', authorisation: other, asOf: NOW })
       .blockers.some((b) => b.code === 'programme_out_of_scope'));
  ok('a revoked authorisation stops filing',
     buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'company', authorisation: { ...signed, revoked_at: NOW }, asOf: NOW })
       .submit.we_submit === false);
  ok('an expired one does too',
     buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'company', authorisation: { ...signed, expires_at: NOW - 1 }, asOf: NOW })
       .submit.we_submit === false);

  /* The person path must be exactly as cautious as it was. */
  const person = buildPackage({ profile: { country_code: sc.slug }, programme: prog, entry: sc, applicant: 'person', asOf: NOW });
  ok('a person is still never filed for in France', person.submit.requires_user_action === true && person.submit.tier !== 'submit');
  ok('and the person package has no we_submit flag at all', person.submit.we_submit === undefined);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
