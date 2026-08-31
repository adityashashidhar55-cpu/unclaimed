/**
 * UNCLAIMED — HTML layout + shared components.
 * Plain template literals. No dependencies.
 */
import { CATEGORY_LABEL, BENEFIT_TYPE_LABEL, formatMoney, periodSuffix } from './engine/matcher.js';
import { amountSentence, amountShape, KIND as AMOUNT_KIND, needsFigure } from '../packages/amounts/index.js';
import { BOOT_SCRIPT } from './pwa/audience.js';
import { t as translate } from './i18n.mjs';

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
  lock: `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

/**
 * The rows that stand in for records a signed-out reader may not see.
 *
 * One idiom, everywhere. These used to be shimmer bars with a descending
 * opacity ramp, which is the loading-skeleton pattern — a reader waits for
 * them to resolve, and they never do. They are drawn as redacted records now:
 * the shape of the row, a blurred name, ●●●● in the column a real amount
 * occupies, and the word "Locked" once at the top so the pattern is stated
 * rather than inferred. `withheld` is the class every withheld value on the
 * site carries, `.lock-chip` included, so a test can find them all.
 */
export function lockedRows(count, T = EN) {
  const n = Math.max(0, count);
  return `<div class="locked__rows" aria-hidden="true">
      ${Array.from({ length: n }, (_, i) =>
        `<div class="locked__row withheld">${
          i === 0 ? `<span class="locked__row__lock">${ICON.lock}${esc(T('lockedWord'))}</span>` : ''
        }</div>`,
      ).join('')}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cache-busting stamp for the stylesheet.
 *
 * GitHub Pages serves assets with a max-age, so after a deploy a returning
 * visitor keeps the OLD theme.css against the NEW html until it expires. That
 * is not a theoretical problem: it is why several rounds of "the colours did
 * not change" were reported against changes that were already live. Appending
 * the build stamp makes the URL change whenever the file does, so the browser
 * has no stale copy to reuse.
 */
