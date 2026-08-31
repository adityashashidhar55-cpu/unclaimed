#!/usr/bin/env node
/**
 * Which records are worth spending a page fetch on, in the order to spend it.
 *
 * A crawl over every record without a figure would be 2,432 fetches, and most
 * of that budget would go on free schooling and metro discounts, where there
 * is no figure to find. `needsFigure()` in packages/amounts narrows it to the
 * 1,224 cash-shaped awards whose figure is simply missing.
 *
 * Order matters because a budget usually runs out. Records are ranked by how
 * much a missing figure costs a reader:
 *
 *   1. National programmes over local ones — more people reach them.
 *   2. Programmes that pay automatically, because a reader who does not know
 *      the figure cannot tell whether it is worth checking they receive it.
 *   3. Countries with the most traffic, from the manifest's own ordering.
 *
 * Output is a JSON worklist. It does not fetch anything: the fetch step needs
 * a Firecrawl key this repo deliberately does not hold, so it runs outside and
 * writes markdown into `harvest/pages/<slug>.md`. `scripts/harvest-apply.mjs`
 * then reads those files and proposes amounts, with the funder's own sentence
 * attached as evidence for every one.
 *
 * Usage:
 *   node scripts/harvest-worklist.mjs             > harvest/worklist.json
 *   node scripts/harvest-worklist.mjs --limit 200 > harvest/worklist.json
 *   node scripts/harvest-worklist.mjs --country gb
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsFigure, awardType } from '../packages/amounts/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const limit = parseInt(arg('limit', '0'), 10) || 0;
const onlyCountry = arg('country');

function load(dir, skip) {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && !skip.includes(f))
    .flatMap((f) => {
      const cc = f.replace(/\.json$/, '');
      return (JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')).programmes || []).map((p) => ({
        ...p,
        _cc: p.country_code || cc,
        _file: path.join(dir, f),
      }));
    });
}

const individual = load('data', ['manifest.json', 'mcp-tools.json', 'fx-rates.json']);
const startups = load('data/startups', ['manifest.json']);
const all = [...individual, ...startups];

const LEVEL_RANK = { national: 0, federal: 0, state: 1, region: 1, province: 1, city: 2, municipal: 2, local: 2 };

const work = all
  .filter((p) => needsFigure(p))
  .filter((p) => !onlyCountry || p._cc === onlyCountry)
  .map((p) => ({
    slug: p.slug,
    file: p._file,
    country: p._cc,
    name: p.name_en || p.name_local,
    funder: p.funder,
    award: awardType(p),
    url: p.source_url,
    /* Carried through so the apply step can check the page still describes
       this programme before believing any figure it finds on it. */
    name_local: p.name_local,
    current_note: p.amount_note ?? null,
    verification_status: p.verification_status ?? null,
    _rank: [
      LEVEL_RANK[p.admin_level] ?? 3,
      p.is_automatic ? 0 : 1,
    ],
  }))
  .sort((a, b) => a._rank[0] - b._rank[0] || a._rank[1] - b._rank[1] || a.country.localeCompare(b.country))
  .map(({ _rank, ...rest }) => rest);

const out = limit ? work.slice(0, limit) : work;

/* A worklist that silently loses records is worse than no worklist, so the
   header states what was considered and what was selected. */
const summary = {
  generated_at: new Date().toISOString(),
  corpus: all.length,
  needing_a_figure: work.length,
  selected: out.length,
  estimated_credits: out.length,
  note: 'One markdown scrape per record, 1 Firecrawl credit each. Records with no source_url are excluded.',
};

process.stdout.write(JSON.stringify({ ...summary, records: out.filter((r) => r.url) }, null, 2));
process.stderr.write(
  `\nWorklist: ${out.length} of ${work.length} records needing a figure (corpus ${all.length}).\n` +
    `Estimated cost: ${out.filter((r) => r.url).length} Firecrawl credits at 1 per markdown scrape.\n`,
);
