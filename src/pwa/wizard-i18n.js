/**
 * UNCLAIMED — the wizard translator.
 *
 * The two wizards are rendered entirely by client JavaScript, so none of their
 * copy passes through the build's TR()/tr() and none of it was ever localised.
 * /fr/check/ was a French page around an English form.
 *
 * The build now emits a dictionary into the head of every /check/ and
 * /startups/check/ page:
 *
 *     <script id="i18n-wizard" type="application/json">{ "Continue": "Continuer" }</script>
 *
 * keyed by the EXACT English source string, `{}` on English pages. That
 * convention is the point: the key is the fallback, so a missing entry renders
 * the English sentence rather than a key name. `(k) => k` printing
 * "check.nav.continue" at a reader is the failure this shape makes impossible.
 *
 * Two halves of this existed and did not meet — the build wrote the script tag,
 * and the only client-side translator read `window.__UNCLAIMED_I18N`, which
 * nothing ever set, keyed by a key nothing ever emitted. Both wizards rendered
 * 100% English in all six non-English locales while every static check passed.
 *
 * Translation happens over rendered text NODES, not over the HTML string, and
 * only on a whole-node exact match. Substring replacement would rewrite the
 * "Continue" inside "Continue with United Kingdom", and worse, would reach into
 * programme names and funder names that must never be machine-substituted.
 */

let DICT = null;

/** Read the dictionary once. Absent, empty or malformed all mean "English". */
export function wizardDict() {
  if (DICT) return DICT;
  DICT = {};
  try {
    const el = typeof document !== 'undefined' && document.getElementById('i18n-wizard');
    if (el && el.textContent.trim()) {
      const parsed = JSON.parse(el.textContent);
      if (parsed && typeof parsed === 'object') DICT = parsed;
    }
  } catch {
    /* A malformed dictionary must not take the wizard down with it. English is
       a correct answer here; a thrown exception is not. */
    DICT = {};
  }
  if (typeof window !== 'undefined') window.__UNCLAIMED_I18N = DICT;
  return DICT;
}

/**
 * The page's language, read once from <html lang>. 'en' when absent.
 *
 * Everything locale-shaped hangs off this: plural selection, number grouping,
 * currency placement, and the /fr/ prefix on links. Reading it from the
 * document rather than from the module URL is deliberate — /app.js is served
 * from one path for all seven locales, which is exactly why the link prefix
 * computed from import.meta.url was always empty.
 */
let LANG = null;
export function wizardLang() {
  if (LANG) return LANG;
  const raw = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
  LANG = String(raw).toLowerCase().split('-')[0] || 'en';
  return LANG;
}

/**
 * Translate one English string, with {token} substitution and plurals.
 *
 * @param {string} english  the exact English source string, which is the key
 * @param {Record<string, string|number>} [vars]  {token} substitutions
 * @param {number} [count]  the number the plural forms select on; defaults to
 *                          vars.n when that is a number
 *
 * Interpolation happens AFTER lookup, never before. A sentence built by
 * concatenation — "Step " + n + " of " + total — can never whole-node match a
 * dictionary entry, which is why the rail caption stayed English in all six
 * non-English locales on all seven steps while everything around it was
 * translated, and why the entire results screen — where every sentence
 * carries a number — stayed English after the questions were fixed. So the
 * key is the whole sentence with `{n}`-style tokens in it, and the numbers are
 * substituted into whichever language came back.
 *
 * PLURALS. `${n === 1 ? '' : 's'}` reproduces the same unmatchable-node
 * problem one layer down, and it is wrong in most of the languages here: hi
 * and pt have more than two forms and Slavic-shaped rules exist for locales
 * this site will add. So a plural key carries every form, labelled with its
 * CLDR category:
 *
 *     T('one={n} programme|other={n} programmes', { n }, n)
 *
 * and Intl.PluralRules picks the one this language wants for this number. The
 * English key is itself a valid form set, so an untranslated page — where the
 * dictionary is {} by design — still resolves rather than printing "one=…".
 */
const FORMS = /(?:^|\|)\s*(zero|one|two|few|many|other)=/;

function selectForm(text, count) {
  if (!FORMS.test(text)) return text;
  const forms = {};
  for (const part of text.split('|')) {
    const m = /^\s*(zero|one|two|few|many|other)=([\s\S]*)$/.exec(part);
    if (m) forms[m[1]] = m[2];
  }
  let cat = 'other';
  if (typeof count === 'number' && Number.isFinite(count)) {
    try {
      cat = new Intl.PluralRules(wizardLang()).select(count);
    } catch {
      cat = count === 1 ? 'one' : 'other';
    }
  }
  /* A language whose rules name a category the translation does not carry
     falls back to `other`, then to whatever is there. Never to the raw
     "one=…|other=…" string, which is the one output a reader must not see. */
  return forms[cat] ?? forms.other ?? Object.values(forms)[0] ?? text;
}

