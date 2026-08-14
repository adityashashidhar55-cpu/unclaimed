# STATUS — Unclaimed

Honest capability read for the static rebuild. Nothing here is marked done if it is
simulated or partially wired. Limitations first.

Build verified: `node src/build.mjs` → 4,108 pages, `node scripts/verify.mjs` → 22/22 checks.

---

## Known limitations

1. **The headline figure is a ceiling, not a prediction.** It sums published annualised
   *maximums* for eligible programmes. Means-tested schemes taper — most people get less than
   the maximum. Programmes with no published amount contribute zero, so a user's real
   entitlement is typically higher than the number shown, not lower.
2. **Circumstance detection is keyword-based.** Programmes gated on disability, caring,
   sickness, a new baby, bereavement or military service are detected from the programme's
   *name* (see `CIRCUMSTANCES` in `src/engine/matcher.js`) and routed to a "only if this is
   you" bucket. This is a heuristic over names, not a data field. It will miss programmes
   whose name doesn't say so, and could in principle over-match. Matching on names only
   (rather than snippets) was chosen deliberately: a false positive hides money the user can
   actually claim, which is the more damaging error. **The correct fix is a real
   `eligibility.circumstances` field in the data spec** — that is a data job, not a code job.
3. **Income bands are approximations.** Band thresholds are fractions of estimated median
   household income per country, not official poverty lines.
4. **1,261 of 2,216 records are not human-verified** (`verification_status: auto_extracted`).
   They were extracted from official sources during curation but not re-read since. Shown
   as "Not human-checked" on every card — never flattened into a uniform confidence.
5. **Snapshot, not a live feed.** Data is dated 2026-08-12. There is no scraper re-checking
   these pages, and no refresh/verification log yet.
6. **Regional coverage is uneven.** National schemes are well covered everywhere; city-level
   schemes only for major cities.
7. **Data bugs from the original brief are NOT fixed.** Part 1 of `unclaimedfullbuildbrief.md`
   (income-rule gaps, missing `procedure_steps`, missing `documents_required`, empty
   `application_url`) required live research per record and was out of scope for this pass.
   Current gaps, measured from the shipped data: see `scripts/verify.mjs` output and
   `/api/v1/stats.json` — 1,749/2,216 have documents, 1,856/2,216 have steps.

## What is real

- **Static generation.** 2,503 pages of real HTML with JSON-LD in the source, built by
  `src/build.mjs` in ~1.7s with zero dependencies. This closes limitation #1 of the previous
  status doc (client-side-only rendering). Crawlers see full content.
- **One engine, one set of numbers.** `src/engine/matcher.js` runs unchanged in Node (build
  time) and the browser (live wizard). The landing page's example figure is computed by the
  same engine at build time. `scripts/verify.mjs` fails the build if the landing page and the
  API disagree on a count.
- **Loan/capital exclusion.** Credit facilities and capital ceilings are detected and excluded
  from the headline total, reported separately. This closes limitation #2 of the previous
  status doc (Mudra-style ceilings inflating the figure).
- **Conditional bucket.** Programmes gated on unmodelled personal circumstances are held out
  of the total unless the user claims the circumstance — see limitation #2 above for the
  caveat on how they're detected.
- **Dataset:** 2,216 curated programmes across 25 countries, each with `source_url`,
  `source_snippet`, `last_verified_at`, `verification_status`. 955 human-verified (43%).
- **Real user-facing outputs:** deduplicated document checklist, `.ics` deadline export,
  URL-encoded shareable results, print/PDF pack, automatic-vs-must-apply split.
- **Machine-readable:** `/api/v1/countries.json`, `/api/v1/programmes/{cc}.json`,
  `/api/v1/stats.json`, `/api/v1/mcp-tools.json`, `/llms.txt`, `/sitemap.xml`, `/robots.txt`.
- **Accessibility:** skip link, visible focus rings, 44px+ touch targets, `prefers-reduced-motion`
  respected, no emoji used as UI icons, semantic headings, `aria-pressed` on option buttons.

## What is stubbed or absent

- **MCP server is not deployed.** Tool schemas ship as data at `/api/v1/mcp-tools.json`;
  no live Streamable HTTP endpoint exists. The matcher is importable into one unchanged.
- **No backend at all.** No accounts, no persistence beyond the URL and browser storage.
  "Report a problem" links to a pre-filled **public GitHub issue** — that is a real
  destination, unlike the previous build's client-side-only confirmation, but it is not a
  managed queue.
- **No "notify me" capture.** Removed rather than faked.
- **Deadline `.ics` events are review reminders, not parsed deadlines.** The dataset stores
  `deadline_type` and a free-text `deadline_note`, not a machine-readable date, so exported
  events are scheduled 30 days out and tell the user to check the official page. Calling
  these exact deadline reminders would be a lie.
