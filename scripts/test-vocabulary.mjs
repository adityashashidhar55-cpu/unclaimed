#!/usr/bin/env node
/**
 * The question and the matcher must speak the same language.
 *
 * This exists because they stopped. The check offered "EU / EEA national" and
 * "Other legal residence"; the matcher understood neither, so every programme
 * failed its residency test and an EU national in the UK was told they
 * qualified for nothing — 0 eligible, 114 rejected — with no error anywhere.
 * A silently empty result is the worst failure this product has: the user
 * concludes there is no money and leaves.
 *
 * So: both vocabularies are read from the shipped source and the shipped data
 * rather than restated here. A test with its own copy of the answer list would
 * have passed happily through the entire bug.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/engine/matcher.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`));
};

/* ---- what the app can ANSWER, read out of the question definition ---- */
const appSrc = fs.readFileSync(path.join(ROOT, 'src/pwa/app.js'), 'utf8');
const qStart = appSrc.indexOf("id: 'nationality_group'");
/* Stop at the next question rather than at the first `],` — that closes the
   first OPTION, not the option list, and slicing there found exactly one
   answer and declared the vocabulary consistent. */
const qEnd = appSrc.indexOf("id: '", qStart + 10);
const block = appSrc.slice(qStart, qEnd > 0 ? qEnd : undefined);
const appAnswers = [...block.matchAll(/\['([a-z_]+)',/g)].map((m) => m[1]);

/* ---- what the matcher UNDERSTANDS, read out of the matcher ---- */
const matcherSrc = fs.readFileSync(path.join(ROOT, 'src/engine/matcher.js'), 'utf8');
const mapBlock = matcherSrc.slice(
  matcherSrc.indexOf('const NATIONALITY_SATISFIED_BY'),
  matcherSrc.indexOf('};', matcherSrc.indexOf('const NATIONALITY_SATISFIED_BY')),
);
const understood = new Set([...mapBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

console.log('\nResidency vocabulary');
t(`the check offers ${appAnswers.length} residency answers`, appAnswers.length >= 3, JSON.stringify(appAnswers));
for (const a of appAnswers) {
  t(`the matcher understands "${a}"`, understood.has(a), 'answering this rejects every programme');
}

/* ---- every requirement in the data must be mapped ---- */
const DATA = path.join(ROOT, 'data');
const requirements = new Set();
for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.json') || f === 'manifest.json' || f === 'mcp-tools.json') continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).programmes ?? []) {
    const n = p.eligibility?.nationality;
    if (n && n !== 'any') requirements.add(n);
  }
}
const mappedKeys = [...mapBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
for (const req of requirements) {
  t(`the data's "${req}" requirement is mapped`, mappedKeys.includes(req), 'unmapped requirements become questions, not rejections');
}

/* ---- and the end-to-end assertion that actually matters ---- */
console.log('\nNobody is told they qualify for nothing');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
for (const cc of ['gb', 'de', 'fr', 'us']) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, `${cc}.json`), 'utf8'));
  const entry = manifest.countries.find((c) => c.slug === cc);
  for (const answer of appAnswers) {
    const r = match(
      { country_code: cc, status: 'unemployed', income_band: 'low', housing_tenure: 'renting', age: 34, nationality_group: answer },
      data,
      entry,
    );
    const shown = r.eligible.length + r.conditional.length + r.needs_one_more_answer.length;
    t(`${cc}/${answer} gets something back (${r.eligible.length} eligible, ${shown} shown)`, shown > 0);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
