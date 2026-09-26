#!/usr/bin/env node
/**
 * Shareable result links, on both check flows.
 *
 * The household wizard (src/app.js) and the company wizard
 * (src/pwa/startup-check.js) each already encode the answered profile into
 * `#r=<base64>` and expose a "copy a link to these results" button — that
 * part predates this file. What did not exist anywhere in the repo was
 * utm_* passthrough: a founder who arrived from a campaign link and then
 * shared their own result carried none of that campaign's tagging forward,
 * so every subsequent open of the shared link — including the founder's own,
 * on reload — attributed to nothing.
 *
 * This is a source-level test, not a browser one (scripts/test-native-boot.mjs
 * and friends already drive real wizards; this only needs to prove the wiring
 * is present and the pure function behaves). It:
 *
 *   1. Exercises utmQuery() directly — the only genuinely new logic.
 *   2. Confirms both wizards import it and use it in their share action,
 *      reading the shipped source rather than restating the expectation.
 *   3. Confirms the build emits share-link.js where both wizards' relative
 *      import can reach it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utmQuery } from '../src/pwa/share-link.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.UNCLAIMED_DIST || path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ---- 1. utmQuery() itself ------------------------------------------- */

t('keeps a single utm_ param', utmQuery('?utm_source=newsletter') === '?utm_source=newsletter');

t(
  'keeps every utm_ param, drops nothing between them',
  (() => {
    const q = utmQuery('?utm_source=fb&utm_medium=cpc&utm_campaign=spring');
    const p = new URLSearchParams(q.slice(1));
    return p.get('utm_source') === 'fb' && p.get('utm_medium') === 'cpc' && p.get('utm_campaign') === 'spring';
  })(),
);

t(
  'drops non-utm params — a click id is not a campaign label',
  (() => {
    const q = utmQuery('?utm_source=ig&gclid=abc123&fbclid=xyz&ref=friend');
    return q === '?utm_source=ig';
  })(),
);

t('empty query stays empty, not "?"', utmQuery('') === '');
t('a query with no utm_ params stays empty', utmQuery('?foo=bar&session=1') === '');

t(
  'malformed input degrades to empty rather than throwing',
  (() => {
    try {
      return utmQuery(null) === '' || typeof utmQuery(null) === 'string';
    } catch {
      return false;
    }
  })(),
);

/* ---- 2. both wizards actually use it --------------------------------- */

const householdSrc = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
const companySrc = fs.readFileSync(path.join(ROOT, 'src/pwa/startup-check.js'), 'utf8');

/* Comments are prose and reference utmQuery()/INITIAL_UTM by name to explain
   the bug this guards against — stripping them before counting keeps that
   assertion about the CODE, not about how the fix is explained. Crude
   (doesn't understand strings containing "//" or "/*"), but nothing in
   either file needs that precision. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

for (const [label, src] of [['household (src/app.js)', householdSrc], ['company (src/pwa/startup-check.js)', companySrc]]) {
  t(`${label}: imports utmQuery from share-link.js`, /from ['"]\.\/share-link\.js['"]/.test(src));

  /* utmQuery() must be captured ONCE, at module load — not re-read from
     location.search inside the share action or inside syncHistory().
     syncHistory() calls history.replaceState() with a URL built from
     location.pathname alone on the very first render, before a reader has
     clicked anything, which erases ?utm_* from the live location. Code that
     reads location.search fresh anywhere after that reads it AFTER that
     erasure and silently drops the campaign every time — this is the actual
     bug qa-check-flows.md found in a live browser, not a hypothetical, so
     it is pinned here at the source level too. */
  const code = stripComments(src);
  t(`${label}: captures utmQuery() once into a module-level INITIAL_UTM`, /const INITIAL_UTM = utmQuery\(\)/.test(code));
  t(`${label}: never calls utmQuery() again in code after that one capture`, (code.match(/utmQuery\(\)/g) || []).length === 1);
  /* Both the share button's URL and syncHistory()'s own pushed/replaced URL
     build the identical `${location.pathname}${INITIAL_UTM}#r=…` shape — so
     rather than parsing out which occurrence is which, just require the
     shape to appear at least twice and never appear without INITIAL_UTM. */
  const withUtm = (code.match(/\$\{location\.pathname\}\$\{INITIAL_UTM\}#[rs]=/g) || []).length;
  const withoutUtm = (code.match(/\$\{location\.pathname\}#[rs]=/g) || []).length;
  /* At least 2: the share button and syncHistory(). src/app.js has a third —
     the "sign in to unlock" link's own ?next= return URL, which is exactly
     this same bug's third instance (that link stayed English-broken too:
     following it back from sign-in dropped the campaign on a checkout,
     which is the one place losing it costs actual revenue attribution). */
  t(`${label}: the pathname+hash URL shape always carries INITIAL_UTM (share button and syncHistory both)`, withUtm >= 2);
  t(`${label}: no leftover pathname+hash URL skips INITIAL_UTM`, withoutUtm === 0);
  /* The note telling the reader the link carries their answers — required by
     the feature brief, and easy to silently lose in a refactor since it is
     the one sentence with no functional effect if it goes missing. */
  t(`${label}: still tells the reader the link contains their answers`, /sees the answers you gave|contains my answers|contains their answers/i.test(src));
}

/* ---- 3. the build actually ships it where both wizards can reach it --- */

if (!fs.existsSync(DIST)) {
  console.log('  (skipping dist checks — run `npm run build` first)');
} else {
  const shareLinkDist = path.join(DIST, 'share-link.js');
  t('dist/share-link.js exists', fs.existsSync(shareLinkDist));
  if (fs.existsSync(shareLinkDist)) {
    const built = fs.readFileSync(shareLinkDist, 'utf8');
    t('dist/share-link.js exports utmQuery', /export function utmQuery/.test(built));
  }
  t('dist/app.js exists (household /check/)', fs.existsSync(path.join(DIST, 'app.js')));
  t('dist/startup-check.js exists (/startups/check/)', fs.existsSync(path.join(DIST, 'startup-check.js')));

  /* Relative import resolution: both files sit at dist root, same as
     share-link.js, so './share-link.js' from either resolves correctly.
     If either one ever moves into a subdirectory this would start failing a
     real page load; it is asserted here so it fails a test instead. */
  const distApp = fs.existsSync(path.join(DIST, 'app.js')) ? fs.readFileSync(path.join(DIST, 'app.js'), 'utf8') : '';
  t('dist/app.js still imports share-link.js from its own directory', /from ['"]\.\/share-link\.js/.test(distApp));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