export function T(english, vars, count) {
  if (typeof english !== 'string' || !english) return english;
  const d = wizardDict();
  const v = d[english];
  let out = typeof v === 'string' && v ? v : english;
  const n = count ?? (vars && typeof vars.n === 'number' ? vars.n : undefined);
  out = selectForm(out, n);
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** A figure in the reader's own grouping. 1 234 567 in fr, 12,34,567 in hi. */
export function NUM(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  try {
    return new Intl.NumberFormat(wizardLang(), { maximumFractionDigits: 0 }).format(v);
  } catch {
    return String(Math.round(v));
  }
}

/**
 * A path on this site, in this locale.
 *
 * app.js is served from /app.js on every localised page, so a prefix computed
 * from import.meta.url is always '' — which is how the paywall control on
 * /fr/check/ came to send a French reader to the English /pricing/. The lang
 * attribute is the only thing on the page that knows.
 *
 * Only paths that HAVE a localised counterpart are prefixed. Country and
 * programme pages exist in a locale only for the countries that locale covers
 * (src/i18n.mjs LOCALES[lang].countries), so the table below mirrors it — and
 * anything not listed is left alone, because a wrong prefix is a 404 and an
 * absent one is merely English.
 */
const LOCALISED_SECTIONS = new Set([
  'pricing', 'account', 'methodology', 'startups', 'enterprise', 'business',
  'privacy', 'countries', 'check', 'for', 'auto-apply',
]);

/* Mirrors LOCALES[lang].countries in src/i18n.mjs. */
const LOCALE_COUNTRIES = {
  fr: ['fr', 'be', 'ch', 'ca'],
  es: ['es', 'mx'],
  de: ['de', 'at', 'ch'],
  it: ['it', 'ch'],
  pt: ['pt', 'br'],
  hi: ['in'],
};

/**
 * Does this locale own this country?
 *
 * /fr/ exists for France, Belgium, Switzerland and Canada; that is exactly the
 * set where "the page language is the language the authority writes in" is a
 * safe bet, so it is the set where a card leads with `name_local` rather than
 * with the English gloss. A French reader was being shown "Active Solidarity
 * Income (RSA)" as the headline of a French benefit — a name that appears on
 * no form they will ever fill in.
 */
export function localeOwnsCountry(slug) {
  const lang = wizardLang();
  if (lang === 'en' || !slug) return false;
  return (LOCALE_COUNTRIES[lang] || []).includes(String(slug).toLowerCase());
}

/*
 * The country manifest carries one name per country and it is English, so a
 * French reader met "8 dispositifs ... COMPARÉ À 114 DISPOSITIFS" under an
 * eyebrow reading "UNITED KINGDOM", and "Dispositifs examinés en United
 * Kingdom". Intl.DisplayNames turns the ISO code we already hold into the name
 * that language actually uses, so there is no per-locale table to maintain and
 * nobody has to invent a translation of a country's name. Falls back to the
 * manifest name if the runtime has no data for the code.
 */
const REGION_NAMES = new Map();
export function countryName(entry) {
  if (!entry) return '';
  const fallback = entry.name || '';
  const code = String(entry.country_code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return fallback;
  const lang = wizardLang();
  if (!REGION_NAMES.has(lang)) {
    let dn = null;
    try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { dn = null; }
    REGION_NAMES.set(lang, dn);
  }
  const dn = REGION_NAMES.get(lang);
  if (!dn) return fallback;
  try { return dn.of(code) || fallback; } catch { return fallback; }
}

export function localePath(path) {
  const lang = wizardLang();
  if (lang === 'en') return path;
  const p = String(path || '/');
  if (!p.startsWith('/')) return p;
  const seg = p.split('/')[1] || '';
  const known = LOCALISED_SECTIONS.has(seg) || (LOCALE_COUNTRIES[lang] || []).includes(seg);
  return known ? `/${lang}${p}` : p;
}

/**
 * Write HTML into a node and translate what was written.
 *
 * translateTree() runs once per render, so anything written to the DOM
 * afterwards — a status line, an error, the whole prepared-applications pack —
 * was permanently English however good the dictionary was: two strings shipped
 * correct French and rendered English because of it. Every post-render write
 * goes through here.
 */
export function setHTML(el, html) {
  if (!el) return el;
  el.innerHTML = html;
  translateTree(el);
  return el;
}

/* Attributes that hold reader-facing prose. title/aria-label are read aloud;
   placeholder and aria-placeholder are visible. Nothing else is copy. */
const TEXT_ATTRS = ['aria-label', 'placeholder', 'aria-placeholder', 'title', 'aria-valuetext'];

/**
 * Translate a freshly rendered subtree in place.
 *
 * Whole-text-node matching, with the node's own leading and trailing
 * whitespace preserved so the template's formatting survives. Script, style
 * and the dictionary element itself are skipped — translating the dictionary
 * with itself is a fun way to lose an afternoon.
 */
export function translateTree(root) {
  if (!root) return root;
  const d = wizardDict();
  if (!Object.keys(d).length) return root; // English page: nothing to do, no walk.

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const tag = n.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || n.id === 'i18n-wizard') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const raw = n.nodeValue;
      const key = raw.trim();
      if (!key) continue;
      const hit = d[key];
      if (typeof hit === 'string' && hit) {
        const lead = raw.slice(0, raw.indexOf(key[0]));
        const tail = raw.slice(lead.length + key.length);
        n.nodeValue = lead + hit + tail;
      }
    } else {
      for (const a of TEXT_ATTRS) {
        if (!n.hasAttribute(a)) continue;
        const v = n.getAttribute(a).trim();
        const hit = d[v];
        if (typeof hit === 'string' && hit) n.setAttribute(a, hit);
      }
    }
  }
  return root;
}
