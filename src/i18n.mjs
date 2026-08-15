/**
 * UNCLAIMED — interface translations.
 *
 * The strings live in src/i18n/<lang>.mjs, one file per language, with English
 * as the source of truth for the key set. This module is the entry point and
 * holds only the locale table and the lookup.
 *
 * Scope, stated on every localised page via `langNote`: everything WE wrote is
 * translated — interface, marketing copy, headings, explanations. Everything a
 * FUNDER wrote is not: programme names, quoted source snippets, eligibility
 * wording and document names stay in the language the authority published
 * them in. On a site whose entire claim is accuracy, a machine-translated
 * benefit rule is worse than an English one, and the reader has to open the
 * official page in that language regardless.
 */

import en from './i18n/en.mjs';
import fr from './i18n/fr.mjs';
import es from './i18n/es.mjs';
import de from './i18n/de.mjs';
import it from './i18n/it.mjs';
import pt from './i18n/pt.mjs';
import hi from './i18n/hi.mjs';

export const LOCALES = {
  en: { name: 'English',    native: 'English',   countries: null }, // null = all
  fr: { name: 'French',     native: 'Français',  countries: ['fr', 'be', 'ch', 'ca'] },
  es: { name: 'Spanish',    native: 'Español',   countries: ['es', 'mx'] },
  de: { name: 'German',     native: 'Deutsch',   countries: ['de', 'at', 'ch'] },
  it: { name: 'Italian',    native: 'Italiano',  countries: ['it', 'ch'] },
  pt: { name: 'Portuguese', native: 'Português', countries: ['pt', 'br'] },
  hi: { name: 'Hindi',      native: 'हिन्दी',     countries: ['in'] },
};

const T = { en, fr, es, de, it, pt, hi };

/**
 * Look up a string, or call it with arguments if it is a function.
 *
 * The fallback to English is a safety net for a runtime that has somehow got a
 * key the dictionary lacks — not a workflow. `scripts/test-i18n.mjs` fails the
 * build on any key present in English and missing elsewhere, because relying
 * on the fallback is exactly how a French page ends up with English paragraphs
 * and nobody notices: a missing translation raises no error, it just reads as
 * English to someone who cannot read English.
 */
export function t(lang) {
  const base = T.en;
  const loc = T[lang] || base;
  return (key, ...args) => {
    const v = loc[key] ?? base[key];
    if (v === undefined) return key;
    return typeof v === 'function' ? v(...args) : v;
  };
}

/** Every key English defines — the contract the other languages must meet. */
export const KEYS = Object.keys(en);

export const LANGS = Object.keys(LOCALES);