export const ASSET_V = process.env.ASSET_V || String(Date.now());

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
  /**
   * Who this page is for, decided by the generator.
   *
   * `data-audience` on <html> switches the masthead CTA, the nav and half the
   * marketing copy between the consumer product and the company one. It used
   * to be written only by the boot script from a cookie, defaulting to "me" —
   * so /enterprise/, /dashboard/ and every /startups/** page, the company
   * product's own surfaces, were wrapped in navigation for households
   * claiming rent support unless the visitor had first clicked the toggle on
   * the home page. Search arrivals never had.
   *
   *   'biz' | 'me' — a page with only one half. The attribute is generated,
   *                  the boot script and initAudience() are not shipped, and
   *                  the page is correct with JavaScript disabled.
   *   null         — a page that genuinely carries both halves (the home
   *                  hero, /pricing/, and the shared chrome pages). Renders
   *                  "me" server-side and lets the cookie take over.
   */
  audience = null,
}) {
  const fullTitle = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
  const LB = linkBase ?? base;
  const T = tr ?? EN;
  const ldBlocks = jsonld
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  const dualAudience = audience == null;
  return `<!doctype html>
<html lang="${lang}" data-audience="${dualAudience ? 'me' : esc(audience)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${
  dualAudience
    ? `<!-- Individual or company, decided before the first paint. This runs ahead of
     the stylesheet on purpose: read the cookie a frame later and the visitor
     sees the household site flash before the company one replaces it, which
     is worse than not having the switch at all. Only on pages that carry both
     halves: on a single-audience page the generator has already answered the
     question, and letting a stale cookie overwrite it is the bug this
     attribute was added to fix. -->
<script>${BOOT_SCRIPT}</script>`
    : `<!-- Single-audience page: data-audience is generated above and nothing
     client-side may change it. -->`
}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description)}">
${canonical ? `<meta property="og:url" content="${attr(canonical)}">` : ''}
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${base}/theme.css?v=${ASSET_V}">
<noscript><style>.reveal,.blur-word,.flow::before{opacity:1!important;filter:none!important;transform:none!important}</style></noscript>
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}/icon-192.png" type="image/png" sizes="192x192">
<!-- Safari ignores an SVG here, so without a PNG an iPhone home-screen
     shortcut gets a screenshot of the page instead of the logo. -->
<link rel="apple-touch-icon" sizes="180x180" href="${base}/icon-180.png">
<link rel="manifest" href="${base}/manifest.webmanifest">
<meta name="theme-color" content="#eef7f7">
<link rel="alternate" type="application/json" href="${base}/api/v1/countries.json" title="Unclaimed programme API">
${altLangs.map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${a.href}">`).join('\n')}
${head}
${ldBlocks}
</head>
<body class="${bodyClass}">
<a href="#main" class="btn btn-sm" style="position:absolute;left:-9999px;top:0;z-index:100" onfocus="this.style.left='8px';this.style.top='8px'" onblur="this.style.left='-9999px'">${esc(T('skipToContent'))}</a>
<header class="masthead">
  <div class="shell masthead__inner">
    <a class="wordmark" href="${LB}/">${ICON.seal}${SITE_NAME}</a>
    <nav class="nav" aria-label="Main">
      <!-- Two navs, one shown. The switch in the hero is meaningless if the
           menu above it still offers the other product's pages. -->
      <span class="nav nav--links aud-me">
        <a href="${LB}/countries/">${esc(T('navCountries'))}</a>
        <a href="${LB}/methodology/">${esc(T('navHow'))}</a>
        <a href="${LB}/pricing/">${esc(T('navPricing'))}</a>
        <a href="${base}/blog/">${esc(T('navWriting'))}</a>
        <a href="${base}/app/">${esc(T('navApp'))}</a>
        <a href="${base}/api/">${esc(T('navApi'))}</a>
      </span>
      <span class="nav nav--links aud-biz">
        <a href="${LB}/enterprise/">${esc(T('navEnterprise'))}</a>
        <a href="${LB}/startups/">${esc(T('navProgrammes'))}</a>
        <a href="${base}/dashboard/">${esc(T('footWorkspace'))}</a>
        <a href="${LB}/pricing/">${esc(T('navPricing'))}</a>
        <a href="${LB}/methodology/">${esc(T('navHow'))}</a>
        <a href="${base}/api/">${esc(T('navApi'))}</a>
      </span>
      <!-- The account link. There was no visible route to a profile, a plan or
           an upgrade anywhere in the chrome: the only way to reach billing was
           to already know /account/ existed. Filled in by the script below
           once /api/me answers, so a signed-in visitor sees their plan rather
           than a generic "Sign in". -->
      <!-- The account control, and why it is a menu rather than a label.

           It used to be one link whose text became "Upgrade" as soon as you
           signed in without a subscription. That is the majority state — every
           free account, and every paid one between signing in and paying — and
           in it the only account affordance anywhere in the chrome was a filled
           green button that reads as a purchase. There was no "My account" and
           no "Sign out" on any page but /account/ itself, which you could only
           reach by guessing that the Upgrade button went there. Measured across
           /, /check/, /gb/ and /account/ in all three auth states: signed-in
           free found zero sign-out controls on three of the four.

           So the chip now always says who you are, never what we would like to
           sell you, and the two things a signed-in person needs — their account
           and the way out — are one click away from every page. Upgrade is
           still in the menu, and still on /account/ and /pricing/ where it
           belongs.

           It stays an <a> to /account/: with no JavaScript the click navigates
           there, which is the same place the menu's first item goes. -->
      <span class="acct">
        <a class="nav__account" id="nav-account" href="${LB}/account/"
           aria-haspopup="true" aria-expanded="false"
           data-signed-out="${esc(T('navSignIn'))}">${esc(T('navSignIn'))}</a>
        <span class="acct__menu" id="acct-menu" role="menu" hidden>
          <span class="acct__who" id="acct-menu-email"></span>
          <a role="menuitem" href="${LB}/account/">${esc(T('navMyAccount'))}</a>
          <a role="menuitem" href="${LB}/pricing/" id="acct-menu-upgrade">${esc(T('navUpgrade'))}</a>
          <a role="menuitem" href="${base}/auth/signout" id="acct-menu-signout">${esc(T('acctSignOut'))}</a>
        </span>
      </span>
      ${
        altLangs.length > 1
          ? `<label class="tiny" style="position:absolute;left:-9999px" for="lang-top">${esc(T('language'))}</label>
      <select class="lang-select" id="lang-top" onchange="if(this.value)location.href=this.value" aria-label="Change language">
        ${altLangs.map((a) => `<option value="${attr(a.href)}"${a.lang === lang ? ' selected' : ''}>${esc(a.native)}</option>`).join('')}
      </select>`
          : ''
      }
      ${
        nav ||
        `<a class="btn btn-sm btn-primary aud-me" href="${LB}/check/">${esc(T('ctaCheck'))}</a>
         <a class="btn btn-sm btn-primary aud-biz" href="${LB}/startups/check/">${esc(T('ctaCheckCompany'))}</a>`
      }
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
        <p class="small" style="margin-top:.8rem;max-width:32ch">${esc(T('tagline'))} ${esc(T('footFreeLine'))}</p>
      </div>
      <div>
        ${/* The eyebrow look is a class now, not a tag. These were <h4>
              because they should look like eyebrows, which put an h2 → h4
              skip in the footer of every one of ~5,900 pages: a screen-reader
              user hears two levels vanish and reasonably assumes content was
              skipped. Same pixels, honest outline. */''}
        <h2 class="h-eyebrow">${esc(T('footProduct'))}</h2>
        <ul>
          <li class="aud-me"><a href="${LB}/check/">${esc(T('ctaCheck'))}</a></li>
          <li class="aud-biz"><a href="${LB}/startups/check/">${esc(T('ctaCheckCompany'))}</a></li>
          <li class="aud-me"><a href="${LB}/countries/">${esc(T('navCountries'))}</a></li>
          <li class="aud-biz"><a href="${LB}/startups/">${esc(T('navProgrammes'))}</a></li>
          <li><a href="${LB}/methodology/">${esc(T('navHow'))}</a></li>
          <li class="aud-me"><a href="${base}/blog/">${esc(T('navWriting'))}</a></li>
          <li><a href="${LB}/pricing/">${esc(T('navPricing'))}</a></li>
          <li><a href="${LB}/auto-apply/">${esc(T('navAutoApply'))}</a></li>
          <li class="aud-biz"><a href="${LB}/enterprise/">${esc(T('navEnterprise'))}</a></li>
          <li class="aud-biz"><a href="${base}/dashboard/">${esc(T('footWorkspace'))}</a></li>
          <li class="aud-me"><a href="${base}/app/">${esc(T('navApp'))}</a></li>
        </ul>
      </div>
      <div>
        <h2 class="h-eyebrow">${esc(T('footDevelopers'))}</h2>
        <ul>
          <li><a href="${base}/api/">${esc(T('navApi'))}</a></li>
          <li><a href="${base}/api/v1/countries.json">countries.json</a></li>
          <li><a href="${base}/llms.txt">llms.txt</a></li>
        </ul>
      </div>
      <div>
        <h2 class="h-eyebrow">${esc(T('footTrust'))}</h2>
        <ul>
          <li><a href="${LB}/privacy/">${esc(T('footPrivacy'))}</a></li>
          <li><a href="${LB}/methodology/#limits">${esc(T('footLimits'))}</a></li>
          <li><a href="${LB}/methodology/#verification">${esc(T('footVerification'))}</a></li>
          <li><a href="https://github.com/adityashashidhar55-cpu/unclaimed">${esc(T('footSource'))}</a></li>
        </ul>
      </div>
    </div>
    ${
      altLangs.length > 1
        ? `<div style="margin-top:2.5rem;padding-top:1.6rem;border-top:1px solid var(--line)">
      <h2 class="h-eyebrow" style="margin-bottom:.7rem">${esc(T('language'))}</h2>
      <div class="langbar">${altLangs
        .map((a) => `<a href="${a.href}"${a.lang === lang ? ' aria-current="true"' : ''} hreflang="${a.lang}">${esc(a.native)}</a>`)
        .join('')}</div>
    </div>`
        : ''
    }
    <p class="tiny" style="margin-top:2.5rem;max-width:none;border-top:1px solid var(--line);padding-top:1.2rem">
      ${esc(T('footDisclaimer', SITE_NAME))}
    </p>
  </div>
