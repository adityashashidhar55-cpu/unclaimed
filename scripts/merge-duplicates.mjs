#!/usr/bin/env node
/**
 * One-shot: merge the reviewed duplicate company-grant records out of
 * data/startups/*.json, and record what happened.
 *
 * This is not meant to run repeatedly — it is the tool used once to apply
 * the merge list below (found with scripts/find-duplicates.mjs, reviewed by
 * hand) and it will refuse to run a second time once a slug is already gone,
 * which is the signal that it already did its job. Re-running it is safe:
 * anything already merged is skipped.
 *
 * For each pair the KEEP record's slug and page survive; the REMOVE record
 * is deleted from its country file. The removed page's URL is recorded in
 * data/startups/redirects.json so src/build.mjs can emit a permanent 301
 * from it to the surviving page (grep _redirects in src/build.mjs), and both
 * slugs are appended to data/startups/dedupe-log.json for the record.
 *
 *   node scripts/merge-duplicates.mjs           # apply
 *   node scripts/merge-duplicates.mjs --dry-run # print what would happen
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUPS_DIR = path.join(ROOT, 'data', 'startups');
const DRY = process.argv.includes('--dry-run');

/**
 * [country file, slug to remove, slug to keep, human-readable reason]
 *
 * Reviewed against scripts/find-duplicates.mjs output by hand. Every pair
 * here is the SAME programme recorded twice (same funder, same scheme, same
 * or near-identical source page) — never two genuinely different tracks.
 * Tracks that looked similar but are real and distinct (EIC Accelerator vs
 * Accelerator Challenges, Pathfinder Open vs Challenges, STEP Scale-Up vs
 * STEP Scale-Up Defence, and dozens of same-funder multi-track schemes with
 * a shared landing page) are left alone and recorded in
 * data/startups/duplicate-allowlist.json instead.
 */
