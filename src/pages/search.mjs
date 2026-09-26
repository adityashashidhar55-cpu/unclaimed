/**
 * UNCLAIMED — site-wide keyword search.
 *
 * 17 of 18 competitor sites in compare/ have a keyword search; this site had
 * filters only — a picker per country, then a category, then a click. That
 * is the right shape for someone who already knows what they are looking
 * for, and the wrong one for "is there anything here for solar panels" or
 * "EIC accelerator". This is the fix: a build-time index of the same public
 * fields already on every programme page, and a small zero-dependency
 * client-side search over it.
 *
 * New file, not another block inside src/build.mjs — see the note atop
 * src/pages/closing-soon.mjs for why: several people build pages in this
 * repo at once, and a self-contained module build.mjs only calls into is a
 * much smaller place to collide.
 *
 * ONE shared /search/ page, not one per locale. Programme names in this
 * dataset are not translated per interface language — a record carries
 * `name_en` and, sometimes, a single `name_local` (the name the funder
 * itself publishes, in its own country's language), never a name-per-UI-
 * locale. Seven copies of the same index behind seven copies of the same
 * results screen would be duplicate weight bought for zero extra
 * translation, so the page is built once, in English, like /compare/ and
 * /browse/ — and every locale's header still gets the search BOX, with the
 * placeholder in that locale's own language (see the i18n keys
 * `navSearch`/`searchPlaceholder`/`searchAriaLabel` and src/ui.mjs).
 *
 * Only public fields travel into the index: slug, name_en, name_local,
 * funder, country, the category/grant_type, and a status — every one of
 * these is already unpaywalled prose on that programme's own public page
 * (see PAYWALL_SCHEMES in src/build.mjs and lockedStartupRecord() in
 * pages/free-tier.mjs). Nothing here is a paid field rendered somewhere new.
 *
 * Household and company are separate files, fetched only when the reader
 * actually searches (not on every page load) and only the one(s) the
 * audience toggle asks for. Measured at build time (see scripts/test-
 * search.mjs): ~430KB for 2,217 household records and ~310KB for 1,641
 * company records, both well under a size where splitting per country would
 * buy anything — a per-country split adds a country-picker step before the
 * first keystroke can search anything, for a file that already loads in
 * well under a second on an ordinary connection. If the dataset grows enough
 * to change that trade-off, splitting is a change to buildSearchIndexes()
 * below and to the two fetch() calls in SEARCH_CLIENT_JS, nothing else.
 */

/** Representative amount, never invented — undefined stays undefined. */
function pick(v) {
  return v === undefined ? undefined : v;
}

/**
 * Builds dist/search/household.json and dist/search/company.json.
 *
 * @param {object} ctx
 * @param {{entry:object,data:object}[]} ctx.countries   household country list, as build.mjs holds it
 * @param {object} ctx.STARTUP_MANIFEST
 * @param {object} ctx.STARTUP_DATA
 * @param {number} ctx.BUILD_NOW
 * @param {(p:object, asOf:number) => string} ctx.effectiveStatus
 * @param {(rel:string, content:string) => void} ctx.write
 */
export function buildSearchIndexes({ countries, STARTUP_MANIFEST, STARTUP_DATA, BUILD_NOW, effectiveStatus, write }) {
  const hCountries = {};
  const hRecords = [];
  for (const { entry, data } of countries) {
    hCountries[entry.slug] = { name: entry.name, flag: entry.flag };
    for (const p of data.programmes) {
      hRecords.push({
        s: p.slug,
        n: p.name_en,
        l: p.name_local && p.name_local !== p.name_en ? p.name_local : undefined,
        f: p.funder,
        c: entry.slug,
        g: p.category,
        v: p.verification_status === 'verified' ? 1 : 0,
      });
    }
  }
  write('search/household.json', JSON.stringify({ countries: hCountries, records: hRecords }));

  const cCountries = {};
  const cRecords = [];
  for (const c of STARTUP_MANIFEST.countries) {
    cCountries[c.slug] = { name: c.name, flag: c.flag };
    for (const p of STARTUP_DATA[c.slug].programmes) {
      cRecords.push({
        s: p.slug,
        n: p.name_en,
        l: p.name_local && p.name_local !== p.name_en ? p.name_local : undefined,
        f: p.funder,
        c: c.slug,
        g: p.grant_type,
        /* The same derivation as every other status badge on the site — see
           CLAUDE.md's "Company status must go through effectiveStatus()" —
           never the raw, possibly-stale `status` column. */
        st: effectiveStatus(p, BUILD_NOW),
      });
    }
  }
  write('search/company.json', JSON.stringify({ countries: cCountries, records: cRecords }));

  return { householdCount: hRecords.length, companyCount: cRecords.length };
}

