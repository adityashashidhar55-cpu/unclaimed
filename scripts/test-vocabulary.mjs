#!/usr/bin/env node
/**
 * The question and the engine must speak the same language.
 *
 * This exists because they stopped. The check offered "EU / EEA national" and
 * "Other legal residence"; the matcher understood neither, so every programme
 * failed its residency test and an EU national in the UK was told they
 * qualified for nothing — 0 eligible, 114 rejected — with no error anywhere.
 * A silently empty result is the worst failure this product has: the reader
 * concludes there is no money and leaves.
 *
 * It then went on checking exactly that one field on exactly that one wizard,
 * and the same bug shipped again on the company side: STAGES offered
 * `preseed`, `seriesa` and `established`; the data and src/engine/startup.js
 * only ever say `pre_seed`, `series_a` and `growth`; and three of the five
 * answers matched nothing at all. Picking "Series A or later" for the UK
 * returned "2 programmes" and no money figure. 19 assertions passed over it.
 *
 * Worse, it read the option list out of src/pwa/app.js while the website
 * serves src/app.js — so it could go green on a vocabulary the web wizard does
 * not use. (Those two files ARE two separate wizards, not two copies: app.js
 * is the site's /check/, pwa/app.js is the installed app shell. Both are
 * enumerated below, because both ship.)
 *
 * So this is a loop over (shipped source, option list, data field) triples.
 * Adding a question means adding a row. One loop catches every future
 * instance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/engine/matcher.js';
import { matchStartup, reachFor } from '../src/engine/startup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const STARTUPS = path.join(DATA, 'startups');

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull an option list out of a shipped source file.
 *
 * Two shapes exist in this codebase: a `const NAME = [ ['value', 'Label'] ]`
 * table, and a question object with `id: 'field'` followed by its options.
 * Both are read from the file the browser is served — never restated here,
 * because a test with its own copy of the answer list passes happily through
 * the entire bug.
 */
function optionsFromTable(src, name) {
  const i = src.indexOf(`const ${name} = [`);
  if (i < 0) return null;
  const end = src.indexOf('\n];', i);
  const block = src.slice(i, end < 0 ? undefined : end);
  return [...block.matchAll(/\[\s*'([a-z_0-9]+)'\s*,/g)].map((m) => m[1]);
}

function optionsFromQuestion(src, field) {
  const start = src.indexOf(`id: '${field}'`);
  if (start < 0) return null;
  const end = src.indexOf("id: '", start + 10);
  const block = src.slice(start, end > 0 ? end : undefined);
  return [...block.matchAll(/\['([a-z_]+)',/g)].map((m) => m[1]);
}

/** Distinct values a field actually takes across a set of data files. */
function dataValues(dir, files, pick) {
  const out = new Set();
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of doc.programmes || []) for (const v of pick(p) || []) if (v) out.add(v);
  }
  return out;
}

const countryFiles = fs
  .readdirSync(DATA)
  .filter((f) => f.endsWith('.json') && !['manifest.json', 'fx-rates.json', 'mcp-tools.json'].includes(f));
const startupFiles = fs.readdirSync(STARTUPS).filter((f) => f.endsWith('.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));

const webSrc = read('src/app.js');
const appSrc = read('src/pwa/app.js');
const startupSrc = read('src/pwa/startup-check.js');

/* ------------------------------------------------------------------ *
 * The triples. Each says: this shipped file offers these answers, and
 * the data speaks this vocabulary for that field.
 * ------------------------------------------------------------------ */
const TRIPLES = [
  {
    label: 'web wizard (src/app.js → dist/app.js) · nationality_group',
    offered: optionsFromTable(webSrc, 'NATIONALITY'),
    /* The matcher's own mapping table, not a restatement of it. */
    understood: (() => {
      const src = read('src/engine/matcher.js');
      const i = src.indexOf('const NATIONALITY_SATISFIED_BY');
      const block = src.slice(i, src.indexOf('};', i));
      return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    })(),
  },
  {
    label: 'web wizard · housing_tenure',
    offered: optionsFromTable(webSrc, 'TENURES'),
    understood: dataValues(DATA, countryFiles, (p) => [p.eligibility?.housing_tenure]),
    /* A tenure the data never gates on is not a broken answer — it is an
       answer no programme cares about. Only the reverse direction is a bug. */
    offeredMayExceedData: true,
  },
  {
    label: 'web wizard · status',
    offered: optionsFromTable(webSrc, 'STATUSES'),
    understood: dataValues(DATA, countryFiles, (p) => p.eligibility?.statuses || []),
    offeredMayExceedData: true,
  },
  {
    label: 'app shell (src/pwa/app.js) · nationality_group',
    offered: optionsFromQuestion(appSrc, 'nationality_group'),
    understood: (() => {
      const src = read('src/engine/matcher.js');
      const i = src.indexOf('const NATIONALITY_SATISFIED_BY');
      const block = src.slice(i, src.indexOf('};', i));
      return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    })(),
  },
  {
    label: 'company wizard (src/pwa/startup-check.js) · stage',
    offered: optionsFromTable(startupSrc, 'STAGES'),
    understood: dataValues(STARTUPS, startupFiles, (p) => p.eligibility?.stages || []),
  },
  {
    label: 'company wizard · sectors',
    offered: optionsFromTable(startupSrc, 'SECTORS'),
    understood: dataValues(STARTUPS, startupFiles, (p) => p.eligibility?.sectors || []),
    offeredMayExceedData: true,
  },
];

console.log('\nEvery answer a wizard offers is one the engine speaks\n');

for (const trip of TRIPLES) {
  if (!trip.offered || !trip.offered.length) {
    t(`${trip.label}: the option list was found`, false, 'the extractor found no answers — the list moved or was renamed');
    continue;
  }
  t(`${trip.label}: ${trip.offered.length} answers offered`, true, JSON.stringify(trip.offered));
  if (trip.offeredMayExceedData) continue;
  for (const a of trip.offered) {
    t(`  "${a}" is a value the data uses`, trip.understood.has(a),
      `answering this matches nothing; the data says ${[...trip.understood].sort().join(', ')}`);
  }
}

/* Every value the DATA gates on must be reachable from some answer. A stage
   in the data with no tile is a programme nobody can find. */
{
  const stages = dataValues(STARTUPS, startupFiles, (p) => p.eligibility?.stages || []);
  const offered = new Set(optionsFromTable(startupSrc, 'STAGES') || []);
  const unreachable = [...stages].filter((s) => !offered.has(s));
  t('every stage the startup data gates on has a tile in the company wizard',
    unreachable.length === 0, unreachable.join(', '));
}

/* ------------------------------------------------------------------ *
 * And the end-to-end assertion that actually matters.
 * ------------------------------------------------------------------ */
console.log('\nNobody is told they qualify for nothing\n');

for (const cc of ['gb', 'de', 'fr', 'us']) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, `${cc}.json`), 'utf8'));
  const entry = manifest.countries.find((c) => c.slug === cc);
  for (const answer of optionsFromTable(webSrc, 'NATIONALITY')) {
    const r = match(
      { country_code: cc, status: 'unemployed', income_band: 'low', housing_tenure: 'renting', age: 34, nationality_group: answer },
      data, entry,
    );
    const shown = r.eligible.length + r.conditional.length + r.needs_one_more_answer.length;
    t(`${cc}/${answer} gets something back (${r.eligible.length} eligible, ${shown} shown)`, shown > 0);
  }
}

