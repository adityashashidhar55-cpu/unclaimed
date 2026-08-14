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
  ordered steps, verbatim attestations, readiness score. **all tests pass**
  (`node scripts/test-autoapply.mjs`) — 169/169 — no dependencies.
- **Jurisdiction policy** (`packages/policy/`) — encodes, per country, how far automation
  may go and the pricing shapes that are refused outright, each with the statute it
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

### The finding that shapes the business model

Research against primary sources established that in France, **taking pre-agreed fees to
help someone obtain a benefit** is an offence — Code de la sécurité sociale art.
**L554-2**, €4,500 fine for any intermediary offering services *"moyennant émoluments
convenus d'avance"* to obtain benefits, replicated per benefit in CASF L262-51 (RSA),
CCH L852-3 (APL), CSS L821-5 (AAH), L845-6, L815-14. No fraud element is required. ANAS
has filed a complaint against Mes Allocs on this basis. France's own *Aidants Connect*
excludes paid providers by rule.

Germany reserves individual legal assessment of a concrete case (§13(5) SGB X + RDG).
Italy reserves the intermediary role to non-profit patronati (L.152/2001). Spain is the
one market where a **legal person** may be a registered *apoderado* and actually submit
(Orden ISM/189/2021 art. 4.2).

#### What that does and does not prohibit

This was read too narrowly twice — first as "cannot charge in France at all", then as
"can sell the database but not the paperwork". Both were wrong, and the corrected
position is that **both halves are sold in all 25 countries**.

L554-2 targets the **intermediary**: someone who steps between claimant and agency and
is paid a pre-agreed fee to procure the benefit. France has never read it to prohibit
paid administrative help as such — *écrivains publics* have charged for exactly this work
for a century and remain a lawful occupation, and *conseils en formalités* charge for
visa, passport and residency paperwork daily.

That last parallel needs stating precisely, because it does not transfer on its own
terms: L554-2 sits in the Code de la sécurité sociale and bites only on *prestations
sociales*, which is why the visa trade is untroubled by it. What transfers is the
distinction those trades rely on — **being a tool the applicant operates, not an agent
who acts for them.**

This product is on the tool side by construction, and each of these is a code path rather
than a claim:

| Fact | Enforced by |
|---|---|
| The user submits, in their own session | `submit.requires_user_action`, no submit path exists |
| We never hold a government credential | `INVARIANTS.NEVER_HOLD_GOV_CREDENTIALS` |
| We hold no mandate or procuration | `maySubmitOnBehalf` false everywhere except ES |
| The fee is flat, never a share of the award | `PRICING` + `contingent_pricing_refused` at checkout |
| Output is a range; the agency decides | matcher returns `total_min`/`total_max`, attestations disclaim agency |

Germany resolves the same way. The RDG reserves individual legal **assessment** of a
concrete case — argued positions, disputed entitlement, appeals. Applying a published
threshold and filling in the user's own answers is neither, and BGH VIII ZR 285/18
(*LexFox*, Nov 2019) read the RDG generously for legal-tech besides. Italy likewise:
L.152/2001 reserves acting as **intermediary before INPS**, filing through the
Piattaforma intermediari as the claimant's representative. We never do that, so we never
occupy the reserved role. The patronato referral stays in the product for users who want
a human to file for them — a real service we do not offer.

#### Auto-apply tiering and the document vault (2026-08-14, third pass)

Auto-apply is not one switch. It depends on whether a real, named mechanism
exists that a company can lawfully stand inside, and `SUBMISSION_RAILS` in
`packages/policy` records what actually does:

| Country | Rail | Tier | What it means |
|---|---|---|---|
| **ES** | Registro Electrónico de Apoderamientos | `submit` | A legal person may hold a registered apoderamiento and file. We do. |
| **IN** | DigiLocker / API Setu | `fetch` | Pull the user's own documents in with per-fetch consent. Never submission — myScheme's terms forbid automated access outright. |
| **US** | SNAP authorized representative (7 CFR 273.2) | `prepare` | Real in statute, `available: false` in code. It is a state-agreement/non-profit lane (mRelief), not a for-profit consumer feature. Claiming it would be the DoNotPay mistake. |
| Everywhere else | none | `prepare` | Complete package, user presses send. |

