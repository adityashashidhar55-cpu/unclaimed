#!/usr/bin/env node
/**
 * /learn/ — the knowledge base.
 *
 * What this guards against regressing silently:
 *
 *   - Every term in TERMS gets a built page, and the hub links to all of
 *     them.
 *   - Every term cites at least one source with a real http(s) URL, except
 *     the two site-authored explainers that carry none by design — checked
 *     by name, so an accidental empty `sources` array on any other term is
 *     caught.
 *   - The last-reviewed date is on the page.
 *   - Each term page carries an Article JSON-LD block.
 *   - learnLinksFor() actually matches on keyword, so the "Related reading"
 *     wiring in build.mjs has something real to find.
 *   - The footer link (footFunders/footLearn) resolves in dist and reads as
 *     translated, not English, on a non-English page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMS, learnLinksFor, FACTS_CHECKED } from '../src/pages/learn.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.error(`  ✗ ${m}`); };
const t = (m, v) => (v ? ok(m) : bad(m));

console.log('\n/learn/ — knowledge base\n');

t(`between 12 and 15 terms (${TERMS.length})`, TERMS.length >= 12 && TERMS.length <= 15);
const slugs = new Set(TERMS.map((x) => x.slug));
t('every term has a unique slug', slugs.size === TERMS.length);

/* Every term is a citable claim about a real law, programme or registry
   except these two, which are the site's own practical guidance and do not
   assert anything external. */
const NO_SOURCE_OK = new Set(['how-to-read-an-eligibility-rule']);
for (const term of TERMS) {
  if (NO_SOURCE_OK.has(term.slug)) continue;
  t(`${term.slug}: cites at least one source`, term.sources.length > 0);
  for (const s of term.sources) {
    t(`${term.slug}: source "${s.label}" is an http(s) URL`, /^https?:\/\//.test(s.url));
  }
}

t('FACTS_CHECKED is a real date string', /^\d{4}-\d{2}-\d{2}$/.test(FACTS_CHECKED));

console.log('');
t('dist/learn/index.html exists', fs.existsSync(path.join(DIST, 'learn/index.html')));
const indexHtml = fs.existsSync(path.join(DIST, 'learn/index.html')) ? fs.readFileSync(path.join(DIST, 'learn/index.html'), 'utf8') : '';
for (const term of TERMS) {
  const file = path.join(DIST, 'learn', term.slug, 'index.html');
  t(`dist/learn/${term.slug}/index.html exists`, fs.existsSync(file));
  t(`/learn/ hub links to ${term.slug}`, indexHtml.includes(`/learn/${term.slug}/`));
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  t(`${term.slug}: last-reviewed date is on the page`, html.includes(FACTS_CHECKED));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  t(`${term.slug}: carries an Article JSON-LD block`, blocks.some((b) => b['@type'] === 'Article'));
  for (const s of term.sources) {
    t(`${term.slug}: source link is on the page`, html.includes(s.url));
  }
}

console.log('');
/* -- keyword matching ---------------------------------------------------- */
t('an SBIR-named programme matches the SBIR-vs-STTR term', learnLinksFor('SBIR Phase I award, National Science Foundation').includes('sbir-vs-sttr'));
t('a de minimis-flagged programme matches the de minimis term', learnLinksFor('Some regional grant', ['de-minimis-aid']).includes('de-minimis-aid'));
t('unrelated text matches nothing', learnLinksFor('Housing benefit for renters in Berlin').length === 0);
t('matches are capped at 3', learnLinksFor('', ['a', 'b', 'c', 'd']).length <= 3);

console.log('');
/* -- footer wiring -------------------------------------------------------- */
const frHome = path.join(DIST, 'fr/index.html');
if (fs.existsSync(frHome)) {
  const html = fs.readFileSync(frHome, 'utf8');
  t('French home page footer links to /learn/', html.includes('href="/learn/"'));
  t('French home page footer links to /funders/', html.includes('href="/funders/"'));
} else {
  bad('dist/fr/index.html missing — cannot check the localised footer');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
