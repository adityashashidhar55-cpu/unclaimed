/**
 * /compare/ — comparison pages against the major grant-discovery products.
 *
 * A new file rather than more of src/build.mjs: this feature adds two page
 * shapes (a hub and one page per competitor) and nothing it needs is specific
 * to build.mjs's internals, so it takes its dependencies as a plain `ctx`
 * object built.mjs already has to hand — esc/attr/layout/breadcrumbs and the
 * three numbers this page is not allowed to hardcode.
 *
 * Every competitor fact below was read from the competitor's own pricing page
 * with a live fetch on 2026-09-25 and is cited with that same link on the
 * page. Nothing is stated here that was not visible on the cited page at
 * that time; where a plan or feature could not be confirmed it is left out
 * rather than guessed. Re-verify before changing a number and update the
 * date in `FACTS_CHECKED` below.
 */

export const FACTS_CHECKED = '2026-09-25';

export const COMPETITORS = [
  {
    slug: 'instrumentl',
    name: 'Instrumentl',
    short: 'Grant pipeline and AI drafting for US nonprofits and foundations',
    sourceUrl: 'https://www.instrumentl.com/pricing',
    sourceLabel: 'instrumentl.com/pricing',
    pricing: [
      { tier: 'Discover', price: '$299/month' },
      { tier: 'Pre-Award', price: '$499/month', note: 'calendar sync (Google, Outlook) starts here' },
      { tier: 'Full Lifecycle', price: '$999/month' },
    ],
    pricingNote: 'Billed annually; month-to-month runs higher. A fourth, Enterprise, tier is custom-priced.',
    theyDoBetter: [
      'A large, curated database of US private foundations matched to your organisation — the thing Instrumentl is built around.',
      'One workspace across discovery, proposal drafting and post-award spend reporting.',
      'AI-assisted proposal drafting (Apply) and CRM integrations, built in from the Pre-Award tier up.',
    ],
    weDoBetter: [
      'Free to see what you are eligible for and how many programmes it comes from — no $299-a-month floor to see a number.',
      'Government and institutional programmes worldwide, household and company, not US private foundations specifically.',
      'An MCP server any AI assistant can query directly, at no seat price.',
    ],
    metaTitle: 'Instrumentl alternative — a free eligibility check first',
    metaDesc:
      'Instrumentl runs $299–$999 a month for US foundation grant pipelines. Unclaimed is a free, sourced eligibility check across company and household programmes worldwide, with no sign-up.',
  },
  {
    slug: 'grantwatch',
    name: 'GrantWatch',
    short: 'A searchable grants database on an annual subscription',
    sourceUrl: 'https://www.grantwatch.com/plans.php',
    sourceLabel: 'grantwatch.com/plans.php',
    pricing: [{ tier: 'Annual', price: '$249/year', note: 'marked "Best Value"' },
      { tier: 'Quarterly', price: '$100/quarter' },
      { tier: 'Monthly', price: '$49/month' },
      { tier: 'Weekly', price: '$22/week' }],
    pricingNote: 'Access is billed as a subscription to search the database, not per programme.',
    theyDoBetter: [
      'A large, human-verified grants database — over 12,000 opportunities, updated daily, per its own plans page.',
      'Short weekly and monthly terms if you only need to search for a few weeks.',
    ],
    weDoBetter: [
      'A full eligibility check free, with no sign-up — GrantWatch keeps its full database behind a subscription, with only limited free searching.',
      'Coverage across {jur} jurisdictions for companies and {hh} countries for households, not primarily the US.',
      'Every record carries a sourced link and a verification date on the page itself, and status is recomputed on every build rather than left to go stale.',
    ],
    metaTitle: 'GrantWatch alternative for Europe — free, sourced, global',
    metaDesc:
      'GrantWatch is a $249/year US-focused grants database. Unclaimed is a free eligibility check across {jur} jurisdictions, built for readers outside the US too.',
  },
  {
    slug: 'subsdy',
    name: 'Subsdy',
    short: 'AI-ranked EU grant matching on a monthly plan',
    sourceUrl: 'https://www.subsdy.com/pricing',
    sourceLabel: 'subsdy.com/pricing',
    pricing: [
      { tier: 'Basic', price: '€19/month' },
      { tier: 'Premium', price: '€49/month' },
      { tier: 'Enterprise', price: '€129/month' },
    ],
    pricingNote: 'Each tier caps monthly screenings, tracked keywords and partner-search results; annual billing saves 20%.',
    theyDoBetter: [
      'AI ranking of EU grants against a stated project profile, with ongoing agent-style monitoring.',
      'Partner search for consortium-based EU calls, which most grant-discovery tools skip entirely.',
    ],
    weDoBetter: [
      'Free eligibility checking with no monthly floor — Subsdy\'s cheapest tier is already €19/month.',
      'Coverage well beyond the EU: {jur} jurisdictions for companies, {hh} countries for households.',
      'No cap on how many programmes a free check can surface — Subsdy\'s tiers meter screenings per month.',
    ],
    metaTitle: 'Subsdy alternative — no monthly plan needed to start',
    metaDesc:
      'Subsdy prices EU grant matching from €19 to €129 a month. Unclaimed checks eligibility for free, across a wider set of jurisdictions.',
  },
  {
    slug: 'grantable',
    name: 'Grantable',
    short: 'AI grant-writing workspace with a free tier',
    sourceUrl: 'https://grantable.co/pricing',
    sourceLabel: 'grantable.co/pricing',
    pricing: [
      { tier: 'Free', price: '$0/month', note: '5 chat messages/day, 10MB file imports' },
      { tier: 'Starter', price: '$50/month' },
      { tier: 'Pro', price: '$150/month' },
    ],
    pricingNote: 'Tiers differ only in daily capacity, not in which features are available; a 501(c)(3) discount applies to paid plans.',
    theyDoBetter: [
      'AI drafting and reuse of past proposal writing across applications, which is the product\'s core job.',
      'A genuinely usable free tier for occasional use, not a teaser.',
    ],
    weDoBetter: [
      'Discovery, not just drafting: Grantable helps you write a grant you already found, it does not surface which programmes you are eligible for.',
      'Free eligibility checking against the full dataset, with no daily message cap.',
      'Coverage across both household benefits and company grants in one place.',
    ],
    metaTitle: 'Grantable alternative — for finding grants, not just writing them',
    metaDesc:
      'Grantable is a $50–$150/month AI drafting tool with a limited free tier. Unclaimed is a free eligibility check that tells you which programmes to write for in the first place.',
  },
  {
    slug: 'eu-funding-tenders-portal',
    name: 'EU Funding & Tenders Portal',
    short: 'The European Commission\'s own official portal',
    sourceUrl: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home',
    sourceLabel: 'ec.europa.eu funding & tenders portal',
    pricing: [{ tier: 'Official EU service', price: 'Free' }],
    pricingNote: 'Run directly by the European Commission — the primary source for EU-level calls, not a paid product.',
    theyDoBetter: [
      'It is the official source: every EU-level call, consortium requirement and submission form originates here, not a secondary read of it.',
      'Full administrative tooling for actually submitting a proposal as a consortium partner.',
    ],
    weDoBetter: [
      'One eligibility check across EU-level programmes and national and regional ones, company and household, in one place — the portal covers EU-level calls only.',
      'Plain-language eligibility rules and a document checklist, rather than the portal\'s own call documentation.',
      'An MCP server and a static JSON API an AI assistant or a script can query directly.',
    ],
    metaTitle: 'EU Funding & Tenders portal — how Unclaimed compares',
    metaDesc:
      'The EU Funding & Tenders portal is the official, free source for EU-level calls. Unclaimed adds a plain-language eligibility check across national programmes too, company and household.',
  },
  {
    slug: 'opengrants',
    name: 'OpenGrants',
    short: 'US grant search, matching and a pipeline, with its own MCP server',
    sourceUrl: 'https://opengrants.io/how-opengrants-pricing-works/',
    sourceLabel: 'opengrants.io/how-opengrants-pricing-works',
    pricing: [
      { tier: 'Pro', price: '$9/month', note: '$8/month billed annually; team collaboration up to 5, API access at 25 requests/day' },
      { tier: 'Developer', price: '$299/month', note: '$239/month billed annually; unlimited API requests and keys, webhooks, unlimited team members' },
    ],
    pricingNote: '7-day free trial on every tier, no card required to start; nonprofit discounts available on request.',
    theyDoBetter: [
      '78,000+ open grants and contracts merged from Grants.gov, all 50 US state portals, municipal programmes and foundations into one search (per opengrants.io/product).',
      'Their own MCP server and a public API with webhooks on the Developer tier — one of the only other sellers, besides Instrumentl, of an MCP grant-discovery connector.',
      'A built-in application pipeline — kanban stages, deadline reminders, team notes — alongside discovery, not just a database.',
    ],
    weDoBetter: [
      'Free eligibility checking with no $9-a-month floor and no card on file, on both sides of the dataset.',
      'Coverage outside the US: {jur} jurisdictions for companies and {hh} countries for households — OpenGrants is a US-only database.',
      'No published rate limit on our free JSON API; OpenGrants caps its Pro tier at 25 requests a day.',
    ],
    metaTitle: 'OpenGrants alternative — free, and not US-only',
    metaDesc:
      'OpenGrants prices US grant search and its MCP server from $9 to $299 a month. Unclaimed checks eligibility for free, across companies and households worldwide.',
  },
  {
    slug: 'candid',
    name: 'Candid',
    short: 'Foundation Directory search and nonprofit compliance data',
    sourceUrl: 'https://candid.org/pricing',
    sourceLabel: 'candid.org/pricing',
    pricing: [
      { tier: 'Free', price: '$0/month', note: 'limited search results and profile views' },
      { tier: 'Premium', price: '$219/month', note: 'or $1,199/year (≈$100/month); up to 250 grants downloaded/month, 1,000/month on the annual plan' },
      { tier: 'Ultimate', price: '$1,699/year', note: '≈$142/month; adds 6 federal and state compliance sources verified daily' },
      { tier: 'Enterprise', price: 'Custom', note: 'for organisations needing 10+ users' },
    ],
    pricingNote: 'Eligibility-based discounts apply to verified non-funding (nonprofit) organisations; Candid does not publish the discounted rate itself.',
    theyDoBetter: [
      '1.9 million organisation profiles with funding history, financials and staff contacts — a depth of foundation and nonprofit research this site does not attempt.',
      'Compliance data (IRS BMF, Pub78, Automatic Revocations, OFAC and more) verified daily across 6 federal and state sources, for donors screening a nonprofit before giving.',
      'An AI fundraising assistant that turns a plain-language question into a funder shortlist and a drafted letter of inquiry.',
    ],
    weDoBetter: [
      'Free eligibility checking on the full dataset — Candid\'s own Free plan caps search results and profile views before the $219/month tier.',
      'Company grants and household benefits together, in plain eligibility terms; Candid is nonprofit-and-foundation research, not a personal or company eligibility check.',
      'No monthly download cap — Candid\'s Premium plan stops at 250–1,000 grant records exported a month.',
    ],
    metaTitle: 'Candid alternative — for grant eligibility, not foundation research',
    metaDesc:
      'Candid prices nonprofit and foundation research at $219–$1,699/year. Unclaimed is a free eligibility check for households and companies, not a foundation directory.',
  },
  {
    slug: 'grantstation',
    name: 'GrantStation',
    short: 'A grantmaker database for nonprofits, sold as an annual membership',
    sourceUrl: 'https://grantstation.com/product/grantstation-membership',
    sourceLabel: 'grantstation.com/product/grantstation-membership',
    pricing: [
      { tier: '1-year membership', price: '$199/year' },
      { tier: '2-year membership', price: '$299' },
    ],
    pricingNote: 'No free trial; a signed-out visitor can see how many grantmakers match a search without seeing full profiles.',
    theyDoBetter: [
      '150,000+ funder profiles and 15,000+ curated grants, updated daily, aimed specifically at US 501(c)(3)s, schools, tribal councils and similar organisations.',
      'Grant-strategy guides, proposal-writing templates and monthly webinars bundled with the database.',
      'An AI tool that turns a description of your organisation into search terms against its own database.',
    ],
    weDoBetter: [
      'Every programme record is free to read on a public page and in the JSON dataset — no $199-a-year membership needed to see a full profile rather than a match count.',
      'Household benefits alongside company grants, worldwide — not one database of US nonprofit funders.',
      'An MCP server and a public JSON API, at no extra price — GrantStation offers neither.',
    ],
    metaTitle: 'GrantStation alternative — free, no annual membership',
    metaDesc:
      'GrantStation charges $199–$299 for annual access to its grantmaker database. Unclaimed checks eligibility for free, across companies and households.',
  },
  {
    slug: 'granted-ai',
    name: 'Granted AI',
    short: 'AI grant-writing with a money-back guarantee',
    sourceUrl: 'https://grantedai.com/pricing',
    sourceLabel: 'grantedai.com/pricing',
    pricing: [
      { tier: 'Professional', price: '$57/month', note: 'unlimited drafts, a "Review Board" pass and a 12-month win-or-refund guarantee' },
    ],
    pricingNote: 'The only tier currently listed on the live pricing page.',
    theyDoBetter: [
      'AI-drafted grant applications with unlimited drafts, a human "Review Board" review pass, and a refund guarantee if nothing is won within 12 months.',
    ],
    weDoBetter: [
      'Discovery, not just drafting: Granted AI writes the grant you already found, it does not tell you which programmes you are eligible for in the first place.',
      'Free eligibility checking with no monthly fee, on both the company and household sides.',
      'Coverage across {jur} jurisdictions and {hh} countries, not one AI drafting tool for whichever single grant you bring it.',
    ],
    metaTitle: 'Granted AI alternative — for finding grants, not just drafting them',
    metaDesc:
      'Granted AI is a $57/month AI grant-writing tool with a refund guarantee. Unclaimed is a free eligibility check that tells you which programmes to write for first.',
  },
  {
    slug: 'hello-alice',
    name: 'Hello Alice',
    short: 'A free AI small-business advisory platform, with grants as one feature',
    sourceUrl: 'https://www.helloalice.com/small-business-grants-and-funding',
    sourceLabel: 'helloalice.com/small-business-grants-and-funding',
    pricing: [
      { tier: 'Hello Alice account', price: 'Free', note: '"free to join" with "no fees to browse or apply to any grant program on the platform"' },
    ],
    pricingNote:
      'Hello Alice does not charge for grant matching itself — it monetises through its own Small Business Mastercard and a small-business loans marketplace, separate product lines its own help centre documents.',
    theyDoBetter: [
      'It costs nothing to use, with no seat or subscription price on the grant-matching feature at all.',
      'Broader small-business guidance beyond grants — an AI "advisory board", credit-building tools and its own financial products in one account.',
    ],
    weDoBetter: [
      'Coverage worldwide and for households, not one US small-business platform.',
      'No companion credit card or loans marketplace attached — grants are the whole product here, not a lead generator for a financial-services business.',
      'A public API and MCP server any AI assistant can query directly; Hello Alice\'s own integration surface is its in-app advisory chat.',
    ],
    metaTitle: 'Hello Alice alternative — global coverage, no financial products attached',
    metaDesc:
      'Hello Alice is a free US small-business advisory platform with grants as one feature. Unclaimed is a free eligibility check across companies and households worldwide.',
  },
];

