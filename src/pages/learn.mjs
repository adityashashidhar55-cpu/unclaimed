/**
 * /learn/<term>/ — the knowledge base.
 *
 * A new file rather than more of src/build.mjs, on the same reasoning as
 * src/pages/compare.mjs: one hub shape and one term shape, nothing here
 * needs build.mjs's internals, and it is generated with a two-line hook.
 *
 * English only, like /compare/ and /browse/ — these are evergreen explainers
 * of law and programme mechanics, not household-benefit prose that benefits
 * from translation.
 *
 * Every factual claim below was read from the cited official source with a
 * live fetch on the date in FACTS_CHECKED, and nothing is stated that was not
 * visible on that source at that time. Where a source did not confirm a
 * figure, it was left out rather than guessed. Re-verify before changing a
 * number, and move the affected term's `lastReviewed` date forward.
 */
import { DE_MINIMIS_CEILING_EUR, REGULATION } from '../../packages/stateaid/index.js';

export const FACTS_CHECKED = '2026-09-25';

const money = (n) => `€${new Intl.NumberFormat('en').format(n)}`;

/**
 * Evergreen explainers, in the order they are meant to be read for someone
 * new to grant terminology (mechanics first, registries second, site-specific
 * guidance last). Each entry:
 *   slug       — /learn/<slug>/
 *   title      — page <h1> and nav label
 *   dek        — one-sentence standfirst
 *   keywords   — lowercase substrings matched against a programme's own name,
 *                funder and category text to decide whether to link this term
 *                from that programme's page (see learnLinksFor below)
 *   sources    — [{ label, url }], the pages every factual claim was read from
 *   body       — the article itself, as HTML
 */
