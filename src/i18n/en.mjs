/**
 * English — the source of truth for the key set.
 *
 * Every other language file must define every key here. `scripts/test-i18n.mjs`
 * fails the build if one is missing, rather than letting `t()` fall back to
 * English: a silent fallback is precisely how a French page shipped with a
 * French nav and an English body.
 */
export default {
  /* -- chrome --------------------------------------------------------- */
  tagline: 'Find the government money you are entitled to and are not claiming.',
  navCountries: 'Countries',
  navHow: 'How we know',
  navPricing: 'Pricing',
  navEnterprise: 'Enterprise',
  navWriting: 'Writing',
  navApp: 'App',
  navApi: 'API & MCP',
  navBrowseInstead: 'Browse instead',
  ctaCheck: "Check what you're owed",
  ctaBrowse: 'Browse by country',
  skipToContent: 'Skip to content',
  language: 'Language',
  footProduct: 'Product',
  footDevelopers: 'Developers',
  footTrust: 'Trust',
  footWorkspace: 'Grants workspace',
  footMobileApp: 'Mobile app',
  footPrivacy: 'Privacy',
  footLimits: 'Known limitations',
  footVerification: 'Verification status',
  footSource: 'Source on GitHub',
  footFreeLine: 'Free, anonymous, no sign-up.',
  footDisclaimer: (site) =>
    `${site} is a discovery tool, not legal, tax or financial advice. Eligibility rules change; only the official body named on each programme page can confirm what you are entitled to. Always read the source page before applying.`,
  disclaimerShort: 'Discovery tool, not advice.',
  disclaimerRest: 'Every figure is the published rule, not a decision on your case.',
  backHome: 'Home',
  methodology: 'Methodology',
  seePricing: 'See pricing',
  signInUnlock: 'Sign in to unlock',
  lockedNote: 'Email and a six-digit code, then €50 a year. No password to forget.',
  lockedWord: 'Locked',
  unlockLink: 'Unlock',
  moreLocked: (n, noun) =>
    `<strong>${n} more ${noun}</strong> ${n === 1 ? 'is' : 'are'} on the paid plan, with the amount, the rules, the documents and the steps for each.`,
  langNote:
    'The interface is in English. Programme names, quoted sources and eligibility wording stay in the language the funder published them in — a machine-translated benefit rule would be less accurate, and you will read the official page in that language anyway.',

  /* -- landing -------------------------------------------------------- */
  homeEyebrow: (n, j) => `${n} sourced programmes · ${j} jurisdictions`,
  /* Hub-page <title>s. These were English literals in build.mjs, so the six
     non-English versions of the site's main entry points shared one English
     title and og:title — the single string a search result and a share card
     are made of. */
  countriesTitle: 'All countries',
  autoApplyTitle: 'Auto-apply, country by country',
  startupCheckTitle: 'Check what your company qualifies for',
  startupsTitle: (j) => `Startup grants — non-dilutive funding across ${j} jurisdictions`,
  startupsHeroCta: 'Check what your company qualifies for',
  homeH1: 'The money you are owed, and nobody told you about.',
  homeLede:
    'Governments and funders hand out rent support, family payments, R&D credits and startup grants every year. Most of it goes unclaimed because nobody can find it. We found it, sourced it, and dated it.',
  homeFounderCta: "I'm a founder",
  statProgrammes: 'Programmes',
  statOpenNow: 'Open right now',
  statReopen: 'Closed, with a reopen date',
  statJurisdictions: 'Jurisdictions',
  homeClosedTitle: 'Closed does not mean hidden.',
  homeClosedBody:
    'Every grant site either buries closed calls — so you never learn they exist and miss them again next year — or lists them as open and wastes your afternoon. We show them with the only fact that matters:',
  homeClosedEm: 'when they come back',
  homeHowEyebrow: 'How it works',
  homeHowH2a: 'Four questions.',
  homeHowH2b: 'Then the money.',
  step1T: 'Tell us about you',
  step1B: 'Country, situation, rough income. No account, no email, nothing stored — the matcher runs in your browser.',
  step2T: 'See the number',
  step2B: 'What you are owed across every programme you qualify for. Free, always, no wall.',
  step3T: 'Get the list and the paperwork',
  step3B: 'Which schemes, what each needs, and a prepared application per claim with the fields already filled.',
  step4T: 'Put the window in your calendar',
  step4B: 'Deadlines export as an .ics file, so the date lands in the place you already look.',
  homeTwoEyebrow: 'Two products',
  homeTwoH2: 'Households and founders need different things.',
  homeForPeople: 'For people',
  homeForFounders: 'For founders',
  homePeopleH3: (n, c) => `${n} benefits across ${c} countries`,
  homePeopleB:
    'Rent support, family payments, energy help, transport concessions, tax credits. Means-tested rules modelled from the published thresholds, with every source linked.',
  homeFoundersH3: (n, j) => `${n} grants across ${j} jurisdictions`,
  homeFoundersB:
    'Public and private, ranked by what you can realistically win rather than headline size — with the EU de minimis ceiling applied so the plan is one you can lawfully execute.',
  homeFindFunding: 'Find startup funding',
  homeTrustEyebrow: 'Why trust the number',
  homeTrustH2a: 'Every figure is a published rule,',
  homeTrustH2b: 'not a guess.',
  trust1T: 'Sourced and dated',
  trust1B: "Every programme links to the funder's own page with a verbatim quote and the date we last read it. Records we have not re-checked say so.",
  trust2T: 'Nulls, never estimates',
  trust2B: 'Where a funder publishes no amount we show no amount. An invented figure is worse than a blank.',
  trust3T: 'Nothing leaves your device',
  trust3B: 'The free check runs entirely in your browser. No account, no tracking, no answers stored anywhere.',
  homeFinalH2: 'Find out in ninety seconds.',
  homeFinalLede: 'No sign-up. No card. The number is free forever.',
  homeTitle: 'Find the money you are owed',
  homeDesc: (n, c) =>
    `A free, anonymous check against ${n} sourced government and institutional support programmes in ${c} countries. See how much you could be owed in ninety seconds.`,

  /* -- check ---------------------------------------------------------- */
  checkTitle: 'Check what you are owed',
  checkDesc: (n, c) =>
    `A 90-second anonymous eligibility check against ${n} government support programmes in ${c} countries. Nothing is stored on a server.`,
  checkNoJsTitle: 'The eligibility check needs JavaScript',
  checkNoJsBody:
    'it runs entirely in your browser so that nothing you type ever reaches a server. Without it you can still browse every programme by country:',
  checkBrowseAll: (n) => `Browse all ${n} countries`,

  /* -- countries index ------------------------------------------------ */
  ctryTitle: 'Every country we cover',
  ctryDesc: (n, c) => `${n} support programmes across ${c} countries, each with its own eligibility rules and official sources.`,
  ctryH1: 'Every country we cover',
  ctryLede: (n, c) =>
    `${n} programmes across ${c} countries. Coverage is uneven and we say where — a thin dataset shown honestly is more useful than a padded one.`,
  ctryProgrammes: 'programmes',
  ctryVerified: 'verified',

  /* -- audience pages -------------------------------------------------- */
  audStudents: 'students & under-30s',
  audParents: 'parents at home',
  audFreelancers: 'freelancers & self-employed',
  audRenters: 'renters',
  audHead: (n, a, c) => `${n} things ${a} in ${c} can claim`,
  audFor: 'Programmes for you',
  audAuto: 'Paid automatically',
  audApply: 'Need an application',
  audPriced: 'With a published amount',
  audBlurbStudents: 'Housing aid, transport passes, study grants, first-job and mobility help.',
  audBlurbParents: 'Family allowances, childcare costs, school and back-to-school help, energy support.',
  audBlurbFreelancers: 'Training credit, start-up aid, contribution relief and health cover.',
  audBlurbRenters: 'Rent support, deposit guarantees, moving costs and social utility tariffs.',
  audIndexH1: (a) => `What ${a} can claim`,
  audIndexLede: (a, n) => `Support aimed at ${a}, across ${n} countries. Pick yours.`,
  audUnpricedNote: (n) =>
    `<strong>${n} of these publish no fixed amount.</strong> That does not mean they are small — it means the authority calculates the figure from your circumstances, and those are often the biggest payments of all. Run the check to see which apply to you.`,

  /* -- programme and country pages ------------------------------------- */
  verified: 'Verified',
  notChecked: 'Not human-checked',
  mustApply: 'You must apply',
  automatic: 'Automatic — no application',
  whoQualifies: 'Who qualifies',
  howApply: 'How to apply',
  documents: "Documents you'll need",
  source: 'Where this comes from',
  lastChecked: 'Last checked',
  applyOfficial: 'Apply on the official site',
  fullRules: 'Full rules & documents',
  amountVaries: 'Amount depends on your circumstances',
  whatThisPays: 'What this pays',
  whatThisPaysBlurb: 'The published value, how it is calculated, and whether it is cash or a credit ceiling.',
  whoQualifiesBlurb: (n) => `The ${n} published rules this programme tests you against — age, income, residency, household and the rest.`,
  documentsBlurb: 'Exactly what to gather before you start, so nothing sends you back to the beginning.',
  documentsLocked: (n) => `${n} documents you'll need`,
  paidPlanNote:
    '<strong>The steps, documents and official link are part of the paid plan.</strong> Checking how much you are owed is free and always will be.',
  seePlans: 'See plans',
  /* The free-check escape hatch beside every 'See plans' button. This key was
     referenced by ui.mjs's teaseList long before it existed anywhere, and the
     translator's identity fallback printed the literal 'checkFree' as a button
     label on 3,957 pages — the one control on the page that costs nothing was
     advertised as a variable name. */
  checkFree: 'Run the free check',
  otherSupport: (cat, country) => `Other ${cat} support in ${country}`,
  /* Two paywall sentences, not one. The page used to promise "the steps,
     documents and official link" on every programme, but 344 records have no
     steps, no documents and an application_url identical to source_url — so on
     those pages we were selling three things that do not exist. The thin
     variant names what is genuinely locked there: the amount and the rules. */
  paidPlanNoteFull: "The steps, documents and official link are part of the paid plan. Checking how much you're owed stays free.",
  paidPlanNoteThin: "What this pays and the eligibility rules are part of the paid plan. Checking how much you're owed stays free.",
  provVerified: 'A researcher has read this record against the official page.',
  provAuto: 'Extracted from the official source, not yet re-read by a human.',
  provVerifiedShort: 'Read by a researcher',
  provAutoShort: 'Not yet re-read',
  atGlanceChecked: 'Record',
  otherSupportIn: (cat, country) => `Other ${cat} in ${country}`,
  countryCoverage: 'Country coverage',
  rawJson: 'Raw JSON',
  checkWhichQualify: 'Check which of these you qualify for',
  sortedByAmount: 'Sorted so the ones with a published amount come first.',
  weCouldSource: (n, cat) => `${n} ${cat} programmes we could source and date.`,

  /* -- account --------------------------------------------------------- */
  acctTitle: 'Sign in',
  acctH1: 'Sign in',
  acctLede:
    'Your email and a six-digit code. No password — there is nothing to leak, nothing to reset, and nothing you could reuse from a site that has already been breached.',
  acctEmail: 'Email address',
  acctSendCode: 'Send me a code',
  acctCode: 'Six-digit code',
  acctVerify: 'Verify and sign in',
  acctIndividual: 'For me',
  acctCompany: 'For my company',
  acctNoJs:
    '<strong>Signing in needs JavaScript.</strong> The form posts nowhere useful without it, so rather than leave you typing into something that silently does nothing, we say so here.',
  acctSignOut: 'Sign out',

  /* -- pricing ---------------------------------------------------------- */
  priceTitle: 'Pricing — free to find out, paid to claim',
  priceEyebrow: 'Pricing',
  priceH1a: 'Finding out is free.',
  priceH1b: 'Always.',
  priceLede:
    'You never pay to learn the number. You pay when you want to know which programmes it came from, and to have the paperwork done.',
  priceFree: 'Free',
  priceForever: ' forever',
  priceFreeBlurb:
    'How much you are owed, and how many places it comes from. For people and for companies — the free tier is the same either way.',
  priceFree1: '<strong>How much you are eligible for</strong>, per year',
  priceFree2: '<strong>How many programmes</strong> it comes from',
  priceFree3: 'How many of those pay out automatically',
  priceAppLine: '<strong><a href="/app/">The installable web app at /app/</a></strong> — offline, free plan included',
  priceFree5: 'No account needed to see the number',
  priceNo1: 'Which programmes — names are on the paid plan',
  priceNo2: 'The programme directory',
  priceNo3: 'Documents, deadlines and prepared applications',
  priceFreeNote: 'The check runs on your device. Nothing you type is sent anywhere.',
  pricePersonal: 'Personal',
  pricePerYear: '/year',
  pricePerMonth: '/month',
  pricePersonalSecond: 'or €7/month — the annual plan saves €34',
  pricePersonalBlurb: 'For a household claiming what it is entitled to.',
  pricePers1: '<strong>Which programmes</strong>, by name',
  pricePers2: (n) => `The full directory — all ${n} records with rules and sources`,
  pricePers3: '<strong>A document checklist per claim</strong>, in your dashboard',
  pricePers4: 'Every document reused across every later claim that asks for it',
  pricePers5: 'Exact steps, deadlines and a calendar export',
  pricePers6: '<strong>Auto-apply where it is legally available</strong>',
  priceStartWithFree: 'Start with the free check',
  pricePersonalNote: 'Cancel any time. Same price whether you are owed nothing or €9,000.',
  priceStartup: 'Startup',
  /* One button label for every priced tier. It used to carry the price —
     "Subscribe — €49 a seat a month" — which was the fourth place the Startup
     card stated €49. The figure above the button says it once. */
  subscribeShort: 'Subscribe',
  pricePerSeatMonth: ' per seat / month',
  priceStartupYear: 'or €490 per seat / year',
  priceEnterprise: 'Enterprise',
  priceEnterpriseYear: 'or €800 per seat / year — billed annually',
  priceStartupSecond: 'or €490/year · one company, one seat',
  priceStartupBlurb: 'For a founder chasing grants for their own company.',
  priceStart1: (n) => `All ${n} startup programmes by name, ranked by what you can realistically win`,
  priceStart2: 'Award odds and effort estimate per programme',
  priceStart3: '<strong>EU de minimis ceiling tracking</strong>',
  priceStart4: 'Company auto-fill from public registers',
  priceStart5: 'Document checklist reused across applications',
  priceStart6: 'Saved searches by sector, stage and geography',
  priceWhatFreeT: 'What free actually gets you, stated plainly.',
  priceWhatFreeB:
    'The total and the count. Not a shortened list, not the first few names, not a teaser you can piece together — the programme names are the product. We would rather say that on the pricing page than have you find out at the end of a ten-minute questionnaire.',
  priceAppsT: 'The app is free, and it is a web app.',
  priceAppsB: 'Open /app/ and add it to your home screen on Android or iOS: it installs, works offline and needs no account. There is no store listing. A free user gets their number on their phone; paying unlocks the same extra content in the app as on the web, and it is one subscription, not two.',
  priceFlatT: 'One flat price. Never a cut of what you get.',
  priceFlatB:
    'No success fee, no commission, no per-claim charge. That is a deliberate limit on us: the moment a service takes a share of someone\'s benefits it stops being a tool and becomes a middleman, and in several countries that is exactly what the law is there to stop.',
  priceNotDoT: "What we don't do.",
  priceNotDoB:
    'We never sign in to a government website as you, and we never press submit on your behalf outside Spain. Every application we prepare is sent by you, from your own account. A benefits declaration is sworn by the person making it, and keeping it yours is what the law requires and what protects you.',
  priceChecklistT: 'A checklist that fills itself in',
  priceChecklistB: 'Every claim wants a payslip, a proof of address, a birth certificate. The dashboard lists exactly what each programme asks for, and ticking a document off once ticks it off on every later claim that wants it. <strong>It is a checklist of labels, not a document store</strong> — we hold the name of the document and the date you got it. Your files stay where they are.',
  priceIncluded: 'Included on every paid plan',
  priceWhereWeFile: 'Where we can, we file it',
  priceAutoApplyT: 'Auto-apply, honestly scoped',
  priceAutoApplyB:
    'In <strong>Spain</strong> a company can hold a registered power of attorney and submit for you, so there we do. That is one country and we would rather say so. Everywhere else you get the complete package and press send yourself.',

  /* -- enterprise -------------------------------------------------------- */
  entTitle: 'Enterprise — a grants workspace for a whole portfolio',
  entH1: 'One workspace for every company you support.',
  entLede:
    'Accelerators, funds, universities and economic development agencies run the same search dozens of times a year. This is that search, done once, for a whole portfolio — with the applications drafted, the deadlines watched and the state-aid ceiling tracked.',
  entOpenWorkspace: 'Open the workspace',
  entNoSales:
    'No account, no sales call. It runs in your browser on your own portfolio — which is also how a fund can try it on real companies without the data leaving the building.',
  entDayOne: 'What you get on day one',
  entDayOneH3: 'Projects, applications, documents, deadlines, post-award, ledger, reports',
  entStatMatched: 'Programmes matched',
  entStatJurisdictions: 'Jurisdictions',
  entStatOpen: 'Open right now',
  entStatTabs: 'Workspace tabs',
  entSampleNote:
    'The workspace ships with no data in it. Load the sample portfolio from inside it if you want to see a full board before you type anything real.',
  entFindT: 'Find what every company can win',
  entFindL: (n, j) =>
    `One search across ${n} programmes in ${j} jurisdictions, run for the whole portfolio rather than one company at a time.`,
  entApplyT: 'Get the application most of the way written',
  entApplyL:
    'The workspace fills what a register and a stored profile can fill, and then names — field by field — what only a human can write.',
  entTrackT: 'Every application, and where it stands',
  entTrackL:
    'An entry is created the moment an opportunity enters the pipeline — reference, requested amount, document checklist and all — so the log has no holes where the busy weeks were.',
  entReportT: 'The part after the award, and the board pack',
  entReportL:
    'Milestones, reports and deliverables with their own dates; awarded to date, open pipeline, hit rate and funnel — with a standing list of what the numbers exclude.',
  entExtrasH2: 'The parts nobody demos, which decide whether it gets used',
  entSeatsT: 'Seats and visibility',
  /* "with EU data residency on the hosted plan" used to sit in this sentence.
     wrangler.jsonc's D1 binding carries no jurisdiction and no location hint,
     and the R2 vault is commented out entirely, so nothing pins customer state
     to the EU — the clause was selling a config line that does not exist. It is
     removed rather than softened, in the same voice as the sentence that
     follows it: the honest form of a thing we have not built is silence or an
     explicit "not yet", never an implication. */
  entSeatsB: "One workspace per company, shared by whoever you give the link to. Per-person permissions are not built yet, so this page does not sell them, and storage is not pinned to an EU region yet either.",
  entDataT: 'Data out, not just in',
  entDataB: 'Everything in the workspace exports to CSV, and every deadline exports as .ics. Nothing is locked inside it.',
  entImportT: 'Bring a spreadsheet',
  entImportB:
    'Import a portfolio as CSV. Columns we do not recognise are reported, never guessed at — a mis-mapped column that silently becomes the headcount is the bug you find in month three.',
  entOnboardT: 'Onboarding that is not a PDF',
  entOnboardB:
    'We load your portfolio with you and hand back a ranked plan per company. If the answer is that we have thin coverage in your jurisdictions, you hear that in week one.',
  entCoverageT: 'Honest coverage',
  entCoverageB: (j, o) =>
    `Coverage is uneven and published: ${j} jurisdictions, ${o} calls open today, and every record dated with when a human last read it.`,
  entWebT: 'Web, on purpose',
  entWebB:
    'A board with forty companies and six columns is not a phone screen. The mobile app is for individuals checking what they personally qualify for — different job, different device.',
  entWontT: 'What we will not do, and why it is on this page.',
  entWontB:
    'We do not take a percentage of what you win, we do not sign in to a funder\'s portal as you, and we do not write the innovation claim. The first is a middleman fee dressed as alignment; the second is impersonation; the third is a false declaration with your name on it. Every grant tool that promises the third one is promising something the applicant carries the liability for.',
  entFinalH2: 'Open it against your own portfolio.',
  entFinalLede: 'Nothing to install, nothing to sign, nothing sent anywhere.',
  entApiDocs: 'API docs',
  entWhatItDoes: 'What it does',
  entTalkToUs: 'Talk to us',
  entPriceEyebrow: 'Enterprise · from €80 per seat / month',
  entPriceH2a: 'Grant work stops being scattered.',
  entPriceH2b: 'It becomes a system.',
  entPriceLede:
    'For accelerators, funds, universities, chambers and public bodies running many applicants at once. One place to find what they qualify for, write the applications, track every submission, keep the funder relationships warm, and prove where the money went.',
  entPriceNote:
    '€800 per seat per year if you pay annually. Web only — a pipeline board with forty companies is not a phone screen.',
  entSeatWhyT: 'Why this is priced per seat and the other plans are not.',
  entSeatWhyB:
    'A founder checking one company is a search, and it costs us the same whether they run it once or fifty times. An accelerator is people: each analyst has their own pipeline, their own funder conversations and their own deadlines to miss. The work scales with the number of people doing it, so the price does too.',
  entQuickT: 'Up and running in days',
  entQuickB: 'No implementation fee and no scoping call. Import your companies, invite the team, start matching.',
  entToolsT: 'Fits your existing tools',
  entToolsB: 'Deadlines to your calendar as an .ics file, records to your spreadsheet as CSV.',
  entBoardT: 'Accountable to a board',
  entBoardB: 'Every number in a report is traceable to the programme record and the funder\'s own page it was read from.',
  ctryEyebrow: 'Coverage',
  ctryH1n: (c, n) => `${c} countries, ${n} programmes`,
  ctryLede2: 'Coverage is deliberately uneven — we went deep on national schemes everywhere and added regional and city schemes where they matter most. The counts below are live from the dataset.',
  ctryCategories: 'categories',
  ctryNotHereT: 'Country not here?',
  ctryNotHereB: 'The engine and the schema are country-agnostic — adding one is a data job, not a code job. Open an issue and say which one.',
  whoFor: 'Who is this for?',
  audLabelStudents: 'Students & under-30s',
  audLabelParents: 'Parents at home',
  audLabelFreelancers: 'Freelancers & self-employed',
  audLabelRenters: 'Renters',
  audIndexCount: (n, c) => `${n} programmes across ${c} countries. Pick your country to see the list that applies to you.`,
  audTitleSuffix: 'what you can claim',
  acctCrumb: 'Sign in',
  acctH1a: 'No password.',
  acctH1b: 'Just your email.',
  acctLede2: 'We send a six-digit code. It works once, expires in ten minutes, and there is nothing for anyone to steal or for you to forget.',
  ctaCheckCompany: 'Check what my company is owed',
  navProgrammes: 'Programmes',
  audTabMe: 'For me',
  audTabBiz: 'For my company',
  homeEntEyebrow: (n, j) => `${n} funding programmes for companies across ${j} jurisdictions`,
  homeEntH1: 'Your company is leaving grant money on the table.',
  homeEntLede: 'Match a whole portfolio against every open programme, track every application in one pipeline, and let the workspace fill the forms.',
  audAria: 'Who is this for',
  acctPanelMe: "A personal account keeps your answers and your unlocked programmes on every device you sign in from. The document list is a checklist of labels and dates — we do not hold your files, and there is nowhere here to upload one.",
  acctPanelBiz: "A business account adds the workspace: companies, projects, a shared document checklist, application tracking, deadline export and reports for your whole team.",
  acctYourEmail: 'Your email',
  acctDiffEmail: 'Use a different email',
  acctSignedIn: 'Signed in',
  acctSubYear: "Subscribe — €50 a year",
  acctSubMonth: "or €7 a month",
  acctSubNote: "Cancel any time. Business plans, billed per seat, are on the pricing page.",
  acctManage: "Manage billing",
  acctPaidT: "Payment received.",
  acctPaidB: "Your plan is active. If the programmes still look locked, give the confirmation from Stripe a few seconds and reload.",
  acctActive: "active. Every programme you match is unlocked.",
  acctFreeAcct: "Free account. You can see your total; unlock to see which programmes it comes from.",
  priceSeatNote: "Billed per seat. Add or remove seats at checkout and on any renewal.",
  unlockYear: "Unlock — €50 a year",
  unlockAll: "See all plans",
  unlockOrMonth: "Or €7 a month on the pricing page. Cancel any time.",
  acctPastDue: "the last payment failed. Update your card to keep your programmes unlocked.",
  acctLapsed: "ended. Your saved work is still here; resubscribe to see programme names again.",
  acctAdminLine: "Operator session — everything is unlocked.",
  acctGranted: "unlocked for you by Unclaimed Grants. There is nothing to pay and nothing to manage.",
  acctFreeHere: "Free where you are. Your country regulates this as advice, so we do not charge for it.",
  acctConfirming: "Confirming your payment…",
  planPersonalMonthly: "Personal, monthly",
  planPersonalAnnual: "Personal, annual",
  planBusinessMonthly: "Business, monthly",
  planBusinessAnnual: "Business, annual",
  planEnterprise: "Enterprise",
  planNone: "Your subscription",
  navSignIn: "Sign in",
  navMyAccount: "My account",
  navUpgrade: "Upgrade",
  navAccount: "Account & plan",
  navAutoApply: "Auto-apply by country",
  acctGoCheck: 'Go to my check',
  acctNoJs2: '<strong>Sign-in needs JavaScript.</strong> The code is exchanged for a session without leaving this page, and that cannot be done with a plain form post. Everything else on this site works without it.',
  entP11: () => `<strong>Portfolio matching.</strong> Every company against every programme, ranked by amount × published award rate × whether a company that size could realistically deliver it.`,
  entP12: (n) => `<strong>${n} open today</strong>, and the closed ones are kept rather than hidden — next year's applications come from this year's closed calls.`,
  entP13: '<strong>Saved searches</strong> by sector, stage and geography, re-run against the current dataset every time you open the workspace.',
  entP14: '<strong>Your own calls too.</strong> A regional fund or an internal budget line goes in through grant entry and behaves exactly like a programme we ship.',
  entP21: '<strong>Auto-fill with provenance.</strong> Every filled field shows where it came from, so a reviewer can check it rather than trust it.',
  entP22: '<strong>The seven narrative answers</strong> most applications want, written once per company and reused across every pack.',
  entP23: '<strong>A document checklist per application</strong>, built from what that funder actually asks for. Record a document once and it ticks itself off on every application that wants it.',
  entP24: '<strong>A readiness score against the funder\'s published criteria</strong>, with every component shown. Not a probability of winning — nobody can compute that, and a number that looked like one would get planned around.',
  entP25: '<strong>Issues flagged before you draft</strong>: a ceiling breach, a missing mandatory document, an expired one, a co-funding gap you have not confirmed, a deadline you are two weeks from with nothing written.',
  entP26: '<strong>A downloadable pack</strong> per opportunity. We never sign in as you and never press submit — a funding declaration is sworn by the person making it.',
  entP31: '<strong>An applications tab</strong> listing every grant applied for: who owns it, when it went, for how much, what came back, and what is still outstanding.',
  entP32: '<strong>A pipeline board</strong> your programme manager is currently keeping in a spreadsheet, with drag-and-drop and a keyboard path that does the same job.',
  entP33: '<strong>Projects</strong>, because funders fund a project and the same project goes to several calls — so "how much have we raised for this" is a number, not an addition.',
  entP34: '<strong>Deadline watch</strong> across the portfolio, exportable as .ics so the reminder lands where the team already looks.',
  entP35: '<strong>Reopen tracking</strong> on closed calls, because the round you were not watching is the one you miss.',
  entP41: '<strong>Hit rate on decided applications only.</strong> Counting undecided bids as losses flatters or damns a team at random.',
  entP42: '<strong>Instruments are never added together.</strong> Cloud credits do not join a grant total anywhere on this site.',
  entP43: '<strong>Unpriced programmes count as zero</strong> and the count is shown, so nobody reads the pipeline as the ceiling.',
  /* This said "CSV and API out" while entDataB2, on the same page, said "There
     is no outbound API and no webhook layer yet". Both cannot be true, and the
     true one is the second: worker/index.js exposes no export endpoint, and the
     only ways out are the client-side CSV and .ics in src/pwa/dashboard.js. A
     page that contradicts itself teaches the reader to discount both halves. */
  entP44: '<strong>CSV out</strong>, so the numbers land in the CRM or the board pack rather than in another tab.',
  entP45: '<strong>Post-award obligations tracked</strong> — late reporting is the usual reason a paid grant is clawed back, because the money arrived and nobody is chasing it.',
  entP46: '<strong>A de minimis ledger</strong> per company per member state on a rolling three-year window, fed automatically when an award is recorded, with the declaration text ready to paste.',
  entDataB2: "Everything in the workspace exports to CSV, and every deadline exports as .ics. There is no outbound API and no webhook layer yet — when there is, it will be documented at /api/ before it is sold.",
  entSeeApi: 'See the API',

  /* -- privacy ---------------------------------------------------------- */
  privH1: `What we know about you, which is almost nothing.`,
  privUpdated: `Last updated 14 August 2026.`,
  privShortT: `The short version.`,
  privShortB: "The eligibility check runs on your device. Your answers are not sent to us and we cannot see them. If you create an account we store your email address. The document checklist holds labels and dates only — there is no upload anywhere in this product, and we hold none of your files.",
  privSecs: [
    [`The free check`, `When you answer the questions, the matching happens in your browser or in the app, against data already downloaded to your device. Your country, age, income band, household and housing answers are stored on your device only. They are never transmitted to us. You can erase them at any time from Settings, and clearing your browser data or uninstalling the app removes them completely.`],
    [`If you create an account`, `We store your email address, to sign you in and to send the code. We do not use passwords. If you subscribe, our payment processor (Stripe) holds your card details — we never see or store them. We keep a record of your subscription status so we know what to show you.`],
    [`The document checklist`, `This is a checklist, not a vault. It records the NAME of a document you have gathered — "proof of income" — and the date, so a later claim that wants the same paper can tick it off for you. There is no file input anywhere in this product: your documents never leave your own machine, because we never ask for them. Encrypted client-side storage is designed (see packages/vault) and not shipped; when it is, this section will describe it and not before.`],
    [`What we do not collect`, `No advertising identifiers. No location. No contacts, photos or messages. No cross-site tracking, and no third-party analytics or advertising SDKs in the app. We do not sell or share personal data with anyone, and there is no category of data we would sell.`],
    [`Notifications`, `Deadline reminders are scheduled locally on your device. There is no push server and no message about you leaves your phone.`],
    [`Your rights`, `Under the GDPR and equivalent laws you can ask for a copy of your data, correct it, or have it deleted. Account deletion is available in the app and on the web and removes your email, subscription record and all stored documents. Write to <a class="link-underline" href="mailto:privacy@unclaimedgrant.com">privacy@unclaimedgrant.com</a> and we will respond within 30 days.`],
    [`Children`, `The service is not directed at children under 13 and we do not knowingly collect their data.`],
    [`Changes`, `If this policy changes materially we will say so on this page and, for account holders, by email. The date at the top always reflects the current version.`],
  ],

  /* -- methodology ------------------------------------------------------ */
  methEyebrow: `Trust`,
  methH1: `How we know what we say we know`,
  methLede: `Everything on this site is checkable. This page tells you exactly how the data was built, what the confidence levels mean, and — importantly — what is still wrong with it.`,
  methSrcH: `Sourcing`,
  methSrcP1: `Every record is a real, currently-running programme published by a government, public body or well-known institution. Each one carries an official <code>source_url</code> on the funder's own domain and, where we quoted it, a verbatim <code>source_snippet</code> from that page.`,
  methSrcP2: `Rules we hold ourselves to, and which you can check us against:`,
  methVerH: `The two verification states`,
  /* Said once, here, because it is a fact about the catalogue and not about any
     one programme. */
  methCorpusDate: (d) => `Every record carries the same date: the whole catalogue was last re-extracted on ${d}. Individual programmes are not re-checked on their own schedule yet, so no programme page claims a date of its own.`,
  methVerVerified: `A researcher opened the official page and confirmed the rule, amount and link.`,
  methVerAuto: `Extracted from an official source during curation, but not re-read by a person since. Treat it as a strong lead, not a guarantee.`,
  methVerRecords: `records`,
  methMatH: `How matching works`,
  methMatP1: `Your answers are evaluated against nine published rule types: geography, work or life status, student status, age, household income, dependent children, residency status, length of residence, and housing tenure. Each programme lands in one of three buckets:`,
  methMatP2: `A record with no published restriction on a given attribute passes that attribute. This is deliberate: it is better to surface a programme you might not get than to silently hide one you would.`,
  methMoneyH: `What the big number means (and does not)`,
  methMoneyP: `The headline figure is the sum of published annualised maximums for programmes in your <em>eligible</em> bucket only. Monthly amounts are multiplied by twelve; one-off amounts are counted once.`,
  methPrivH: `Privacy`,
  methPrivP: `The eligibility check runs entirely in your browser. Your answers are never transmitted anywhere — there is no server to transmit them to. This site is static files. If you use the "copy link" feature, your answers are encoded in the URL you choose to share, and nowhere else. There are no accounts, no cookies for tracking, and no analytics that identify you.`,
  methLimH: `Known limitations`,
  methLimP: `The honest list. If any of this changes, this section changes with it.`,
  methLim1: `<strong>Income bands are approximations.</strong> Band thresholds are fractions of estimated median household income per country, not official poverty lines. Enter an exact income when the wizard offers it and matching gets sharper.`,
  methLim5: `<strong>Regional coverage is uneven.</strong> National schemes are well covered everywhere; city-level schemes are covered for major cities only.`,
  methLim6: `<strong>Not legal or financial advice.</strong> We describe published criteria. Only the named authority can decide your case.`,
  methCorrH: `Corrections`,
  methCorrP: `Every programme page has a "report it" link that opens a public GitHub issue with the programme and page pre-filled. Public tracker, public fix history — no feedback form that disappears into nothing.`,
  methOpenH: `The data is yours`,
  methOpenP1: `The full dataset is open.`,
  methOpenApi: `Use the JSON API or plug it into an AI assistant over MCP`,
  methOpenP2: `or take the whole repository from`,
  methSrcL: [
    `No invented URLs. If we could not find the exact deep link, we link the official landing page.`,
    `No guessed amounts. If the amount depends on your circumstances, the fields are left empty and a note explains why — we never fabricate a plausible-looking figure.`,
    `No ended programmes. Schemes that closed were deliberately excluded during curation.`,
    `Every record is dated. <code>last_verified_at</code> is when a human last looked.`,
  ],
  methMatL: [
    `<strong>Eligible</strong> — you pass every rule the record publishes.`,
    `<strong>Needs one more answer</strong> — you pass everything we can test, but one rule needs a detail you have not given. We show you the exact question.`,
    `<strong>Not eligible</strong> — you fail at least one rule, and we name it in plain language.`,
  ],
  methMoneyL: [
    `It is an <strong>upper bound of published ceilings</strong>, not a prediction of your payment. Most means-tested schemes taper — you get the maximum only at the bottom of the income range.`,
    `Programmes with no published amount contribute <strong>zero</strong>. Your real entitlement is almost certainly higher than the number shown, not lower.`,
    `Loan and credit-facility ceilings are <strong>excluded</strong> from the headline and reported separately, because borrowing capacity is not income.`,
  ],
  methVerP: (n, c) => `We show the difference on every card rather than flattening both into one confident-looking badge. A site that claims uniform accuracy across ${n} programmes in ${c} countries is lying to you.`,
  methLim2: (a, b) => `<strong>${a} of ${b} records have no published amount.</strong> They are real programmes; the amount simply depends on circumstances the official body calculates.`,
  methLim3: (n) => `<strong>${n} records are not human-verified.</strong> Rules may have moved since curation.`,
  methLim4: (d) => `<strong>Snapshot, not a live feed.</strong> The data is a curated snapshot dated ${d}. There is no scraper re-checking these pages daily.`,

  /* A9 — the price a button shows is derived from the plan key it buys.

     /account/ hardcoded "Subscribe — €50 a year" and then rewrote only
     dataset.plan, so a business account's button read €50 and sent the buyer
     to a €490 checkout: a 9.8x gap between the label and the charge. A label
     that lives next to the plan key cannot disagree with it. These must match
     what /pricing/ prints for the same key. */
  planPrice: {
    personal_annual: '€50 a year',
    personal_monthly: '€7 a month',
    business_monthly: '€49 a seat a month',
    business_annual: '€490 a seat a year',
  },
  subscribeCta: (price) => `Subscribe — ${price}`,
  orAlt: (price) => `or ${price}`,
  /* Rendered server-side, before /api/me has said which account this is.
     Neutral on purpose: a price shown before we know the plan is a guess. */
  planNeutralCta: 'Choose a plan',
  /* A11 — said out loud instead of implied by a 2px outline, which is the
     same device as :focus-visible and reads as a focus ring. */
  priceMostPick: 'Most people pick this',
  /* A20(d) — the enterprise cards borrowed their eyebrows from other keys:
     one said "PRICING" above "Get the application most of the way written",
     two repeated their own heading verbatim, and one took the first word of
     its title, which in another language is an article. */
  entEyeFind: 'Discovery',
  entEyeApply: 'Drafting',
  entEyeTrack: 'Pipeline',
  entEyeReport: 'Reporting',
  /* A18(b) — "Could not send the code." named neither the cause nor the way
     out, and was drawn as ordinary prose in --ink-3. */
  authSendFail: "We couldn't send the code — the sign-in service didn't answer. Try again in a moment, or email hello@unclaimedgrant.com.",
  /* A21(a) — /browse/ was a 404 sitting above ten live category directories,
     with a breadcrumb inviting the reader to trim the URL to it. */
  browseAll: 'All categories',
  browseAllLede: "Every support programme in the dataset, grouped by what it is for. Pick a category to see it across all countries.",

  /* A22 — the wizard's own strings, keyed by the exact English literal.

     /fr/check/ served <html lang="fr"> with a fully French shell and an
     entirely English wizard: every question, option, hint and bucket heading,
     in six locales, because src/app.js has no translator and every locale's
     page loads the same /app.js. check-i18n.mjs never saw it — the strings
     are injected client-side, after the file it reads was written.

     Keyed by the English source string rather than by invented key names, so
     the wizard can call T('Where do you live?') with the literal it already
     has and fall back to it when the key is absent. English therefore needs
     no entries at all: the fallback IS the English copy. */
  wizard: {},
};