Where the tier is `prepare`, the honest product is the paperwork itself, which
is what the vault is for.

#### The vault (`packages/vault/`)

Almost nobody misses a benefit because the form was hard. They miss it because
the form wanted three documents at once. So: keep each once, know when it goes
stale, and know which claims each missing one unlocks.

- **17 canonical document types** with per-type validity windows, labelled in
  six languages.
- **A classifier** normalising the dataset's free-text `documents_required`
  onto those types. Measured against all **3,206 requirements** in the shipped
  data: **1,771 recognised (55%)**. The remaining 1,435 span ~1,400 distinct
  strings — a real long tail, not a fixable gap — and fall back to showing the
  agency's own wording verbatim rather than guessing.
- **Reuse is the payoff, and it is measurable.** In France, uploading the five
  most-demanded documents moves the user from **1 claim ready to 25** (GB 4→21,
  DE 2→27).
- **Two correctness bugs found by measuring** rather than by assuming: `\b`
  does not fire next to non-ASCII characters, so every accented French term and
  every Korean and Japanese term silently failed to match; and `documentPlan`
  merged all unrecognised requirements into one bucket, claiming a reuse that
  does not exist. Both are now regression-tested.
- **"None" is not a missing document.** 21 requirements in the data say some
  variant of *no application required*. Treating those as outstanding paperwork
  would have told people on automatic payments that they were incomplete.

#### Encryption, and what the server cannot do

Documents are AES-GCM encrypted **on the user's device** under a key derived
from their passphrase (PBKDF2-HMAC-SHA256, 600,000 iterations, per OWASP 2023).
Envelope encryption: a random data key per document, wrapped under the
passphrase-derived key, so a passphrase change rewraps N small keys rather than
re-encrypting N large files.

The server holds ciphertext, a wrapped key it cannot unwrap, a coarse type
label, a size and two dates. **It stores no filename** — `AAH_refus_2024.pdf`
would leak precisely what the encryption protects. An operator with full
database and bucket access cannot read a single payslip. `handleVaultPut` also
refuses a body whose magic bytes look like a real PDF, ZIP, JPEG or PNG, so a
client bug that skipped encryption fails loudly instead of quietly filling the
bucket with readable documents.

Argon2id would be better than PBKDF2 and is not reachable without a dependency.

**Unverified, as with everything else here:** R2 has never been written to, the
routes have never been served, and the React Native crypto provider is
unwired — Expo does not expose full WebCrypto, so `createVaultCrypto` takes an
injected provider and the mobile side will need `react-native-quick-crypto` or
equivalent. The crypto itself is tested: the suite performs a real AES-GCM
round-trip, asserts a wrong passphrase fails, and asserts IVs and data keys are
never reused.

### Startup grants (2026-08-14, fourth pass)

**203 programmes across 27 jurisdictions**, researched against official funder
pages — 152 public, 31 private, 20 public-private. 200 of 203 carry
`verification_status: verified` with a verbatim `source_snippet`; the three
that do not are marked unverified rather than dropped or guessed.

Coverage: us 29, global 27, eu 23, gb 21, fr 15, de 13, in 12, ie 10, sg 6,
ae 5, jp/ca 4, kr/au/nl/es/be 3, and 2 each across nz, br, mx, za, it, pl, se,
at, ch, pt 1. By instrument: 92 grants, 29 loans, 24 in-kind, 19 tax credits,
16 equity, 10 prizes, 7 accelerators, 6 vouchers.

#### A separate engine, on purpose

`src/engine/startup.js` does not extend the personal matcher. A person is
tested on income, household and tenure; a company on age, headcount, turnover,
sector and stage. Three things it does that a filter would not:

- **Supranational programmes travel.** EU-level and global programmes live in
  their own pools and are merged in for the countries that can reach them,
  rather than being duplicated 27 times. Horizon association is tracked
  separately from EU membership, because the lists genuinely differ — reading
  them as one would wrongly exclude Norwegian, Swiss and UK founders.
- **The EU SME test is turnover OR balance sheet, not AND.** Reading it as AND
  wrongly excludes capital-heavy companies with low revenue, which is most
  deeptech. Headcount is the binding test; the medium balance-sheet threshold
  is €43m, not €50m.
