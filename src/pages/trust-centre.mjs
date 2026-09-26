/**
 * /trust/ — "Trust, privacy & AI".
 *
 * Localised like /privacy/ (which it sits beside in the footer's Trust
 * column), because the claims on this page are read by the same audience in
 * the same languages. Every factual sentence here was checked against the
 * actual code before being written, not assumed:
 *
 *   - What we hold: migrations/0001-0010 (users/entitlements, workspaces,
 *     vault_documents, alert_subscriptions, events).
 *   - What the beacon sends: src/pwa/beacon.js (the client) and
 *     handleEvent() in worker/index.js (the server column list — step,
 *     visitor, country, locale, surface; no IP, no cookie).
 *   - Eligibility running client-side: src/app.js / src/pwa/app.js import
 *     src/engine/matcher.js directly and call it in the browser; there is no
 *     POST that carries a household's answers anywhere in worker/index.js.
 *   - The vault: packages/vault/index.js and migrations/0002_vault.sql — R2
 *     ciphertext, a wrapped key the server cannot use.
 *   - AI: handleGenerate() in worker/index.js — gated by orgGate() +
 *     entitlementFor() + quota spend, calls api.anthropic.com only inside
 *     that handler, nowhere else in the codebase.
 *   - MCP: data/mcp-tools.json lists exactly six tools (check_entitlements,
 *     search_programmes, get_programme, get_documents, get_procedure,
 *     get_coverage) and worker/index.js's handleMcp() has no write method.
 *
 * Kept in its own file per the multi-builder convention (see
 * src/pages/compare.mjs, src/pages/de-minimis.mjs): build.mjs only imports
 * and calls in.
 */
import { esc, disclaimerBar } from '../ui.mjs';

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

function breadcrumbLd(origin, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.label,
      item: it.href ? `${origin}${it.href}` : undefined,
    })),
  };
}

export function trustCentrePage({ BASE, LB, L, TR, ALT, SITE_URL, ORIGIN, layout }) {
  const crumbs = breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('footTrustCentre') }]);

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell-narrow">
  ${crumbs}
  <span class="eyebrow eyebrow-accent">${esc(TR('trustEyebrow'))}</span>
  <h1 style="max-width:22ch">${esc(TR('trustH1'))}</h1>
  <p class="lede">${esc(TR('trustUpdated'))}</p>

  <div class="callout callout--sage" style="margin-top:1.6rem">
    <p><strong>${esc(TR('trustShortT'))}</strong> ${esc(TR('trustShortB'))}</p>
  </div>

  ${TR('trustSecs')
    .map(([h, b]) => `<h2 style="margin-top:2.2rem">${esc(h)}</h2>\n  <p>${b}</p>`)
    .join('\n')}

  <p style="margin-top:2.5rem" class="tiny">${esc(TR('trustSeeAlso'))}
    <a class="link-underline" href="${LB()}/privacy/">${esc(TR('footPrivacy'))}</a> ·
    <a class="link-underline" href="${BASE}/scams/">${esc(TR('footScams'))}</a> ·
    <a class="link-underline" href="${BASE}/accessibility/">${esc(TR('footAccessibility'))}</a> ·
    <a class="link-underline" href="${BASE}/mcp">/mcp</a></p>
</section>`;

  return layout({
    base: BASE, linkBase: LB(), lang: L, tr: TR, altLangs: ALT,
    title: TR('footTrustCentre'),
    description: TR('trustShortB'),
    canonical: `${SITE_URL}${L === 'en' ? '' : '/' + L}/trust/`,
    jsonld: [breadcrumbLd(ORIGIN, [{ label: TR('backHome'), href: `${LB()}/` }, { label: TR('footTrustCentre') }])],
    body,
  });
}
