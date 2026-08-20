/**
 * How English is this text?
 *
 * One marker list, shared by every guard that has to tell "translated" from
 * "still English". It used to live inside check-i18n.mjs, which only ever sees
 * built HTML; the results screen is drawn client-side after load and so was
 * never measured by anything. Two copies of a list like this drift, and the
 * copy that drifts is the one that stops catching the bug.
 *
 * It is a heuristic and it says so. It cannot tell good French from bad. What
 * it can tell, reliably, is English from not-English.
 */

/* Words that are English and are not also common in the target languages.
   "no" is Spanish, "non" is French, "die" is German — none of those are here. */
export const ENGLISH_MARKERS = new Set([
  'the', 'and', 'you', 'your', 'yours', 'with', 'from', 'that', 'this', 'these', 'those',
  'what', 'which', 'when', 'where', 'who', 'why', 'how', 'are', 'is', 'was', 'were',
  'have', 'has', 'had', 'been', 'being', 'will', 'would', 'should', 'could', 'can',
  'about', 'into', 'over', 'under', 'between', 'before', 'after', 'because', 'through',
  'every', 'each', 'both', 'other', 'another', 'same', 'than', 'then', 'there', 'their',
  'them', 'they', 'it', 'its', 'we', 'our', 'us', 'not', 'but', 'for', 'nor', 'yet',
  'free', 'paid', 'money', 'owed', 'check', 'apply', 'grant', 'grants', 'programme',
  'programmes', 'country', 'countries', 'people', 'company', 'companies', 'something',
  'nothing', 'anything', 'everything', 'someone', 'nobody', 'anyone', 'everyone',
  'more', 'most', 'less', 'least', 'much', 'many', 'few', 'some', 'any', 'all', 'none',
  'here', 'now', 'never', 'always', 'often', 'sometimes', 'already', 'still', 'once',
  'first', 'second', 'third', 'last', 'next', 'only', 'also', 'even', 'just', 'very',
  'does', 'did', 'doing', 'done', 'make', 'makes', 'made', 'take', 'takes', 'taken',
  'get', 'gets', 'got', 'give', 'gives', 'given', 'know', 'knows', 'known', 'see',
  'sees', 'seen', 'want', 'wants', 'need', 'needs', 'needed', 'pay', 'pays', 'paid',
]);

/* Marker words that are also ordinary words of the target language. Counting
   them measures nothing: "programme" is French and German, "pays" is French
   for country, "was" is German for what, "also" is German for so. Left in, a
   correctly translated screen scores 6% English on its own vocabulary and the
   guard fails on the fix — which is how a guard stops being believed. Kept
   deliberately short: every entry is a word this repo has actually seen
   inflate a score on a rendered page. */
const ALSO_NATIVE = {
  fr: ['pays', 'programme', 'programmes', 'second'],
  de: ['was', 'also', 'will', 'all', 'programme'],
  es: [],
  it: [],
  pt: [],
  hi: [],
};

/** The marker set to count with when the target language is `lang`. */
export function markersFor(lang) {
  const drop = ALSO_NATIVE[lang];
  if (!drop || !drop.length) return ENGLISH_MARKERS;
  const s = new Set(ENGLISH_MARKERS);
  for (const w of drop) s.delete(w);
  return s;
}

/* Latin-alphabet words only. This is what check-i18n has always counted, and
   it is right for a page whose target language is also written in Latin. */
const LATIN_WORD = /[a-z']{2,}/g;
/* Any script. On a Hindi page the Devanagari has to be in the denominator, or
   a page with four English sentences and nothing else scores 100% English on
   four words and is waved through by the minimum-words floor. */
const ANY_WORD = /\p{L}[\p{L}'’-]*/gu;

/**
 * @param {string} text
 * @param {{minWords?: number, script?: 'latin'|'any', lang?: string}} opts
 * @returns {{share: number, words: number, hits: string[]}}
 *   `share` is 0 when there is too little text to judge; check `words`.
 */
export function englishShare(text, { minWords = 40, script = 'latin', lang = null } = {}) {
  const re = script === 'any' ? ANY_WORD : LATIN_WORD;
  const markers = lang ? markersFor(lang) : ENGLISH_MARKERS;
  const words = String(text).toLowerCase().match(re) || [];
  if (words.length < minWords) return { share: 0, words: words.length, hits: [] };
  const hits = words.filter((w) => markers.has(w));
  return { share: hits.length / words.length, words: words.length, hits };
}

/**
 * The English sentences on a page that is mostly not English.
 *
 * A whole-page share is the right measure for "is this page translated at
 * all", and it is the wrong measure for one untranslated paragraph among
 * twenty French ones: step 1 of /fr/check/ ends in "Your country isn't
 * listed? The dataset covers 25 countries so far", and the twenty-five
 * country names above it — data, correctly untranslated — dilute that to 3.8%
 * of the screen, under any threshold loose enough to be believed.
 *
 * So: measure each visible run of text on its own. A run of `minWords` or
 * more, of which `share` or more are English marker words, is an English
 * sentence sitting on a translated page. Short runs are not judged, because
 * one data word in a three-word chip proves nothing.
 *
 * @param {string[]} chunks visible text runs, in reading order.
 */
export function englishRuns(chunks, { lang = null, minWords = 6, share = 0.15 } = {}) {
  const markers = lang ? markersFor(lang) : ENGLISH_MARKERS;
  const out = [];
  for (const c of chunks) {
    /* Words with their position, so a capital can be told from a sentence
       start. Programme names stay in the language the funder published them
       in — "Yours include Child Benefit, Free Courses for Jobs, Legal Aid and
       2 more" is a correctly translated sentence with three English titles
       inside it, and counting Free and Aid as evidence of an untranslated
       page would fail the guard on the fix. A capitalised word that is not
       the first word of its sentence is a name, not prose. It stays in the
       denominator — it is still text on the screen — but it is not a hit. */
    const words = [...String(c).matchAll(/\p{L}[\p{L}'’-]*/gu)];
    if (words.length < minWords) continue;
    const hits = [];
    for (const m of words) {
      const w = m[0].toLowerCase();
      if (!markers.has(w)) continue;
      if (/^\p{Lu}/u.test(m[0])) {
        const before = String(c).slice(0, m.index).replace(/[\s"'“”«»(\[]+$/u, '');
        if (before && !/[.!?:;·—–\n]$/u.test(before)) continue;
      }
      hits.push(w);
    }
    const s = hits.length / words.length;
    if (s >= share) {
      out.push({ text: c.length > 110 ? `${c.slice(0, 107)}…` : c, share: s, words: words.length, hits: [...new Set(hits)] });
    }
  }
  return out;
}
