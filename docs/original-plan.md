# Plan — "Unclaimed" Global Grants & Benefits Finder (expanded beyond France + India)

## Goal
Build the product from PROMPT_A, expanded from 2 markets to broad multi-country
coverage, with marketing-grade presentation as a first-class requirement.
Deliverable: a polished, deployed web app (React SPA) with a curated, sourced
benefits database, intake → matcher → results flow, per-country programme pages,
and machine-readable surfaces where feasible.

## Stage 0 — Scope lock (user input)
- Confirm country list (breadth vs depth tradeoff)
- Confirm deliverable shape: marketing site + matcher app + data; MCP/REST layer
  in-scope or documented-only
- Confirm data approach: curated, real, well-known programmes with official
  source URLs (verifiable), not live scraping in this build

## Stage 1 — Research & data curation (deep-research-swarm style, parallel explore agents)
- Per-country research agents gather real, current, well-documented programmes:
  national + flagship regional schemes across categories (housing, income,
  family, health, education, energy, employment, business grants)
- Each record carries: name (local + EN), funder, amount band, eligibility
  rules, application URL, official source URL, last-verified date
- Output: structured JSON dataset per country (seed DB)

## Stage 2 — Core engine (pure TS module)
- Eligibility matcher: hard/soft rules, eligible / needs-one-more-answer /
  not-eligible buckets, failing-rule explanations, "money on the table" total
- Pure TS, no framework imports; reused by UI and any API layer

## Stage 3 — Web app build (vibecoding-webapp-swarm + webapp-building-swarm)
- Design-first React + Vite + Tailwind + shadcn/ui
- Marketing-quality landing ("How much money are you leaving on the table?")
- Progressive intake wizard (≤6 fields/screen, <90s to result)
- Results screen: programme cards with why-you-match, documents, steps,
  deadline, source + verified date, disclaimer
- Programme & country pages (SEO-shaped routes), JSON-LD, shareable result
- Multilingual-aware copy where feasible (local names preserved)
- musepool skill consulted pre-design to avoid generic AI aesthetics

## Stage 4 — Machine-readable layer (as feasible in this environment)
- REST-shaped data endpoints / static JSON per record (/{country}/{slug}.json)
- llms.txt, OpenAPI doc, JSON-LD on public pages
- MCP server: full Streamable HTTP deployment is out of environment scope;
  ship the typed tool schemas + a documented adapter design in /docs

## Stage 5 — QA, honest status doc, delivery
- Persona-based test passes (per-country personas, zero fabricated fields)
- /docs/status.md honest capability read (what is real / curated / stubbed)
- website_version_manager build_version → preview card delivery
