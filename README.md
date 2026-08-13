# Unclaimed

**Find the government money you are entitled to and are not claiming.**

A static, crawlable, zero-dependency site over a curated dataset of **2,216 real
government and institutional support programmes across 25 countries** — each with the
published eligibility rules, an official source URL, a document checklist, numbered
application steps, and the date a human last verified it.

- **Live site:** https://adityashashidhar55-cpu.github.io/unclaimed/
- **Eligibility check:** `/check/` — runs entirely in the browser, nothing is sent anywhere
- **API:** `/api/v1/countries.json`, `/api/v1/programmes/{cc}.json`, `/api/v1/stats.json`
- **For LLMs:** `/llms.txt`

---

## Why this exists

Every scheme here is published on an official government page. None of it is secret. It is
simply spread across dozens of departments, written in the local language, and never
cross-referenced. Unclaimed reads the rules so you don't have to: answer six questions once,
and 2,216 sets of published criteria get evaluated against your answers.

## What makes it more than a list of links

| | |
|---|---|
| **Three honest buckets** | Eligible / needs one more answer / not eligible, with the exact failing rule in plain language |
| **A fourth, honest bucket** | Programmes gated on a circumstance the data doesn't model — disability, caring, sickness, a new baby, bereavement, service — are held out of your total unless you say they apply. Counting money you can't get is how these tools become useless. |
| **Automatic vs must-apply split** | 295 of 2,216 programmes pay out with no application. Knowing which is which is the single most actionable fact on the page. |
| **Merged document checklist** | Your matches are deduplicated into one list, ordered by how many programmes each document unlocks |
| **Deadline `.ics` export** | Time-limited programmes go into your calendar |
| **Shareable result link** | Answers are encoded in the URL. No account, no database, no email. |
| **Printable claim pack** | Print stylesheet with every source URL expanded — for a caseworker, an adviser, or a relative offline |
| **Sources on every record** | Official URL, verbatim snippet, funder, and last-verified date. No source, no entry. |

## Architecture

```
data/               25 curated country datasets + manifest (the source of truth)
src/engine/         the matcher — pure JS, zero deps, runs in Node AND the browser
src/build.mjs       static site generator → dist/  (2,503 pages, ~1.7s, no npm install)
src/app.js          the browser wizard, importing the same engine
src/theme.css       hand-written design system
scripts/verify.mjs  build verification (runs in CI)
docs/               methodology, data spec, honest status
```

**One engine, one set of numbers.** The landing page's example figure, the results screen and
the API are all produced by `src/engine/matcher.js`. No surface has its own hard-coded copy of
a number shown elsewhere — `scripts/verify.mjs` fails the build if the landing page and the
API disagree.

**Why static instead of the React SPA.** The original app was a client-rendered Vite SPA:
crawlers without JS saw an empty shell and JSON-LD was injected at runtime, so the
programmatic-SEO value — the entire point of 2,216 programme pages — was mostly theoretical.
This rebuild emits real HTML per programme with JSON-LD in the source, costs nothing to host,
and builds without a single dependency. The original React app is not carried in this repo —
it was never installed or compiled (no npm registry access in the build sandbox), so shipping it
would have meant shipping something unverified.

## Build

```bash
node src/build.mjs        # → dist/
node scripts/verify.mjs   # 22 checks
npx serve dist            # or: python3 -m http.server -d dist 8000
```

No `npm install`. No dependencies. Node 18+.

Environment variables:

- `SITE_BASE` — path prefix when hosted in a subdirectory (`/unclaimed` on GitHub Pages)
- `SITE_ORIGIN` — origin used for canonicals, sitemap and JSON-LD

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds, runs verification, and
publishes `dist/` to GitHub Pages. To serve it from a custom domain
(e.g. `unclaimed.involve-consulting.com`), set the CNAME in repository settings and build with
`SITE_BASE=""` and the matching `SITE_ORIGIN`.

## MCP / AI integration

The dataset is designed to be consumed by an assistant, not just a human:

- `/llms.txt` orients a model and states the rules for answering from this data
  (never state an unpublished amount; always cite `source_url` and `last_verified_at`)
- `/api/v1/mcp-tools.json` ships tool schemas (JSON Schema 2020-12) for
  `list_countries`, `search_programmes`, `get_programme`, `match_profile`
- `src/engine/matcher.js` is dependency-free and imports into a Node MCP server unchanged

**Status: schemas shipped, server not deployed.** A documented interface is not a running one,
and this repo does not pretend otherwise.

## Honest status

See [`docs/status.md`](docs/status.md) for what is real, what is stubbed, and what is still
wrong. If something is simulated it says so — an optimistic status doc is worse than no status
doc.

## Data corrections

Every programme page links to a pre-filled GitHub issue. Public tracker, public fix history.

## Licence

MIT for the code and the dataset compilation. The underlying programme information belongs to
the publishing authorities and is linked on every record. Not legal, tax or financial advice.
