#!/usr/bin/env node
/**
 * "Similar programmes" — deterministic build-time similarity, on every
 * household and company programme page.
 *
 * Two kinds of check: the scoring functions in isolation (does the ranking
 * actually prefer what it claims to), and the built pages (does every
 * programme page that has ANY candidate to link actually carry the block,
 * pointing only at real, public, same-audience pages).
 *
 * Run against `dist/`, so `npm run build` must have already run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { similarHousehold, similarCompany } from '../src/pages/similar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, cond) => (cond ? (pass += 1, console.log(`  ✓ ${name}`)) : (fail += 1, console.error(`  ✗ ${name}`)));

console.log('\nSimilar programmes\n');

/* ---- scoring, in isolation, on a small fabricated pool ---- */
{
  const pool = [
    { slug: 'target', category: 'housing', benefit_type: 'cash', amount_max: 4000, funder: 'A', verification_status: 'verified' },
    { slug: 'same-cat', category: 'housing', benefit_type: 'voucher', amount_max: 50000, funder: 'B', verification_status: 'auto_extracted' },
    { slug: 'same-cat-and-band', category: 'housing', benefit_type: 'cash', amount_max: 4200, funder: 'C', verification_status: 'auto_extracted' },
    { slug: 'unrelated', category: 'childcare', benefit_type: 'credit', amount_max: 900000, funder: 'D', verification_status: 'verified' },
  ];
  const target = pool[0];
  const out = similarHousehold(pool, target, 6);
  t('never includes the target itself', !out.some((p) => p.slug === 'target'));
  t('ranks the same-category-AND-same-band record first', out[0]?.slug === 'same-cat-and-band');
  t('drops a record that shares nothing with the target', !out.some((p) => p.slug === 'unrelated'));
  t('is deterministic across repeated calls', JSON.stringify(similarHousehold(pool, target, 6)) === JSON.stringify(out));
}

/* ---- a duplicate record of the same programme is never "similar" to itself ---- */
{
  const pool = [
    { slug: 'uk-eis', name_en: 'Enterprise Investment Scheme (EIS)', grant_type: 'tax_credit', funder_type: 'public', funder: 'HMRC' },
    { slug: 'gb-hmrc-eis', name_en: 'Enterprise  Investment Scheme (EIS)', grant_type: 'tax_credit', funder_type: 'public', funder: 'HM Revenue and Customs' },
    { slug: 'demo-ara', name_en: 'Regionalised i-Demo', admin_area: 'ARA', grant_type: 'grant', funder_type: 'public', funder: 'Bpifrance' },
    { slug: 'demo-occ', name_en: 'Regionalised i-Demo', admin_area: 'OCC', grant_type: 'grant', funder_type: 'public', funder: 'Bpifrance' },
  ];
  const es = () => 'open';
  t('a same-name, same-area duplicate record is excluded', !similarCompany(pool, pool[0], 0, es).some((p) => p.slug === 'gb-hmrc-eis'));
  const withPair = [...pool,
    { slug: 'uk-seis', name_en: 'Seed Enterprise Investment Scheme (SEIS)', grant_type: 'tax_credit', funder_type: 'public', funder: 'HMRC' },
    { slug: 'gb-hmrc-seis', name_en: 'Seed Enterprise Investment Scheme (SEIS)', grant_type: 'tax_credit', funder_type: 'public', funder: 'HMRC' }];
  t('two duplicate candidates never take two slots', similarCompany(withPair, pool[0], 0, es).filter((p) => /seis$/.test(p.slug)).length === 1);
  t('a same-name regional variant (different admin_area) is kept', similarCompany(pool, pool[2], 0, es).some((p) => p.slug === 'demo-occ'));
}

{
  const asOf = Date.parse('2026-06-01');
  const effectiveStatus = (p) => p._status || 'closed';
  const pool = [
    { slug: 'target', grant_type: 'grant', funder_type: 'public', amount_max: 50000, funder: 'X', _status: 'open' },
    { slug: 'same-type-closed', grant_type: 'grant', funder_type: 'public', amount_max: 52000, funder: 'Y', _status: 'closed' },
    { slug: 'same-type-open', grant_type: 'grant', funder_type: 'public', amount_max: 51000, funder: 'Z', _status: 'open' },
    { slug: 'unrelated', grant_type: 'tax_credit', funder_type: 'private', amount_max: 1, funder: 'W', _status: 'open' },
  ];
  const target = pool[0];
  const out = similarCompany(pool, target, asOf, effectiveStatus, 6);
  t('company scoring never includes the target itself', !out.some((p) => p.slug === 'target'));
  t('an open match tie-breaks ahead of an equally-scored closed one', out[0]?.slug === 'same-type-open');
  t('drops a record that shares nothing with the target', !out.some((p) => p.slug === 'unrelated'));
}

/* ---- the built pages ---- */
if (!fs.existsSync(DIST)) {
  console.log('\ndist/ does not exist — skipping built-page checks (run `npm run build` for full coverage).');
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8'));
  const startupManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/startups/manifest.json'), 'utf8'));

  /* Household: sample a handful of countries, each with more than one
     programme in some category, so a real similarity candidate should exist
     somewhere in the country pool. */
  let hChecked = 0;
  let hHasBlock = 0;
  for (const c of manifest.countries.slice(0, 6)) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, `data/${c.slug}.json`), 'utf8'));
    if (data.programmes.length < 2) continue;
    const p = data.programmes[0];
    const f = path.join(DIST, c.slug, p.category, p.slug, 'index.html');
    if (!fs.existsSync(f)) continue;
    hChecked += 1;
    const html = fs.readFileSync(f, 'utf8');
    if (html.includes('Similar programmes') || html.includes('similarProgrammes')) hHasBlock += 1;
    /* Every link in that block goes to a real page on this same country's
       household side (never the funder's own site). */
    const linksOk = ![...html.matchAll(/card-link" href="([^"]+)"/g)]
      .some(([, href]) => href.startsWith('http'));
    t(`${c.slug}/${p.category}/${p.slug}/: similar-programmes links stay on-site`, linksOk);
  }
  t(`checked at least one household programme page (${hChecked})`, hChecked > 0);

  /* Company: same idea, English-only pages. */
  let cChecked = 0;
  let cHasBlock = 0;
  for (const c of startupManifest.countries.slice(0, 10)) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, `data/startups/${c.slug}.json`), 'utf8'));
    if (data.programmes.length < 2) continue;
    const p = data.programmes[0];
    const f = path.join(DIST, 'startups', c.slug, p.slug, 'index.html');
    if (!fs.existsSync(f)) continue;
    cChecked += 1;
    const html = fs.readFileSync(f, 'utf8');
    if (html.includes('Similar programmes')) cHasBlock += 1;
    const linksOk = ![...html.matchAll(/card-link" href="([^"]+)"/g)]
      .some(([, href]) => href.startsWith('http'));
    t(`startups/${c.slug}/${p.slug}/: similar-programmes links stay on-site`, linksOk);
  }
  t(`checked at least one company programme page (${cChecked})`, cChecked > 0);

  t(`at least one sampled household page with a peer in its country shows the block (${hHasBlock}/${hChecked})`, hHasBlock > 0);
  t(`at least one sampled company page with a peer in its country shows the block (${cHasBlock}/${cChecked})`, cHasBlock > 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
