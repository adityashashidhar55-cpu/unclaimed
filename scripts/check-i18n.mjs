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

/* No i18n key may ever appear as visible text.
   
   Three shared components took an optional `tr` and, when a caller forgot it,
   returned the KEY NAME. 4,063 of 5,891 pages rendered at least one, and the
   primary paywall button on every programme page read `signInUnlock`. No test
   caught it because the page rendered fine — it just spoke in identifiers.
   Checked against the real key list, so a new key is covered the day it is
   added and an ordinary camelCase word in prose is not a false positive. */
{
  const en = (await import('../src/i18n/en.mjs')).default;
  /* Only camelCase keys. `documents`, `source` and `verified` are also
     ordinary English words and appear in prose on thousands of pages; an
     internal capital is what makes a string unmistakably an identifier rather
     than something a person wrote. Every key that actually leaked —
     signInUnlock, seePricing, lockedNote, seePlans, moreLocked, checkFree —
     is caught by this. */
  const keys = Object.keys(en).filter((k) => k.length > 5 && /[a-z][A-Z]/.test(k));
  const offenders = [];
  const htmlFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.html')) htmlFiles.push(f);
    }
  })(DIST);
  for (const f of htmlFiles) {
    const text = fs
      .readFileSync(f, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    for (const k of keys) {
      if (new RegExp(`\\b${k}\\b`).test(text)) {
        offenders.push(`${path.relative(DIST, f)} shows the raw key "${k}"`);
        break;
      }
    }
    if (offenders.length > 8) break;
  }
  if (offenders.length) {
    console.error(`\n  \u2717 raw i18n key names are visible to users:`);
    for (const o of offenders) console.error(`      ${o}`);
    console.error('');
    process.exit(1);
  }
  console.log('  \u2713 no page displays a raw i18n key name');

  /* And the same failure in the other dialect: database enum identifiers.
     `statuses: self_employed`, `Housing: student_housing`, `Stage: series_a`
     are all values the schema uses to talk to itself, and they were being
     printed into labelled tables on thousands of pages. A snake_case token in
     visible text is never something a person typed. */
  const ENUMS = [
    'self_employed', 'student_housing', 'any_resident', 'citizen_or_pr',
    'refugee_or_protected', 'in_person', 'via_employer', 'pre_seed',
    'series_a', 'medium_sized',
  ];
  const enumOffenders = [];
  for (const f of htmlFiles) {
    const text = fs
      .readFileSync(f, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    for (const k of ENUMS) {
      if (new RegExp(`\\b${k}\\b`).test(text)) {
        enumOffenders.push(`${path.relative(DIST, f)} shows the raw value "${k}"`);
        break;
      }
    }
    if (enumOffenders.length > 8) break;
  }
  if (enumOffenders.length) {
    console.error(`\n  \u2717 raw database values are visible to users:`);
    for (const o of enumOffenders) console.error(`      ${o}`);
    console.error('');
    process.exit(1);
  }
  console.log('  \u2713 no page displays a raw database enum value');
}


/* ------------------------------------------------------------------ */
/* Every key a template asks for must exist                            */
/*                                                                     */
/* The translator falls back to the key name when a key is absent, and  */
/* nothing errors. src/ui.mjs asked for `checkFree`, no locale file     */
/* defined it, and the literal string "checkFree" shipped as a button   */
/* label on 3,957 pages. This is the static half of that: read the      */
/* templates, read the English dictionary, and hold one against the     */
/* other before anything is even built.                                 */
/* ------------------------------------------------------------------ */
{
  const en = (await import('../src/i18n/en.mjs')).default;
  const known = new Set(Object.keys(en));
  const SOURCES = ['src/ui.mjs', 'src/build.mjs', 'src/blog.mjs'];
  const missing = [];

  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    /* Match the call, then read only its FIRST argument — up to the first
       comma or close paren at depth zero. A ternary lives there too
       (`TR(cond ? 'a' : 'b', x)`), so every quoted literal in that span is a
       key, not just the leading one. */
    for (const m of src.matchAll(/(?<![\w$.])(?:T|TR)\(/g)) {
      let i = m.index + m[0].length;
      let depth = 0;
      let arg = '';
      for (; i < src.length; i += 1) {
        const c = src[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' && depth === 0) break;
        else if (c === ')' || c === ']' || c === '}') depth -= 1;
        else if (c === ',' && depth === 0) break;
        arg += c;
        if (arg.length > 400) break;
      }
      for (const lit of arg.matchAll(/(['"])([A-Za-z_$][\w$]*)\1/g)) {
        if (!known.has(lit[2])) {
          const line = src.slice(0, m.index).split('\n').length;
          missing.push(`${rel}:${line} asks for "${lit[2]}", which en.mjs does not define`);
        }
      }
    }
  }

  if (missing.length) {
    console.error('\n  ✗ a template asks for a key that does not exist:');
    for (const x of missing.slice(0, 12)) console.error(`      ${x}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ every T()/TR() key in ${SOURCES.length} templates exists in en.mjs`);
}

/* ------------------------------------------------------------------ */
/* And nothing that LOOKS like a key reached a control                  */
/*                                                                     */
/* The key-name scan above is exact: it can only catch keys that exist  */
/* in the dictionary today. This one is shaped: an anchor or button     */
/* whose entire label is a camelCase token is an identifier, whatever   */
/* the dictionary happens to contain. It is the check that would have   */
/* caught `checkFree` on the day it was written, when no locale file    */
/* had ever heard of it.                                                */
/* ------------------------------------------------------------------ */
{
  /* A real sample, not the nine hub pages above. The button that leaked was on
     country and category pages — 3,957 of them — and never on a hub, so a
     hub-only crawl would have reported everything fine. */
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8'));
  const sampleCountries = manifest.countries.slice(0, 3);
  const targets = [];
  for (const lang of ['', ...LANGS]) {
    for (const [rel] of SURFACES) targets.push(path.join(DIST, lang, rel, 'index.html'));
    for (const c of sampleCountries) {
      targets.push(path.join(DIST, lang, c.slug, 'index.html'));
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${c.slug}.json`), 'utf8'));
      const cat = data.programmes[0]?.category;
      if (cat) targets.push(path.join(DIST, lang, c.slug, cat, 'index.html'));
    }
  }

  const IDENTIFIER = /^[a-z]+[A-Z][A-Za-z]*$/;
  const shaped = [];
  let scanned = 0;
  for (const f of targets) {
    if (!fs.existsSync(f)) continue;
    scanned += 1;
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const text = m[2].replace(/<[^>]+>/g, '').replace(/&[a-z]+;|&#\d+;/gi, ' ').trim();
      if (IDENTIFIER.test(text)) shaped.push(`${path.relative(DIST, f)}: <${m[1]}> reads "${text}"`);
    }
  }
  if (shaped.length) {
    console.error('\n  ✗ a control is labelled with something shaped like a variable name:');
    for (const x of shaped.slice(0, 12)) console.error(`      ${x}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ no control on ${scanned} sampled pages is labelled with an identifier`);
}

/* ------------------------------------------------------------------ */
/* The head, not just the body                                         */
/*                                                                     */
/* This file measured visible text and stopped at </head>, so two title */
/* bugs lived under it for as long as they liked: the home page passed  */
/* SITE_NAME and got a one-word <title>, and /startups/check/ and       */
/* /auto-apply/ carried hardcoded English titles in all seven locales.  */
/* A <title> is the one string a reader sees before they open the page. */
/* ------------------------------------------------------------------ */
{
  const SITE_NAME = 'Unclaimed';
  const HUBS = ['', 'pricing/', 'startups/', 'startups/check/', 'auto-apply/', 'countries/', 'account/'];
  const titleOf = (f) => {
    if (!fs.existsSync(f)) return null;
    const head = fs.readFileSync(f, 'utf8').split('</head>')[0];
    return {
      title: (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() ?? null,
      og: (head.match(/<meta property="og:title" content="([^"]*)"/) || [])[1]?.trim() ?? null,
    };
  };

  const problems = [];

  /* A title equal to the site name, anywhere. layout() skips the " · Unclaimed"
     suffix when the title already IS the site name, which is what turned the
     home page into a one-word search result. */
  const everyPage = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === 'index.html') everyPage.push(f);
    }
  })(DIST);
  for (const f of everyPage) {
    /* The PWA shell is exempt: its <title> becomes the standalone window's
       title bar and the home-screen label, where the product name on its own is
       the right answer. It is not a document anybody arrives at from a search
       result. */
    if (path.relative(DIST, f).startsWith(`app${path.sep}`)) continue;
    const t = titleOf(f);
    if (t && t.title === SITE_NAME) problems.push(`${path.relative(DIST, f)} has a <title> of just "${SITE_NAME}"`);
    if (problems.length > 6) break;
  }

  /* And a localised hub whose head is byte-identical to the English one has not
     been localised — it has been copied. */
  for (const rel of HUBS) {
    const enT = titleOf(path.join(DIST, rel, 'index.html'));
    if (!enT || !enT.title) continue;
    for (const lang of LANGS) {
      const locT = titleOf(path.join(DIST, lang, rel, 'index.html'));
      if (!locT || !locT.title) continue;
      if (locT.title === enT.title) problems.push(`/${lang}/${rel} has the English <title> "${enT.title}"`);
      else if (locT.og && enT.og && locT.og === enT.og) problems.push(`/${lang}/${rel} has the English og:title "${enT.og}"`);
    }
  }

  if (problems.length) {
    console.error('\n  ✗ page titles:');
    for (const x of problems.slice(0, 12)) console.error(`      ${x}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ every hub page has a localised <title> and no page is titled only "${SITE_NAME}"`);
}

console.log(
  `\n${checked - bad} of ${checked} pages under the ${(THRESHOLD * 100).toFixed(0)}% threshold` +
    `, ${bad} still substantially English.\n`,
);
process.exit(bad ? 1 : 0);
