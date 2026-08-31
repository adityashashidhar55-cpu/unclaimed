#!/usr/bin/env node
/**
 * Turn fetched funder pages into proposed amounts, with the funder's own
 * sentence attached to every one.
 *
 * The fetch is deliberately not in this script. Firecrawl needs a key this
 * repo does not hold, and more importantly a harvest that fetches and writes
 * in one pass cannot be reviewed — the interesting question is always "where
 * did that number come from", and by the time it is a row in data/ the page it
 * came from is gone. So the fetch writes markdown into `harvest/pages/`, and
 * this reads those files.
 *
 * What it will and will not do is the whole design:
 *
 *   - It proposes. Nothing is written to data/ without --apply, and even then
 *     every proposal carries `amount_source_url`, `amount_evidence` (the exact
 *     sentence) and `amount_reviewed_at`, so a wrong number can be traced to
 *     the page that produced it rather than argued about.
 *   - It uses the SAME strict extractor the migration used
 *     (scripts/lib/amount-extract.mjs), which refuses a means test, a price, a
 *     threshold and anything without a payment verb, a currency and a period.
 *     That extractor lifted only 49 of 123 candidates on purpose. Loosening it
 *     here to raise the hit rate would be reintroducing the exact bug the whole
 *     product is built to avoid.
 *   - A page that no longer names the programme is reported as a broken
 *     source, not mined for a number. A funder who reorganised their site is
 *     the most common way a "verified" record quietly becomes wrong.
 *
 * Usage:
 *   node scripts/harvest-apply.mjs                 # report only
 *   node scripts/harvest-apply.mjs --apply         # write the confident ones
 *   node scripts/harvest-apply.mjs --json out.json # machine-readable proposals
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPayment, extractAidIntensity } from './lib/amount-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = path.join(ROOT, 'harvest', 'pages');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const jsonOut = argv[argv.indexOf('--json') + 1];

if (!fs.existsSync(PAGES)) {
  console.error(`No fetched pages at ${path.relative(ROOT, PAGES)}.\nRun scripts/harvest-worklist.mjs, fetch each url, and write the markdown there as <slug>.md.`);
  process.exit(1);
}

/** Load every record once, remembering which file it came from. */
function loadAll() {
  const out = new Map();
  for (const [dir, skip] of [['data', ['manifest.json', 'mcp-tools.json', 'fx-rates.json']], ['data/startups', ['manifest.json']]]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.json') || skip.includes(f)) continue;
      const rel = path.join(dir, f);
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      for (const p of j.programmes || []) out.set(p.slug, { p, file: rel });
    }
  }
  return out;
}

/**
 * Does this page still describe this programme?
 *
 * Cheap and deliberately generous: a funder's page uses their own casing,
 * their own diacritics and often only part of the name. Requiring the whole
 * English name would reject most live pages. Requiring nothing would mine a
 * cookie banner for a number.
 */
function stillAboutIt(text, programme) {
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hay = norm(text);
  for (const name of [programme.name_local, programme.name_en]) {
    const words = norm(name).split(' ').filter((w) => w.length > 3);
    if (!words.length) continue;
    const hits = words.filter((w) => hay.includes(w)).length;
    if (hits / words.length >= 0.5) return true;
  }
  return false;
}

/** Sentences, so the evidence quoted back is a sentence and not 400 characters. */
const sentences = (text) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const records = loadAll();
const files = fs.readdirSync(PAGES).filter((f) => f.endsWith('.md'));

const proposals = [];
const problems = [];

for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const entry = records.get(slug);
  if (!entry) { problems.push({ slug, reason: 'no_such_record' }); continue; }
  const { p } = entry;

  const text = fs.readFileSync(path.join(PAGES, file), 'utf8');
  if (text.trim().length < 200) { problems.push({ slug, reason: 'page_empty' }); continue; }
  if (!stillAboutIt(text, p)) { problems.push({ slug, reason: 'page_no_longer_names_the_programme', url: p.source_url }); continue; }

  /* One sentence at a time, so the evidence is the sentence the number came
     from. Running the extractor over the whole page would find a number and
     lose the context that decides whether it is a payment. */
  let hit = null;
  for (const s of sentences(text)) {
    const pay = extractPayment(s);
    if (pay) { hit = { kind: 'payment', ...pay, evidence: s.slice(0, 300) }; break; }
  }
  if (!hit) {
    for (const s of sentences(text)) {
      const pct = extractAidIntensity(s);
      if (pct != null) { hit = { kind: 'rate', pct, evidence: s.slice(0, 300) }; break; }
    }
  }

  if (!hit) { problems.push({ slug, reason: 'no_figure_the_extractor_will_stand_behind', url: p.source_url }); continue; }

  proposals.push({
    slug,
    file: entry.file,
    name: p.name_en || p.name_local,
    funder: p.funder,
    current: { amount_min: p.amount_min, amount_max: p.amount_max },
    proposed: hit.kind === 'payment'
      ? { amount_min: hit.value, amount_max: hit.value, amount_period: hit.period, amount_currency: p.amount_currency ?? null }
      : { cofunding_pct: hit.pct },
    evidence: hit.evidence,
    source_url: p.source_url,
  });
}

console.log(`\nHarvest: ${files.length} pages read\n`);
console.log(`  ${proposals.length} propose a figure the strict extractor will stand behind`);
console.log(`  ${problems.length} do not:`);
const byReason = {};
for (const pr of problems) byReason[pr.reason] = (byReason[pr.reason] ?? 0) + 1;
for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)}  ${r}`);

console.log('\nProposals:\n');
for (const pr of proposals) {
  const v = pr.proposed.cofunding_pct != null
    ? `${pr.proposed.cofunding_pct}% co-funding`
    : `${pr.proposed.amount_min} ${pr.proposed.amount_currency ?? ''} ${pr.proposed.amount_period}`.trim();
  console.log(`  ${pr.slug}`);
  console.log(`      ${v}`);
  console.log(`      “${pr.evidence}”`);
  console.log(`      ${pr.source_url}\n`);
}

if (jsonOut) {
  fs.writeFileSync(path.join(ROOT, jsonOut), JSON.stringify({ proposals, problems }, null, 2));
  console.log(`Written to ${jsonOut}`);
}

if (!APPLY) {
  console.log('Nothing written. Re-run with --apply to write these into data/.');
  process.exit(0);
}

/* Applying. Grouped by file so each data file is read and written once. */
const byFile = new Map();
for (const pr of proposals) {
  if (!byFile.has(pr.file)) byFile.set(pr.file, []);
  byFile.get(pr.file).push(pr);
}

const now = new Date().toISOString().slice(0, 10);
let written = 0;
for (const [rel, list] of byFile) {
  const full = path.join(ROOT, rel);
  const j = JSON.parse(fs.readFileSync(full, 'utf8'));
  for (const pr of list) {
    const rec = (j.programmes || []).find((x) => x.slug === pr.slug);
    if (!rec) continue;
    Object.assign(rec, pr.proposed);
    /* Every applied figure carries where it came from and what it said. A
       number in this dataset with no evidence is a number nobody can defend
       when a reader asks why they were told they would get it. */
    rec.amount_source_url = pr.source_url;
    rec.amount_evidence = pr.evidence;
    rec.amount_reviewed_at = now;
    written += 1;
  }
  fs.writeFileSync(full, `${JSON.stringify(j, null, 2)}\n`);
}
console.log(`\nApplied ${written} figures, each with its source url and the funder's own sentence.`);