export const MERGES = [
  // --- EIC family (eu.json) — the site had every scheme added twice, once
  // with a bare "eic-*" slug and once with a jurisdiction-prefixed "eu-eic-*"
  // one, sometimes years apart. ---
  ['eu', 'eic-accelerator', 'eu-eic-accelerator', 'same page, same scheme as the canonical Accelerator record'],
  ['eu', 'eu-eic-accelerator-open', 'eu-eic-accelerator', '"Open" is the default Accelerator call, not a separate track (unlike Challenges, which is kept)'],
  ['eu', 'eic-pathfinder-open', 'eu-eic-pathfinder', 'duplicate of the general Pathfinder record; its more specific source snippet was folded in'],
  ['eu', 'eu-eic-pathfinder-open', 'eu-eic-pathfinder', 'unverified duplicate of the general Pathfinder record (no snippet, marked closed)'],
  ['eu', 'eu-eic-pathfinder-challenges', 'eic-pathfinder-challenges', 'unverified duplicate; eic-pathfinder-challenges has the verified, specific source'],
  ['eu', 'eu-eic-transition', 'eic-transition', 'unverified duplicate of the same eic-transition_en page'],
  ['eu', 'eu-eic-pre-accelerator', 'eic-pre-accelerator', 'generic duplicate; eic-pre-accelerator has the actual award amounts'],
  ['eu', 'eu-eic-step-scale-up', 'eic-step-scale-up', 'duplicate of the same STEP Scale Up scheme; eic-step-scale-up has the award amounts'],
  ['eu', 'eu-eic-scaleup-step', 'eic-step-scale-up', 'unverified duplicate with a mismatched source_url (points at the Accelerator page)'],
  ['eu', 'eu-eic-step-scale-up-defence', 'eic-step-scale-up-defence', 'duplicate of the same STEP Scale Up Defence scheme; eic-step-scale-up-defence has the award amounts'],
  ['eu', 'eu-eic-business-acceleration-services', 'eic-business-acceleration-services', 'unverified duplicate of the same EIC Business Acceleration Services page'],
  ['eu', 'eu-eurostars-3', 'eurostars-3', 'same Eurostars call, same source page; eurostars-3 already carries the deadline facts'],

  // --- Other EU-level programmes added twice under different slug schemes ---
  ['eu', 'eu-digital-europe-programme', 'digital-europe-programme', 'same Digital Europe Programme page, unverified duplicate'],
  ['eu', 'eu-eit-food-accelerator-network', 'eit-food-accelerator-network', 'same EIT Food Accelerator Network; eit-food-accelerator-network has the actual prize amounts'],

  // --- global.json: company-side pattern with an unprefixed and a
  // "global-"-prefixed slug for the same programme. ---
  ['global', 'global-aws-activate', 'aws-activate', 'same AWS Activate credits programme, less detailed duplicate'],
  ['global', 'techstars-accelerator', 'global-techstars', 'same Techstars investment terms; global-techstars has the more current APAC/discontinuation detail'],
  ['global', 'global-earthshot-prize', 'earthshot-prize', 'same Earthshot Prize, unverified duplicate'],
  ['global', 'global-mongodb-for-startups', 'mongodb-for-startups', 'same MongoDB for Startups programme; mongodb-for-startups has the current tier detail'],

  // --- gb.json ---
  ['gb', 'uk-innovate-uk-smart-grants', 'gb-iuk-smart-grants', 'same Innovate UK Smart Grants; gb-iuk-smart-grants has the fuller procedure and reopen note'],
  ['gb', 'gb-investni-innovation-vouchers', 'uk-invest-ni-innovation-vouchers', 'same Invest NI Innovation Vouchers; uk-invest-ni-innovation-vouchers has the verified, current amount'],
  ['gb', 'uk-nihr-i4i', 'gb-nihr-invention-for-innovation', 'same NIHR i4i programme, duplicate whose only addition was a note that the source page blocked automated access'],

  // --- fr.json ---
  ['fr', 'fr-cir', 'fr-credit-impot-recherche', 'same Credit d’impot recherche; fr-credit-impot-recherche is verified with a quoted source snippet'],
  ['fr', 'fr-cii', 'fr-credit-impot-innovation', 'same Credit d’impot innovation; fr-credit-impot-innovation is verified with a quoted source snippet'],
  ['fr', 'fr-bft-emergence', 'fr-bourse-french-tech-emergence', 'same Bourse French Tech Emergence grant; fr-bourse-french-tech-emergence is verified with the award ceiling'],

  // --- de.json ---
  ['de', 'de-invest-zuschuss-wagniskapital', 'de-invest-erwerbszuschuss', 'same INVEST acquisition grant (Erwerbszuschuss), just an older source_url; distinct from the exit grant, which is kept'],

  // --- nl.json ---
  ['nl', 'nl-dei-plus-demonstratie-energie-klimaatinnovatie', 'nl-dei-plus', 'same DEI+ scheme spelled out in full; nl-dei-plus is the name actually used on the RVO page'],

  // --- us.json ---
  ['us', 'us-ca-california-competes-tax-credit', 'us-ca-california-competes', 'same California Competes Tax Credit, same source page'],
  ['us', 'us-sbir-nsf', 'us-nsf-americas-seed-fund', 'same NSF SBIR/STTR program; us-nsf-americas-seed-fund cites the newer NSF 26-511 solicitation figures'],
  ['us', 'us-sba-growth-accelerator-fund-competition', 'us-sba-gafc', 'same SBA GAFC prize competition; us-sba-gafc has the actual prize-tier amounts'],

  // --- za.json ---
  ['za', 'za-spii-matching-scheme', 'za-spii', 'za-spii already documents the Matching Scheme as one of its two schemes'],

  // --- Second pass (w2 integration review). Each pair below was checked for
  // same programme AND same track, not just a shared name or page. ---
  ['gb', 'gb-hmrc-eis', 'uk-eis', 'same HMRC Enterprise Investment Scheme; uk-eis is verified with a quoted source and is the slug packages/scoring/rates.js uses'],
  ['gb', 'gb-hmrc-seis', 'uk-seis', 'same HMRC Seed Enterprise Investment Scheme; uk-seis is verified with a quoted source and is the slug packages/scoring/rates.js uses'],
  ['gb', 'gb-iuk-icure-explore', 'uk-icure-explore', 'same ICURe Explore programme, same source page; uk-icure-explore is verified (the earlier "distinct track" allowlist entry was wrong)'],
  ['us', 'us-ny-innovation-vc-fund', 'us-ny-innovation-venture-capital-fund', 'same NYS Innovation Venture Capital Fund; the survivor cites the fund\'s own page rather than the ESD venture-capital overview'],
  ['us', 'us-sba-504-loan', 'us-sba-504', 'same SBA 504 (CDC/504) loan, same source page; us-sba-504 has the fuller procedure and documents (the earlier "distinct track" allowlist entry was wrong)'],
  ['us', 'us-tx-pdsbi', 'us-tx-product-development-small-business-incubator-fund', 'same Texas PDSBI fund; the survivor is verified with the loan ceiling'],
  ['eu', 'eu-creative-europe-media', 'creative-europe-media', 'same Creative Europe MEDIA strand; unverified duplicate marked closed. The MEDIA sub-schemes (Innovative Tools, Slate Development, Video Games) are distinct and kept'],
  ['eu', 'eu-women-techeu', 'women-techeu', 'same Women TechEU call; women-techeu cites the current 2026 round and has the procedure'],
  ['eu', 'eu-eit-jumpstarter', 'eit-jumpstarter', 'same EIT Jumpstarter pre-accelerator, same source page; eit-jumpstarter is verified with the prize amounts'],
  ['fr', 'fr-i-nov', 'fr-concours-i-nov', 'same i-Nov competition; fr-concours-i-nov is verified and cites the call page, not the generic calls listing'],
  ['fr', 'fr-jei', 'fr-jeune-entreprise-innovante', 'same Jeune Entreprise Innovante status; the survivor is verified with a quoted source'],
  ['fr', 'fr-reseau-entreprendre', 'fr-reseau-entreprendre-pret-honneur', 'same Reseau Entreprendre honour loan (national network, amounts set locally); the survivor quotes the published 15k-90k range'],
  ['fr', 'fr-first-factory', 'fr-premiere-usine', 'same Premiere Usine / First Factory call, same source page; the survivor has the procedure and documents'],
  ['ch', 'ch-innosuisse-innovationsprojekte-umsetzungspartner', 'ch-innosuisse-innovation-project-implementation-partner', 'same Innosuisse innovation project with an implementation partner, recorded once from the German page and once from the English one'],
  ['ch', 'ch-innosuisse-startup-innovationsprojekte', 'ch-innosuisse-startup-innovation-projects', 'same Innosuisse start-up innovation projects, recorded once from the German page and once from the English one'],
];

