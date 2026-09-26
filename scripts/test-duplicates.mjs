#!/usr/bin/env node
/**
 * Regression test for company-grant duplicates.
 *
 * The site had the same programme recorded twice under two slugs — once
 * ~30 times over (EIC Accelerator/Pathfinder/Transition/STEP/etc. under both
 * a bare "eic-*" slug and a jurisdiction-prefixed "eu-eic-*" one, AWS Activate
 * under "aws-activate" and "global-aws-activate", and more) — which meant two
 * different pages, two different "amount you could get" figures, and the
 * dataset's total silently double-counting the same scheme. That has been
 * cleaned up (data/startups/dedupe-log.json records every merge; the removed
 * page redirects to the survivor via data/startups/redirects.json).
 *
 * This test is the guard against it coming back: it runs
 * scripts/find-duplicates.mjs over the current data and fails if it finds any
 * pair that is not already on data/startups/duplicate-allowlist.json — a
 * human has to look at a new look-alike and decide merge-or-allowlist, it
 * cannot just silently reappear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicates, loadAllowlist, isAllowlisted, STARTUPS_DIR } from './find-duplicates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };

/* ---- the finder itself: sanity checks on the heuristics ------------ */

{
  const { jaccard, normaliseFunder, tokenize } = await import('./find-duplicates.mjs');
  jaccard('European Innovation Council Accelerator', 'European Innovation Council Accelerator') === 1
    ? ok('identical names score 1.0')
    : bad('identical names should score 1.0');
  jaccard('AWS Activate', 'Techstars Accelerator') < 0.2
    ? ok('unrelated names score low')
    : bad('unrelated names scored too high');
  normaliseFunder('Amazon Web Services, Inc.') === normaliseFunder('Amazon Web Services')
    ? ok('a legal suffix does not change the normalised funder')
    : bad('"Inc." changed the normalised funder — it should not');
  normaliseFunder('Amazon Web Services') !== normaliseFunder('Techstars')
    ? ok('genuinely different funder names stay different')
    : bad('two unrelated funders normalised to the same string');
  tokenize('the Grant for Startups').includes('grant')
    ? bad('"grant" should be filtered as a stopword-ish filler token')
    : ok('generic filler words are stripped before comparing names');
}

/* ---- every known duplicate got merged ------------------------------ */

{
  const log = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, 'dedupe-log.json'), 'utf8'));
  log.length >= 30
    ? ok(`dedupe log records ${log.length} merges`)
    : bad(`expected at least 30 recorded merges, found ${log.length}`);

  for (const entry of log) {
    const doc = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, `${entry.country}.json`), 'utf8'));
    const stillThere = doc.programmes.some((p) => p.slug === entry.removed);
    const survivorThere = doc.programmes.some((p) => p.slug === entry.kept);
    !stillThere
      ? ok(`${entry.country}/${entry.removed} was actually removed`)
      : bad(`${entry.country}/${entry.removed} is still in the data — the merge did not apply`);
    survivorThere
      ? ok(`${entry.country}/${entry.kept} (its replacement) still exists`)
      : bad(`${entry.country}/${entry.kept} is missing — the merge deleted the wrong record`);
  }
}

/* ---- known EIC-family merges, named explicitly (the ones the task
   called out by name) actually landed, not just "some merge happened" --- */
{
  const eu = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, 'eu.json'), 'utf8'));
  const slugs = new Set(eu.programmes.map((p) => p.slug));
  const mustBeGone = [
    'eic-accelerator', 'eu-eic-accelerator-open', 'eic-pathfinder-open', 'eu-eic-pathfinder-open',
    'eu-eic-pathfinder-challenges', 'eu-eic-transition', 'eu-eic-pre-accelerator', 'eu-eic-step-scale-up',
    'eu-eic-scaleup-step', 'eu-eic-step-scale-up-defence', 'eu-eic-business-acceleration-services', 'eu-eurostars-3',
  ];
  const mustSurvive = [
    'eu-eic-accelerator', 'eu-eic-accelerator-challenges', 'eic-pathfinder-challenges', 'eu-eic-pathfinder',
    'eic-transition', 'eic-pre-accelerator', 'eic-step-scale-up', 'eic-step-scale-up-defence',
    'eic-business-acceleration-services', 'eurostars-3',
  ];
  const stillPresent = mustBeGone.filter((s) => slugs.has(s));
  stillPresent.length === 0
    ? ok('every known EIC/Eurostars duplicate slug is gone from eu.json')
    : bad(`still present: ${stillPresent.join(', ')}`);
  const missing = mustSurvive.filter((s) => !slugs.has(s));
  missing.length === 0
    ? ok('every canonical EIC/Eurostars record (including the genuinely separate Accelerator/Pathfinder Challenges tracks) survives')
    : bad(`missing canonical record(s): ${missing.join(', ')}`);

  const namesById = Object.fromEntries(eu.programmes.map((p) => [p.slug, p.name_en]));
  namesById['eu-eic-accelerator'] !== namesById['eu-eic-accelerator-challenges']
    ? ok('Accelerator and Accelerator Challenges are kept as distinct, differently-named tracks')
    : bad('Accelerator and Accelerator Challenges collapsed into the same record');
}