/** /search/ — one page, English, shared by every locale's header search box. */
export function searchPage({ base, layout, esc, breadcrumbs, breadcrumbLd, SITE_URL, disclaimerBar, TR, householdCount, companyCount, ASSET_V }) {
  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell">
  ${breadcrumbs([{ label: 'Home', href: `${base}/` }, { label: 'Search' }])}
  <span class="eyebrow eyebrow-accent">Search</span>
  <h1 style="max-width:24ch">Search benefits and grants</h1>
  <p class="lede" style="max-width:60ch">Every public programme name and funder across ${(householdCount + companyCount).toLocaleString('en')} household benefits and
  company grants, searched in your browser — nothing you type here is sent anywhere.</p>

  <div id="search-app" data-base="${esc(base)}" class="stack" style="margin-top:1.6rem">
    <noscript>
      <div class="callout">
        <p><strong>This search needs JavaScript.</strong> Without it, browse instead:
        <a class="link-underline" href="${base}/countries/">household benefits by country</a> or
        <a class="link-underline" href="${base}/startups/">startup grants by jurisdiction</a>.</p>
      </div>
    </noscript>
  </div>
</section>
<script type="module" src="${base}/search.js?v=${ASSET_V}"></script>`;

  return layout({
    base,
    linkBase: base,
    lang: 'en',
    tr: TR,
    altLangs: [],
    title: 'Search benefits and grants',
    description: `Search ${(householdCount + companyCount).toLocaleString('en')} household benefits and company grants by name or funder, across every country and jurisdiction this site covers.`,
    canonical: `${SITE_URL}/search/`,
    body,
    jsonld: [breadcrumbLd([{ label: 'Home', href: `${base}/` }, { label: 'Search' }])],
  });
}

/**
 * The client — plain ES module, zero dependencies, written verbatim by
 * build.mjs's write() (which version-stamps any bare-specifier imports; this
 * file has none, so it ships unchanged).
 *
 * Ranking: every query token must match SOMEWHERE on a record (AND across
 * tokens) or the record is dropped, then records are ordered by the best
 * single match any query token makes — an exact whole-token hit on the name
 * outranks a prefix hit, which outranks a funder hit, which outranks a
 * country hit. Diacritic-insensitive and prefix-based in both directions
 * (typing "cafe" matches "café" and vice versa) so an accent a reader does
 * not type, or does not know a funder uses, never hides a real result.
 */
export const SEARCH_CLIENT_JS = `
const root = document.getElementById('search-app');
if (root) {
  const BASE = root.dataset.base || '';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Diacritic-insensitive, case-insensitive, punctuation-insensitive. */
  function fold(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase();
  }
  function tokens(s) {
    return fold(s).split(/[^a-z0-9]+/).filter(Boolean);
  }

  const CACHE = {};
  async function loadIndex(kind) {
    if (CACHE[kind]) return CACHE[kind];
    const res = await fetch(BASE + '/search/' + kind + '.json');
    const data = await res.json();
    /* Precompute folded token lists once per record, not once per keystroke —
       the index is a few thousand rows and re-folding every string on every
       render is the difference between typing feeling instant and feeling
       laggy on a mid-range phone. */
    for (const r of data.records) {
      r._nt = tokens(r.n);
      r._lt = r.l ? tokens(r.l) : [];
      r._ft = tokens(r.f);
    }
    CACHE[kind] = data;
    return data;
  }

  /* Best score one query token gets against one record's fields. 0 = no match
     at all (this token disqualifies the record under AND semantics below). */
  function tokenScore(qt, r) {
    let best = 0;
    for (const nt of r._nt) {
      if (nt === qt) return 5;
      if (nt.startsWith(qt) || qt.startsWith(nt)) best = Math.max(best, 3);
    }
    for (const lt of r._lt) {
      if (lt === qt) best = Math.max(best, 4);
      else if (lt.startsWith(qt) || qt.startsWith(lt)) best = Math.max(best, 2.5);
    }
    for (const ft of r._ft) {
      if (ft === qt) best = Math.max(best, 2);
      else if (ft.startsWith(qt)) best = Math.max(best, 1);
    }
    if (best === 0) {
      const c = fold(r.c);
      if (c.startsWith(qt) || qt.startsWith(c)) best = 0.5;
    }
    return best;
  }

  function search(data, query) {
    const qts = tokens(query);
    if (!qts.length) return [];
    const out = [];
    for (const r of data.records) {
      let total = 0;
      let ok = true;
      for (const qt of qts) {
        const s = tokenScore(qt, r);
        if (s === 0) { ok = false; break; }
        total += s;
      }
      if (ok) out.push({ r, total });
    }
    out.sort((a, b) => b.total - a.total || a.r.n.localeCompare(b.r.n));
    return out.slice(0, 60).map((x) => x.r);
  }

  function url(kind, countries, r) {
    if (kind === 'company') return BASE + '/startups/' + r.c + '/' + r.s + '/';
    return BASE + '/' + r.c + '/' + r.g + '/' + r.s + '/';
  }

  function row(kind, countries, r) {
    const country = countries[r.c] || {};
    const audience = kind === 'company' ? 'Company grant' : 'Household benefit';
    return '<a class="list-row" href="' + url(kind, countries, r) + '">' +
      '<span>' +
        '<span class="list-row__name">' + esc(r.n) + '</span>' +
        '<span class="list-row__meta">' + esc(r.l && r.l !== r.n ? r.l + ' \\u00b7 ' : '') + esc(r.f) + '</span>' +
      '</span>' +
      '<span class="list-row__right">' +
        '<span class="tiny">' + esc((country.flag ? country.flag + ' ' : '') + (country.name || r.c)) + '</span>' +
        '<span class="badge badge-neutral">' + esc(audience) + '</span>' +
      '</span>' +
    '</a>';
  }

  let AUDIENCE = 'all'; // 'all' | 'household' | 'company'

  root.innerHTML =
    '<form id="search-form" role="search" style="max-width:38rem">' +
      '<label for="search-q" class="field" style="margin-bottom:0">Search by name or funder' +
        '<input id="search-q" type="search" autocomplete="off" placeholder="e.g. childcare, EIC Accelerator, solar panels\\u2026" autofocus></label>' +
    '</form>' +
    '<div class="btn-row" style="margin-top:1rem" role="group" aria-label="Filter by audience">' +
      '<button class="btn btn-sm" type="button" data-aud="all" aria-pressed="true">All</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-aud="household" aria-pressed="false">Household</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-aud="company" aria-pressed="false">Company grants</button>' +
    '</div>' +
    '<p class="small" id="search-count" style="margin-top:1rem" aria-live="polite"></p>' +
    '<div class="list-rows" id="search-results"></div>';

  const input = document.getElementById('search-q');
  const out = document.getElementById('search-results');
  const count = document.getElementById('search-count');
  const audBtns = [...root.querySelectorAll('[data-aud]')];

  const qs = new URLSearchParams(location.search);
  if (qs.get('q')) input.value = qs.get('q');

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  }

  async function run() {
    const query = input.value.trim();
    try {
      const params = new URLSearchParams(location.search);
      if (query) params.set('q', query); else params.delete('q');
      const qstr = params.toString();
      history.replaceState(null, '', location.pathname + (qstr ? '?' + qstr : ''));
    } catch {
      /* Non-navigable context (a preview iframe, say) — the search still works. */
    }
    if (!query) {
      out.innerHTML = '';
      count.textContent = '';
      return;
    }
    count.textContent = 'Searching\\u2026';
    const wantHousehold = AUDIENCE !== 'company';
    const wantCompany = AUDIENCE !== 'household';
    const [h, c] = await Promise.all([
      wantHousehold ? loadIndex('household') : Promise.resolve(null),
      wantCompany ? loadIndex('company') : Promise.resolve(null),
    ]);
    /* Interleave by rank rather than "all household, then all company" — each
       half is independently sorted best-first, and a straight concatenation
       would bury a perfect company match under 60 mediocre household ones.
       This is a merge by position, not a re-score. */
    const merged = [];
    const hList = h ? search(h, query) : [];
    const cList = c ? search(c, query) : [];
    for (let i = 0; i < 60; i += 1) {
      if (i < hList.length) merged.push({ kind: 'household', countries: h.countries, r: hList[i] });
      if (i < cList.length) merged.push({ kind: 'company', countries: c.countries, r: cList[i] });
    }
    const shown = merged.slice(0, 60);
    if (!shown.length) {
      out.innerHTML = '';
      count.textContent = 'No matches for \\u201c' + query + '\\u201d.';
      return;
    }
    count.textContent = shown.length + (shown.length === 60 ? '+' : '') + ' result' + (shown.length === 1 ? '' : 's') + '.';
    out.innerHTML = shown.map((x) => row(x.kind, x.countries, x.r)).join('');
  }

  input.addEventListener('input', schedule);
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  audBtns.forEach((b) => b.addEventListener('click', () => {
    AUDIENCE = b.dataset.aud;
    audBtns.forEach((x) => {
      const on = x === b;
      x.setAttribute('aria-pressed', String(on));
      x.classList.toggle('btn-ghost', !on);
    });
    run();
  }));

  if (input.value) run();
}
`;