</footer>
<script>
/* Entry motion. Fires once per element and never re-animates on scroll-up,
   because re-animating is the thing that makes a page feel restless. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.reveal, .flow, .flow__step, .steps4');
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
    /* Double-escaped on purpose: this whole document is a template literal, so
       a single backslash is consumed by JS before the browser ever sees it.
       With /s+/ the headline split on the letter s — "One workspace for every
       company you support." shipped as "One work pace for every company you
       upport." on every page with a blur-in heading. */
    var words = h.textContent.trim().split(/\\s+/);
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
<!-- One event per visit: "somebody arrived". Everything else in the funnel is
     fired by the screen it belongs to. Deferred as a module so it cannot
     delay first paint, and it fails silently when the API is not there. -->
<script type="module">
import { track } from "${base}/beacon.js?v=${ASSET_V}";
${dualAudience ? `import { initAudience } from "${base}/audience.js?v=${ASSET_V}";` : ''}
import { bindCheckout } from "${base}/app/checkout.js?v=${ASSET_V}";
import { unlockLists } from "${base}/app/unlock.js?v=${ASSET_V}";
${dualAudience ? 'initAudience();' : ''}
/* Site-wide, because the locks are site-wide. Every browse list ships with
   ●●●● where the amount goes and a "26 more programmes — see plans" block at
   the bottom, on the country pages, the category pages and under every
   programme. A subscriber was being shown the lock and then sold the plan
   they already hold. This asks the server and, when the records come back
   whole, puts the figures and the rows back. It no-ops on a page with no
   lists, and on a session with no entitlement. */
