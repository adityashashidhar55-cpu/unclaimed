#!/usr/bin/env node
/**
 * Flagship coverage: the founder-facing programmes every major grant site
 * leads with must exist here too, per country, or the "we cover more than
 * <competitor>" claim is marketing, not fact.
 *
 * This does not assert every programme in every country — the corpus is far
 * bigger than any one flagship list — it asserts that the specific slugs a
 * founder in each jurisdiction goes looking for by name are present, sourced,
 * and dated. A missing flagship is a founder concluding the site does not
 * know their country, on the very first thing they search for.
 *
 * Add a slug here the same day it is added to data/startups/<cc>.json, so the
 * two never drift apart the way data/startups/manifest.json's stored counts
 * once did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUPS = path.join(ROOT, 'data', 'startups');

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const load = (cc) => JSON.parse(fs.readFileSync(path.join(STARTUPS, `${cc}.json`), 'utf8'));
const find = (doc, slug) => doc.programmes.find((p) => p.slug === slug);

/**
 * Flagship founder/SME programme per country a reader would search for by
 * name. Values are the ANY-OF-THESE slugs that satisfy that flagship — some
 * countries carry the scheme under more than one slug (an original programme
 * plus a regionalised or renamed successor), so any match counts.
 */
const FLAGSHIPS = {
  de: [
    { label: 'Forschungszulage (research allowance)', anyOf: ['de-forschungszulage'] },
    { label: 'EXIST', anyOf: ['de-exist-gruendungsstipendium', 'de-exist-forschungstransfer', 'de-exist-startup-factories', 'de-exist-women'] },
    { label: 'ZIM', anyOf: ['de-zim', 'de-zim-einzelprojekt', 'de-zim-kooperationsprojekt'] },
    { label: 'INVEST venture capital grant', anyOf: ['de-invest-zuschuss-wagniskapital', 'de-invest-erwerbszuschuss', 'de-invest-exitzuschuss'] },
    { label: 'KfW / ERP start-up and innovation loans', anyOf: ['de-kfw-erp-gruenderkredit-startgeld', 'de-kfw-erp-kapital-fuer-gruendung', 'de-kfw-erp-digitalisierungs-innovationskredit', 'de-kfw-erp-mezzanine-innovation'] },
  ],
  gb: [
    { label: 'R&D tax relief (merged scheme / ERIS)', anyOf: ['gb-hmrc-rd-relief', 'uk-merged-rdec-scheme', 'uk-eris-rd-intensive-smes'] },
    { label: 'Innovate UK Smart Grants', anyOf: ['gb-iuk-smart-grants', 'uk-innovate-uk-smart-grants'] },
    { label: 'SEIS (Seed Enterprise Investment Scheme)', anyOf: ['gb-hmrc-seis', 'uk-seis'] },
    { label: 'EIS (Enterprise Investment Scheme)', anyOf: ['gb-hmrc-eis', 'uk-eis'] },
  ],
  fr: [
    { label: 'JEI (Jeune Entreprise Innovante)', anyOf: ['fr-jei', 'fr-jeune-entreprise-innovante'] },
    { label: 'Bourse French Tech', anyOf: ['fr-bourse-french-tech', 'fr-bourse-french-tech-emergence'] },
    { label: 'i-Nov', anyOf: ['fr-i-nov', 'fr-concours-i-nov'] },
    { label: 'CIR / CII (research and innovation tax credit)', anyOf: ['fr-cir', 'fr-credit-impot-recherche', 'fr-cii', 'fr-credit-impot-innovation'] },
  ],
  nl: [
    { label: 'WBSO', anyOf: ['nl-wbso'] },
    { label: 'Innovatiekrediet', anyOf: ['nl-innovatiekrediet'] },
    { label: 'MIT', anyOf: ['nl-mit-haalbaarheid', 'nl-mit-kennisvouchers', 'nl-mit-rd-samenwerking'] },
  ],
  ie: [
    { label: 'R&D tax credit', anyOf: ['ie-rd-tax-credit', 'ie-revenue-rd-tax-credit'] },
    { label: 'Enterprise Ireland HPSU', anyOf: ['ie-ei-innovative-hpsu-fund', 'ie-innovative-hpsu-fund', 'ie-ei-hpsu-feasibility', 'ie-hpsu-feasibility-study-grant'] },
    { label: 'Innovation Vouchers', anyOf: ['ie-ei-innovation-voucher', 'ie-innovation-voucher'] },
  ],
  es: [
    { label: 'CDTI NEOTEC', anyOf: ['es-cdti-neotec', 'es-cdti-neotec-2026'] },
    { label: 'ENISA', anyOf: ['es-enisa-prestamos-participativos', 'es-enisa-jovenes-emprendedores', 'es-enisa-emprendedoras-digitales'] },
  ],
  it: [
    { label: 'Smart&Start Italia', anyOf: ['it-smart-start', 'it-smart-start-italia'] },
    { label: 'Transizione 5.0 (or its successor Nuovo Piano / Iperammortamento)', anyOf: ['it-transizione-5-0', 'it-transizione-5-0-iperammortamento'] },
  ],
  in: [
    { label: 'SISFS (Startup India Seed Fund Scheme)', anyOf: ['in-startup-india-seed-fund-scheme'] },
    { label: 'Section 80-IAC tax holiday', anyOf: ['in-section-80iac-tax-holiday'] },
    { label: 'CGSS (Credit Guarantee Scheme for Startups)', anyOf: ['in-cgss-credit-guarantee-scheme-startups'] },
  ],
  sg: [
    { label: 'Startup SG', anyOf: ['sg-startup-sg-founder', 'sg-startup-sg-equity', 'sg-startup-sg-tech', 'sg-startup-sg-talent', 'sg-startup-sg-accelerator'] },
    { label: 'EDGE grant', anyOf: ['sg-edge-grant'] },
  ],
  ca: [
    { label: 'SR&ED', anyOf: ['ca-sred-tax-incentive'] },
    { label: 'IRAP', anyOf: ['ca-nrc-irap', 'ca-nrc-irap-financial-support', 'ca-nrc-irap-clean-technology'] },
  ],
  au: [
    { label: 'R&DTI (R&D Tax Incentive)', anyOf: ['au-rd-tax-incentive'] },
    { label: 'Accelerating Commercialisation / Industry Growth Program', anyOf: ['au-industry-growth-program'] },
  ],
};