export const TERMS = [
  {
    slug: 'de-minimis-aid',
    title: 'What is de minimis aid?',
    dek: 'The EU rule that lets small public grants skip full State-aid approval — and the ceiling that comes with it.',
    keywords: ['de minimis', 'de-minimis'],
    sources: [
      { label: 'Regulation (EU) 2023/2831', url: 'https://eur-lex.europa.eu/eli/reg/2023/2831' },
    ],
    body: `
    <p>"De minimis" aid is public support small enough that the EU treats it as incapable of distorting
    competition between Member States, so it can be granted without the European Commission's prior
    notification and approval that larger State aid requires. It still counts as State aid in every other
    sense — it is public money given selectively to a company — it is simply exempted from the
    notification procedure under <a href="https://eur-lex.europa.eu/eli/reg/2023/2831" rel="nofollow noopener">Commission
    Regulation (EU) 2023/2831</a>, provided the total a single company receives per Member State stays
    under a ceiling over a rolling window.</p>
    <p>The general ceiling is <strong>${money(DE_MINIMIS_CEILING_EUR)} over any rolling three years</strong>
    (${esc_(REGULATION.general.id)}, ${esc_(REGULATION.general.article)}) — sector-specific regulations set
    separate, usually lower, ceilings for agriculture, fisheries and services of general economic interest.
    Under Article 3(7), if a new award would push a company over its ceiling, the <em>whole new award</em>
    falls outside the Regulation — it is not trimmed down to whatever headroom remains, so a company that
    signs for a grant without checking its running total first can end up owing the money back.</p>
    <p>Full mechanics — the four ceilings, how the three-year window rolls, and a calculator that runs the
    arithmetic in your browser — are on <a href="/startups/de-minimis/">our de minimis headroom
    calculator</a>.</p>`,
  },
  {
    slug: 'sbir-vs-sttr',
    title: 'SBIR vs STTR: what actually differs',
    dek: 'Same US federal small-business R&D funding pot, two different rules about who has to do the research.',
    keywords: ['sbir', 'sttr'],
    sources: [
      { label: 'SBIR.gov — SBIR or STTR? Which one is right for me?', url: 'https://www.sbir.gov/tutorials/program-basics/tutorial-3' },
      { label: 'SBIR.gov — Am I eligible to participate?', url: 'https://www.sbir.gov/tutorials/program-basics/tutorial-2' },
      { label: 'SBIR.gov — About SBIR and STTR', url: 'https://www.sbir.gov/about' },
    ],
    body: `
    <p>Small Business Innovation Research (SBIR) and Small Business Technology Transfer (STTR) are both
    US federal programmes that award non-dilutive funding to small businesses doing R&D, structured in the
    same Phase I → Phase II → Phase III sequence. <strong>11 federal agencies run SBIR; only five run
    STTR</strong> — the Department of Defense, Department of Energy, NASA, NIH and NSF.</p>
    <p>The difference that actually matters is subcontracting to a research institution (a university,
    federal lab, or FFRDC):</p>
    <table class="rule-table">
      <thead><tr><th></th><th>SBIR</th><th>STTR</th></tr></thead>
      <tbody>
        <tr><th>Research-institution partner</th><td>Optional</td><td><strong>Required</strong></td></tr>
        <tr><th>Max. share subcontracted to it</th><td>33% (Phase I), 50% (Phase II)</td><td>Up to 60%</td></tr>
        <tr><th>Minimum work by the small business</th><td>Not fixed by this rule</td><td>At least 40%</td></tr>
        <tr><th>Minimum work by the research institution</th><td>—</td><td>At least 30%</td></tr>
        <tr><th>Principal investigator's employer</th><td>The small business</td><td>Either the small business or the research institution</td></tr>
      </tbody>
    </table>
    <p>In practice: if your project needs a large university partnership and the PI might sit at that
    university rather than at your company, STTR is the fit. If you plan to do the research in-house and
    only occasionally subcontract to a lab, SBIR's lighter 33%/50% caps are less restrictive. As of April
    2026, agencies may issue an SBIR/STTR Phase I award up to <strong>$323,090</strong> and a Phase II award
    up to <strong>$2,153,927</strong> without separate SBA approval — individual agencies can and do award
    less, and some award more with SBA sign-off.</p>`,
  },
  {
    slug: 'co-funding-match-funding',
    title: 'Co-funding and match funding, explained',
    dek: 'Why almost no public grant pays 100% of a project — and what "co-financing rate" actually commits you to.',
    keywords: ['co-financing', 'co-funding', 'match funding', 'matching funds', 'cofunding'],
    sources: [
      { label: 'Regulation (EU) 2021/1060 (Common Provisions Regulation), Article 112', url: 'https://eur-lex.europa.eu/eli/reg/2021/1060/oj/eng' },
    ],
    body: `
    <p>"Co-financing" — also called match funding or cofunding — means a grant covers only a stated share
    of a project's eligible costs, and the recipient (or another public or private co-financer) must supply
    the rest. The <strong>co-financing rate</strong> is that share. It is rarely 100%: EU calls state a
    maximum rate, and national and regional schemes built on EU money inherit a ceiling from it.</p>
    <p>For the EU's main regional and social funds, the ceiling is set by Article 112(3) of the
    <a href="https://eur-lex.europa.eu/eli/reg/2021/1060/oj/eng" rel="nofollow noopener">Common Provisions
    Regulation (EU) 2021/1060</a> and depends on how developed the region is. For the ERDF, the ESF+ and the
    Just Transition Fund in 2021–2027, the EU share is capped at:</p>
    <ul>
      <li><strong>85%</strong> in less developed regions and outermost regions;</li>
      <li><strong>60%</strong> in transition regions (70% for transition regions that were classed as less
      developed in 2014–2020);</li>
      <li><strong>40%</strong> in more developed regions (50% for certain more developed regions, such as
      those that were transition regions in 2014–2020).</li>
    </ul>
    <p>These are ceilings for the programme as a whole, not the rate any one call must offer — a programme's
    own call documents are the only reliable source for its exact rate. Two practical consequences worth
    planning around: a lower co-financing rate means you need more of your own cash (or a co-financing
    partner) lined up before you apply, and "your share" usually has to be shown as committed funding in the
    application itself, not promised later.</p>`,
  },
  {
    slug: 'eu-sme-definition',
    title: 'The EU SME definition (Recommendation 2003/361)',
    dek: 'The employee, turnover and balance-sheet thresholds that decide whether "SME" applies to your company under EU rules.',
    keywords: ['sme definition', 'sme category', 'small and medium', 'micro-enterprise', 'microenterprise'],
    sources: [
      { label: 'Commission Recommendation 2003/361/EC (EUR-Lex)', url: 'https://eur-lex.europa.eu/eli/reco/2003/361/oj/eng' },
    ],
    body: `
    <p>The EU's single definition of micro, small and medium-sized enterprises comes from
    <a href="https://eur-lex.europa.eu/eli/reco/2003/361/oj/eng" rel="nofollow noopener">Commission Recommendation
    2003/361/EC</a> of 6 May 2003, and it is the definition almost every EU and Member State SME scheme,
    grant and de minimis rule points back to. Article 2 sets three thresholds, and a company must stay
    under the headcount limit AND under at least one of the two financial limits:</p>
    <table class="rule-table">
      <thead><tr><th>Category</th><th>Employees (AWU)</th><th>Annual turnover</th><th>or balance-sheet total</th></tr></thead>
      <tbody>
        <tr><th>Medium-sized (the SME ceiling)</th><td>&lt; 250</td><td>≤ €50 million</td><td>≤ €43 million</td></tr>
        <tr><th>Small</th><td>&lt; 50</td><td>≤ €10 million</td><td>≤ €10 million</td></tr>
        <tr><th>Micro</th><td>&lt; 10</td><td>≤ €2 million</td><td>≤ €2 million</td></tr>
      </tbody>
    </table>
    <p>Two details that trip people up. First, "employees" means <strong>annual work units (AWU)</strong>
    — full-time-equivalent staff for the year, not a headcount snapshot; part-timers and seasonal staff
    count as fractions. Second, the size test is not just about your own company: Article 3 requires adding
    in a proportional share of any "partner enterprise" (25%+ cross-ownership) and 100% of any "linked
    enterprise" (majority control either way) — a small-looking subsidiary of a large group is very often
    not an SME once its parent's numbers are added in. A company only loses or gains SME status once these
    thresholds are crossed over <strong>two consecutive accounting periods</strong>, not on a single bad
    (or good) year.</p>`,
  },
  {
    slug: 'eic-accelerator-explained',
    title: 'The EIC Accelerator, explained',
    dek: "How the EU's flagship deep-tech funding instrument actually works: the grant, the equity, and the four-step process.",
    keywords: ['eic accelerator', 'european innovation council'],
    sources: [
      { label: 'European Innovation Council — EIC Accelerator', url: 'https://eic.ec.europa.eu/eic-funding-opportunities/eic-accelerator_en' },
    ],
    body: `
    <p>The <a href="https://eic.ec.europa.eu/eic-funding-opportunities/eic-accelerator_en" rel="nofollow noopener">EIC
    Accelerator</a> is the European Innovation Council's programme for single start-ups and SMEs (and small
    mid-caps, for the equity component only) developing breakthrough, high-risk innovations. It offers
    <strong>blended finance</strong>: a grant component of up to €2.5 million for innovation activities at
    technology readiness level 6–8, to be completed within 24 months, plus an investment component of
    <strong>€1–€10 million</strong> through equity or quasi-equity instruments such as convertible loans.
    Applicants can apply for the grant alone or for both together.</p>
    <p>Eligibility runs to EU Member States and countries associated with Horizon Europe; a third-country
    applicant may become eligible by relocating. The EIC states it particularly welcomes applications from
    start-ups and SMEs with female CEOs.</p>
    <p>The application is a four-step funnel:</p>
    <ol>
      <li><strong>Short proposal</strong> — a 12-page form, a 10-slide pitch deck and a 3-minute video
      pitch, evaluated by four experts within 4–6 weeks.</li>
      <li><strong>Full proposal</strong> — a 20-page expanded form, pitch deck, implementation plan and
      financial documentation, submitted against batching dates (six per year in 2026).</li>
      <li><strong>Interview</strong> — top-ranked proposals get a face-to-face interview with the EIC Jury.</li>
      <li><strong>Award and due diligence</strong> — grant agreement signing, and due diligence for the
      investment component where one was requested.</li>
    </ol>`,
  },
  {
    slug: 'rd-tax-credit-vs-grant',
    title: 'R&D tax credit vs. grant: the difference that changes your claim',
    dek: 'A grant and a tax credit reward the same R&D spend differently — and in the UK, taking one can block the other.',
    keywords: ['r&d tax credit', 'rd tax credit', 'research and development tax', 'r&d tax relief'],
    sources: [
      { label: 'HMRC — CIRD81650: subsidies (SME scheme only)', url: 'https://www.gov.uk/hmrc-internal-manuals/corporate-intangibles-research-and-development-manual/cird81650' },
      { label: 'HMRC — CIRD89000: RDEC scheme subsidies', url: 'https://www.gov.uk/hmrc-internal-manuals/corporate-intangibles-research-and-development-manual/cird89000' },
    ],
    body: `
    <p>A <strong>grant</strong> is cash paid upfront (or on milestones) for a defined project, decided
    competitively before the work starts. An <strong>R&D tax credit</strong> is a reduction in tax owed —
    or, for a loss-making company, a cash credit — calculated after the fact from R&D expenditure you have
    already incurred, with no competitive selection: if the spend qualifies, the relief follows.</p>
    <p>They are not simply stackable. Under UK law (Corporation Tax Act 2009, as HMRC applies it),
    <strong>expenditure that has been "subsidised" by a grant is not eligible for relief under the SME
    R&D tax credit scheme</strong>. HMRC's own manual states it plainly: "R&D tax reliefs under the SME
    scheme are not available for expenditure that is subsidised," and where a project has received any
    funding that counts as notified State aid, <em>no</em> expenditure on that project can qualify under the
    SME scheme at all. A company in that position can instead claim under the Research and Development
    Expenditure Credit (RDEC) scheme, which — unlike the SME scheme — has no rule against subsidised
    expenditure, though usually at a lower headline rate than the SME scheme offers.</p>
    <p>The practical takeaway for a UK company weighing both a public grant and an R&D tax credit for the
    same project: check which scheme the grant-subsidised spend falls into before you plan the tax credit
    into your cash-flow forecast — the two can reduce, rather than add to, each other. Rules differ outside
    the UK; check your own country's R&D tax authority before assuming the same interaction applies.</p>`,
  },
  {
    slug: 'non-dilutive-funding',
    title: 'What is non-dilutive funding?',
    dek: 'Money for your company that does not cost you equity — grants, some tax credits, and where the term gets stretched.',
    keywords: ['non-dilutive', 'nondilutive'],
    sources: [
      { label: 'SBA — Increasing access to capital', url: 'https://www.sba.gov/about-sba/priorities/american-manufacturers/increasing-access-capital/' },
    ],
    body: `
    <p><strong>Non-dilutive funding</strong> is capital a company raises without giving up equity or
    board control — the opposite of dilutive funding (venture capital, angel investment), where investors
    receive shares in exchange for cash. Grants are the clearest example: the U.S. Small Business
    Administration itself describes programmes such as its Manufacturing USA institutes as awarding
    "non-dilutive funding to develop your technology," with no ownership stake taken in return.</p>
    <p>Grants are not the only form. R&D tax credits, prize competitions, revenue-based financing and
    conventional debt are all non-dilutive in the strict sense — none of them takes equity — though debt
    still has to be repaid and revenue-based financing takes a cut of revenue, so "non-dilutive" is a
    narrower claim than "free" or "risk-free." The trade-off runs the other way for grants specifically:
    they preserve 100% of your ownership, but they are competitive, capped in size relative to venture
    funding, and come with reporting obligations most equity investors do not impose.</p>`,
  },
  {
    slug: 'uei-sam-registration',
    title: 'UEI and SAM.gov registration, explained',
    dek: 'The one number every company needs before it can receive a US federal grant, contract or SBIR/STTR award.',
    keywords: ['uei', 'sam.gov', 'sam registration', 'duns number'],
    sources: [
      { label: 'GSA — Unique Entity Identifier update', url: 'https://www.gsa.gov/about-us/organization/federal-acquisition-service/office-of-systems-management/integrated-award-environment-iae/iae-systems-information-kit/unique-entity-identifier-update' },
    ],
    body: `
    <p>A <strong>Unique Entity ID (UEI)</strong> is the identifier the US federal government uses for every
    entity doing federal business — grants, contracts, SBIR/STTR awards included. It replaced the
    Dun & Bradstreet DUNS number, which had been the standard identifier since 1978; the transition to UEI
    began in 2019 and completed by April 2022. Unlike DUNS, a UEI is <strong>generated directly inside
    SAM.gov</strong> rather than obtained from a third party — there is no separate application to Dun &
    Bradstreet any more.</p>
    <p><strong>SAM.gov (System for Award Management)</strong> is where the UEI is assigned and viewable, and
    where an entity registers and manages the credentials that let it actually receive a federal award.
    Registering in SAM.gov is a prerequisite for essentially every US federal grant and contract, including
    every SBIR/STTR award — an eligible small business cannot be paid without it. Existing registered
    entities were assigned a UEI automatically during the transition, with no re-entry of their existing
    data required.</p>`,
  },
  {
    slug: 'siren-siret',
    title: 'SIREN and SIRET numbers, explained',
    dek: 'The two French company identifiers that grant forms ask for — and which one you actually need.',
    keywords: ['siren', 'siret'],
    sources: [
      { label: 'INSEE — Definition: SIRET number', url: 'https://www.insee.fr/en/metadonnees/definition/c1841' },
    ],
    body: `
    <p><strong>SIREN</strong> is France's 9-digit identifier for a legal entity — the company as a whole,
    assigned by INSEE (the national statistics institute) when it registers. <strong>SIRET</strong> is a
    14-digit identifier for one specific <em>establishment</em> of that company — a particular address or
    site — built by appending a 5-digit NIC (internal classification number) to the company's SIREN.
    INSEE's own definition states it directly: the SIRET number identifies establishments, and a SIRET is
    the SIREN plus the NIC.</p>
    <p>In practice: a company with one office has one SIREN and one SIRET, and the two numbers share their
    first nine digits. A company with several sites has one SIREN and a separate SIRET for each site. Most
    French grant forms and company-lookup tools ask for the SIRET of the site actually carrying out the
    funded activity, not just the group-level SIREN — supplying the wrong one is a common reason a French
    application gets bounced back for correction.</p>`,
  },
  {
    slug: 'companies-house-number',
    title: 'The Companies House number, explained',
    dek: 'What a UK company registration number looks like, what it proves, and how fast you can get one.',
    keywords: ['companies house', 'company registration number', 'crn'],
    sources: [
      { label: 'Companies House Developer Forum — Company Number format', url: 'https://forum.companieshouse.gov.uk/t/company-number-format/3097' },
      { label: 'GOV.UK — Register your company', url: 'https://www.gov.uk/limited-company-formation/register-your-company' },
    ],
    body: `
    <p>A UK <strong>company registration number (CRN)</strong> is the identifier Companies House assigns
    when a company is incorporated. Per Companies House's own developer forum, <strong>all company numbers
    are 8 characters long</strong>: companies formed in England and Wales get 8 digits, while companies
    registered in Scotland carry an "SC" prefix and companies in Northern Ireland carry an "NI" prefix, each
    followed by 6 digits (other prefixes exist for specific entity types, such as credit unions or Scottish
    charitable incorporated organisations).</p>
    <p>The number appears on the <strong>certificate of incorporation</strong> issued once registration
    completes — the document that "confirms the company legally exists and shows the company number and
    date of formation." Registering online costs £100 and is usually processed within 24 hours; registering
    by post with form IN01 costs £124 and takes 8 to 10 days. Every grant, tender and registry lookup that
    asks for a "company number" in the UK means this one.</p>`,
  },
  {
    slug: 'dpiit-recognition',
    title: 'DPIIT recognition for Indian startups, explained',
    dek: 'The government certification that unlocks tax breaks, self-certification and faster patents for Indian founders.',
    keywords: ['dpiit', 'startup india recognition'],
    sources: [
      { label: 'Startup India — Startup recognition scheme', url: 'https://www.startupindia.gov.in/content/sih/en/startup-scheme.html' },
    ],
    body: `
    <p><strong>DPIIT recognition</strong> — issued by India's Department for Promotion of Industry and
    Internal Trade — is the certification that makes a company an official "startup" for the purposes of
    India's Startup India initiative, and the gate most Indian startup-specific schemes and tax benefits
    sit behind.</p>
    <p>Under the standard track, an entity qualifies if it is a private limited company, registered
    partnership firm, LLP or cooperative society, is <strong>no more than 10 years old</strong> from
    incorporation, has annual turnover that has never exceeded <strong>₹200 crore</strong> in any financial
    year since incorporation, was not formed by splitting up or reconstructing an existing business, and is
    working towards innovation or improvement of products, processes or services with a scalable business
    model. A separate deeptech track extends both limits, to 20 years and ₹300 crore turnover.</p>
    <p>Recognition unlocks several concrete benefits: eligible private limited companies and LLPs
    incorporated after 1 April 2016 can claim an income-tax exemption for <strong>3 consecutive financial
    years</strong> out of their first ten; recognised startups can self-certify compliance with six labour
    laws and three environmental laws, avoiding routine inspections for five years except on a credible
    complaint; patent applications get expedited examination with an 80% rebate on filing fees; and
    recognised startups are exempted from the prior-experience and turnover requirements (and Earnest Money
    Deposit) that would otherwise bar them from public-procurement tenders.</p>`,
  },
  {
    slug: 'forschungszulage',
    title: "Germany's Forschungszulage (research allowance), explained",
    dek: 'How the German R&D tax credit is calculated, what caps apply, and who has to certify your project first.',
    keywords: ['forschungszulage', 'fzulg'],
    sources: [
      { label: 'IHK München — Steuerliche Förderung von Forschung und Entwicklung', url: 'https://www.ihk-muenchen.de/ratgeber/steuern/steuerliche-sonderthemen/foerderung-forschung-entwicklung/' },
      { label: 'BSFZ — Das Wachstumschancengesetz', url: 'https://www.bescheinigung-forschungszulage.de/wachstumschancengesetz' },
      { label: 'BSFZ — Steuerliches Investitionssofortprogramm', url: 'https://www.bescheinigung-forschungszulage.de/steuerliches-investitionssofortprogramm' },
    ],
    body: `
    <p>The <strong>Forschungszulage</strong> is Germany's tax-neutral R&D credit under the
    Forschungszulagengesetz (FZulG) — available to any company liable for German tax, regardless of size or
    profitability, and payable even to a company with no tax bill to offset against (it is paid out as a
    credit, not just a deduction).</p>
    <p>The rate is <strong>25% of the eligible assessment base</strong> (qualifying R&D personnel costs, and
    since later reforms, contract-research costs and capital goods) — raised to <strong>35% for companies
    that meet the EU's SME definition</strong> (see our <a href="/learn/eu-sme-definition/">EU SME
    definition explainer</a>) since the Wachstumschancengesetz reform took effect on 28 March 2024. Where
    R&D is contracted out to another party (Auftragsforschung), 70% of the fee paid to the contractor
    counts as eligible spend (up from 60% before that same reform date).</p>
    <p>The eligible assessment base is capped per company per year, and the cap has risen over time: up to
    €2 million (first half of 2020), €4 million (July 2020 to 27 March 2024), €10 million from 28 March
    2024, and <strong>€12 million for expenses incurred after 31 December 2025</strong> under the
    Steuerliches Investitionssofortprogramm. At the standard 25% rate that caps the credit itself at up to
    €3 million a year (€4.2 million for an SME at 35%). The same 2026 change lets projects starting after
    31 December 2025 add a flat 20% for overheads on top of their other eligible costs.</p>
    <p>Claiming it is a two-step process: first, apply to the independent <strong>Bescheinigungsstelle
    Forschungszulage (BSFZ)</strong> for a certificate confirming the project qualifies as R&D under §6
    FZulG — this can be requested before, during or after the project runs. Only then can the company apply
    to its local tax office (Finanzamt) for the Forschungszulage itself, attaching that certificate. The
    Forschungszulage can generally be combined with other grants or state aid for the same project, but not
    to the point of double-funding the same cost twice.</p>`,
  },
  {
    slug: 'how-to-read-an-eligibility-rule',
    title: 'How to read a grant eligibility rule',
    dek: 'The handful of questions that decide whether a published rule actually excludes you — before you spend an afternoon on the form.',
    keywords: [],
    sources: [
      { label: 'Commission Recommendation 2003/361/EC (EUR-Lex) — Annex, Articles 3 and 4', url: 'https://eur-lex.europa.eu/eli/reco/2003/361/oj/eng' },
      { label: 'HMRC — CIRD81650: subsidies (SME scheme only)', url: 'https://www.gov.uk/hmrc-internal-manuals/corporate-intangibles-research-and-development-manual/cird81650' },
      { label: 'Regulation (EU) 2023/2831 (de minimis)', url: 'https://eur-lex.europa.eu/eli/reg/2023/2831' },
    ],
    body: `
    <p>Every eligibility rule on this site is one of a small number of shapes, and knowing the shape tells
    you what to check first.</p>
    <ul>
      <li><strong>A ceiling or floor</strong> ("turnover under €10 million", "at least 2 years old") — check
      which date or period it is measured at. Most company-size and turnover rules use the last approved
      accounting period (the EU SME definition says so explicitly, in Article 4 of its Annex), not today's numbers, and most age rules count from legal incorporation, not from
      when the business actually started trading.</li>
      <li><strong>A category</strong> ("SME", "early-stage", "a registered charity") — these usually point
      to a formal legal definition, not a plain-English one. "SME" in an EU context specifically means
      Recommendation 2003/361 (see our <a href="/learn/eu-sme-definition/">explainer</a>), which counts a
      parent company's numbers alongside yours — a small-looking subsidiary of a large group very often
      fails this test even though it feels like a small business.</li>
      <li><strong>A location rule</strong> ("registered in France", "operating in this region") — check
      whether it means your registered address, where the funded activity happens, or both; these are
      sometimes different requirements stacked on top of each other.</li>
      <li><strong>An exclusivity rule</strong> ("not already subsidised", "no other State aid for this
      project") — these interact with each other. Taking a grant can disqualify the same spend from a
      separate R&D tax credit (see our <a href="/learn/rd-tax-credit-vs-grant/">explainer</a>), and a small
      grant can still count against a de minimis ceiling (see our <a href="/learn/de-minimis-aid/">de
      minimis explainer</a>) even though the ceiling is set by a completely different regulation than the
      grant itself.</li>
    </ul>
    <p>When a rule is genuinely ambiguous for your situation, the funder's own published guidance — not a
    third-party summary, including this one — is the only authoritative answer; every programme page here
    links straight to it.</p>`,
  },
  {
    slug: 'how-grant-deadlines-work',
    title: 'How grant deadlines actually work',
    dek: 'Cut-off dates, rolling calls and annual rounds are not the same thing, and mixing them up costs a real deadline.',
    keywords: [],
    sources: [
      { label: 'EU Funding & Tenders Portal — Online Manual', url: 'https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/common/guidance/om_en.pdf' },
    ],
    body: `
    <p>Not every "deadline" on a grant programme means the same thing, and the three shapes below cover
    most of what you will see on this site.</p>
    <ul>
      <li><strong>A single, fixed deadline.</strong> One submission window, one close date; the call stops
      accepting proposals the moment it passes. Most Horizon Europe topics work this way — the EU Funding
      & Tenders Portal's own Online Manual describes it as "single-stage": for most topics you submit a
      full proposal by the call deadline, and a topic is "considered open until the deadline for submission
      has passed."</li>
      <li><strong>Rolling, with cut-off dates.</strong> The call itself stays open for a long period (often
      the length of a whole funding programme) but has several intermediate cut-off dates that each trigger
      a batch evaluation. Per the same Online Manual: "the call has a final closure date... and several
      cut-off dates that trigger evaluation... After each cut-off date, the submitted proposals are grouped,
      reviewed and ranked together. If you miss a cut-off date, the proposal will be evaluated with the next
      batch." Missing one cut-off is not missing the programme — it just pushes you into the next batch,
      usually a matter of months.</li>
      <li><strong>Continuously open, no deadline at all.</strong> Applications are accepted, and typically
      evaluated, on an ongoing basis with no fixed close date — this is what "rolling" or "always open"
      means on this site's own status badges. The Online Manual notes explicitly that the ability to
      re-edit a submitted proposal "is not available for continuously open calls," a small sign of how
      differently these are administered behind the scenes.</li>
    </ul>
    <p>The practical rule: before you plan around a deadline, check whether the programme calls it a call
    deadline, a cut-off date, or neither — the three carry very different consequences for what happens if
    you are a day late.</p>`,
  },
];

