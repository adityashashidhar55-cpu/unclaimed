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
  linkBase,
  lang = 'en',
  altLangs = [],
  tr,
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
  const LB = linkBase ?? base;
  const T = tr ?? ((k) => k);
  const ldBlocks = jsonld
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  return `<!doctype html>
<html lang="${lang}">
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
<meta name="theme-color" content="#000000">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${base}/theme.css">
<noscript><style>.reveal,.blur-word,.flow::before{opacity:1!important;filter:none!important;transform:none!important}</style></noscript>
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="${base}/api/v1/countries.json" title="Unclaimed programme API">
${altLangs.map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${a.href}">`).join('\n')}
${head}
${ldBlocks}
</head>
<body class="${bodyClass}">
<a href="#main" class="btn btn-sm" style="position:absolute;left:-9999px;top:0;z-index:100" onfocus="this.style.left='8px';this.style.top='8px'" onblur="this.style.left='-9999px'">Skip to content</a>
<header class="masthead">
  <div class="shell masthead__inner">
    <a class="wordmark" href="${LB}/">${ICON.seal}${SITE_NAME}</a>
    <nav class="nav" aria-label="Main">
      <span class="nav nav--links">
        <a href="${LB}/countries/">${esc(T('navCountries'))}</a>
        <a href="${LB}/methodology/">${esc(T('navHow'))}</a>
        <a href="${LB}/pricing/">Pricing</a>
        <a href="${base}/app/">App</a>
        <a href="${base}/api/">${esc(T('navApi'))}</a>
      </span>
      ${
        altLangs.length > 1
          ? `<label class="tiny" style="position:absolute;left:-9999px" for="lang-top">Language</label>
      <select class="lang-select" id="lang-top" onchange="if(this.value)location.href=this.value" aria-label="Change language">
        ${altLangs.map((a) => `<option value="${attr(a.href)}"${a.lang === lang ? ' selected' : ''}>${esc(a.native)}</option>`).join('')}
      </select>`
          : ''
      }
      ${nav || `<a class="btn btn-sm btn-primary" href="${LB}/check/">${esc(T('ctaCheck'))}</a>`}
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
        <a class="wordmark" href="${LB}/">${ICON.seal}${SITE_NAME}</a>
        <p class="small" style="margin-top:.8rem;max-width:32ch">${esc(TAGLINE)} Free, anonymous, no sign-up.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="${LB}/check/">${esc(T('ctaCheck'))}</a></li>
          <li><a href="${LB}/countries/">${esc(T('navCountries'))}</a></li>
          <li><a href="${LB}/methodology/">${esc(T('methodology'))}</a></li>
          <li><a href="${LB}/pricing/">Pricing</a></li>
          <li><a href="${LB}/enterprise/">Enterprise</a></li>
          <li><a href="${base}/app/">Mobile app</a></li>
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
          <li><a href="${LB}/privacy/">Privacy</a></li>
          <li><a href="${LB}/methodology/#limits">Known limitations</a></li>
          <li><a href="${LB}/methodology/#verification">Verification status</a></li>
          <li><a href="https://github.com/adityashashidhar55-cpu/unclaimed">Source on GitHub</a></li>
        </ul>
      </div>
    </div>
    ${
      altLangs.length > 1
        ? `<div style="margin-top:2.5rem;padding-top:1.6rem;border-top:1px solid var(--line)">
      <h4 style="margin-bottom:.7rem">Language</h4>
      <div class="langbar">${altLangs
        .map((a) => `<a href="${a.href}"${a.lang === lang ? ' aria-current="true"' : ''} hreflang="${a.lang}">${esc(a.native)}</a>`)
        .join('')}</div>
    </div>`
        : ''
    }
    <p class="tiny" style="margin-top:2.5rem;max-width:none;border-top:1px solid var(--line);padding-top:1.2rem">
      ${SITE_NAME} is a discovery tool, not legal, tax or financial advice. Eligibility rules change; only the
      official body named on each programme page can confirm what you are entitled to. Always read the source
      page before applying.
    </p>
  </div>
</footer>
<script>
/* Entry motion. Fires once per element and never re-animates on scroll-up,
   because re-animating is the thing that makes a page feel restless. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.reveal, .flow, .flow__step');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var d = parseInt(el.getAttribute('data-delay') || '0', 10);
        setTimeout(function () { el.classList.add('in'); }, d);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* Headline blur-in, word by word. Hero only — everywhere it becomes a tic. */
  /* Safety net. Entry animation is a nicety; a blank page is not an option.
     If anything above failed, this still shows the content. */
  setTimeout(function () {
    document.querySelectorAll('.reveal, .flow, .flow__step, .blur-word').forEach(function (el) {
      el.classList.add('in');
    });
  }, 3000);

  document.querySelectorAll('[data-blur-words]').forEach(function (h) {
    if (reduce) return;
    var words = h.textContent.trim().split(/\s+/);
    h.textContent = '';
    words.forEach(function (w, i) {
      var span = document.createElement('span');
      span.className = 'blur-word';
      span.textContent = w;
      h.appendChild(span);
      if (i < words.length - 1) h.appendChild(document.createTextNode(' '));
      setTimeout(function () { span.classList.add('in'); }, 90 * i + 120);
    });
  });

  /* Count-up on the hero figure. Short, eased, and it stops at the real number. */
  document.querySelectorAll('[data-tally]').forEach(function (el) {
    var target = parseFloat(el.getAttribute('data-tally'));
    if (reduce || !target) { return; }
    var started = false;
    var run = function () {
      if (started) return; started = true;
      var t0 = performance.now(), dur = 1400;
      var step = function (t) {
        var k = Math.min(1, (t - t0) / dur);
        var eased = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(target * eased).toLocaleString();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, o) {
        es.forEach(function (e) { if (e.isIntersecting) { run(); o.disconnect(); } });
      }, { threshold: 0.4 }).observe(el);
    } else { run(); }
  });
})();
</script>
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

export function disclaimerBar(tr) {
  const T = tr ?? ((k) => ({ disclaimerShort: 'Discovery tool, not advice.', disclaimerRest: 'Every figure is the published rule, not a decision on your case.' }[k] ?? k));
  return `<div class="disclaimer-bar"><div class="shell"><strong>${esc(T('disclaimerShort'))}</strong> ${esc(T('disclaimerRest'))}</div></div>`;
}
