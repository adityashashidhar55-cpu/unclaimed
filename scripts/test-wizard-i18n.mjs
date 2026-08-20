/**
 * The /check/ and /startups/check/ wizards are drawn entirely in the browser,
 * so they cannot use the build-time translator. Instead the build ships a
 * dictionary — <script id="i18n-wizard"> from TR('wizard') — keyed by the exact
 * English source string, and src/pwa/wizard-i18n.js swaps whole text nodes on
 * exact match.
 *
 * That contract fails silently in the worst possible direction: a key that is
 * absent, or whose English text has drifted by one character, simply renders
 * in English on a French page. Nothing errors, nothing is logged, and the only
 * person who finds out is a reader who cannot read the sentence.
 *
 * So this test reads the literals out of the wizard source and holds the six
 * non-English `wizard` maps against them. It also fails on an entry whose value
 * is byte-identical to its English key, because a copied English string is the
 * same bug wearing a translation's clothes.
 *
 * It reads src/app.js and src/pwa/startup-check.js and never writes them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['fr', 'de', 'es', 'it', 'pt', 'hi'];
const SOURCES = ['src/app.js', 'src/pwa/startup-check.js'];

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ✗ ${m}`); };

/**
 * Pull the English literals out of a wizard source file.
 *
 * Two call shapes are in use: `T('English')` from wizard-i18n.js, and
 * `t('dotted.key', 'English')` in app.js, whose SECOND argument is the English
 * source string. A regex per shape, quoted or backticked, with escapes
 * unescaped so the extracted string is what the runtime will actually look up.
 */
function literalsIn(src) {
  const out = new Set();
  const unq = (raw, q) =>
    raw.replace(/\\(['"`\\nrt])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));

  /* T('...')  — first argument. */
  for (const m of src.matchAll(/(?<![\w$.])T\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    out.add(unq(m[2], m[1]));
  }
  /* t('key', '...') — second argument is the English source string. */
  for (const m of src.matchAll(
    /(?<![\w$.])t\(\s*(['"`])(?:\\.|(?!\1)[^\\])*\1\s*,\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g,
  )) {
    out.add(unq(m[3], m[2]));
  }
  return out;
}

const english = new Set();
for (const rel of SOURCES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const found = literalsIn(src);
  if (!found.size) bad(`${rel} — no translatable literals found; the extractor has stopped matching`);
  for (const s of found) if (s.trim()) english.add(s);
}
ok(`${english.size} English wizard literals extracted from ${SOURCES.length} sources`);

/* A literal that is a bare token, a URL, or nothing but interpolation slots is
   not a sentence and there is nothing in it to translate — "{lo} – {hi}" is the
   same string in every language. Strip the {slots} before asking whether any
   words are left. */
const hasWords = (s) => /\p{L}/u.test(s.replace(/\{[^}]*\}/g, ''));
const translatable = [...english].filter(
  (s) => hasWords(s) && s.trim().length > 1 && !/^https?:/.test(s),
);

for (const lang of LANGS) {
  const dict = (await import(path.join(ROOT, `src/i18n/${lang}.mjs`))).default;
  const wiz = dict.wizard || {};
  const missing = translatable.filter((s) => typeof wiz[s] !== 'string' || !wiz[s]);
  if (missing.length) {
    bad(`${lang}: ${missing.length} of ${translatable.length} wizard strings have no entry`);
    for (const m of missing.slice(0, 12)) console.log(`      · ${JSON.stringify(m)}`);
    if (missing.length > 12) console.log(`      … and ${missing.length - 12} more`);
  } else {
    ok(`${lang} translates all ${translatable.length} wizard strings`);
  }

  const copied = Object.entries(wiz).filter(([k, v]) => k === v && hasWords(k));
  if (copied.length) {
    bad(`${lang}: ${copied.length} entries are byte-identical to their English key`);
    for (const [k] of copied.slice(0, 8)) console.log(`      · ${JSON.stringify(k)}`);
  } else {
    ok(`${lang} has no untranslated copies`);
  }

  /* Entries keyed off a string the extractor cannot see are reported, not
     failed. A dictionary entry legitimately lands BEFORE the literal it keys
     off is wrapped in T() — that is how the two halves of this change were
     split between lanes — so a hard failure here would fail honest work in
     flight. It is still worth printing: once wrapping is finished, anything
     left in this list is a key whose English text has drifted, which renders
     as silent English on a translated page. */
  const unseen = Object.keys(wiz).filter((k) => !english.has(k));
  if (unseen.length) {
    console.log(`  · ${lang}: ${unseen.length} entries key off literals not yet wrapped in T() (informational)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