function esc_(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Which learn terms are worth linking from a given programme's own text.
 *
 * `text` is whatever a caller wants matched against — typically the
 * programme's name, funder and category, lowercased and concatenated. Capped
 * at 3 so a programme page gains a short "Related reading" list, not a wall
 * of links.
 */
export function learnLinksFor(text, extra = []) {
  const hay = String(text || '').toLowerCase();
  const bySlug = new Set(extra);
  for (const term of TERMS) {
    if (bySlug.has(term.slug)) continue;
    if (term.keywords.some((k) => hay.includes(k))) bySlug.add(term.slug);
  }
  return [...bySlug].slice(0, 3);
}

export function learnIndexPage(terms, ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, L } = ctx;
  const rows = terms
    .map(
      (t) => `<a class="card card-link reveal" href="${attr(`${BASE}/learn/${t.slug}/`)}">
    <h2 style="margin:0;font-size:1.1rem">${esc(t.title)}</h2>
    <p class="small" style="margin:.4rem 0 0">${esc(t.dek)}</p>
  </a>`,
    )
    .join('');

  const body = `
<section class="section-tight shell">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Learn' }])}
  <span class="eyebrow eyebrow-accent">Learn</span>
  <h1>The grant and startup-funding glossary</h1>
  <p class="lede" style="max-width:62ch">${terms.length} evergreen explainers of the terms that show up across our
  eligibility rules and programme pages — each one sourced to the official regulation, agency or registry it
  describes, with a last-reviewed date so you can tell how fresh it is.</p>
  <div class="grid grid-3" style="margin-top:2rem">${rows}</div>
</section>`;

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: 'Learn — the grant and startup-funding glossary',
    description: `${terms.length} sourced explainers of grant and startup-funding terms — de minimis aid, SBIR vs STTR, the EU SME definition, R&D tax credits, company registries and more.`,
    canonical: `${SITE_URL}/learn/`,
    jsonld: [breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Learn', href: '/learn/' }])],
    body,
  });
}