function loadCountry(cc) {
  const file = path.join(STARTUPS_DIR, `${cc}.json`);
  return { file, doc: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const dedupeLogPath = path.join(STARTUPS_DIR, 'dedupe-log.json');
const redirectsPath = path.join(STARTUPS_DIR, 'redirects.json');

const dedupeLog = fs.existsSync(dedupeLogPath) ? JSON.parse(fs.readFileSync(dedupeLogPath, 'utf8')) : [];
const redirects = fs.existsSync(redirectsPath) ? JSON.parse(fs.readFileSync(redirectsPath, 'utf8')) : [];

const byCountry = new Map();
let applied = 0;
let skipped = 0;

for (const [cc, removeSlug, keepSlug, reason] of MERGES) {
  if (!byCountry.has(cc)) byCountry.set(cc, loadCountry(cc));
  const { doc } = byCountry.get(cc);
  const removeIdx = doc.programmes.findIndex((p) => p.slug === removeSlug);
  const keep = doc.programmes.find((p) => p.slug === keepSlug);

  if (!keep) {
    console.error(`  ✗ ${cc}: canonical "${keepSlug}" not found — skipping ${removeSlug}`);
    skipped += 1;
    continue;
  }
  if (removeIdx === -1) {
    console.log(`  · ${cc}: "${removeSlug}" already merged (skipping)`);
    continue;
  }

  const removed = doc.programmes[removeIdx];
  console.log(`  ✓ ${cc}: ${removeSlug}  ->  ${keepSlug}  (${reason})`);
  applied += 1;

  if (!DRY) {
    doc.programmes.splice(removeIdx, 1);
    if (!dedupeLog.some((e) => e.country === cc && e.removed === removeSlug)) {
      dedupeLog.push({
        country: cc,
        removed: removeSlug,
        removed_name: removed.name_en,
        kept: keepSlug,
        kept_name: keep.name_en,
        reason,
        merged_at: new Date().toISOString().slice(0, 10),
      });
    }
    if (!redirects.some((r) => r.country === cc && r.from === removeSlug)) {
      redirects.push({ country: cc, from: removeSlug, to: keepSlug });
    }
  }
}

if (!DRY) {
  for (const [, { file, doc }] of byCountry) {
    /* Compact, no trailing newline — matches the existing file format
       exactly, so a merge's diff is the removed record and nothing else. */
    fs.writeFileSync(file, JSON.stringify(doc));
  }
  fs.writeFileSync(dedupeLogPath, `${JSON.stringify(dedupeLog, null, 2)}\n`);
  fs.writeFileSync(redirectsPath, `${JSON.stringify(redirects, null, 2)}\n`);
}

console.log(`\n${applied} merge(s) ${DRY ? 'would be' : ''} applied, ${skipped} skipped (canonical missing)\n`);