- **Mobile app (Part 4 of the brief) not built.** The static site is responsive and installable
  as a bookmark, but no Expo/React Native app exists.
- **The original React SPA is not in this repo.** It was never installed or compiled (no npm
  registry access in the build sandbox), so it is **unverified**, not "working", and carrying
  unverified code would misrepresent it. The static build fully replaces it.

## Paywall, mobile app and auto-apply (2026-08-14)

### What is real and tested here

- **Auto-apply engine** (`packages/autoapply/`) — turns a profile + programme into a
  submission-ready package: localised covering letter, filled field map, evidence list,
  ordered steps, verbatim attestations, readiness score. **35/35 tests pass**
  (`node scripts/test-autoapply.mjs`), no dependencies.
- **Jurisdiction policy** (`packages/policy/`) — encodes, per country, whether the
  beneficiary may be charged and how far automation may go, each with the statute it
  comes from. Enforced in code, not in a policy document.
- **Cloudflare Worker** (`worker/index.js`) — paywall, magic-link auth, Stripe checkout
  and webhooks, consent ledger. Stripe signature verification (including ignoring the
  decoy `v0` Stripe sends on test events) verified against a locally generated signature.
- **Paywall split verified**: the free payload was tested to contain **zero** scheme
  names and none of `application_url`, `procedure_steps`, `documents_required`,
  `source_url`. It is enforced server-side, not in the client.
- **Mobile app** (`mobile/`) — 7 Expo Router screens, shares a **byte-identical** copy of
  the engine, policy and auto-apply core with web and Worker (verified with `diff`).

### What could NOT be verified here, and why

The build sandbox has **no npm registry access** (`registry.npmjs.org` returns 403) and
`api.expo.dev` is unreachable. Therefore:

- **The mobile app has never been compiled or run.** JSX cannot be parsed without babel,
  which cannot be installed. What was verified: import resolution, JSX tag balance,
  presence of default exports, and that the shared core files parse under `node --check`.
  That is structural validation, not a build. **Treat the app as unbuilt source.**
- **The Worker has never run.** `wrangler dev` needs npm. The route logic, SQL and crypto
  were exercised in isolation; the deployment itself is unrun.
- **No Stripe product, price or webhook exists.** `STRIPE_PRICE_MONTHLY` is a placeholder.
- **No store submission.** Requires an Apple Developer account ($99/yr), a Play account
  ($25) and code signing.

### The finding that changes the business model

Research against primary sources established that **charging the beneficiary for benefits
help is an offence in France** — Code de la sécurité sociale art. **L554-2**, €4,500 fine
for any intermediary offering services *"moyennant émoluments convenus d'avance"* to
obtain benefits, replicated per benefit in CASF L262-51 (RSA), CCH L852-3 (APL), CSS
L821-5 (AAH), L845-6, L815-14. No fraud element is required. ANAS has filed a complaint
against Mes Allocs on this basis. France's own *Aidants Connect* excludes paid providers
by rule.

Germany reserves paid benefits advice to qualified lawyers (§13(5) SGB X + RDG). Italy
reserves the intermediary role to non-profit patronati (L.152/2001). Spain is the one
market where a **legal person** may be a registered *apoderado* and actually submit
(Orden ISM/189/2021 art. 4.2).

Consequently the paywall **refuses to take money in FR, DE, IT and PT** — server-side, in
`handleCheckout`. The pricing page states this plainly rather than hiding it.

On automation: no for-profit competitor in any researched market auto-submits. CAF's own
procuration withholds authority to perform legal acts on the account; caf.fr's terms
forbid sharing credentials with anyone. The engine therefore prepares everything and
hands over at the submit step — which is also the only version that keeps the sworn
declaration the user's, as the law requires.

**This is research, not legal advice.** Local counsel is required in FR, DE and IT before
charging anyone. Portugal is unresolved and is treated as free-to-user until it isn't.

## Income-threshold research (2026-08-13, second pass)

Reported by the user: a French employee on €60,000 was being shown low-income
allowances as "eligible". The cause was not the ranking — it was that the income rule
could not fire. Only 371 of 2,216 records carried a numeric `income_annual_max`, and a
further 412 stated in their own prose that they were means-tested without publishing a
number. Any income above zero passed all of them.

Six parallel research passes checked the highest-value records against official sources.
**142 records were checked; nothing was estimated.** Results:

- **52 numeric ceilings added** (dataset now 423). Examples: Visale €20,520; NZ Community
  Services Card NZ$34,974; Belgian verhoogde tegemoetkoming €28,054.93; Canada Workers
  Benefit CA$37,742; Ontario OESP CA$38,000; SASSA CSG R67,200; ECDA childcare
  SGD 144,000; ANEEL tarifa social R$9,726; AU Low Income Health Care Card A$42,172.