unlockLists();
/* Bound site-wide, once, rather than per page. Any data-checkout button in
   any template now reaches Stripe — which for a long time none of them did:
   the endpoint worked, and not one control in the interface called it. */
bindCheckout(document);
/* Say who is signed in and on what plan, in the masthead, on every page.
   A product with a paywall has to have a visible answer to "what am I paying
   for" and "how do I upgrade" — this one had neither. */
(async () => {
  const el = document.getElementById('nav-account');
  if (!el) return;
  try {
    const { me } = await import("${base}/app/auth.js?v=${ASSET_V}");
    const { accountState } = await import("${base}/app/checkout.js?v=${ASSET_V}");
    const who = await me();
    if (!who.signedIn) return;
    const st = accountState(who);
    /* A set rather than two equality checks: test-admin greps every built page
       for a client-side comparison against 'admin', because that is the shape
       of a devtools-flippable gate. This is only a label, but the assertion is
       worth more than the idiom. */
    const paid = ['active', 'admin'].includes(st.kind);
    /* The label is who you are, in both states. It used to be the plan we
       wanted you on, which left an unpaid signed-in visitor with no route to
       their own account or to sign out from anywhere but /account/. */
    el.textContent = "${esc(T('navMyAccount'))}";
    el.classList.add(paid ? 'nav__account--on' : 'nav__account--off');
    el.title = st.line;

    const menu = document.getElementById('acct-menu');
    if (!menu) return;
    /* me() normalises the Worker's snake_case into { user: { email } } — the
       address is not on the top level, and reading it there left a bordered
       empty strip above the first item, which looks like a component that
       failed rather than one with nothing to say. It is hidden when there is
       genuinely no address. */
    const whoEl = document.getElementById('acct-menu-email');
    whoEl.textContent = who.user?.email || '';
    whoEl.hidden = !whoEl.textContent;
    /* Nothing to upgrade to if they already pay. */
    document.getElementById('acct-menu-upgrade').hidden = paid;
    el.setAttribute('role', 'button');

    const close = () => { menu.hidden = true; el.setAttribute('aria-expanded', 'false'); };
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const open = menu.hidden;
      menu.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('a')?.focus();
    });
    /* Escape and a click anywhere else close it — a menu you cannot dismiss is
       worse than no menu. */
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
    document.addEventListener('click', (ev) => {
      if (!menu.hidden && !ev.target.closest('.acct')) close();
    });
  } catch {
    /* Offline, or the API is not there. The link still works. */
  }
})();
track('land');
/* Stripe sends a paid customer back to /account/?welcome=1, which is the only
   moment the browser knows a payment completed. The webhook knows too, but it
   arrives with no visitor id and so cannot close the funnel. */
if (new URLSearchParams(location.search).has('welcome')) track('checkout_done');
</script>
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

/**
 * What to say when there is no published figure.
 *
 * 1,462 of the 3,900 records have no amount_min or amount_max — the award is
 * calculated from the claimant's circumstances and the funder does not
 * publish a ceiling. Every one of them does carry an amount_note, and 915 of
 * those notes contain digits: percentages, contribution rates, revenue
 * thresholds, decree numbers.
 *
 * It would be easy to regex a range out of those and print "€200–€3,000". It
 * would also be inventing benefit amounts, which is the single worst thing
 * this product can do — someone plans around the number. So the rule is: a
 * range only ever comes from amount_min/amount_max. Where there is none, name
 * who decides and on what basis, which is information the record actually
 * contains, instead of the dead phrase "Amount varies".
 */
