/**
 * UNCLAIMED — HTML layout + shared components.
 * Plain template literals. No dependencies.
 */
import { CATEGORY_LABEL, BENEFIT_TYPE_LABEL, formatMoney, periodSuffix } from './engine/matcher.js';

export const SITE_NAME = 'Unclaimed';
export const TAGLINE = 'Find the government money you are entitled to and are not claiming.';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attr(s) {
  return esc(s);
}

/* ------------------------------------------------------------------ */
/* Icons (inline SVG — never emoji as UI icons)                        */
/* ------------------------------------------------------------------ */

export const ICON = {
  seal: `<svg class="wordmark__seal" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="0.8" stroke-dasharray="2 2"/><path d="M8.4 12.2l2.5 2.5 4.7-5.2" stroke="#a8431d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.4l3.2 3.2L13 4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function layout({
  base,
  title,
  description,
  canonical,
  body,
  jsonld = [],
  bodyClass = '',
  scripts = '',
  head = '',
  nav = '',
}) {
  const fullTitle = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
  const ldBlocks = jsonld
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description)}">
${canonical ? `<meta property="og:url" content="${attr(canonical)}">` : ''}
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#faf6ef">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${base}/theme.css">
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="${base}/api/v1/countries.json" title="Unclaimed programme API">
${head}
${ldBlocks}
</head>
<body class="${bodyClass}">
<a href="#main" class="btn btn-sm" style="position:absolute;left:-9999px;top:0;z-index:100" onfocus="this.style.left='8px';this.style.top='8px'" onblur="this.style.left='-9999px'">Skip to content</a>
<header class="masthead">
  <div class="shell masthead__inner">
    <a class="wordmark" href="${base}/">${ICON.seal}${SITE_NAME}</a>
    <nav class="nav" aria-label="Main">
      <span class="nav nav--links">
        <a href="${base}/countries/">Countries</a>
        <a href="${base}/methodology/">How we know</a>
        <a href="${base}/api/">API &amp; MCP</a>
      </span>
      ${nav || `<a class="btn btn-sm btn-primary" href="${base}/check/">Check what you're owed</a>`}
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <div class="shell">
    <div class="grid grid-4">
      <div>
        <a class="wordmark" href="${base}/">${ICON.seal}${SITE_NAME}</a>
        <p class="small" style="margin-top:.8rem;max-width:32ch">${esc(TAGLINE)} Free, anonymous, no sign-up.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="${base}/check/">Eligibility check</a></li>
          <li><a href="${base}/countries/">All 25 countries</a></li>
          <li><a href="${base}/methodology/">Methodology &amp; sources</a></li>
        </ul>
      </div>
      <div>
        <h4>Developers</h4>
        <ul>
          <li><a href="${base}/api/">REST &amp; MCP</a></li>
          <li><a href="${base}/api/v1/countries.json">countries.json</a></li>
          <li><a href="${base}/llms.txt">llms.txt</a></li>
        </ul>
      </div>
      <div>
        <h4>Trust</h4>
        <ul>
          <li><a href="${base}/methodology/#limits">Known limitations</a></li>
          <li><a href="${base}/methodology/#verification">Verification status</a></li>
          <li><a href="https://github.com/adityashashidhar55-cpu/unclaimed">Source on GitHub</a></li>
        </ul>
      </div>
    </div>
    <p class="tiny" style="margin-top:2.5rem;max-width:none;border-top:1px solid var(--line);padding-top:1.2rem">
      ${SITE_NAME} is a discovery tool, not legal, tax or financial advice. Eligibility rules change; only the
      official body named on each programme page can confirm what you are entitled to. Always read the source
      page before applying.
    </p>
  </div>
</footer>
${scripts}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export function verificationBadge(status) {
  if (status === 'verified') {
    return `<span class="badge badge-verified" title="A researcher confirmed this record against the official page">${ICON.check} Verified</span>`;
  }
  return `<span class="badge badge-auto" title="Extracted from the official source but not yet re-checked by a human">Not human-checked</span>`;
}

export function applyBadge(p) {
  return p.is_automatic
    ? `<span class="badge badge-auto-apply">Automatic — no application</span>`
    : `<span class="badge badge-action">You must apply</span>`;
}

export function amountLabel(p, currency) {
  const cur = p.amount_currency || currency;
  const suffix = periodSuffix(p.amount_period);
  if (p.amount_min == null && p.amount_max == null) return null;
  if (p.amount_min != null && p.amount_max != null && p.amount_min !== p.amount_max) {
    return `${formatMoney(p.amount_min, cur)}–${formatMoney(p.amount_max, cur)}${suffix}`;
  }
  const v = p.amount_max ?? p.amount_min;
  return `${formatMoney(v, cur)}${suffix}`;
}

export function progHref(base, cc, p) {
  return `${base}/${cc}/${p.category}/${p.slug}/`;
}

export function categoryLabel(c) {
  return CATEGORY_LABEL[c] || c;
}

export function benefitTypeLabel(b) {
  return BENEFIT_TYPE_LABEL[b] || b;
}

export function listRow(base, cc, p, currency) {
  const amt = amountLabel(p, currency);
  return `<a class="list-row" href="${progHref(base, cc, p)}">
  <span>
    <span class="list-row__name">${esc(p.name_en)}</span>
    <span class="list-row__meta">${esc(p.name_local !== p.name_en ? p.name_local + ' · ' : '')}${esc(p.funder)}</span>
  </span>
  <span class="list-row__right">
    ${amt ? `<span class="list-row__amount">${esc(amt)}</span>` : `<span class="tiny">Amount varies</span>`}
    <span class="row" style="gap:.3rem">${verificationBadge(p.verification_status)}</span>
  </span>
</a>`;
}

export function disclaimerBar() {
  return `<div class="disclaimer-bar"><div class="shell"><strong>Discovery tool, not advice.</strong> Every figure is the published rule, not a decision on your case.</div></div>`;
}
