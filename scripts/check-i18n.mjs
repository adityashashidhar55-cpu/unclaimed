#!/usr/bin/env node
/**
 * How much of a translated page is actually translated.
 *
 * The bug this exists to stop: /fr/ shipped with a French nav and an English
 * everything-else — "Pays, Nos sources, Pricing, Enterprise, Writing, App"
 * across one menu bar. Each individual string looked fine in isolation, and
 * nothing failed, because a missing translation is not an error. It is just
 * English.
 *
 * So this counts. For every localised page it extracts the visible text, drops
 * the parts that are legitimately not translated (see EXEMPT), and reports the
 * share of remaining words that are English function words. A page whose body
 * is full of "the", "and", "you can" is not translated, whatever its nav says.
 *
 * It is a heuristic and it says so. It cannot tell good French from bad. What
 * it can tell, reliably, is English from not-English — which is the failure we
 * actually keep shipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const LANGS = ['fr', 'es', 'de', 'it', 'pt', 'hi'];

/* Words that are English and are not also common in the target languages.
   "no" is Spanish, "non" is French, "die" is German — none of those are here. */
const ENGLISH_MARKERS = new Set([
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

/* Legitimately untranslated, and documented as such on every localised page:
   programme names and funder-sourced prose stay in the language the funder
   published them in. Anything inside these selectors is skipped. */
const EXEMPT_SELECTORS = [
  'source-block', 'rule-table', 'docs', 'steps',
  'list-row__name', 'list-row__meta', 'blockquote',
];

/* Field names are not prose. `last_verified_at` and `source_url` are the
   actual keys in the JSON, and translating them would be a lie about the
   schema — so <code> is stripped before counting, like the funder-sourced
   blocks above. */
const EXEMPT_TAGS = ['code', 'pre'];

/** Visible text, minus scripts, styles and the exempt blocks. */
function visibleText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  for (const cls of EXEMPT_SELECTORS) {
    /* Crude but adequate: drop from the opening tag carrying the class to the
       next closing tag of the same kind. Over-removal is the safe direction —
       it can only make the score look better, never worse, and the score is a
       floor we are trying to raise. */
    s = s.replace(new RegExp(`<(\\w+)[^>]*class="[^"]*${cls}[^"]*"[\\s\\S]{0,4000}?</\\1>`, 'gi'), ' ');
  }
  for (const tag of EXEMPT_TAGS) {
    s = s.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function englishShare(text) {
  const words = text.toLowerCase().match(/[a-z']{2,}/g) || [];
  if (words.length < 40) return { share: 0, words: words.length, hits: [] };
  const hits = words.filter((w) => ENGLISH_MARKERS.has(w));
  return { share: hits.length / words.length, words: words.length, hits };
}

/** One representative page per surface, rather than all 5,900. */
const SURFACES = [
  ['', 'landing'],
  ['countries/', 'country index'],
  ['check/', 'check'],
  ['pricing/', 'pricing'],
  ['enterprise/', 'enterprise'],
  ['methodology/', 'methodology'],
  ['privacy/', 'privacy'],
  ['account/', 'account'],
  ['for/renters/', 'audience'],
];

/* A page is called translated below this share of English marker words. Real
   translated prose lands near zero; English prose lands around 0.20-0.30. */
const THRESHOLD = 0.06;

let checked = 0;
let bad = 0;
const rows = [];

for (const lang of LANGS) {
  for (const [rel, label] of SURFACES) {
    const f = path.join(DIST, lang, rel, 'index.html');
    if (!fs.existsSync(f)) continue;
    checked += 1;
    const { share, words, hits } = englishShare(visibleText(fs.readFileSync(f, 'utf8')));
    const ok = share <= THRESHOLD;
    if (!ok) bad += 1;
    rows.push({ lang, label, rel, share, words, ok, sample: [...new Set(hits)].slice(0, 8) });
  }
}

rows.sort((a, b) => b.share - a.share);

console.log(`\nTranslation coverage — ${checked} localised pages checked\n`);
for (const r of rows) {
  const pct = (r.share * 100).toFixed(1).padStart(5);
  console.log(
    `  ${r.ok ? '✓' : '✗'} ${pct}% English  /${r.lang}/${r.rel.padEnd(16)} ${String(r.words).padStart(5)} words` +
      (r.ok ? '' : `   e.g. ${r.sample.join(', ')}`),
  );
}

console.log(
  `\n${checked - bad} of ${checked} pages under the ${(THRESHOLD * 100).toFixed(0)}% threshold` +
    `, ${bad} still substantially English.\n`,
);
process.exit(bad ? 1 : 0);