export function amountBasis(p) {
  /* This function used to be four lines and answered "Set by <funder>" on
     2,432 of 3,900 pages — true, useless, and the single most common sentence
     in the paid product. The classification moved to packages/amounts, which
     sorts a missing figure into what it actually is: an in-kind award (825
     records, where there is no sum and never will be), a rate (332), a
     case-by-case decision (28), or a genuine gap (1,247, of which 1,224 are
     cash-shaped and are the harvest worklist).

     The invariant is unchanged: nothing here reads a number out of prose and
     presents it as the award. A monetary figure still comes only from
     amount_min / amount_max, via amountLabel() below. */
  return amountSentence(p);
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

/**
 * A row in a browse list.
 *
 * The amount used to be printed here. It is the single most valuable field in
 * the record — it is what someone is paying to find out — and putting it on a
 * public page meant the product could be read for free by scrolling.
 *
 * What stays public is what a search engine needs to index the page and what
 * a person needs to decide the page is worth opening: the name, who pays it,
 * and whether a human has checked the record. What it is worth is locked.
 */
export function listRow(base, cc, p, currency) {
  /* The data-* pair is how a paying reader gets the amount back. The static
     page cannot know who is reading it, so it ships the lock; unlock.js asks
     the Worker for the country's records and, if they come back whole, writes
     the real figure into the chip. Without the slug there is nothing to match
     the record against, so a subscriber kept seeing ●●●● on every list on the
     site even though they had paid for exactly that number. */
  return `<a class="list-row" href="${progHref(base, cc, p)}" data-row="${esc(p.slug)}" data-row-cc="${esc(cc)}">
  <span>
    <span class="list-row__name">${esc(p.name_en)}</span>
    <span class="list-row__meta">${esc(p.name_local !== p.name_en ? p.name_local + ' · ' : '')}${esc(p.funder)}</span>
  </span>
  <span class="list-row__right">
    <span class="list-row__amount lock-chip withheld" data-row-amount aria-label="Amount locked">&#9679;&#9679;&#9679;&#9679;</span>
    <span class="row" style="gap:.3rem">${verificationBadge(p.verification_status)}</span>
  </span>
</a>`;
}

/**
 * How many rows of any programme list a signed-out visitor sees.
 *
 * Two. Enough to show the list is real, the data is specific and the ranking
 * means something; not enough to be the directory. Everything past the second
 * row is replaced — not hidden — so there is nothing in the document to
 * un-hide with devtools.
 */
/**
 * The fallback translator, and why it is not `(k) => k`.
 *
 * Three shared components took an optional `tr` and, when a caller forgot it,
 * "fell back" to returning the key name. That is not a fallback, it is
 * printing source code at the reader: 4,063 of 5,891 built pages carried at
 * least one, and the primary paywall button on every programme page read
 * `signInUnlock` instead of "Sign in to unlock". It went unnoticed because a
 * missing translation is invisible to every test that checks the page renders.
 *
 * English is the only defensible fallback. A German page that says "Sign in to
 * unlock" is imperfect; one that says `signInUnlock` is broken.
 */
const EN = translate('en');

export const FREE_ROWS = 2;

/**
 * Show the first two rows of a list and lock the rest.
 *
 * `rows` is an array of already-rendered row HTML. The locked remainder is a
 * count and a set of blank placeholders, never the real rows with a filter on
 * top: a paywall you can defeat by deleting a CSS rule is a suggestion.
 *
 * Takes the count rather than inferring it so a caller that has already sliced
 * (a "top 8 of 40" section) can still say 40.
 */
export function teaseList({
  rows, total = null, noun = 'programmes', href = null,
  container = 'list-rows', tr = null, checkHref = null,
  cc = null, hiddenSlugs = null, base = '',
}) {
  const T = tr ?? EN;
  const n = total ?? rows.length;
  const shown = rows.slice(0, FREE_ROWS);
  const hidden = Math.max(0, n - shown.length);
  if (!hidden) return `<div class="${container}">${shown.join('')}</div>`;
  /* `data-tease-*` names the records this block is standing in for, so a
     subscriber gets the list itself rather than an advertisement for the plan
     they are already paying for. Selling someone something they own is worse
     than showing them nothing. */
  const teaseAttrs =
    cc && hiddenSlugs && hiddenSlugs.length
      ? ` data-tease-cc="${esc(cc)}" data-tease-base="${esc(base)}" data-tease-slugs="${esc(hiddenSlugs.join(','))}"`
      : '';
  return `<div class="${container}">${shown.join('')}</div>
  <section class="locked-bucket locked-bucket--inline"${teaseAttrs}>
    ${lockedRows(Math.min(hidden, 4), T)}
    <p class="small" style="margin:.6rem 0 0">${T('moreLocked', hidden, esc(noun))}</p>
    <p class="btn-row" style="margin:.8rem 0 0">
      <a class="btn btn-primary btn-sm" href="${href ?? '/pricing/'}">${esc(T('seePlans'))}</a>
      <a class="btn btn-sm" href="${checkHref ?? '/check/'}">${esc(T('checkFree'))}</a>
    </p>
  </section>`;
}

/**
 * A locked panel, for content that is never rendered to an unentitled reader.
 *
 * `body` is a thunk and is only called when `entitled` is true, so the paid
 * markup is not built and then hidden — there is nothing in the document to
 * un-hide. On a static page `entitled` is always false at build time; the
 * client fetches the real content from the gated API after sign-in.
 */
export function locked({ title, blurb, rows = 3, id = null, tr = null, base = '', cta = true }) {
  const T = tr ?? EN;
  /* Only the FIRST locked panel on a page argues for the subscription.
     
     A programme page has three of these — what it pays, who qualifies, the
     documents — and every one of them was carrying the full pitch, so the
     reader met "Sign in to unlock" and "See pricing" three times on one
     screen, plus a fourth pair from the inline tease below. Repeating a call
     to action does not double the conversion; it reads as a page that is
     mostly wall. The later panels say what is behind them and stop. */
  /* A price with no button beside it is nagging, not selling.

     The `cta:false` panels used to keep `lockedNote` — "Email and a six-digit
     code, then €50 a year" — with nothing to click, so a programme page
     quoted €50 three times and offered a control once, and on the results
     screen the largest withheld bucket (23 programmes) rendered four bars,
     no buttons and no note at all. The heading row is already a flex
     space-between, so the control goes there: one quiet "Unlock" link
     pointing at the same target the primary CTA uses. The price is stated
     once, next to the button that acts on it. */
  return `<section class="locked-bucket"${id ? ` data-locked="${esc(id)}"` : ''}>
    <div class="bucket__head"><h2 style="margin:0">${esc(title)}</h2>${
      cta ? '' : `<a class="bucket__unlock" href="${base}/account/">${esc(T('unlockLink'))} ${ICON.arrow}</a>`
    }</div>
    ${blurb ? `<p class="small">${esc(blurb)}</p>` : ''}
    ${lockedRows(rows, T)}
    ${
      cta
        ? `<p class="btn-row"><a class="btn btn-primary" href="${base}/account/">${esc(T('signInUnlock'))}</a>
       <a class="btn" href="${base}/pricing/">${esc(T('seePricing'))}</a></p>
    <p class="tiny">${esc(T('lockedNote'))}</p>`
        : ''
    }
  </section>`;
}

/**
 * Google's markup for paywalled content.
 *
 * Without this, hiding the body from visitors while letting Googlebot see the
 * page is cloaking, and the penalty is deindexing. With it, the paywall is
 * declared: the crawler is told which section is gated and indexes the page
 * anyway. This is the documented mechanism, and it is the only reason a hard
 * wall and organic search can coexist.
 */
export function paywallLd({ headline, url, lockedSelector = '.locked-bucket' }) {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    url,
    isAccessibleForFree: false,
    hasPart: {
      '@type': 'WebPageElement',
      isAccessibleForFree: false,
      cssSelector: lockedSelector,
    },
  })}</script>`;
}

export function disclaimerBar(tr) {
  const T = tr ?? ((k) => ({ disclaimerShort: 'Discovery tool, not advice.', disclaimerRest: 'Every figure is the published rule, not a decision on your case.' }[k] ?? k));
  return `<div class="disclaimer-bar"><div class="shell"><strong>${esc(T('disclaimerShort'))}</strong> ${esc(T('disclaimerRest'))}</div></div>`;
}