/* Coverage counts are placeholders in the copy above and filled from the
   build's own stats, so they cannot drift from the dataset. */
function fill(text, ctx) {
  return String(text)
    .replace(/\{jur\}/g, ctx.nf(ctx.STARTUP_MANIFEST.countries.length))
    .replace(/\{hh\}/g, ctx.nf(ctx.STATS.countryCount));
}

function competitorCard({ comp, href, esc, attr, arrow }) {
  const lowest = comp.pricing[0];
  return `<a class="card card-link reveal" href="${attr(href)}">
    <span class="eyebrow">${esc(comp.name)}</span>
    <h2 style="margin:.3rem 0 .4rem;font-size:1.15rem">${esc(comp.short)}</h2>
    <p class="small" style="margin:0">${esc(lowest.tier)} from <strong>${esc(lowest.price)}</strong></p>
    <p class="card-link__go small">Compare ${arrow}</p>
  </a>`;
}

/**
 * The hub at /compare/ — one card per competitor, plus the same three
 * headline numbers repeated on every individual page so a reader who lands
 * here first still gets them once.
 */
export function compareHub(ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, nf, STATS, STARTUP_STATS, STARTUP_MANIFEST, L, ICON } = ctx;
  const jurisdictions = STARTUP_MANIFEST.countries.length;
  const companyCount = STARTUP_STATS.total;
  const householdCount = STATS.total;

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Compare' }])}
  <span class="eyebrow eyebrow-accent">Compare</span>
  <h1>Unclaimed next to the other grant-finding tools</h1>
  <p class="lede" style="max-width:62ch">A fair, sourced comparison — every competitor figure below links to the page it came from, checked on ${esc(FACTS_CHECKED)}.
  We are free to check eligibility; some of these are not free to look.</p>

  <div class="grid grid-3" style="margin-top:2.5rem">
    ${COMPETITORS.map((comp) => competitorCard({ comp, href: `${BASE}/compare/${comp.slug}/`, esc, attr, arrow: ICON.arrow })).join('')}
  </div>

  <div class="callout" style="margin-top:3rem">
    <p><strong>What Unclaimed is, in the numbers these comparisons keep coming back to:</strong></p>
    <ul class="ticks">
      <li>${nf(companyCount)} company programmes across ${nf(jurisdictions)} jurisdictions, and ${nf(householdCount)} household benefits across ${nf(STATS.countryCount)} countries</li>
      <li>A free eligibility check with no sign-up, on both sides of the dataset</li>
      <li>An MCP server at <code>/mcp</code> any AI assistant can query directly, and a static JSON API alongside it</li>
      <li>Status recomputed on every build, with a daily rebuild so a closed programme does not sit marked "open"</li>
    </ul>
    <p class="small" style="margin-top:1rem"><a class="link-underline" href="${LB()}/pricing/">See our own pricing</a> · <a class="link-underline" href="${LB()}/methodology/">Read the methodology</a></p>
  </div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    /* Generated from COMPETITORS rather than hand-listed: the list has grown
       past what fits in a title, and a hand-typed subset drifts the moment
       another competitor is added (it happened once already, going from 5
       to 10). The title keeps the first four names, plus a count; the
       description lists every one. */
    title: `Compare Unclaimed — ${COMPETITORS.slice(0, 4).map((c) => c.name).join(', ')} and ${nf(COMPETITORS.length - 4)} more`,
    description: `A sourced, cited comparison of Unclaimed against ${COMPETITORS.map((c) => c.name).join(', ')}, on price and coverage across ${nf(companyCount)} company programmes and ${nf(householdCount)} household benefits.`,
    canonical: `${SITE_URL}/compare/`,
    jsonld: [breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Compare', href: '/compare/' }])],
    body,
  });
}

