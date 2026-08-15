#!/usr/bin/env node
/**
 * Every language defines every key, and the functions take the same arguments.
 *
 * `t()` falls back to English for a missing key. That fallback exists so a
 * runtime never throws — it is not a workflow, because a missing translation
 * produces no error, no warning and no visible defect except to the person who
 * cannot read English. This test turns that silence into a build failure.
 *
 * It also catches the subtler version: a key defined as a plain string in one
 * language and a function in another. That renders `function (n) {...}` into
 * the page, or drops the number entirely, depending which way round it is.
 */
import { LANGS, LOCALES, KEYS, t } from '../src/i18n.mjs';
import en from '../src/i18n/en.mjs';

const dicts = {};
for (const lang of LANGS) {
  dicts[lang] = (await import(`../src/i18n/${lang}.mjs`)).default;
}

let passed = 0;
let failed = 0;
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`); };
const bad = (m) => { failed += 1; console.error(`  ✗ ${m}`); };

/* -- completeness ------------------------------------------------------- */
for (const lang of LANGS) {
  if (lang === 'en') continue;
  const missing = KEYS.filter((k) => !(k in dicts[lang]));
  const extra = Object.keys(dicts[lang]).filter((k) => !KEYS.includes(k));
  if (missing.length) bad(`${lang} is missing ${missing.length} keys: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
  else ok(`${lang} defines all ${KEYS.length} keys`);
  /* An extra key is dead weight but also a symptom: usually a typo in a key
     name, which means the intended key is silently falling back. */
  if (extra.length) bad(`${lang} has ${extra.length} keys English does not: ${extra.join(', ')}`);
}

/* -- shape -------------------------------------------------------------- */
{
  let mismatched = 0;
  for (const lang of LANGS) {
    for (const k of KEYS) {
      const a = en[k];
      const b = dicts[lang][k];
      if (b === undefined) continue;
      if (typeof a !== typeof b) {
        bad(`${lang}.${k} is a ${typeof b}, English has a ${typeof a}`);
        mismatched += 1;
      } else if (typeof a === 'function' && a.length !== b.length) {
        bad(`${lang}.${k} takes ${b.length} arguments, English takes ${a.length}`);
        mismatched += 1;
      }
    }
  }
  if (!mismatched) ok('every key has the same type and arity in every language');
}

/* -- no English left in a translated value ------------------------------ */
{
  /* Cheap smell test for a copy-paste that never got translated. Brand names,
     acronyms and product words are legitimately identical across languages, so
     only flag a value that is byte-identical to English AND long enough that
     the match cannot be a coincidence. */
  const SHARED_OK = /^(API|MCP|App|SSO|CSV|JSON|Privacy|Startup|Home|Metodologia|Español)/i;
  let suspects = 0;
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    for (const k of KEYS) {
      const a = en[k];
      const b = dicts[lang][k];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (a === b && a.length > 24 && !SHARED_OK.test(a)) {
        bad(`${lang}.${k} is identical to English — untranslated? "${a.slice(0, 50)}…"`);
        suspects += 1;
      }
    }
  }
  if (!suspects) ok('no long value is byte-identical to its English original');
}

/* -- the functions actually run ----------------------------------------- */
{
  /* A translation is a template literal in someone else's language; a stray
     backtick or a renamed parameter throws only when the page is built, which
     is a long way from where the mistake was made. */
  let threw = 0;
  for (const lang of LANGS) {
    const TR = t(lang);
    for (const k of KEYS) {
      if (typeof en[k] !== 'function') continue;
      try {
        const out = TR(k, 1, 'x', 'y');
        if (typeof out !== 'string') {
          bad(`${lang}.${k} returned a ${typeof out}, not a string`);
          threw += 1;
        }
      } catch (e) {
        bad(`${lang}.${k} threw: ${e.message}`);
        threw += 1;
      }
    }
  }
  if (!threw) ok('every interpolating key renders in every language');
}

/* -- locale table ------------------------------------------------------- */
{
  const bad2 = LANGS.filter((l) => !LOCALES[l]?.native);
  bad2.length ? bad(`no native name for: ${bad2.join(', ')}`) : ok(`${LANGS.length} locales, each with a native name`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
