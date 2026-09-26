/**
 * /funders/ — profile pages grouping company AND household programmes by the
 * organisation that funds them.
 *
 * A new file rather than more of src/build.mjs: like src/pages/compare.mjs,
 * this adds one page shape (an A-Z hub) plus one page per qualifying funder,
 * and nothing it needs is specific to build.mjs's internals — it takes a
 * plain `ctx` object built.mjs already has to hand.
 *
 * Grouping is name-based, not a curated funder database: `funderKey()` folds
 * away punctuation, diacritics and casing so "U.S. Small Business
 * Administration" and "US Small Business Administration" land in the same
 * bucket, but it does NOT expand abbreviations or resolve aliases — "SBA" and
 * "Small Business Administration" stay two different funders here, because
 * merging those safely needs a curated map this dataset does not have, and a
 * wrong merge (two different bodies sharing a page) is worse than two pages
 * for the same one. A funder gets a page only once its group has at least
 * FUNDER_MIN_PROGRAMMES records; everything else keeps linking straight to
 * its own official source, exactly as before this feature existed.
 */

import { deadlineState } from '../../packages/deadlines/index.js';

export const FUNDER_MIN_PROGRAMMES = 2;

/** Fold a funder name down to a grouping key. See file header for scope. */
export function funderKey(raw) {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’`()]/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyKey(key) {
  return (
    key
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'funder'
  );
}

/**
 * Group every household and company programme by normalised funder.
 *
 * Returns every funder (even those with a single programme, so build.mjs can
 * still look one up when deciding whether to link its name), sorted A→Z by
 * display name. `hasPage` marks the ones that clear FUNDER_MIN_PROGRAMMES.
 */
export function buildFunderDirectory({ countries, STARTUP_MANIFEST, STARTUP_DATA }) {
  const groups = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { key, nameCounts: new Map(), household: [], startup: [] });
    return groups.get(key);
  };

  for (const { entry, data } of countries) {
    for (const p of data.programmes) {
      if (!p.funder) continue;
      const key = funderKey(p.funder);
      if (!key) continue;
      const g = group(key);
      g.nameCounts.set(p.funder, (g.nameCounts.get(p.funder) || 0) + 1);
      g.household.push({ cc: entry.slug, countryName: entry.name, flag: entry.flag, p });
    }
  }

  for (const c of STARTUP_MANIFEST.countries) {
    for (const p of STARTUP_DATA[c.slug].programmes) {
      if (!p.funder) continue;
      const key = funderKey(p.funder);
      if (!key) continue;
      const g = group(key);
      g.nameCounts.set(p.funder, (g.nameCounts.get(p.funder) || 0) + 1);
      g.startup.push({ cc: c.slug, countryName: c.name, flag: c.flag, p });
    }
  }

  const usedSlugs = new Set();
  const list = [...groups.values()].map((g) => {
    const total = g.household.length + g.startup.length;
    // Most-common raw spelling wins the display name; ties break alphabetically.
    const names = [...g.nameCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const name = names[0][0];
    let slug = slugifyKey(g.key);
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);
    const countryCount = new Set([...g.household, ...g.startup].map((r) => r.cc)).size;
    return {
      key: g.key,
      slug,
      name,
      total,
      countryCount,
      household: g.household,
      startup: g.startup,
      hasPage: total >= FUNDER_MIN_PROGRAMMES,
    };
  });

  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/* Same one-line rule build.mjs's own liveAttrs(p) applies — kept in sync with
   it deliberately rather than importing it, since it is not exported from
   ui.mjs. See src/build.mjs. */
function liveAttrs(p, attr) {
  const live = p && ['open', 'rolling', 'upcoming'].includes(p.status);
  return live && p.closes_at ? ` data-closes="${attr(String(p.closes_at).slice(0, 10))}"` : '';
}

function programmeRow({ r, kind, ctx }) {
  const { esc, attr, BASE, ICON } = ctx;
  const href =
    kind === 'household'
      ? `${BASE}/${r.cc}/${r.p.category}/${r.p.slug}/`
      : `${BASE}/startups/${r.cc}/${r.p.slug}/`;
  const chip =
    kind === 'startup'
      ? (() => {
          const d = deadlineState(r.p, ctx.BUILD_NOW);
          return `<span class="status status--${d.urgency}"${liveAttrs(r.p, attr)}>${esc(d.meta.label)}</span>`;
        })()
      : r.p.is_automatic
        ? '<span class="badge badge-neutral">Automatic</span>'
        : '';
  return `<a class="card card-link reveal" href="${attr(href)}">
    <span class="row-between" style="width:100%">
      <span>
        <span class="eyebrow">${esc(r.flag)} ${esc(r.countryName)}</span>
        <h3 style="margin:.25rem 0 0;font-size:1rem">${esc(r.p.name_en)}</h3>
      </span>
      <span class="row" style="gap:.5rem;flex-shrink:0">${chip}<span class="tiny">${ICON.arrow}</span></span>
    </span>
  </a>`;
}

/** The hub at /funders/ — every funder with a page, A→Z. */
export function fundersIndexPage(directory, ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, nf, L } = ctx;
  const withPages = directory.filter((f) => f.hasPage);
  const letters = new Map();
  for (const f of withPages) {
    const l = /[a-z]/i.test(f.name[0]) ? f.name[0].toUpperCase() : '#';
    if (!letters.has(l)) letters.set(l, []);
    letters.get(l).push(f);
  }
  const sortedLetters = [...letters.keys()].sort();

  const jump = sortedLetters.map((l) => `<a href="#letter-${esc(l)}" class="badge badge-neutral">${esc(l)}</a>`).join(' ');

  const sections = sortedLetters
    .map((l) => {
      const rows = letters
        .get(l)
        .map(
          (f) => `<a class="card card-link reveal" href="${attr(`${BASE}/funders/${f.slug}/`)}">
        <h2 style="margin:0;font-size:1.05rem">${esc(f.name)}</h2>
        <p class="small" style="margin:.3rem 0 0">${nf(f.total)} programmes · ${nf(f.countryCount)} ${f.countryCount === 1 ? 'jurisdiction' : 'jurisdictions'}</p>
      </a>`,
        )
        .join('');
      return `<h2 id="letter-${esc(l)}" class="h-eyebrow" style="margin-top:2.5rem">${esc(l)}</h2>
      <div class="grid grid-3" style="margin-top:1rem">${rows}</div>`;
    })
    .join('');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: withPages.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/funders/${f.slug}/`,
      name: f.name,
    })),
  };

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Funders' }])}
  <span class="eyebrow eyebrow-accent">Funders</span>
  <h1>Every funder we can name, in one place</h1>
  <p class="lede" style="max-width:62ch">${nf(withPages.length)} public and private organisations that fund two or more programmes in
  our dataset — household benefits and company grants together. A single-programme funder is linked directly from its own
  programme page instead of getting a thin page here.</p>

  <div class="row" style="gap:.4rem;flex-wrap:wrap;margin-top:1.5rem">${jump}</div>
  ${sections}
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Funders A–Z — who pays out what, across Unclaimed',
    description: `An A–Z directory of ${nf(withPages.length)} funders running two or more programmes in the Unclaimed dataset, across household benefits and company grants.`,
    canonical: `${SITE_URL}/funders/`,
    jsonld: [breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Funders', href: '/funders/' }]), ld],
    body,
  });
}

