#!/usr/bin/env node
/**
 * Regenerate data/manifest.json's per-country `regions` from data/*.json.
 *
 * The wizard's region question is drawn from manifest.regions; the matcher
 * gates on eligibility.admin_areas. They were two hand-maintained lists with
 * nothing tying them together, and they had drifted: 37 admin_areas values
 * appeared in the data and in no manifest, and 35 records had no selectable
 * answer at all — cheque-guarderia-madrid wanted "Comunidad de Madrid" while
 * the wizard offered "Madrid", so every one of the six answers it did offer,
 * and no answer, all returned zero. Nothing errored; the record was simply
 * unreachable, at 283/month.
 *
 * So the vocabulary gets one source. The union of every admin_areas value in a
 * country's data IS that country's region list, by construction, and this
 * script is how it gets there. Run it after any data edit that touches
 * admin_areas; scripts/verify.mjs fails the build if the two ever disagree
 * again.
 *
 *   node scripts/gen-manifest.mjs           # rewrite data/manifest.json
 *   node scripts/gen-manifest.mjs --check   # exit 1 if it would change
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const MANIFEST = path.join(DATA, 'manifest.json');
const CHECK = process.argv.includes('--check');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/** Every admin_areas value a country's records actually gate on. */
export function regionsFor(slug) {
  const doc = JSON.parse(fs.readFileSync(path.join(DATA, `${slug}.json`), 'utf8'));
  const seen = new Set();
  for (const p of doc.programmes || []) {
    for (const a of p.eligibility?.admin_areas || []) {
      if (typeof a === 'string' && a.trim()) seen.add(a.trim());
    }
    /* The sibling field is part of the vocabulary too — it is what a reader
       would type, and normalisation keeps it a member of admin_areas, so this
       is belt and braces rather than a second source of truth. */
    if (typeof p.admin_area === 'string' && p.admin_area.trim()) seen.add(p.admin_area.trim());
  }
  /* Locale-aware, so "Ávila" sorts where a Spanish reader expects it and not
     after "Zaragoza". */
  return [...seen].sort((a, b) => a.localeCompare(b));
}

let changed = 0;
const report = [];
for (const entry of manifest.countries) {
  const prev = entry.regions || [];
  /* Union, not replacement. A region nobody gates on is still somewhere people
     live, and dropping it would leave a resident of Veneto with no honest
     answer to "which part of Italy?" but "not sure". The invariant that has to
     hold is one-directional: every admin_areas value must be offerable. */
  const next = [...new Set([...prev, ...regionsFor(entry.slug)])].sort((a, b) => a.localeCompare(b));
  const added = next.filter((r) => !prev.includes(r));
  if (added.length) {
    changed += 1;
    report.push(`  ${entry.slug}: +${added.length} (${added.slice(0, 6).join(', ')}${added.length > 6 ? '…' : ''})`);
  }
  entry.regions = next;
}

if (CHECK) {
  if (changed) {
    console.error(`\ndata/manifest.json regions are stale in ${changed} countries:\n${report.join('\n')}\n\nRun: node scripts/gen-manifest.mjs\n`);
    process.exit(1);
  }
  console.log('manifest regions match the data');
  process.exit(0);
}

manifest.generated_at = new Date().toISOString();
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nRegenerated manifest regions — ${changed} countries changed\n${report.join('\n')}\n`);
