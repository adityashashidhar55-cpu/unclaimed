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
 * Translate one English string. Safe to call with anything — an unknown string
 * comes back unchanged, which is what makes it safe to sprinkle.
 */
/**
 * @param {string} english  the exact English source string, which is the key
 * @param {Record<string, string|number>} [vars]  {token} substitutions
 *
 * Interpolation happens AFTER lookup, never before. A sentence built by
 * concatenation — "Step " + n + " of " + total — can never whole-node match a
 * dictionary entry, which is why the rail caption stayed English in all six
 * non-English locales on all seven steps while everything around it was
 * translated. So the key is the whole sentence with `{n}`-style tokens in it,
 * and the numbers are substituted into whichever language came back.
 */
export function T(english, vars) {
  if (typeof english !== 'string' || !english) return english;
  const d = wizardDict();
  const v = d[english];
  const out = typeof v === 'string' && v ? v : english;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
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