- **56 records confirmed to have NO income test at all** by their own official page
  (Kindergeld, AEEH, Baby Bonus Cash Gift, SASSA Foster Child Grant, Deutschlandstipendium…).
  These now carry `income_test: "none"` and are *no longer* wrongly caveated — accuracy
  in both directions, not just tightening.
- **34 confirmed means-tested with a genuinely unpublished threshold** (`income_test:
  "unpublished"`) — Dutch huurtoeslag, US Medicaid, Swiss cantonal childcare. These are
  held out of the eligible bucket instead of silently passing.

Every researched record carries `income_source_url`, `income_confidence` and
`income_reviewed_at`. Where an official page publishes no figure, the value is null with
the reason recorded — never a plausible-looking guess. Two stale records were corrected in
passing: Belgium's OMNIO status was merged into the verhoogde tegemoetkoming in 2014 and no
longer exists separately, and the Vlaamse zorgverzekering note described the wrong benefit.

Also fixed: **aid paid to employers** ("Employer Hiring Aid for Apprentices") was being
offered to individuals as their own entitlement. Those are now flagged and excluded.

## Audience pages

`/for/{students,parents,freelancers,renters}/` plus per-country versions, derived **only**
from structured eligibility fields (`student_required`, `requires_children`, `statuses`,
`housing_tenure`, `age_max`, `category`) — never guessed from prose. Coverage: 351 student,
424 parent, 342 freelancer, 201 renter records.

## Languages

Six locales (fr, es, de, it, pt, hi) with real `hreflang`, each generated only for the
countries that speak it. **The interface is translated; the eligibility prose is not.**
Programme names were already real local-language strings from the dataset's `name_local`.
Official-source rule text is deliberately left untranslated and every localised page says
so — on a site whose entire claim is accuracy, a machine-mistranslated benefit rule is
worse than an English one.

## Accuracy fixes from adversarial review (2026-08-13)

An adversarial pass ran the engine over 10 personas across 10 countries and swept 525
status×nationality×country combinations. Five defects it found, and what was done:

1. **Income ceilings were treated as hard cut-offs.** A French person on €9,000/yr was told
   they did not qualify for APL, ALS or RSA — while the records' own `income_note` says the
   aid *tapers* rather than stops. Fixed: a `tapered` bucket, triggered when the record's own
   note describes a taper and the user is within 3× the ceiling. Actively harmful → merely
   imprecise.
2. **Time-limited monthly benefits were annualised as if permanent.** UAE's ILOE insurance
   pays "up to 3 months per claim"; ×12 produced a AED 240,000/yr headline that was 100% of
   the total. Fixed: `monthsPayable()` parses the duration out of the record's own note.
   AED 240,000 → AED 60,000.
3. **Tax-shelter contribution ceilings counted as claimable money.** Japan's NISA
   (¥3.6M *investment allowance*) was 90% of a pensioner's headline. Fixed: `isCapitalCeiling`
   now also excludes `tax_credit` records whose note describes a contribution/investment limit.
   ¥3,978,420 → ¥378,420.
4. **Sorting by raw amount put irrelevant things first.** An unemployed French person's top
   result was a €15,000 business microcredit. Fixed: a tier ahead of amount demotes capital and
   (for non-working statuses) business programmes.
5. **Zero matches rendered a blank page.** Migrant workers in Singapore and India match nothing
   — every record requires citizenship or PR. Fixed: a dedicated view that counts and names the
   blocking rules, flags how many open up with PR, and points to statutory employment
   entitlements that do not depend on nationality.

Also: document checklists are canonicalised into ~15 real-world buckets before deduplication
(a GB run went from 23 rows / 1 shared to a genuinely consolidated list), and the programme-page
heading that rendered non-income eligibility notes under "Income test" is now "Eligibility notes".

**Not fixed, and known:** mutually-exclusive scheme variants are still summed (Germany's three
BAföG streams; Singapore's four CPF housing grants), which inflates those two headlines.
Grouping them needs a `scheme_family` field in the data rather than a name-matching heuristic —
recorded here rather than papered over. Income also still filters weakly: only 371 of 2,216
records carry an `income_annual_max` at all.

## Changelog

**2026-08-13 — static rebuild.** Replaced the client-rendered SPA with a zero-dependency static
generator. Added: conditional-circumstance bucket, loan/capital exclusion from totals, merged
document checklist, `.ics` export, shareable result URLs, print pack, global category browse,
build verification in CI, GitHub Pages deployment. Design system rewritten from scratch
(editorial/warm, no framework).
