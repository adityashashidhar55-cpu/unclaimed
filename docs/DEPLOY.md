# How unclaimedgrant.com is served

Until now the site was static files on GitHub Pages. That is the single reason
sign-in and checkout did not work for anybody: GitHub Pages cannot run code, so
every request to `/auth/*` and `/api/*` returned a 404, and the client did what
it is supposed to do when the API is unreachable — treat the visitor as signed
out and unentitled. Nothing was broken in the auth code. There was no server.

The site now runs as **one Cloudflare Worker** that serves both the static pages
and the API from the same origin.

## Why one Worker rather than a separate API host

A session cookie has to reach the API. Put the API on another origin and the
cookie is a third-party cookie, which Safari and Firefox drop outright and
Chrome is phasing out — so sessions would have to move to a token in
localStorage, readable by any injected script. One origin keeps the session in
an `HttpOnly` cookie that JavaScript cannot read at all.

Asset requests are also not billed as Worker requests, which is why ~5,900 SEO
pages cost nothing to serve. Only `/api/*`, `/auth/*` and `/webhooks/*` run
code — that is what `run_worker_first` in `wrangler.jsonc` does.

## Pieces

| Piece | What it is |
| --- | --- |
| Worker `unclaimedgrant` | `worker/index.js` + `dist/` as assets |
| D1 `unclaimedgrant-prod` | users, entitlements, login codes, vault metadata, funnel events |
| R2 `unclaimedgrant-vault` | **not yet enabled** — see below |
| Build | Cloudflare Workers Builds, from `adityashashidhar55-cpu/unclaimed`, on push to `main` |

Build command `npm run build`, deploy command `npx wrangler deploy`. There is no
API token anywhere: Cloudflare builds the repo itself through its GitHub app, so
no secret had to be created, pasted into a form, or stored in CI.

## The DNS cutover

`wrangler deploy` attaches `unclaimedgrant.com` and `www.` as custom domains.
The first deploy failed at exactly that step:

```
Hostname 'unclaimedgrant.com' already has externally managed DNS records
(A, CNAME, etc). Delete them first or try a different hostname. [code: 100117]
```

Those were the four GitHub Pages A records (`185.199.108-111.153`) and a
`www` CNAME to `adityashashidhar55-cpu.github.io`. They were removed, and the
Worker's custom domain takes their place — Cloudflare manages the record itself
once the Worker owns the hostname.

**If the domain ever needs to go back to GitHub Pages**, recreate exactly:

```
A      unclaimedgrant.com       185.199.108.153   DNS only
A      unclaimedgrant.com       185.199.109.153   DNS only
A      unclaimedgrant.com       185.199.110.153   DNS only
A      unclaimedgrant.com       185.199.111.153   DNS only
CNAME  www.unclaimedgrant.com   adityashashidhar55-cpu.github.io   DNS only
```

The GitHub Pages workflow still runs on every push and still builds the site, so
that fallback stays warm. It deliberately does **not** set
`EMIT_FULL_DATASET`, so the Pages mirror is the name-stripped copy — see below.

## The dataset flag

The Worker answers a paid check from the unstripped dataset, which the build
only writes when `EMIT_FULL_DATASET=1`. That is now set in `npm run build`, so
`dist/api/v1/full/` exists in the Worker deployment.

This is only safe because `/api/*` is inside `run_worker_first` and the router
returns 404 for every external request to `/api/v1/full/`. `env.ASSETS.fetch`
does not re-enter the router, so the Worker can read what no visitor can.
`scripts/test-gating.mjs` asserts both halves of that: the flag emits the files,
and no page links to them.

**Never set that flag on a plain static host.** On GitHub Pages it publishes a
complete, guessable copy of the paid directory. That has happened once already.

## Secrets to set

None of these are in the repo. Set with `npx wrangler secret put <NAME>`, or in
the dashboard under the Worker's Settings → Variables and Secrets.

| Secret | Needed for |
| --- | --- |
| `SESSION_SIGNING_KEY` | **every** signed session — sign-in does nothing without it |
| `RESEND_API_KEY` | sending the six-digit sign-in code |
| `STRIPE_SECRET_KEY` | creating checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | verifying the webhook that grants entitlement |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_HASH` | `/admin/` — see ADMIN.md |

The four `STRIPE_PRICE_*` values in `wrangler.jsonc` are `vars`, not secrets —
price ids appear in the checkout URL either way. `scripts/stripe-setup.mjs`
prints them.

## R2

R2 has to be switched on once in the dashboard before a bucket can be created.
Until then the `r2_buckets` binding stays commented out in `wrangler.jsonc` and
every `/api/vault/*` route returns 503 with a plain explanation. That is
deliberate: a storage feature that is not turned on must not take sign-in and
checkout down with it.

After enabling it:

```
npx wrangler r2 bucket create unclaimedgrant-vault
```

then uncomment the binding and push.

## Migrations

Four, in `migrations/`, all applied to `unclaimedgrant-prod`. New ones:

```
npx wrangler d1 migrations apply unclaimedgrant-prod --remote
```
