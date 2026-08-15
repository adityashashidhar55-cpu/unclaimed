# The paywall, and the one switch that can undo it

Free is the total and the count. Paid is the programme names, the directory,
the document checklist and auto-apply. Three things enforce that, and they only
work together.

## 1. The public dataset is stripped

`/api/v1/programmes/{cc}.json` and `/api/v1/startups/{pool}.json` ship the first
two records whole and every other one without its name, funder, links, quoted
source, steps or documents. Gating the pages while publishing the full records
is not a paywall — the directory was one `curl` away.

The stripped records carry a `derived` block holding the five answers the
matcher would otherwise read out of the prose that was removed, so the free
total is identical to the paid one. `scripts/test-gating.mjs` asserts that
across every country and three profiles. If it ever fails, stop: a free total
that quietly drifts is the worst bug this product can have.

## 2. The unstripped copies are opt-in

`EMIT_FULL_DATASET=1` writes `/api/v1/full/...`. **Leave it unset until the
Cloudflare Worker is actually in front of the site.**

The design is that `/api/v1/full/` sits inside `run_worker_first`, so the Worker
reads it through `env.ASSETS` (which does not re-enter the router) while the
router 404s every external request. That is true with the Worker deployed and
completely false without it. On GitHub Pages there is no router, so the flag
would publish the entire directory at a guessable path. `robots.txt` disallows
it, but that is a request, not a control.

This was shipped wrong once, live, and caught in verification. The build now
defaults the flag off and `test-gating.mjs` fails if the directory appears
without it.

Without the full copies the Worker falls back to the stripped file: a paid user
sees less than they paid for, which is the right direction to fail in.

## 3. The client never decides

`state.entitled` in the app defaults to `false`, including when the network is
down, and is only ever set from what the server said. The `.ics` export and the
deadlines screen both check it — a hidden button is not an authorisation check,
and the calendar export used to carry every programme name in its SUMMARY lines.

## Turning it on properly

1. Deploy the Worker (`wrangler deploy`) with `run_worker_first` covering
   `/api/*`, `/auth/*`, `/webhooks/*`.
2. Confirm `https://unclaimedgrant.com/api/v1/full/programmes/gb.json` returns
   404 from the internet.
3. Only then set `EMIT_FULL_DATASET: '1'` in the build step's `env` block in
   `.github/workflows/deploy.yml`.
4. Confirm step 2 again after the deploy.
