#!/usr/bin/env node
/**
 * The records whose "source" is a homepage.
 *
 * This is the largest quality problem in the dataset and it was invisible
 * because every record has a source_url and none of them are broken links:
 *
 *   1,702 of 3,900 records (44%) cite a BARE DOMAIN — `https://www.caf.fr`
 *   rather than the CAF page about the prime à la naissance. 1,817 do the same
 *   for the application link, so the button marked "Apply" opens a national
 *   portal's front door. And 451 of those records are marked `verified`,
 *   which means somebody verified them against a homepage.
 *
 * It also explains most of the missing amounts. You cannot extract a figure
 * from a page that does not describe the programme, so a record whose source
 * is a homepage was never going to have one.
 *
 * The fix is a search, not a scrape. Firecrawl's search takes the programme
 * name scoped to the funder's own domain and returns the real page — and,
 * usefully often, the figure in the snippet, so one 2-credit search fixes both
 * the link and the amount. Two live probes:
 *
 *   paje-prime-naissance-adoption  caf.fr           → the Paje page, and
 *                                                     "1 093,08 €" in the snippet
 *   grundrentenzuschlag            deutsche-rentenversicherung.de
 *                                                   → the DRV FAQ, and the
 *                                                     formula that shows why
 *                                                     this one has no single
 *                                                     figure to publish
 *
 * Usage:
 *   node scripts/harvest-sources.mjs                # the worklist, as JSON
 *   node scripts/harvest-sources.mjs --limit 100
 *   node scripts/harvest-sources.mjs --country fr
 *   node scripts/harvest-sources.mjs --count        # just the numbers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsFigure } from '../packages/amounts/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const limit = parseInt(arg('limit', '0'), 10) || 0;
const onlyCountry = arg('country');
const countOnly = argv.includes('--count');

/** How specific a URL is. 0 = a bare domain, 1 = one path segment. */
export function pathDepth(u) {
  try {
    return new URL(u).pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
  } catch {
    return -1;
  }
}

/** A source that cannot possibly describe one programme. */
export const isVagueSource = (u) => pathDepth(u) <= 1;

/* Everything below runs only when this file is the program.
 *
 * scripts/verify.mjs imports `isVagueSource` from here to assert the ratchet,
 * and an unguarded top-level `process.stdout.write` meant importing it printed
 * a 2,358-record worklist into the middle of the verifier's output. A module
 * that does work on import is a module you cannot reuse. */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function load(dir, skip) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && !skip.includes(f))
    .flatMap((f) => {
      const cc = f.replace(/\.json$/, '');
      return (JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')).programmes || [])
        .map((p) => ({ ...p, _cc: p.country_code || cc, _file: path.join(dir, f) }));
    });
}

if (isMain) main();

function main() {
const all = [
  ...load('data', ['manifest.json', 'mcp-tools.json', 'fx-rates.json']),
  ...load('data/startups', ['manifest.json']),
];

const vague = all.filter((p) => isVagueSource(p.source_url));

if (countOnly) {
  const bare = all.filter((p) => pathDepth(p.source_url) === 0).length;
  const one = all.filter((p) => pathDepth(p.source_url) === 1).length;
  const appBare = all.filter((p) => pathDepth(p.application_url) === 0).length;
  const verifiedVague = all.filter((p) => p.verification_status === 'verified' && isVagueSource(p.source_url)).length;
  console.log(`corpus                          ${all.length}`);
  console.log(`source_url is a bare domain     ${bare}`);
  console.log(`source_url has one segment      ${one}`);
  console.log(`application_url is bare         ${appBare}`);
  console.log(`marked verified, vague source   ${verifiedVague}`);
  console.log(`also missing an amount          ${vague.filter(needsFigure).length}`);
  process.exit(0);
}

/* A record that is BOTH mis-sourced and missing its amount is worth two fixes
   for one search, so those come first. National before local after that: more
   people reach them. */
const LEVEL = { national: 0, federal: 0, state: 1, region: 1, province: 1, city: 2, municipal: 2, local: 2 };

const work = vague
  .filter((p) => !onlyCountry || p._cc === onlyCountry)
  .map((p) => {
    let host = '';
    try { host = new URL(p.source_url).hostname.replace(/^www\./, ''); } catch { /* left blank */ }
    return {
      slug: p.slug,
      file: p._file,
      country: p._cc,
      name: p.name_en || p.name_local,
      name_local: p.name_local,
      funder: p.funder,
      site: host,
      current_source: p.source_url,
      also_needs_amount: needsFigure(p),
      verification_status: p.verification_status ?? null,
      /* The query to run. Local name first: a funder's own site indexes the
         programme under its own name, and the English translation often
         appears nowhere on it. */
      query: [p.name_local, p.name_local !== p.name_en ? p.name_en : null, p.funder]
        .filter(Boolean).join(' ').slice(0, 180),
      _rank: [p.amount_min == null && p.amount_max == null ? 0 : 1, LEVEL[p.admin_level] ?? 3],
    };
  })
  .sort((a, b) => a._rank[0] - b._rank[0] || a._rank[1] - b._rank[1] || a.country.localeCompare(b.country))
  .map(({ _rank, ...r }) => r);

const out = limit ? work.slice(0, limit) : work;

process.stdout.write(JSON.stringify({
  generated_at: new Date().toISOString(),
  corpus: all.length,
  vague_sources: vague.length,
  selected: out.length,
  estimated_credits: out.length * 2,
  note: 'One Firecrawl search per record, scoped to the funder’s own domain. 2 credits each; the snippet often carries the figure too, which saves a scrape.',
  records: out,
}, null, 2));

process.stderr.write(`\n${out.length} of ${vague.length} mis-sourced records selected (corpus ${all.length}).\nEstimated cost: ${out.length * 2} Firecrawl credits.\n`);
}