- **Instruments and currencies are never summed together.** A €150k grant and
  $100k of AWS credits are different things in different units. Totals are
  per instrument and per currency, and no FX rate is ever invented. This was
  a real bug on first run — EUR grants were being added to USD prizes — caught
  by a test rather than by review.

#### De minimis: the ceiling founders find out about too late

`packages/stateaid/` implements Regulation (EU) 2023/2831, read from the
consolidated text (`docs/state-aid.md` carries the quotes).

Small public grants across the EU are capped at **€300,000 per single
undertaking per member state over a rolling three years**. Three details that
aggregators routinely get wrong, all encoded and tested:

1. **The window is rolling, not fiscal.** 1407/2013 used fiscal years;
   2023/2831 replaced that (recital 11). Code written against the old rule
   under-counts.
2. **The ceiling is per member state.** German and Spanish aid draw on
   separate pots for the same company.
3. **"Single undertaking" is not the SME group test.** Control-based links
   only — a fund holding 30% of two portfolio companies does not merge their
   de minimis pots, though it does affect both SME calculations.

The consequence that makes this worth implementing rather than mentioning:
under **Article 3(7)**, an award that would breach the ceiling is disqualified
**in full**, not trimmed to the headroom. So `planWithinCeiling` applies the
budget across the whole plan, largest-affordable-first, and the UI tells a
founder which awards are blocked and the date the oldest aid rolls out of the
window and frees room. Aid counts from the date the legal right is conferred,
not the date of payment (Art. 3(3)).

#### Auto-fill actually works here, and the reason is structural

`packages/registry/` — a person's income is private, but a company's legal
identity is public record. One identifier fills most of a grant form:

| | Register | Auth | Reality |
|---|---|---|---|
| **GB** | Companies House | Free key | The most complete free company API in any market |
| **FR** | API Recherche d'entreprises (INSEE) | None | Open, no key. Returns a headcount **band**, never an exact figure — recorded as a band, never presented as a number |
| **US** | SAM.gov | Free key | Registration **expires annually** and that expiry blocks every federal award — surfacing the date is worth more than any other field |
| **IN** | CIN structure | None | The identifier itself encodes listing status, industry, state, year and class. Parsed offline, no API call at all |
| **DE** | Handelsregister | Paid | **No free structured API.** Marked `available: false` rather than implying parity |

`projectCompany` reports the split honestly: fields filled from the register
versus the narrative — project summary, innovation claim, work plan, budget,
co-funding, CVs — that no register can supply and only the founder can write.
"9 fields filled, 7 only you can write" is a true claim; "auto-apply" would
not be.

#### What is not done

- **No registry API has been called.** No keys exist, and the sandbox has no
  npm; the adapters are tested against captured response shapes, not live
  endpoints.
- **The classifier recognises 33% of startup document requirements** (180 of
  541) versus 55% for personal ones. Grant paperwork is more bespoke —
  "Business plan and financing plan", "Contract of sale or building contract"
  — and the rest falls back to the funder's own wording.
- **Several programmes are closed or paused** and recorded as such rather than
  quietly dropped: Innovate UK Smart Grants (no rounds since Jan 2025), ZIM
  (application stop to early 2027), India's SISFS (closed 31 May 2026),
  Australia's Industry Growth Program, Innoviris Brussels. A grants site that
  lists closed calls as open wastes weeks of founders' time.

### Where the residual risk actually lives

Not in the country. In two things, both of which are ours to control:

1. **Pricing shape.** A fee that scales with what the user recovers is a procurement
   commission, and that single change would put the product inside L554-2. The Worker
   refuses to create a checkout session parameterised by the matched total
   (`contingent_pricing_refused`). No success fees, no per-claim charges, ever.
2. **Marketing copy.** "We get you your benefits" is both a procurement claim and
   independently enforceable — FTC v. DoNotPay was $193,000 for unsubstantiated
   capability claims, regardless of whether the underlying service was lawful. Say what
   is true: we tell you what exists, we help you write, the agency decides.

Mes Allocs charges in France today and ANAS has filed against it, so the boundary is
live rather than settled. **This is research, not legal advice** — French, German and
Italian counsel are worth having, but as a review of pricing and marketing copy, not as
a precondition for selling.

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