{
  const poolCache = {};
  const poolsFor = (cc) => {
    const out = {};
    for (const pool of reachFor(cc)) {
      if (!(pool in poolCache)) {
        const p = path.join(STARTUPS, `${pool}.json`);
        poolCache[pool] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { programmes: [] };
      }
      out[pool] = poolCache[pool];
    }
    return out;
  };
  /* Every stage tile, in the major markets, must produce a non-empty eligible
     bucket. This is the assertion B4 would have failed: preseed → 0,
     seriesa → 0, established → 0, silently, on three of five answers. */
  for (const cc of ['gb', 'us', 'de', 'fr']) {
    for (const stage of optionsFromTable(startupSrc, 'STAGES')) {
      const r = matchStartup(
        { country_code: cc, incorporated: true, headcount: 10, turnover_annual_eur: 500000, stage, sectors: ['software'], rd_active: true },
        poolsFor(cc), Date.now(),
      );
      const eligible = (r.buckets?.eligible ?? r.eligible ?? []).length;
      t(`${cc}/${stage} returns a non-empty eligible bucket (${eligible})`, eligible > 0);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Manifest fields a client reads must exist in the built manifest.
 *
 * src/pwa/startup-check.js read `c.programme_count` off an index whose field
 * is `count`, and the `?? 0` beside it turned all 77 jurisdictions into
 * "0 programmes" one click after the landing page advertises 1,684. The `??`
 * is what made it silent, so the guard is on the field, not the render.
 * ------------------------------------------------------------------ */
console.log('\nManifest fields a client reads\n');
{
  const MANIFESTS = [
    {
      label: '/api/v1/startups/index.json (company wizard)',
      file: path.join(ROOT, 'dist/api/v1/startups/index.json'),
      entries: (j) => j.countries || [],
      reads: (() => {
        const m = startupSrc.match(/MANIFEST_FIELDS_READ = \[([^\]]*)\]/);
        return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
      })(),
    },
    {
      label: '/api/v1/countries.json (web wizard)',
      file: path.join(ROOT, 'dist/api/v1/countries.json'),
      entries: (j) => j.countries || [],
      /* Read straight out of the shipped source: every `c.<field>` the
         country PICKER touches. Scoped to viewCountry() — `c` is also the
         loop variable for clamp notes elsewhere in the file, and an unscoped
         scan reported `c.from` and `c.to` as missing manifest fields. */
      reads: (() => {
        const i = webSrc.indexOf('function viewCountry()');
        const body = webSrc.slice(i, webSrc.indexOf('\nfunction ', i + 10));
        return [...new Set([...body.matchAll(/\bc\.([a-z_]+)\b/g)].map((m) => m[1]))];
      })(),
    },
  ];
  for (const man of MANIFESTS) {
    if (!fs.existsSync(man.file)) { t(`${man.label} exists in dist/`, false, man.file); continue; }
    const j = JSON.parse(fs.readFileSync(man.file, 'utf8'));
    const entries = man.entries(j);
    t(`${man.label} has entries`, entries.length > 0);
    const missing = man.reads.filter((f) => !entries.some((e) => e[f] !== undefined));
    t(`${man.label}: every field the client reads exists on at least one entry`,
      missing.length === 0, `absent from every entry: ${missing.join(', ')}`);
    /* And the specific silent-zero: a jurisdiction whose count is positive
       must not be readable as zero. */
    if (man.reads.includes('count')) {
      const zeros = entries.filter((e) => (e.count ?? 0) > 0 && (e.programme_count ?? 0) === 0 && e.programme_count !== undefined);
      t(`${man.label}: no entry carries a contradictory zero`, zeros.length === 0);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
