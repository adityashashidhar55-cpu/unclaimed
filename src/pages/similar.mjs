/**
 * UNCLAIMED — "Similar programmes", on every household and company page.
 *
 * New file, not another block inside src/build.mjs, for the same reason as
 * src/pages/closing-soon.mjs: several people build pages in this codebase at
 * once, and a self-contained module build.mjs only calls into is a much
 * smaller place to collide than a few hundred more lines inside an already
 * huge file.
 *
 * Deterministic and build-time — no randomness, no client-side re-ranking.
 * The same programme page produces the same "Similar programmes" list on
 * every build until the underlying data changes, which is what makes the
 * block cacheable, testable and honest: nothing here is personalised or
 * A/B'd, it is a fixed function of the public dataset.
 *
 * Scoring shares one shape across both audiences — "closer" means: same
 * category of thing this money is (grant_type / category), same kind of
 * payer (funder_type for companies; benefit_type for households), a
 * similar amount, the same funder — and, for companies only, an open
 * programme is preferred over a closed one as a tie-break, never as a
 * filter (a closed match can still be the best match on substance).
 *
 * A record only ever links to a PUBLIC programme page on this site — never
 * to the funder's own site — and never carries an amount, a status or a
 * name this codebase did not already have on that programme's own page.
 */

/** Representative amount for banding: the ceiling if one is published. */
function amountOf(p) {
  return p.amount_max ?? p.amount_min ?? null;
}

/* Six bands, not a raw comparison. Two programmes of "€4,800" and "€5,300"
   are the same kind of money to a reader deciding what to look at next; a
   raw numeric distance would rank a programme with no published amount
   (`null`) as maximally different from everything, which is the wrong
   answer at least as often as it is the right one. */
const BAND_CEILINGS = [1000, 5000, 20000, 100000, 500000];
function bandOf(amt) {
  if (amt == null) return null;
  for (let i = 0; i < BAND_CEILINGS.length; i += 1) {
    if (amt <= BAND_CEILINGS[i]) return i;
  }
  return BAND_CEILINGS.length;
}

/* The same programme listed twice under two slugs (a pre-existing data
   duplicate, e.g. two "Enterprise Investment Scheme (EIS)" records in gb)
   scores as the MOST similar thing to itself — and a "Similar programmes"
   card pointing at the programme the reader is already reading looks broken.
   Skip a candidate whose folded name matches the target's AND that covers
   the same admin area. Regional variants that share a name (France's
   "Regionalised i-Demo" per region, Australia's per-state First Home Owner
   Grant) differ in admin_area and stay in. */
