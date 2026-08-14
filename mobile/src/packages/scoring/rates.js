/**
 * UNCLAIMED — published award rates.
 *
 * Funder-published figures only. Where a funder publishes nothing the record
 * is kept with p: null and a note on what they DO publish, because knowing a
 * rate is unpublished is itself useful — it is the difference between an
 * estimate we labelled and a number we invented.
 *
 * A JS module rather than JSON so it loads identically in Node, the browser,
 * a Worker and React Native without import assertions.
 *
 * Generated 2026-08-14. Regenerate by re-running the rate research.
 */

export const RATE_DATA = Object.freeze({
 "generated_at": "2026-08-14",
 "note": "Award likelihoods from funder-published figures only. Nulls are programmes where no official rate exists; they are never replaced with a guess.",
 "rates": [
  {
   "slug": "eic-accelerator",
   "p": 0.0586,
   "confidence": "derived",
   "stage": "post_filter",
   "period": "2024 October cut-off (results Feb 2025)",
   "basis": "FULL-application success rate. 1,211 full proposals submitted at the October 2024 cut-off, 431 invited to jury interview, 71 selected for funding. 71/1211 = 5.9%. Note this is the rate on full proposals only; applicants must first pass a separate short-proposal stage, so the end-to-end rate from short proposal is lower. The Commission's own 2025 Horizon Europe interim evaluation separately states EIC success rates were 'approximately 5% in 2024'.",
   "source_url": "https://eic.ec.europa.eu/news/eic-accelerator-71-companies-selected-most-competitive-funding-round-so-far-2025-02-17_en"
  },
  {
   "slug": "eic-pathfinder-open",
   "p": 0.0211,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2025",
   "basis": "Single-stage call, so this IS the end-to-end rate. 2,087 proposals submitted to the EIC Pathfinder Open 2025 call; 44 projects selected for funding (announced 23 Oct 2025). 44/2087 = 2.1%.",
   "source_url": "https://eic.ec.europa.eu/news/eic-pathfinder-open-2025-call-draws-record-interest-research-community-2025-05-23_en"
  },
  {
   "slug": "eic-pathfinder-challenges",
   "p": 0.0773,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2024 call, results March 2025",
   "basis": "Single-stage call; rate computed on ELIGIBLE proposals only (ineligible submissions already excluded, which flatters the rate slightly). 401 eligible proposals, 31 projects funded. 31/401 = 7.7%. The following (2025) Challenges round funded 30 projects with EUR 118m.",
   "source_url": "https://eic.ec.europa.eu/news/eic-pathfinder-challenges-eu116-million-awarded-pioneering-research-projects-2025-03-27_en"
  },
  {
   "slug": "eic-transition",
   "p": 0.0655,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2025 call, results February 2026",
   "basis": "Single-stage call, end-to-end rate. 611 submissions, 40 projects selected. 40/611 = 6.5%. A further 228 proposals were awarded a Seal of Excellence (above threshold but unfunded), so the quality-threshold pass rate is far higher (~44%) than the funded rate — do not confuse the two.",
   "source_url": "https://eic.ec.europa.eu/news/eic-selects-40-new-transition-projects-bring-research-results-closer-market-2026-02-09_en"
  },
  {
   "slug": "eic-pre-accelerator",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "2025",
   "basis": "EIC published the submission count for the first-ever Pre-Accelerator call (1,056 submissions from 30 eligible countries) but had not published the number selected at time of research; evaluation results were due late Feb / early March 2026. Denominator known, numerator not.",
   "source_url": "https://eic.ec.europa.eu/news/high-interest-first-eic-pre-accelerator-call-underscores-relevance-new-instrument-2025-11-25_en"
  },
  {
   "slug": "eurostars-3",
   "p": 0.2,
   "confidence": "published",
   "stage": "end_to_end",
   "period": "Eurostars-3 (2021-2027), programme-level",
   "basis": "Programme-published headline rate, stated by Eureka in the official Eurostars FAQ. Measured on submitted applications (single-stage), i.e. end-to-end. Approximate figure, not a per-call count.",
   "source_url": "https://www.eurekanetwork.org/programme-resources/eurostars-frequently-asked-questions/"
  },
  {
   "slug": "horizon-europe-collaborative-calls",
   "p": 0.16,
   "confidence": "published",
   "stage": "unstated",
   "period": "2021-2024",
   "basis": "Programme-wide figure published by the European Commission in the Horizon Europe interim evaluation (COM(2025) 189 final). Covers all applications across the programme, not any single collaborative call; individual cluster/topic calls vary widely around it. The same document notes nearly 7 in 10 above-threshold proposals went unfunded for budget reasons.",
   "source_url": "https://research-and-innovation.ec.europa.eu/document/download/1a80e2e1-df28-4f1a-8a52-a0e1b47a1860_en"
  },
  {
   "slug": "us-sbir",
   "p": 0.168,
   "confidence": "derived",
   "stage": "unstated",
   "period": "FY2022",
   "basis": "PHASE I selection rate, aggregated across the five largest SBIR agencies in SBA's FY2022 SBIR/STTR Annual Report to Congress: DoD 1,172/6,444, HHS 654/4,121, NSF 245/2,259, DOE 376/1,925, NASA 278/1,433 = 2,725 awards on 16,182 proposals = 16.8%. Phase II rates are much higher because only prior Phase I awardees may apply. SBA cautions the rate is an estimate because FY22 awards drew on FY21 and FY22 proposals.",
   "source_url": "https://www.sbir.gov/sites/default/files/SBA_FY22_SBIR_STTR_Annual_Report.pdf"
  },
  {
   "slug": "us-sttr",
   "p": 0.226,
   "confidence": "derived",
   "stage": "unstated",
   "period": "FY2022",
   "basis": "PHASE I selection rate, aggregated across the five largest STTR agencies in SBA's FY2022 Annual Report: DoD 520/2,093, HHS 214/1,163, NSF 79/322, DOE 66/416, NASA 53/137 = 932 awards on 4,131 proposals = 22.6%. STTR is consistently easier than SBIR because far fewer firms can meet the research-institution partnering requirement.",
   "source_url": "https://www.sbir.gov/sites/default/files/SBA_FY22_SBIR_STTR_Annual_Report.pdf"
  },
  {
   "slug": "us-dow-sbir-sttr",
   "p": 0.18,
   "confidence": "published",
   "stage": "unstated",
   "period": "FY2022",
   "basis": "SBIR Phase I selection rate published by SBA for DoD (now Department of War) in the FY2022 Annual Report: 6,444 proposals received, 1,172 awards, 18%. DoD STTR Phase I was 520/2,093 = 25%. Component-level rates (Army, Navy, AF, DARPA) differ substantially from this department average.",
   "source_url": "https://www.sbir.gov/sites/default/files/SBA_FY22_SBIR_STTR_Annual_Report.pdf"
  },
  {
   "slug": "us-nih-sbir-sttr",
   "p": 0.16,
   "confidence": "published",
   "stage": "unstated",
   "period": "FY2022",
   "basis": "SBIR Phase I selection rate published by SBA for HHS (of which NIH is the dominant component) in FY2022: 4,121 proposals, 654 awards, 16%. HHS STTR Phase I was 214/1,163 = 18%. NIH counts resubmissions (A1) as new applications, so a single project idea can consume two or three attempts at this rate.",
   "source_url": "https://www.sbir.gov/sites/default/files/SBA_FY22_SBIR_STTR_Annual_Report.pdf"
  },
  {
   "slug": "us-nsf-americas-seed-fund",
   "p": 0.11,
   "confidence": "published",
   "stage": "post_filter",
   "period": "FY2022 / historical",
   "basis": "SBIR Phase I selection rate published by SBA for NSF in FY2022: 2,259 proposals, 245 awards, 11%. NSF itself publishes a range: 'Historical Phase I funding rates for NSF SBIR/STTR Phase I proposal have been between 10% and 20%'. IMPORTANT: this is the rate on FULL PROPOSALS, which are by invitation only after a Project Pitch screen — the end-to-end rate from Project Pitch is materially lower, and NSF does not publish the pitch invitation rate.",
   "source_url": "https://seedfund.nsf.gov/apply/review-decision/"
  },
  {
   "slug": "us-nasa-sbir-sttr",
   "p": 0.19,
   "confidence": "published",
   "stage": "unstated",
   "period": "FY2022",
   "basis": "SBIR Phase I selection rate published by SBA for NASA in FY2022: 1,433 proposals, 278 awards, 19%. NASA STTR Phase I was 53/137 = 39%, the highest of any major agency and a genuine outlier worth surfacing to applicants.",
   "source_url": "https://www.sbir.gov/sites/default/files/SBA_FY22_SBIR_STTR_Annual_Report.pdf"
  },
  {
   "slug": "de-exist-gruendungsstipendium",
   "p": 0.549,
   "confidence": "published",
   "stage": "unstated",
   "period": "2007-2025 cumulative (Monitoringbericht Nr. 5)",
   "basis": "Programme-published cumulative approval rate (Foerderquote) since 2007: 6,070 applications, 3,331 approved, ~55%. CAUTION: this is the rate AFTER a first-stage filter — EXIST applications are submitted through a host university/research institution which pre-screens and endorses teams, so the population reaching the formal application stage is already selected. The unfiltered rate for a founder first approaching a university is unpublished and much lower.",
   "source_url": "https://exist.de/wp-content/uploads/2026/02/EGS_Monitoringbericht_2025.pdf"
  },
  {
   "slug": "de-exist-forschungstransfer",
   "p": 0.278,
   "confidence": "published",
   "stage": "post_endorsement",
   "period": "cumulative to 2025 (Monitoringbericht Nr. 3)",
   "basis": "Programme-published cumulative approval rate for EXIST-Forschungstransfer Phase I: 2,280 applications, 634 projects approved, 27.8%. Same caveat as the Gruendungsstipendium — applications are institutionally endorsed before submission, so this is a post-filter rate.",
   "source_url": "https://exist.de/wp-content/uploads/2026/04/EFT_Monitoringbericht_2025_Nr.3.pdf"
  },
  {
   "slug": "fr-concours-i-lab",
   "p": 0.131,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2024/2025 edition",
   "basis": "Single-stage competition, end-to-end rate. 473 candidatures received, 62 lauréats selected in the 2024/2025 edition (27th i-Lab). 62/473 = 13.1%. Published jointly by MESR and Bpifrance.",
   "source_url": "https://www.enseignementsup-recherche.gouv.fr/fr/france-2030-147-laureats-recompenses-lors-de-la-ceremonie-20242025-des-concours-d-innovation-de-l-100154"
  },
  {
   "slug": "fr-concours-i-nov",
   "p": 0.282,
   "confidence": "derived",
   "stage": "unstated",
   "period": "i-Nov vague 11",
   "basis": "Single wave (vague 11) of i-Nov: 149 candidatures received, 42 lauréats. 42/149 = 28.2%. Rates vary by wave and by thematic vertical; earlier waves (e.g. wave 7 with 73 lauréats) had different denominators. Use as an order-of-magnitude figure, not a constant.",
   "source_url": "https://presse.bpifrance.fr/france-2030-annonce-des-42-laureats-de-la-11eme-vague-du-concours-dinnovation-i-nov/?lang=fra"
  },
  {
   "slug": "es-cdti-neotec",
   "p": 0.2,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2015-2025 cumulative",
   "basis": "Derived from CDTI's own cumulative statement: since 2015 NEOTEC has financed 'more than a thousand' business projects from 'more than 5,000' proposals received, i.e. roughly 20%. Single-stage. The 2025 call funded 130 SMEs with EUR 40m; CDTI did not publish the 2025 application count in its results release, so the per-call rate for 2025 is unknown.",
   "source_url": "https://www.cdti.es/noticias/cdti-innovacion-resolucion-convocatoria-neotec-2025-pymes-innovadoras"
  },
  {
   "slug": "se-vinnova-innovativa-startups",
   "p": 0.1,
   "confidence": "derived",
   "stage": "end_to_end",
   "period": "2025",
   "basis": "Vinnova reported receiving 'over 1000' applications and supporting 103 newly started companies in the 2025 Innovativa Startups round. 103/1000+ ≈ 10% (upper bound, since the denominator is stated as a floor). Single-stage.",
   "source_url": "https://www.vinnova.se/nyheter/2025/10/50-miljoner-till-innovativa-startups"
  },
  {
   "slug": "kr-k-startup-grand-challenge",
   "p": 0.0305,
   "confidence": "published",
   "stage": "unstated",
   "period": "2025",
   "basis": "Programme-published competition ratio. 2,626 applications for 80 finalist slots in the 2025 edition, stated by the organisers as a 32.8:1 competition rate = 3.05%. This is the rate to enter the accelerator cohort, not the rate of receiving the larger follow-on settlement funding.",
   "source_url": "https://www.newswire.com/news/record-2-626-global-startups-apply-to-k-startup-grand-challenge-2025-22604700"
  },
  {
   "slug": "hello-tomorrow-global-challenge",
   "p": 0.016,
   "confidence": "derived",
   "stage": "unstated",
   "period": "recent edition",
   "basis": "Organiser's own headline: over 5,000 applications reduced to 80 finalists, ~1.6%. This is the rate of reaching the FINALIST stage, not of winning a prize — only a handful of the 80 finalists receive cash. The winner-level rate is roughly an order of magnitude lower.",
   "source_url": "https://hello-tomorrow.org/from-over-5000-applications-to-80-finalists/"
  },
  {
   "slug": "techstars-accelerator",
   "p": 0.01,
   "confidence": "published",
   "stage": "unstated",
   "period": "programme-level, undated",
   "basis": "Techstars states on its own site that accepted founders are in a group of 'less than 1% who applied and were accepted'. Recorded as an upper bound of 1%. Techstars does not publish per-programme application counts, and rates differ a lot between flagship city programmes and corporate-partnered ones.",
   "source_url": "https://www.techstars.com/blog/pov/is-techstars-really-worth-it"
  },
  {
   "slug": "y-combinator",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "YC does not publish an acceptance rate or application count. Its FAQ acknowledges high application volume without numbers ('due to the volume of applications we have to process'). Batch sizes are observable (roughly 150-250 companies) but the denominator is not official. Widely quoted 1-1.5% figures come from press and forum commentary, not YC.",
   "source_url": "https://www.ycombinator.com/faq"
  },
  {
   "slug": "microsoft-for-startups-founders-hub",
   "p": 1,
   "confidence": "published",
   "stage": "eligibility",
   "period": "from July 2025 programme changes",
   "basis": "SELF-SERVE / eligibility-based for the entry tier: the USD 1,000 Azure startup credit is granted on signup to any new Azure customer meeting stated criteria, with a further USD 4,000 released after business verification. Effectively 100% for eligible applicants. NOTE: the large USD 100,000+ tier is NOT self-serve — it requires a referral code from an affiliated investor, and no acceptance rate is published for that path.",
   "source_url": "https://learn.microsoft.com/en-us/startups/changes-microsoft-for-startups"
  },
  {
   "slug": "nvidia-inception",
   "p": null,
   "confidence": "absent",
   "stage": "eligibility",
   "period": "current",
   "basis": "Eligibility-based rather than competitive, but no acceptance rate is published. NVIDIA states there are no fees, deadlines or cohorts and lists objective membership requirements (at least one developer, working website, incorporated, under 10 years old) plus explicit exclusions (consultancies, crypto, cloud providers, resellers, public companies). Treat as high-probability-on-eligibility, but the funder never quantifies it.",
   "source_url": "https://www.nvidia.com/en-us/startups/"
  },
  {
   "slug": "aws-activate",
   "p": null,
   "confidence": "absent",
   "stage": "eligibility",
   "period": "current",
   "basis": "AWS publishes eligibility criteria (pre-Series B, founded in last 10 years, AWS account on a paid tier plan, new to Activate credits or requesting more than previously received) and a 5-10 business day review window, but does NOT state that approval is automatic and publishes no approval rate. Do not assume 100%: the review step is explicit.",
   "source_url": "https://aws.amazon.com/startups/credits"
  },
  {
   "slug": "google-for-startups-accelerator",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Google publishes cohort compositions (typically 10-20 startups per regional cohort) in blog announcements but never the number of applications received, so no rate can be computed from official sources.",
   "source_url": "https://startup.google.com/programs/accelerator/"
  },
  {
   "slug": "earthshot-prize",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "annual",
   "basis": "Nomination-only, not open application, so a conventional success rate is not meaningful. The Prize publishes the funnel shape (thousands of nominations -> top 150 -> 15 Finalists -> 5 Winners) but not an exact nomination count, so no denominator exists.",
   "source_url": "https://earthshotprize.org/the-prize/how-the-earthshot-prize-works/"
  },
  {
   "slug": "cartier-womens-initiative-regional-awards",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Cartier publishes the number of fellows selected per year (typically 30 across regional awards, 9 per cohort of finalists per region) but does not publish application volumes. Its FAQ references application volume only qualitatively.",
   "source_url": "https://www.cartierwomensinitiative.com/faq"
  },
  {
   "slug": "ie-innovative-hpsu-fund",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "2024",
   "basis": "Enterprise Ireland publishes outcome counts (90 High Potential Start-Ups approved for investment in 2024, EUR 27.6m) in its annual results releases, but never the number of companies that applied or were assessed for HPSU status. Denominator unpublished.",
   "source_url": "https://www.enterprise-ireland.com/en/news/27-6-million-invested-start-ups-in-2024"
  },
  {
   "slug": "ie-hpsu-feasibility-study-grant",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Enterprise Ireland does not publish application or approval counts for the HPSU Feasibility Study Grant. It is a development-adviser-gated support (you must already be engaged with an EI adviser), so any published rate would in any case be a post-filter rate.",
   "source_url": "https://www.enterprise-ireland.com/en/supports/hpsu-feasibility-study-grant"
  },
  {
   "slug": "uk-innovate-uk-smart-grants",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Innovate UK publishes competition briefs and the list of funded projects but does not publish application counts or success rates per Smart Grants round on ukri.org. Figures circulating in the 8-12% range come from grant-writing consultancies and FOI-derived blog posts, not from UKRI, and were deliberately excluded here.",
   "source_url": "https://www.ukri.org/councils/innovate-uk/guidance-for-applicants/guidance-for-specific-funds/smart-innovation-funding-guidance/"
  },
  {
   "slug": "ch-innosuisse-startup-innovation-projects",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Innosuisse publishes the list of approved start-up innovation projects and annual approval counts, but not the number of applications received for this specific instrument, so no rate can be derived. For scale reference from a comparable Innosuisse instrument, the Swiss Accelerator 2023 call received 373 short applications and approved 33 projects (8.8%).",
   "source_url": "https://www.innosuisse.admin.ch/en/approved-start-up-innovation-projects"
  },
  {
   "slug": "ch-innosuisse-innovation-project-implementation-partner",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "No application-versus-approval counts published for this instrument. Innosuisse's annual report gives funding volumes and project counts but not submission counts. A related SME call was reported as receiving 270 submissions with no approval figure released.",
   "source_url": "https://www.innosuisse.admin.ch/de/hohe-nachfrage-270-kmu-projekte-eingereicht"
  },
  {
   "slug": "de-zim",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "BMWK/ZIM publishes an evaluation report and statistics section, but the 2024 ZIM evaluation does not state a headline Bewilligungsquote in accessible form and application-versus-approval counts are not published on zim.de. Programme is rolling and non-competitive in form (assessed against criteria, not ranked against other applicants), which makes a single rate a poor model input anyway.",
   "source_url": "https://www.zim.de/ZIM/Navigation/DE/Infothek/Studien-Statistiken/studien-und-statistiken.html"
  },
  {
   "slug": "in-startup-india-seed-fund-scheme",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "The official SISFS dashboard reports incubators approved and startups supported (e.g. 133 incubators approved with Rs 477.25 crore; 656 startups supported as of an earlier reporting date) but the dashboard is JavaScript-rendered and DPIIT does not publish the number of startup applications received, only those funded. Additionally, selection is delegated to each approved incubator, so a single national rate would be misleading.",
   "source_url": "https://seedfund.startupindia.gov.in/"
  },
  {
   "slug": "kr-tips",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "TIPS awards are gated by a TIPS operator (accredited VC/accelerator) recommending the startup; MSS publishes the number of teams selected per year and the number of operators, but not the number of applicant teams. Any rate would also be post-filter, since only operator-backed teams reach the government evaluation.",
   "source_url": "https://www.jointips.or.kr/"
  },
  {
   "slug": "eit-health-startup-programmes",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "EIT publishes cohort sizes and portfolio counts for its KIC startup programmes but not application counts, and each KIC runs many sub-programmes with different funnels. No official rate exists.",
   "source_url": "https://eithealth.eu/programmes/"
  },
  {
   "slug": "eit-jumpstarter",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "EIT Jumpstarter publishes the number of teams admitted and finalists per edition but not the number of applications, so no rate can be derived from official sources.",
   "source_url": "https://eitjumpstarter.eu/"
  },
  {
   "slug": "uk-seis",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Not a competition. SEIS is a tax relief: any company meeting the statutory conditions qualifies, and HMRC's Advance Assurance is an opinion service rather than a rationed award. HMRC publishes numbers of companies raising funds under SEIS but no 'success rate' concept applies. A ranking model should treat SEIS as eligibility-determined, not competitive.",
   "source_url": "https://www.gov.uk/guidance/seed-enterprise-investment-scheme-background"
  },
  {
   "slug": "uk-eis",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Not a competition, same as SEIS: statutory eligibility test administered by HMRC, no rationed award and therefore no published success rate. HMRC publishes uptake statistics (companies and amounts raised) only.",
   "source_url": "https://www.gov.uk/guidance/venture-capital-schemes-apply-for-the-enterprise-investment-scheme"
  },
  {
   "slug": "us-sba-7a-loan",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Not a competitive award. SBA 7(a) is a loan guarantee delivered through participating lenders; the credit decision sits with the lender, and SBA publishes loan volume rather than an application-to-approval rate. Approval odds are borrower-and-lender specific and cannot be modelled as a programme success rate.",
   "source_url": "https://www.sba.gov/funding-programs/loans/7a-loans"
  },
  {
   "slug": "us-arpa-e",
   "p": null,
   "confidence": "absent",
   "stage": "post_filter",
   "period": "n/a",
   "basis": "ARPA-E runs a two-stage process (Concept Paper, then invited Full Application) and publishes selected project lists per programme, but does not publish concept-paper submission counts per FOA on arpa-e.energy.gov, so neither the first-stage nor end-to-end rate is officially available. Note any rate found elsewhere is likely to be the FULL-APPLICATION rate, which excludes everyone discouraged at concept-paper stage.",
   "source_url": "https://arpa-e.energy.gov/technologies/open-programs"
  },
  {
   "slug": "us-army-xtech",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "xTech publishes per-competition prize structures and the number of finalists/winners per phase (e.g. xTech|Inversion: up to 12 Phase 1 finalists, up to 5 Phase 2 winners) but not the number of submissions per competition, so no denominator is available.",
   "source_url": "https://www.xtech.army.mil/"
  },
  {
   "slug": "fr-french-tech-tremplin",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Mission French Tech publishes lauréat counts per promotion (e.g. 434 selected for the 3rd Prepa edition; 102 lauréats in the 5th Incubation promotion; 224 in an earlier Incubation cohort) but does not consistently publish candidature counts alongside them, so no reliable rate could be derived from official pages.",
   "source_url": "https://lafrenchtech.gouv.fr/en/programme/french-tech-tremplin/"
  },
  {
   "slug": "fr-bourse-french-tech",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Bpifrance does not publish application or approval counts for the Bourse French Tech. It is assessed by regional Bpifrance offices against criteria rather than ranked in a national competition, so a single rate would not be meaningful even if published.",
   "source_url": "https://www.bpifrance.fr/catalogue-offres/bourse-french-tech"
  },
  {
   "slug": "antler-residency",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Antler publishes cohort sizes per residency (e.g. 57 founders in the 15th Australian residency) but not application volumes, and no acceptance rate appears on antler.co. Frequently cited sub-2% figures are press estimates, not company-published.",
   "source_url": "https://www.antler.co/residency"
  },
  {
   "slug": "anthropic-claude-for-startups",
   "p": null,
   "confidence": "absent",
   "stage": "eligibility",
   "period": "n/a",
   "basis": "Credit/partner programme with stated eligibility conditions but no published approval rate and no statement that approval is automatic. Treat as unknown rather than assuming near-certain approval.",
   "source_url": "https://www.anthropic.com/startups"
  },
  {
   "slug": "openai-for-startups",
   "p": null,
   "confidence": "absent",
   "stage": "eligibility",
   "period": "n/a",
   "basis": "No approval rate or application count published; access is partner/investor-referral mediated for the larger credit tiers. Not stated to be automatic on eligibility.",
   "source_url": "https://openai.com/startups/"
  },
  {
   "slug": "openai-grove",
   "p": null,
   "confidence": "absent",
   "stage": "unstated",
   "period": "n/a",
   "basis": "Small cohort-based programme; OpenAI announced cohort size but not application volume, so no rate is available. Cohort-based selection implies a low rate but the funder publishes no number.",
   "source_url": "https://openai.com/grove/"
  }
 ]
});

export default RATE_DATA;
