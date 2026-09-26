/**
 * /accessibility/ — a statement describing what is actually implemented.
 *
 * Every claim below was checked against the code before being written:
 *   - Skip link: src/ui.mjs's layout(), the first element in <body>.
 *   - Focus indicator: :focus-visible in src/theme.css, one colour reused
 *     everywhere rather than left to the browser default.
 *   - Reduced motion: @media (prefers-reduced-motion: reduce) in
 *     src/theme.css switches off entry animation and slows the spinner.
 *   - Labelled form fields and live regions: src/app.js (<label for=...>,
 *     aria-live="polite", aria-describedby, role="status").
 *   - Language: <html lang="..."> is set per locale in layout(), and the
 *     language switcher carries aria-label="Change language".
 *   - Locked/withheld rows carry aria-label rather than relying on colour
 *     alone (src/ui.mjs lockedRows()).
 *
 * Nothing here claims a WCAG conformance level, because no audit against one
 * has been run — this states what is built, not a certification nobody has
 * done. English-only, like /compare/ and /browse/.
 */
import { esc, disclaimerBar } from '../ui.mjs';

function breadcrumbs(items) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((it) => (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`))
    .join('')}</nav>`;
}

export function accessibilityPage({ BASE, SITE_URL, layout, TR }) {
  const crumbs = breadcrumbs([{ label: 'Home', href: `${BASE}/` }, { label: 'Accessibility' }]);

  const body = `
${disclaimerBar(TR)}
<section class="section-tight shell-narrow">
  ${crumbs}
  <span class="eyebrow eyebrow-accent">Accessibility</span>
  <h1 style="max-width:22ch">Accessibility statement</h1>
  <p class="lede">What is actually built into this site, not a claim of certification against a standard nobody has
  audited us on.</p>

  <h2 style="margin-top:2.2rem">What is in place</h2>
  <ul class="ticks">
    <li><strong>A skip link on every page.</strong> The first focusable element lets a keyboard or screen-reader user
    jump straight past the header to the main content, on every one of the thousands of generated pages.</li>
    <li><strong>A single, consistent focus indicator.</strong> Every interactive element — links, buttons, form
    fields, the language switcher — gets the same visible outline on keyboard focus, defined once in the stylesheet
    rather than left to inconsistent browser defaults.</li>
    <li><strong>Reduced motion is respected.</strong> If your operating system is set to reduce motion, the entry
    animations used across the site switch off and the loading spinner slows down, rather than ignoring that
    preference.</li>
    <li><strong>Labelled form fields.</strong> Every question in the eligibility wizard — age, household size,
    income, country search — has a real <code>&lt;label&gt;</code> associated with its input, not a placeholder
    standing in for one.</li>
    <li><strong>Live regions for dynamic updates.</strong> Places where the page updates without a reload — a
    filtered country list, the "preparing your application" status, a copied share link — use
    <code>aria-live</code> or <code>role="status"</code> so a screen reader announces the change.</li>
    <li><strong>Locked content is never colour-only.</strong> Rows withheld behind the paywall carry an
    <code>aria-label</code> ("Amount locked") rather than relying on a blurred visual treatment alone.</li>
    <li><strong>Semantic structure.</strong> Header, navigation, main content and footer are marked up as landmarks,
    and the language switcher is itself labelled for assistive technology.</li>
    <li><strong>Correct <code>lang</code> attribute.</strong> Every page declares the language it is actually written
    in, and the alternate-language links in the footer carry <code>hreflang</code>.</li>
  </ul>

  <h2 style="margin-top:2.2rem">Known gaps</h2>
  <p>This is a small team's honest list, and it will change as items are fixed rather than as marketing copy.</p>
  <ul class="ticks ticks--no">
    <li>No third-party accessibility audit (an automated or manual WCAG conformance review) has been run yet, so this
    page does not claim a conformance level.</li>
    <li>Colour contrast has not been checked line-by-line against every background the theme produces; the design
    uses a limited, high-contrast palette by intent, but a formal audit has not confirmed every combination.</li>
  </ul>

  <h2 style="margin-top:2.2rem">Contact</h2>
  <p>If something on this site is difficult to use with a screen reader, keyboard-only, or with any other assistive
  technology, tell us — write to <a class="link-underline" href="mailto:accessibility@unclaimedgrant.com">accessibility@unclaimedgrant.com</a>
  with the page and what happened, and we will look at it. This is the same small team behind the rest of the site, so
  a real person reads every message.</p>

  <p style="margin-top:2.5rem"><a class="link-underline" href="${BASE}/trust/">Trust, privacy & AI</a></p>
</section>`;

  return layout({
    base: BASE, linkBase: BASE, lang: 'en', tr: TR, altLangs: [],
    title: 'Accessibility statement',
    description: 'What this site actually implements for accessibility — skip links, a consistent focus indicator, reduced-motion support, labelled forms and live regions — plus the known gaps, and how to report a problem.',
    canonical: `${SITE_URL}/accessibility/`,
    body,
  });
}