/** One /funders/<slug>/ page. */
export function funderProfilePage(f, ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, nf, L } = ctx;
  const all = [...f.household.map((r) => ({ r, kind: 'household' })), ...f.startup.map((r) => ({ r, kind: 'startup' }))];
  const countryNames = [...new Map(all.map(({ r }) => [r.cc, r.countryName])).values()].sort((a, b) => a.localeCompare(b));

  const householdRows = f.household
    .slice()
    .sort((a, b) => a.countryName.localeCompare(b.countryName) || a.p.name_en.localeCompare(b.p.name_en))
    .map((r) => programmeRow({ r, kind: 'household', ctx }))
    .join('');
  const startupRows = f.startup
    .slice()
    .sort((a, b) => a.countryName.localeCompare(b.countryName) || a.p.name_en.localeCompare(b.p.name_en))
    .map((r) => programmeRow({ r, kind: 'startup', ctx }))
    .join('');

  const ld = [
    breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Funders', href: '/funders/' }, { label: f.name }]),
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: f.name,
      description: `${f.name} funds ${nf(f.total)} programmes tracked by Unclaimed across ${nf(f.countryCount)} ${f.countryCount === 1 ? 'jurisdiction' : 'jurisdictions'}.`,
      url: `${SITE_URL}/funders/${f.slug}/`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: all.map(({ r, kind }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}${kind === 'household' ? `/${r.cc}/${r.p.category}/${r.p.slug}/` : `/startups/${r.cc}/${r.p.slug}/`}`,
        name: r.p.name_en,
      })),
    },
  ];

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Funders', href: `${BASE}/funders/` }, { label: f.name }])}
  <span class="eyebrow eyebrow-accent">Funder</span>
  <h1 style="max-width:26ch">${esc(f.name)}</h1>
  <p class="lede">${nf(f.total)} programme${f.total === 1 ? '' : 's'} in our dataset, across ${nf(f.countryCount)} ${f.countryCount === 1 ? 'jurisdiction' : 'jurisdictions'}: ${esc(countryNames.join(', '))}.</p>

  ${startupRows ? `<h2 style="margin-top:2.5rem">Company grants from ${esc(f.name)}</h2>
  <div class="grid grid-2" style="margin-top:1rem">${startupRows}</div>` : ''}

  ${householdRows ? `<h2 style="margin-top:2.5rem">Household benefits from ${esc(f.name)}</h2>
  <div class="grid grid-2" style="margin-top:1rem">${householdRows}</div>` : ''}

  <p class="small" style="margin-top:2.5rem">Grouped by name — see something wrong, or two funders that should not be one page (or one that should be)?
  <a class="link-underline" href="https://github.com/adityashashidhar55-cpu/unclaimed/issues/new?title=${encodeURIComponent(`Funder grouping: ${f.name}`)}" rel="noopener" target="_blank">Report it on GitHub</a>.</p>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
  <a class="btn" style="margin-left:.6rem" href="${BASE}/startups/check/">${esc(TR('ctaCheckCompany'))}</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${f.name} — every programme we track`,
    description: `${f.name} funds ${nf(f.total)} programmes in the Unclaimed dataset across ${nf(f.countryCount)} ${f.countryCount === 1 ? 'jurisdiction' : 'jurisdictions'}, household and company, each linked to its official source.`,
    canonical: `${SITE_URL}/funders/${f.slug}/`,
    jsonld: ld,
    body,
  });
}
