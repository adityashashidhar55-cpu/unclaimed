# Unclaimed

**Find the government money you are entitled to and are not claiming.**

A static, crawlable, zero-dependency site over a curated dataset of **2,216 real
government and institutional support programmes across 25 countries** — each with the
published eligibility rules, an official source URL, a document checklist and numbered
application steps.

- **Live site:** https://unclaimedgrant.com
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
| **Sources on every record** | Official URL, verbatim snippet, funder, and whether a person has read the record against that page. No source, no entry. |
| **One date, stated once** | `last_verified_at` is currently identical on every record — it is the day the catalogue was extracted, not the day a researcher opened that page. So it is stated once, on `/methodology/`, and no programme page claims a date of its own. |

## Architecture

```
data/               25 curated country datasets + manifest (the source of truth)
src/engine/         the matcher — pure JS, zero deps, runs in Node AND the browser
src/build.mjs       static site generator → dist/  (no npm install; `find dist -name '*.html' | wc -l` for the page count)
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
node scripts/verify.mjs   # build verification; prints the count it ran
npx serve dist            # or: python3 -m http.server -d dist 8000
```

No `npm install`. No dependencies. Node 18+.

Environment variables:

- `SITE_BASE` — path prefix when hosted in a subdirectory. **Leave it empty for the real
  deploy**: the site is served at the apex of `unclaimedgrant.com`, and setting a prefix breaks
  every absolute URL, the service worker scope and the web manifest at the same time.
- `SITE_ORIGIN` — origin used for canonicals, sitemap and JSON-LD (`https://unclaimedgrant.com`)

## Deployment

**The live site is a Cloudflare Worker, not GitHub Pages.** This paragraph used to say the
opposite, and that is the most expensive thing a README can be wrong about: you follow it, edit
the wrong pipeline, and watch a correct change never appear.

`wrangler.jsonc` is the deployment. Cloudflare Workers Builds watches `main` and, on every
push, runs the build and deploys one bundle containing both the Worker (`worker/index.js`) and
the static tree:

- `assets.directory` is `./dist`, bound as `ASSETS`. Asset requests are free and do not count
  against the Worker request limit, which is why several thousand SEO pages cost nothing.
- `assets.run_worker_first` is `/api/*`, `/auth/*`, `/webhooks/*` — only those paths execute
  code. Everything else is served straight off the asset tree.
- `routes` claims `unclaimedgrant.com` and `www.unclaimedgrant.com` as custom domains, and
  `dist/CNAME` carries the same apex.
- State lives in the D1 binding `DB` (`unclaimedgrant-prod`), migrated from `./migrations`.
  Secrets — Stripe keys, the session signing key, the operator credentials — are set with
  `wrangler secret put` and are listed, unset, at the foot of `wrangler.jsonc`.

Work that is not on `origin/main` is not deployed, and there is no manual publish step.

`.github/workflows/deploy.yml` still runs on `main` as well. Treat it as the test gate — it
builds and runs `verify.mjs`, `check-links.mjs`, the gating, deadline, admin and translation
suites — and as a mirror. It is not the production path, and it builds with `SITE_BASE: ''`
like everything else.

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
