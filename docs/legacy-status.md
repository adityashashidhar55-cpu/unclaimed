# STATUS — Unclaimed (build of 2026-08-12)

Honest capability read. Bugs and gaps first.

## Known limitations / bugs
1. **Client-side rendering only.** Programme pages (`/programme/{cc}/{category}/{slug}`)
   are SPA routes; HTML is not server-rendered, so crawlers without JS see the shell.
   JSON-LD is injected client-side. Programmatic-SEO value is therefore partial in
   this build — static generation is the top follow-up.
2. **Amount ceilings can overstate.** `total_max` sums `amount_max` across eligible
   programmes, including loan-type schemes (e.g. Mudra, microcredit) whose ceilings
   are large. The figure is labelled "up to"; the conservative `total_min` is the
   honest floor. Amount-type weighting is a planned refinement.
3. **`needs_one_more_answer` under-fires for FR/US/DE/BR personas** in QA — most
   records in those datasets carry null rules that pass, so band-straddle unknowns
   are rarer than intended. GB shows the intended behaviour (30 likely-eligible).
4. **Income bands are approximate.** Band thresholds are fractions of estimated
   median household income per country, not official poverty lines.
5. **No live verification pipeline.** Data is a curated snapshot (2026-08-12);
   the diff/recheck/verification-queue machinery from the spec is designed, not
   running. No scraping, no OpenFisca instance in this build.
6. **MCP server is documented, not deployed.** `public/api/v1/mcp-tools.json` and
   `openapi.json` ship the full tool schemas + governance instructions; there is no
   live Streamable HTTP endpoint.
7. **Navbar wizard capsule** ("Step 1 of 6 · ~90s") is static text, not wired to
   wizard state; "Save & exit" relies on automatic draft persistence.
8. Pre-existing template lint warnings in `src/components/ui/*` (untouched).

## What is real
- **Dataset: 1,933 real, curated programmes across 25 countries**, each with
  official source_url, source_snippet, last_verified_at, verification_status.
  697 records human-verified via live web search during curation. 0 schema errors.
  Ended programmes explicitly excluded by researchers (Canada Carbon Rebate, GBIS,
  PROSPERA, Bezpieczny Kredyt 2%, First Home Grant NZ, STAP-budget NL, etc.).
- **Engine**: pure TS matcher, 9 rules, three-bucket output with plain-language
  failing rules and blocking questions, annualized totals + verified-only subtotal.
  Unit-tested and exercised through 8 hand-built personas (FR, IN, GB, US, DE, KR,
  AE, BR) — all return eligible matches with full provenance on every record.
- **Surfaces**: marketing landing (GSAP/Lenis, real data throughout), intake wizard
  (conditional flow, draft persistence), results screen (count-up total, share card,
  inline answer → live recompute), programme detail (rule table, apply timeline,
  JSON-LD), country browse (filters, table view, gaps band), countries directory,
  methodology/trust page with honest limitations.
- **Machine-readable**: `/api/v1/countries.json`, `/api/v1/programmes/{cc}.json`,
  `/api/v1/openapi.json` (3.1), `/api/v1/mcp-tools.json` (7 tools, full JSON Schema
  2020-12), `/llms.txt`, `/llms-full.txt`.

## What is simulated/stubbed
- No accounts, no persistence beyond browser storage (anonymous runs by design).
- "Report a problem" confirms client-side; no server queue behind it.
- PDF export not built; share card covers the distribution use-case.
- Notify-me capture on unsupported countries is not wired to a backend.