/* ---- no unreviewed duplicate slipped in (or reappeared) ------------ */

{
  const dupes = findDuplicates();
  const allowlist = loadAllowlist();
  const unreviewed = dupes.filter((d) => !isAllowlisted(d, allowlist));

  unreviewed.length === 0
    ? ok(`no unreviewed duplicate candidates (${dupes.length} found, all on the allowlist)`)
    : bad(
        `${unreviewed.length} duplicate candidate(s) are not reviewed:\n` +
          unreviewed.map((d) => `      ${d.country}: ${d.a} <-> ${d.b} (${d.reason})`).join('\n') +
          '\n    Either merge them (scripts/merge-duplicates.mjs) or add them to data/startups/duplicate-allowlist.json.',
      );

  /* Every allowlist entry should point at slugs that still exist — a stale
     entry (from a record later renamed or removed some other way) hides
     nothing today, but it is dead weight that will confuse the next person
     reading the file, so it is worth catching. */
  const bySlugCountry = new Map();
  for (const f of fs.readdirSync(STARTUPS_DIR)) {
    if (!f.endsWith('.json') || f === 'manifest.json' || f === 'duplicate-allowlist.json' || f === 'dedupe-log.json' || f === 'redirects.json') continue;
    const cc = f.replace(/\.json$/, '');
    const doc = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, f), 'utf8'));
    bySlugCountry.set(cc, new Set((doc.programmes || []).map((p) => p.slug)));
  }
  const stale = allowlist.filter((e) => {
    const slugs = bySlugCountry.get(e.country);
    return !slugs || !slugs.has(e.a) || !slugs.has(e.b);
  });
  stale.length === 0
    ? ok(`every allowlist entry (${allowlist.length}) points at records that still exist`)
    : bad(`${stale.length} allowlist entr(y/ies) reference a slug that no longer exists: ${JSON.stringify(stale.slice(0, 3))}`);
}

/* ---- redirects: every removed page gets a real, resolvable 301 ----- */

{
  const redirects = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, 'redirects.json'), 'utf8'));
  const log = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, 'dedupe-log.json'), 'utf8'));

  redirects.length === log.length
    ? ok(`redirects.json has one entry per merge (${redirects.length})`)
    : bad(`redirects.json has ${redirects.length} entries but the dedupe log has ${log.length}`);

  const build = fs.readFileSync(path.join(ROOT, 'src/build.mjs'), 'utf8');
  /startups\/\$\{r\.country\}\/\$\{r\.from\}\/ .* startups\/\$\{r\.country\}\/\$\{r\.to\}\/ 301/.test(build) ||
  /redirects\.json/.test(build)
    ? ok('src/build.mjs reads data/startups/redirects.json into the emitted _redirects file')
    : bad('src/build.mjs does not reference data/startups/redirects.json — removed pages will 404 instead of redirecting');

  const dist = path.join(ROOT, 'dist', '_redirects');
  if (fs.existsSync(dist)) {
    const body = fs.readFileSync(dist, 'utf8');
    let missing = 0;
    for (const r of redirects) {
      const line = `/startups/${r.country}/${r.from}/ /startups/${r.country}/${r.to}/ 301`;
      if (!body.includes(line)) missing += 1;
    }
    missing === 0
      ? ok(`dist/_redirects carries a 301 for every merged company-grant page (${redirects.length})`)
      : bad(`${missing} of ${redirects.length} merged pages have no 301 in the built _redirects file`);
  } else {
    console.log('  · dist/_redirects not built yet — run `npm run build` first to check the emitted file');
  }
}

/* ---- slug-keyed side data follows the merge ------------------------ */

{
  /* packages/scoring/rates.js keys published award rates by slug. A merge
     that removes the slug a rate hangs off silently drops that programme's
     award likelihood, so every removed slug must be gone from it. */
  const { RATE_DATA } = await import('../packages/scoring/rates.js');
  const redirects = JSON.parse(fs.readFileSync(path.join(STARTUPS_DIR, 'redirects.json'), 'utf8'));
  const removed = new Set(redirects.map((r) => r.from));
  const orphaned = RATE_DATA.rates.filter((r) => removed.has(r.slug)).map((r) => r.slug);
  orphaned.length === 0
    ? ok('no published award rate is keyed to a merged-away slug')
    : bad(`award rates still keyed to merged-away slugs: ${orphaned.join(', ')}`);
}

console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
