#!/usr/bin/env node
/**
 * Find likely-duplicate company/startup grant records inside data/startups/.
 *
 * Programmes are hand-harvested per jurisdiction, and the same underlying
 * scheme has repeatedly been added twice under two slugs — once early with a
 * short slug (`eic-accelerator`), once later with a jurisdiction-prefixed one
 * (`eu-eic-accelerator`) — sometimes with a different funder string, a
 * different amount, or a different verification status. A visitor who lands
 * on both pages from search sees the same programme counted twice and two
 * different "amount you could get" figures for it, which is the one thing
 * this site cannot afford to get wrong.
 *
 * A pair is flagged when, within the SAME jurisdiction file:
 *   - the funder strings normalise to the same value AND the programme names
 *     are at least 0.7 token-Jaccard similar, OR
 *   - the source_url paths (scheme/host/path, query and fragment stripped)
 *     are identical.
 *
 * This is a finder, not a merger: it prints candidates for a human to read
 * and decide on. Real merges are recorded in data/startups/dedupe-log.json
 * (what got merged into what, and why) and reviewed look-alikes that are
 * genuinely different tracks/programmes live in
 * data/startups/duplicate-allowlist.json. scripts/test-duplicates.mjs is the
 * regression test: it fails the build if this script finds anything new that
 * is not already on that allowlist.
 *
 *   node scripts/find-duplicates.mjs            # human-readable report
 *   node scripts/find-duplicates.mjs --json      # machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVagueSource } from './harvest-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STARTUPS_DIR = path.join(ROOT, 'data', 'startups');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'to', 'on', 'at', 'by',
  'is', 'as', 'it', 'its', 'with', 'grant', 'grants', 'fund', 'programme',
  'program', 'scheme',
]);

/** Lowercase, strip punctuation, drop stopwords and short filler tokens. */
export function tokenize(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents so café === cafe
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

export function jaccard(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Legal-entity suffixes and punctuation stripped so "Amazon Web Services,
 * Inc." and "Amazon Web Services" normalise to the same funder. Content in
 * parentheses is dropped too — it is usually an alternate name for the same
 * body ("European Innovation Council (EISMEA)"), not a different funder. */
export function normaliseFunder(funder) {
  return (funder || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|sa|s\.a|plc|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** scheme+host+path only — query strings and fragments are noise for
 * "is this the same source page". */
export function urlPath(u) {
  try {
    const parsed = new URL(u);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Compare every pair of programmes within each jurisdiction file and return
 * the ones that look like the same programme recorded twice.
 */
export function findDuplicates({ dir = STARTUPS_DIR } = {}) {
  const results = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'duplicate-allowlist.json' && f !== 'dedupe-log.json' && f !== 'redirects.json');

  for (const f of files) {
    const country = f.replace(/\.json$/, '');
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const list = doc.programmes || [];

    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const nameSim = jaccard(a.name_en, b.name_en);
        const sameFunder = normaliseFunder(a.funder) === normaliseFunder(b.funder) && normaliseFunder(a.funder) !== '';
        const pathA = urlPath(a.source_url);
        const pathB = urlPath(b.source_url);
        /* A homepage or funder-overview URL ("klimafonds.gv.at/foerderungen/")
         * is cited by many genuinely different programmes from the same
         * funder — that is the pre-existing "vague source" debt tracked
         * elsewhere in this repo (scripts/harvest-sources.mjs, the
         * VAGUE_CEILING check in verify.mjs), not evidence of a duplicate.
         * Only a source specific enough to describe one programme counts
         * here, and even then only when the names also overlap somewhat —
         * two different schemes can still share one specific page (e.g. an
         * accelerator's general "investment terms" page). */
        const sameSource =
          pathA !== null && pathA === pathB && !isVagueSource(a.source_url) && !isVagueSource(b.source_url) && nameSim >= 0.3;

        const reason =
          sameFunder && nameSim >= 0.7
            ? `same funder, name similarity ${nameSim.toFixed(2)}`
            : sameSource
              ? `identical (specific) source_url, name similarity ${nameSim.toFixed(2)}`
              : null;
        if (!reason) continue;

        results.push({
          country,
          a: a.slug,
          b: b.slug,
          a_name: a.name_en,
          b_name: b.name_en,
          funder_a: a.funder,
          funder_b: b.funder,
          name_similarity: Number(nameSim.toFixed(3)),
          same_source_url: sameSource,
          reason,
        });
      }
    }
  }
  return results;
}

/** A pair is "reviewed" if either ordering of its slugs (within the same
 * country) appears on the allowlist. */
export function loadAllowlist(dir = STARTUPS_DIR) {
  const p = path.join(dir, 'duplicate-allowlist.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function isAllowlisted(pair, allowlist) {
  return allowlist.some(
    (entry) =>
      entry.country === pair.country &&
      ((entry.a === pair.a && entry.b === pair.b) || (entry.a === pair.b && entry.b === pair.a)),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asJson = process.argv.includes('--json');
  const dupes = findDuplicates();
  const allowlist = loadAllowlist();
  const unreviewed = dupes.filter((d) => !isAllowlisted(d, allowlist));

  if (asJson) {
    console.log(JSON.stringify({ total: dupes.length, unreviewed: unreviewed.length, pairs: dupes }, null, 2));
  } else {
    console.log(`\n${dupes.length} candidate pair(s) found across data/startups/ (${allowlist.length} already reviewed and allowlisted)\n`);
    for (const d of dupes) {
      const flag = isAllowlisted(d, allowlist) ? '  [allowlisted: reviewed, kept separate]' : '  [NOT REVIEWED]';
      console.log(`${d.country}: ${d.a}  <->  ${d.b}`);
      console.log(`  "${d.a_name}"  vs  "${d.b_name}"`);
      console.log(`  ${d.reason}${flag}`);
      console.log('');
    }
    if (unreviewed.length) {
      console.log(`${unreviewed.length} pair(s) are NOT on the allowlist — review and either merge them or add to data/startups/duplicate-allowlist.json.`);
    }
  }
  process.exit(0);
}
