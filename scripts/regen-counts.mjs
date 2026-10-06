#!/usr/bin/env node
/**
 * Rewrite every checked-in statement of a record count from the data.
 *
 *   data/startups/manifest.json   total + per-country count/verified/priced/open/closed
 *   data/manifest.json            total_programmes / total_verified
 *   native/STORE.md               "collects N programmes across J jurisdictions", "we track N closed"
 *   docs/DEMO.md                  the "numbers, as of this build" table
 *   scripts/baselines.json        the vague-source ceiling — a ratchet: lowered, never raised
 *
 * Adding, retiring or merging a record changes all of these, and a literal that
 * is wrong makes a build fail for a reason that has nothing to do with what
 * the build is testing. Run it after any data change (scripts/apply-verification.mjs
 * does), and `npm test` runs it first, so the documents can lag the data by at
 * most one command.
 *
 *   node scripts/regen-counts.mjs           # rewrite
 *   node scripts/regen-counts.mjs --check   # exit 1 if anything is stale
 *   node scripts/regen-counts.mjs --root <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeCounts, loadDatasets, fmt, roundTo, ROOT as REPO } from './lib/counts.mjs';
import { isVagueSource } from './harvest-sources.mjs';


export function vagueCount(root) {
  let n = 0;
  for (const s of loadDatasets(root)) for (const p of s.doc.programmes) if (isVagueSource(p.source_url)) n += 1;
  return n;
}

export function regenCounts({ root = REPO, check = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const counts = computeCounts(root);
  const stale = [];
  const writes = [];
  const edit = (rel, fn) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    const before = fs.readFileSync(abs, 'utf8');
    const after = fn(before);
    if (after !== before) { stale.push(rel); writes.push([abs, after]); }
  };

  /* ---- data/startups/manifest.json ---- */
  edit('data/startups/manifest.json', (raw) => {
    const m = JSON.parse(raw);
    const indent = (raw.match(/^\{\r?\n( *)"/) ?? [])[1]?.length ?? 1;
    const before = JSON.stringify(m);
    m.total = counts.company.total;
    for (const c of m.countries) {
      const live = counts.company.perCountry[c.slug];
      if (live) Object.assign(c, live);
    }
    if (JSON.stringify(m) === before) return raw;
    m.generated_at = today;
    return JSON.stringify(m, null, indent) + (raw.endsWith('\n') ? '\n' : '');
  });

  /* ---- data/manifest.json (household totals; the build recomputes them, but a stale one misleads a reader) ---- */
  edit('data/manifest.json', (raw) => {
    const m = JSON.parse(raw);
    if (m.total_programmes === counts.household.total && m.total_verified === counts.household.verified) return raw;
    const indent = (raw.match(/^\{\r?\n( *)"/) ?? [])[1]?.length ?? 2;
    m.total_programmes = counts.household.total;
    m.total_verified = counts.household.verified;
    return JSON.stringify(m, null, indent) + (raw.endsWith('\n') ? '\n' : '');
  });

  /* ---- native/STORE.md — the store listing is a representation; scripts/verify-native.mjs checks it ---- */
  edit('native/STORE.md', (s) => s
    .replace(/collects [\d,]+ programmes/, `collects ${fmt(roundTo(counts.total, 100))} programmes`)
    .replace(/across \d+ jurisdictions/, `across ${counts.jurisdictions} jurisdictions`)
    .replace(/we track [\d,]+ closed/, `we track ${fmt(counts.closed)} closed`));

  /* ---- docs/DEMO.md ---- */
  edit('docs/DEMO.md', (s) => s
    .replace(/\| Benefit programmes \| [\d,]+ across \d+ countries \|/, `| Benefit programmes | ${fmt(counts.household.total)} across ${counts.household.countries} countries |`)
    .replace(/\| Human-verified against the official page \| [\d,]+ \(\d+%\) \|/,
      `| Human-verified against the official page | ${fmt(counts.household.verified)} (${Math.round((counts.household.verified / counts.household.total) * 100)}%) |`)
    .replace(/\| Company funding programmes \| [\d,]+ across \d+ jurisdictions \|/,
      `| Company funding programmes | ${fmt(counts.company.total)} across ${counts.company.jurisdictions} jurisdictions |`));

  /* ---- scripts/baselines.json: ratchet ---- */
  {
    const rel = 'scripts/baselines.json';
    const abs = path.join(root, rel);
    const vague = vagueCount(root);
    const cur = fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : {};
    if (cur.vague_source_ceiling === undefined || vague < cur.vague_source_ceiling) {
      stale.push(rel);
      writes.push([abs, `${JSON.stringify({ ...cur, vague_source_ceiling: vague }, null, 2)}\n`]);
    }
  }

  if (!check) for (const [abs, text] of writes) fs.writeFileSync(abs, text);
  return { counts, stale };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--root');
  const { counts, stale } = regenCounts({ root: i >= 0 ? path.resolve(argv[i + 1]) : REPO, check: argv.includes('--check') });
  const line = `household ${counts.household.total} (${counts.household.verified} verified), company ${counts.company.total} (${counts.company.verified} verified, ${counts.company.closed} closed), ${counts.jurisdictions} jurisdictions`;
  if (argv.includes('--check')) {
    if (stale.length) { console.error(`stale: ${stale.join(', ')}\n${line}\nRun: node scripts/regen-counts.mjs`); process.exit(1); }
    console.log(`counts are current — ${line}`);
  } else {
    console.log(stale.length ? `regenerated ${stale.join(', ')} — ${line}` : `counts already current — ${line}`);
  }
}