console.log('\nFlagship founder/SME programmes exist per country\n');

for (const [cc, flags] of Object.entries(FLAGSHIPS)) {
  const doc = load(cc);
  for (const f of flags) {
    const hit = f.anyOf.map((slug) => find(doc, slug)).find(Boolean);
    t(`${cc}: ${f.label}`, !!hit, `none of ${f.anyOf.join(', ')} found in data/startups/${cc}.json`);
  }
}

console.log('\nThe two newly added flagship records are real, sourced and dated\n');

{
  const de = load('de');
  const p = find(de, 'de-forschungszulage');
  t('de-forschungszulage exists', !!p);
  if (p) {
    t('  is typed as a tax credit', p.grant_type === 'tax_credit');
    t('  has an official bundesfinanzministerium.de or wirtschaft.nrw source', /bundesfinanzministerium\.de|wirtschaft\.nrw/.test(p.source_url || ''));
    t('  is marked verified with a 2026 verification date', p.verification_status === 'verified' && /^2026-/.test(p.last_verified_at || ''));
    t('  quotes the 2026 SME rate (35%) in its amount note', /35%/.test(p.amount_note || ''));
    t('  quotes a real annual cap, not an invented one', /4[.,]2\s*million|4,200,000|EUR 4\.2m/i.test(p.amount_note || ''));
    t('  is not given a fake deadline (rolling entitlement, no closes_at)', p.status === 'rolling' && p.closes_at === null);
  }
}

{
  const it = load('it');
  const p = find(it, 'it-transizione-5-0-iperammortamento');
  t('it-transizione-5-0-iperammortamento exists', !!p);
  if (p) {
    t('  has an official gse.it or mimit.gov.it source', /gse\.it|mimit\.gov\.it/.test(p.source_url || ''));
    t('  is marked verified with a 2026 verification date', p.verification_status === 'verified' && /^2026-/.test(p.last_verified_at || ''));
    t('  documents that it succeeded the closed 2024–2025 tax-credit scheme', /replaced|successor|closed/i.test(p.amount_note || ''));
    t('  carries a real, not invented, investment window end date', p.closes_at === '2028-09-30');
    t('  is not marked open with no basis: opens_at precedes closes_at', Date.parse(p.opens_at) < Date.parse(p.closes_at));
  }
}

console.log('\nThe corpus total and per-country manifest stats agree with the data on disk\n');

{
  const manifest = JSON.parse(fs.readFileSync(path.join(STARTUPS, 'manifest.json'), 'utf8'));
  let total = 0;
  for (const entry of manifest.countries) {
    const doc = load(entry.slug);
    total += doc.programmes.length;
    t(`${entry.slug}: manifest.count matches data/startups/${entry.slug}.json`, entry.count === doc.programmes.length,
      `manifest says ${entry.count}, file has ${doc.programmes.length}`);
  }
  t('manifest.total is the sum of every country file', manifest.total === total, `manifest says ${manifest.total}, sum is ${total}`);
  t('manifest.total includes both new flagship records (>= 1641: 1684 - 45 deduped + 2)', manifest.total >= 1641);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
