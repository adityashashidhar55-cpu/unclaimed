/**
 * /changelog/ — "What's new", curated from data/changelog.json.
 *
 * Each entry describes a real, already-shipped feature in this codebase (see
 * the file's own header comment for what each one maps to). English-only,
 * like /compare/ and /browse/ — a reference page, not a wizard surface.
 *
 * Lives at data/site/changelog.json rather than data/changelog.json: half a
 * dozen scripts (verify.mjs, test-amounts.mjs, test-eligibility.mjs,
 * test-vocabulary.mjs, verify-native.mjs) `readdirSync(data/)` and treat every
 * *.json file there as one country's programme dataset — a flat {entries:[]}
 * file at that level crashed test-eligibility.mjs's `doc.programmes || doc`
 * fallback. A subdirectory keeps this file out of that scan entirely, with no
 * changes needed to those five scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, disclaimerBar } from '../ui.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANGELOG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../data/site/changelog.json'), 'utf8'),
).entries;

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

const fmt = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function changelogPage({ BASE, SITE_URL, layout, TR }) {
  const entries = CHANGELOG.slice().sort((a, b) => b.date.localeCompare(a.date));
  const crumbs = breadcrumbs([{ label: 'Home', href: `${BASE}/` }, { label: "What's new" }]);

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell-narrow">
  ${crumbs}
  <span class="eyebrow eyebrow-accent">Changelog</span>
  <h1 style="max-width:22ch">What's new</h1>
  <p class="lede">Plain-language notes on what actually shipped, in the order it shipped — not a marketing timeline.</p>

  <div class="list-rows" style="margin-top:2rem">
    ${entries
      .map(
        (e) => `<article class="card" style="margin-bottom:1rem">
      <p class="tiny" style="margin:0;color:var(--ink-3)">${esc(fmt(e.date))}</p>
      <h2 style="margin:.3rem 0 .5rem;font-size:1.2rem">${esc(e.title)}</h2>
      <p style="margin:0">${esc(e.body)}</p>
    </article>`,
      )
      .join('')}
  </div>

  <p style="margin-top:2.5rem"><a class="link-underline" href="${BASE}/trust/">Trust, privacy & AI</a> ·
  <a class="link-underline" href="${BASE}/methodology/">Methodology</a></p>
</section>`;

  return layout({
    base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
    title: "What's new",
    description: `Plain-language release notes: ${entries.length} shipped features, most recent first.`,
    canonical: `${SITE_URL}/changelog/`,
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: entries.map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: e.title })),
      },
    ],
    body,
  });
}
