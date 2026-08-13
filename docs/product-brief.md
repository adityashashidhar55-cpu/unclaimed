# Research / Product Brief — "Unclaimed" Global Grants & Benefits Finder

## What it is
A web app where a person answers 8–12 questions (country, city/region, status,
income band, household, housing tenure, visa/nationality) and gets back a verified,
sourced, dated list of money they are entitled to but probably not claiming —
each with eligibility rules, document checklist, exact application procedure,
and a direct link to the official application page. 25 countries, ~50+ programmes
each (1,250+ records). It is a structured eligibility matcher over a curated
database, NOT a chatbot.

## Core user flows (the design must serve these)
1. **Landing** — marketing surface. Hook: "How much money are you leaving on the
   table?" Global coverage (25 country flags), trust signals (sourced, dated,
   verified), a giant example "money on the table" figure. Ungated free calculator CTA.
2. **Intake wizard** — progressive, max ~6 fields per screen, under 90 seconds.
   Country → region/city → status → income band (explain WHY it's asked) →
   household → housing tenure. Branching by status.
3. **Results screen** — THE product. Big total "money on the table / year" figure
   (this gets screenshotted and shared — make it iconic). Three labelled buckets:
   Eligible / Likely eligible — needs one more answer (shows the exact question) /
   Not eligible (with the specific failing rule in plain language). Per-programme
   cards: local+EN name, funder, badge (Automatic / You must apply), est. value,
   why-you-match, tickable document checklist, numbered apply steps, deadline,
   source + last-verified date always visible, report-a-problem link. Persistent
   disclaimer: discovery tool, not legal/financial advice.
4. **Programme pages** (SEO-shaped) — `/{country}/{category}/{slug}`: full record
   rendered richly, JSON-LD GovernmentService.
5. **Country pages** — `/{country}`: all programmes browsable by category,
   coverage stats.
6. **Methodology/trust page** — how data is sourced, verified, dated; honest
   about verification statuses (verified vs auto-extracted badges).

## Data shape (drives UI)
Each programme: slug, name_local, name_en, admin_level (national/region/state/city/
private), admin_area, funder, category (housing, income_support, health, transport,
energy, education, family, employment, tax, business), benefit_type (cash_monthly,
cash_one_off, tax_credit, discount, in_kind, free_slab), amount min/max + currency +
period + note, is_automatic, application_url, application_channel, deadline,
procedure_steps[], documents_required[], eligibility{statuses, age, income_annual_max,
requires_children, nationality, residency, housing_tenure, student_required,
admin_areas}, source_url, source_snippet, last_verified_at, verification_status
(verified / auto_extracted).

## Design direction references (synthesized from curated precedents)
- Editorial, typography-led trust aesthetic — NOT generic fintech SaaS. Dual-font
  system: a serif/grotesque display for oversized headlines + a clean grotesque sans
  for body and data. Word-staggered entrance animations on headlines.
- Warm, earthy, confident palette (think sage/olive or terracotta/burnt-orange
  accent on warm off-white paper) — money + trust without blue-purple fintech clichés.
- Numbers as heroes: the total entitlement figure should be typographically huge.
- Pill buttons, underline-style minimal form inputs, generous negative space,
  asymmetric editorial grid, scroll-triggered staggered entrances (GSAP/Framer).
- Badges and verification states must be visually distinct: verified = solid trust
  mark; auto_extracted = visible "not yet human-checked" treatment.
- Data-dense programme cards that stay readable: clear hierarchy name → value →
  why → documents → steps → source.