export function learnTermPage(term, ctx) {
  const { esc, attr, layout, breadcrumbs, breadcrumbLd, LB, BASE, SITE_URL, TR, ALT, L } = ctx;
  const sourcesHtml = term.sources.length
    ? `<div class="callout" style="margin-top:2.5rem">
      <p><strong>Sources</strong></p>
      <ul>${term.sources.map((s) => `<li><a class="link-underline" href="${attr(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.label)}</a></li>`).join('')}</ul>
      <p class="tiny" style="margin-top:.6rem">Last reviewed ${esc(FACTS_CHECKED)}. Rules and figures change — follow the
      links above to confirm anything you plan to rely on.</p>
    </div>`
    : `<p class="tiny" style="margin-top:2.5rem">Last reviewed ${esc(FACTS_CHECKED)}.</p>`;

  const others = TERMS.filter((t) => t.slug !== term.slug).slice(0, 4);

  const body = `
<section class="section-tight shell-narrow">
  ${breadcrumbs([{ label: TR('backHome'), href: `${LB()}/` }, { label: 'Learn', href: `${BASE}/learn/` }, { label: term.title }])}
  <span class="eyebrow eyebrow-accent">Learn</span>
  <h1 style="max-width:24ch">${esc(term.title)}</h1>
  <p class="lede">${esc(term.dek)}</p>

  <div style="margin-top:2rem">${term.body.replace(/href="\//g, `href="${BASE}/`)}</div>

  ${sourcesHtml}

  <h2 style="margin-top:3rem">More from the glossary</h2>
  <ul>${others.map((t) => `<li><a class="link-underline" href="${BASE}/learn/${t.slug}/">${esc(t.title)}</a></li>`).join('')}</ul>

  <p style="margin-top:2rem"><a class="btn btn-primary" href="${LB()}/check/">${esc(TR('ctaCheck'))}</a>
  <a class="btn" style="margin-left:.6rem" href="${BASE}/startups/check/">${esc(TR('ctaCheckCompany'))}</a></p>
</section>`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: term.title,
    description: term.dek,
    dateModified: FACTS_CHECKED,
    datePublished: FACTS_CHECKED,
    mainEntityOfPage: `${SITE_URL}/learn/${term.slug}/`,
    citation: term.sources.map((s) => s.url),
  };

  return layout({
    base: BASE,
    linkBase: LB(),
    lang: L,
    tr: TR,
    altLangs: ALT,
    title: `${term.title} — Unclaimed glossary`,
    description: term.dek,
    canonical: `${SITE_URL}/learn/${term.slug}/`,
    jsonld: [breadcrumbLd([{ label: 'Home', href: '/' }, { label: 'Learn', href: '/learn/' }, { label: term.title }]), ld],
    body,
  });
}