function foldName(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function isSameProgramme(p, target) {
  return foldName(p.name_en) !== '' && foldName(p.name_en) === foldName(target.name_en)
    && String(p.admin_area ?? '') === String(target.admin_area ?? '');
}

/* Also collapse duplicate pairs among the candidates themselves: two records
   of SEIS both scoring high on an EIS page would otherwise take two of the
   six slots with the same programme. First (best-ranked) one wins. */
function dedupeByProgramme(list, limit) {
  const out = [];
  for (const p of list) {
    if (out.some((q) => isSameProgramme(p, q))) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Household similarity, within one country's programme pool.
 *
 * +3 same category (housing, income_support, …) — the strongest signal:
 *    a reader comparing this programme is almost always comparing within
 *    the same kind of support.
 * +2 same benefit_type (cash, voucher, credit, …)
 * +2 same amount band
 * +1 same funder
 *
 * A candidate that shares nothing with the target (score 0) is left out
 * rather than padded in to reach a target count — a page that says
 * "similar" and links to something unrelated is worse than a short list.
 */
export function similarHousehold(pool, target, limit = 6) {
  const band = bandOf(amountOf(target));
  const scored = [];
  for (const p of pool) {
    if (p.slug === target.slug || isSameProgramme(p, target)) continue;
    let score = 0;
    if (p.category === target.category) score += 3;
    if (p.benefit_type === target.benefit_type) score += 2;
    if (band != null && bandOf(amountOf(p)) === band) score += 2;
    if (p.funder && p.funder === target.funder) score += 1;
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const av = (a.p.verification_status === 'verified') ? 1 : 0;
    const bv = (b.p.verification_status === 'verified') ? 1 : 0;
    if (bv !== av) return bv - av;
    const aa = amountOf(a.p) ?? -1;
    const ba = amountOf(b.p) ?? -1;
    if (ba !== aa) return ba - aa;
    return String(a.p.slug).localeCompare(String(b.p.slug));
  });
  return dedupeByProgramme(scored.map((s) => s.p), limit);
}

/**
 * Company similarity, within one country's grant pool.
 *
 * +3 same grant_type (grant, voucher, tax_credit, accelerator, …)
 * +2 same funder_type (public / private / mixed)
 * +2 same amount band
 * +1 same funder
 * tie-break: an open/rolling/upcoming programme (per effectiveStatus, the
 * same status derivation every other status badge on the site uses) sorts
 * before a closed one — never as a filter, only when substance is tied.
 */
export function similarCompany(pool, target, asOf, effectiveStatus, limit = 6) {
  const band = bandOf(amountOf(target));
  const openRank = (p) => (['open', 'rolling', 'upcoming'].includes(effectiveStatus(p, asOf)) ? 0 : 1);
  const scored = [];
  for (const p of pool) {
    if (p.slug === target.slug || isSameProgramme(p, target)) continue;
    let score = 0;
    if (p.grant_type === target.grant_type) score += 3;
    if (p.funder_type === target.funder_type) score += 2;
    if (band != null && bandOf(amountOf(p)) === band) score += 2;
    if (p.funder && p.funder === target.funder) score += 1;
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ar = openRank(a.p);
    const br = openRank(b.p);
    if (ar !== br) return ar - br;
    const aa = amountOf(a.p) ?? -1;
    const ba = amountOf(b.p) ?? -1;
    if (ba !== aa) return ba - aa;
    return String(a.p.slug).localeCompare(String(b.p.slug));
  });
  return dedupeByProgramme(scored.map((s) => s.p), limit);
}

/** The block on a household /{cc}/{category}/{slug}/ page. Localised heading. */
export function similarHouseholdBlock({ base, cc, items, TR, esc }) {
  if (!items.length) return '';
  const rows = items
    .map(
      (p) => `<a class="card card-link" href="${base}/${esc(cc)}/${esc(p.category)}/${esc(p.slug)}/">
    <h3 style="margin:0;font-size:1rem">${esc(p.name_en)}</h3>
    <p class="small" style="margin:.4rem 0 0;color:var(--ink-3)">${esc(p.funder)}</p>
  </a>`,
    )
    .join('');
  return `<h2 style="margin-top:3rem">${esc(TR('similarProgrammes'))}</h2>
  <div class="grid grid-2" style="margin-top:1rem">${rows}</div>`;
}

/**
 * The block on a company /startups/{cc}/{slug}/ page. English only, like the
 * rest of /startups/** — see CLAUDE.md — so a plain literal heading, no TR().
 * Carries the same live status chip and `data-closes` attribute as every
 * other status badge on the site, so the freshness script keeps it correct
 * on a page a reader has left open across midnight.
 */
export function similarCompanyBlock({ base, items, asOf, esc, attr, deadlineState, liveAttrs }) {
  if (!items.length) return '';
  const rows = items
    .map((p) => {
      const d = deadlineState(p, asOf);
      return `<a class="card card-link" href="${base}/startups/${esc(p.country_code)}/${esc(p.slug)}/">
    <div class="row-between">
      <h3 style="margin:0;font-size:1rem">${esc(p.name_en)}</h3>
      <span class="status status--${d.urgency}"${liveAttrs(p)} title="${attr(d.detail)}">${esc(d.headline)}</span>
    </div>
    <p class="small" style="margin:.4rem 0 0;color:var(--ink-3)">${esc(p.funder)}</p>
  </a>`;
    })
    .join('');
  return `<h2 style="margin-top:2.5rem">Similar programmes</h2>
  <div class="grid grid-2" style="margin-top:1rem">${rows}</div>`;
}
