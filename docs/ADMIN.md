# The operator account and the admin dashboard

Two things live at `/admin/`: a login that unlocks every paid surface on the
site for your browser, and a dashboard that answers the three questions you
cannot answer from the outside — who signed in, how much traffic there is, and
where in the flow people stop.

Both need the Cloudflare Worker deployed. On plain static hosting the page
renders, the form posts into the void, and the dashboard says so.

## Setting the password

```
node scripts/admin-password.mjs you@example.com
```

It prints a generated password once, then the three secrets that verify it:

```
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_SALT
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Pass your own password as a second argument if you would rather choose one.
The password itself is stored nowhere — not in the repo, not in wrangler.jsonc,
not in D1. Only a PBKDF2-SHA256 hash at 210,000 iterations, and its salt.

**With any of the three secrets unset, `/auth/admin` returns 503.** A missing
secret means the door is off, never that the door is open — that inversion is
the most common way an admin endpoint ends up unauthenticated in production.

Rotating is running the script again and re-putting the two password secrets.
That invalidates nothing already issued, so also rotate `SESSION_SIGNING_KEY`
if you need existing operator sessions dead immediately; that signs out every
user too, which is the price.

## What the operator session does

`{ adm: true }` on the signed session cookie, twelve hours, and
`entitlementFor()` returns entitled for every country and both products before
it looks at anything else. So:

- every programme name, amount, link and application pack, in every country
- the full `/api/v1/programmes/*.json`, not the stripped copy
- the deadline export, the auto-apply plan, the workspace

It is a role on the session, not a row in `entitlements`. Nobody's billing is
touched and there is no free subscription to forget about later. Failed
attempts are rate limited to eight per hour per IP (hashed with the signing
key — the address is never stored) and every success is written to
`login_events` with `kind = 'admin'`, so the dashboard shows your own logins
alongside everyone else's.

## What the analytics collect

One table, `events`, one row per funnel step reached:

| column | what it is |
| --- | --- |
| `step` | one of the twelve names in `packages/analytics/index.js`; anything else is rejected |
| `visitor` | a random id in `sessionStorage`, dead when the tab closes |
| `country` | the country being *checked*, not the visitor's location |
| `locale` | interface language |
| `surface` | `web`, `pwa` or `native` |

Not collected: IP addresses, user agents, referrers, screen sizes, anything
typed into the wizard, and any id that survives the tab. Because the visitor id
is per-session, a person who comes back tomorrow counts as new — which
understates returning visitors, and that is the direction to be wrong in.

The beacon is forgeable, since it has to accept anonymous callers to measure
anonymous visitors. Someone could inflate a step count. They cannot read
anything and they cannot lower a count, so the worst case is a wrong number on
a private page.

## Reading the funnel

Two rates per step, and they answer different questions:

- **share** — of everyone who arrived, how many got this far. The shape of the
  cliff.
- **step rate** — of the people who reached the step *before* this one, how
  many reached this one. This is the one to act on: a 4% share at step nine can
  be nine ordinary steps or one catastrophe, and only the per-step rate says
  which.

"Biggest drop" at the top of the section ranks by **absolute** people lost, not
by rate. A step that loses 90% of the ten people who got that far is noise; one
that loses 25% of eight thousand is the product.

Steps are counted by distinct visitor, so reloading the results screen five
times is one person reaching the results screen.

## Adding a step

Append to `FUNNEL` in `packages/analytics/index.js` and fire it with
`track('name')`. Both the Worker and the dashboard read that list, so a step
fired under a name that is not in it is rejected at the API rather than showing
up as a silent 100% drop-off. Insert in the middle only when the product order
genuinely changed — the drop-off between adjacent rows is the whole table, and
a row in the wrong place produces a real-looking number that means nothing.