/** One /compare/<slug>/ page. */
export function comparePage(comp, ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, nf, STATS, STARTUP_STATS, STARTUP_MANIFEST, L } = ctx;
  const jurisdictions = STARTUP_MANIFEST.countries.length;
  const companyCount = STARTUP_STATS.total;
  const householdCount = STATS.total;

  const pricingRows = comp.pricing
    .map((t) => `<tr><th>${esc(t.tier)}</th><td>${esc(t.price)}${t.note ? ` <span class="small" style="color:var(--ink-3)">— ${esc(t.note)}</span>` : ''}</td></tr>`)
    .join('');

  const body = `
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Compare', href: `${BASE}/compare/` }, { label: comp.name }])}
  <span class="eyebrow eyebrow-accent">${esc(comp.name)} alternative</span>
  <h1>Unclaimed vs. ${esc(comp.name)}</h1>
  <p class="lede">${esc(comp.short)}. Every figure below is cited to the page it came from — checked ${esc(FACTS_CHECKED)}; prices change, so follow the source link to confirm.</p>

  <h2 style="margin-top:2.5rem">${esc(comp.name)}'s pricing</h2>
  <table class="rule-table">${pricingRows}</table>
  ${comp.pricingNote ? `<p class="small" style="margin-top:.6rem">${esc(comp.pricingNote)}</p>` : ''}
  <p class="small"><a class="link-underline" href="${attr(comp.sourceUrl)}" rel="nofollow noopener" target="_blank">Source: ${esc(comp.sourceLabel)}</a></p>

  <h2 style="margin-top:2.5rem">Unclaimed's pricing</h2>
  <table class="rule-table">
    <tr><th>Eligibility check</th><td>${esc(TR('priceFree'))}${esc(TR('priceForever'))} — no sign-up</td></tr>
    <tr><th>${esc(TR('pricePersonal'))}</th><td>€50${esc(TR('pricePerYear'))} (${esc(TR('pricePersonalSecond'))})</td></tr>
    <tr><th>${esc(TR('priceStartup'))}</th><td>€49${esc(TR('pricePerSeatMonth'))} (${esc(TR('priceStartupYear'))})</td></tr>
    <tr><th>${esc(TR('priceEnterprise'))}</th><td>€80${esc(TR('pricePerSeatMonth'))} (${esc(TR('priceEnterpriseYear'))})</td></tr>
  </table>
  <p class="small"><a class="link-underline" href="${LB()}/pricing/">Full pricing detail</a></p>

  <div class="grid grid-2" style="margin-top:2.5rem">
    <div class="card">
      <h2 class="h-eyebrow" style="margin-top:0">Where ${esc(comp.name)} is ahead</h2>
      <ul class="ticks">${comp.theyDoBetter.map((x) => `<li>${esc(fill(x, ctx))}</li>`).join('')}</ul>
    </div>
    <div class="card">
      <h2 class="h-eyebrow" style="margin-top:0">Where we are ahead</h2>
      <ul class="ticks">${comp.weDoBetter.map((x) => `<li>${esc(fill(x, ctx))}</li>`).join('')}</ul>
    </div>
  </div>

  <h2 style="margin-top:3rem">What's actually in Unclaimed</h2>
  <ul>
    <li>${nf(companyCount)} company programmes across ${nf(jurisdictions)} jurisdictions</li>
    <li>${nf(householdCount)} household benefits across ${nf(STATS.countryCount)} countries</li>
    <li>A free eligibility check with no sign-up, on both sides</li>
    <li>An MCP server at <a class="link-underline" href="${BASE}/api/">/mcp</a> for AI assistants, and a static JSON API beside it</li>
    <li>Daily status refresh, so an "Open" badge does not outlive the deadline it describes</li>
  </ul>

  <p style="margin-top:2.5rem"><a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
  <a class="btn" style="margin-left:.6rem" href="${BASE}/startups/check/">${esc(TR('ctaCheckCompany'))}</a></p>

  <p class="small" style="margin-top:2rem"><a class="link-underline" href="${BASE}/compare/">← All comparisons</a></p>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: comp.metaTitle,
    description: fill(comp.metaDesc, ctx),
    canonical: `${SITE_URL}/compare/${comp.slug}/`,
    jsonld: [breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Compare', href: '/compare/' }, { label: comp.name }])],
    body,
  });
}
