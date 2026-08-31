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
not in D1. Only a PBKDF2-SHA256 hash at 100,000 iterations, and its salt. (This doc said 210,000 for a while; the code has always said 100,000. Raising it means re-running the script and re-putting the two secrets, because an existing hash cannot be re-derived.)

**With any of the three secrets unset, `/auth/admin` returns 503.** A missing
secret means the door is off, never that the door is open — that inversion is
the most common way an admin endpoint ends up unauthenticated in production.

Rotating is running the script again and re-putting the two password secrets.
That invalidates nothing already issued, so also rotate `SESSION_SIGNING_KEY`
if you need existing operator sessions dead immediately; that signs out every
user too, which is the price.

## The second factor

Signing in here unlocks every paid surface on the site for twelve hours. The URL
is guessable and so is the email, which leaves one secret between the internet
and the whole product. Rate limiting makes guessing slow; it does nothing about
a password that has leaked.

So `/admin/` offers a TOTP second factor — the six digits from any
authenticator app. RFC 6238, HMAC-SHA1 over a 30-second counter, done with Web
Crypto. No dependency, because the whole repo has none.

**Turning it on.** Sign in, find *This door* at the top of the panel, choose
**enter a setup key** in your authenticator app, type the key, then type the six
digits back. That is it.

Nothing is stored until that code checks out. A key that fails to type, or a tab
closed halfway, leaves the door exactly as it was — you cannot lock yourself out
by starting and not finishing.

There is deliberately **no QR code**. Drawing one means either a QR library (this
repo has no dependencies) or sending the TOTP secret to an image service to be
rendered, which would hand the second factor to whoever draws it.

**How it behaves once on.**

| | |
|---|---|
| Password alone | Refused, and the response says a code is wanted — *only after the password has already checked out*, so the field is not an oracle for guessing the email. |
| Wrong password, right code | "Wrong email or password". Nothing is said about the code. |
| Wrong code | Costs a rate-limited attempt, exactly like a wrong password. Eight failures an hour per IP and the door shuts. |
| The same code twice | Refused. A six-digit code is valid for up to 90 seconds across the drift window, and anything that can read it once — a shoulder, a screenshot, a phishing page relaying it — can replay it inside that window. The last accepted step is stored, and a code at or before it is dead. |
| Clock drift | One 30-second step either side is accepted. Wider would only lengthen the replay window. |
| The stored secret cannot be read | The door **shuts**, with a 503. A database hiccup must never silently downgrade this to one password. |

**Turning it off** needs a current code, not just a session — otherwise a stolen
session could switch the factor off, which would make it a speed bump rather
than a factor.

**If you lose the phone.** Delete the row and the door is back to a password:

```
npx wrangler d1 execute unclaimedgrant --remote \
  --command "DELETE FROM worker_config WHERE key LIKE 'admin_totp%'"
```

That is a deliberate act requiring Cloudflare access, which is the right shape
for a recovery path — nobody can reach it through the product.

Both switching it on and switching it off are written to `admin_audit`.

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

---

# Granting someone a plan

The other half of `/admin/`, under **Customers**. Search for an email, press
Grant, pick a plan, say why. The account is unlocked on their next request —
no Stripe, no invoice, no card.

## What a grant is, and what it deliberately is not

A grant is a row in `grants`. It is **not** a row in `entitlements`, and
nothing about granting touches Stripe. That separation is the whole design,
for two reasons:

1. **`entitlements` belongs to the Stripe webhook.** `applyStripeEvent()`
   upserts on `user_id` and assigns `status` unconditionally. Anything written
   there by hand survives until that customer's next invoice event and then
   disappears, leaving nothing to say it was ever there.

2. **Comped accounts must never look like revenue.** A granted account sitting
   in the entitlements table with `status='active'` makes MRR count people who
   have never paid, silently, forever.

So access is the union of *has a live subscription* and *has a live grant*,
computed in `entitlementFor()`. A paying subscriber is always reported as
`active`, never as `granted`, so the paying column stays honest. Granting
creates no Stripe customer; revoking cancels no subscription.

## The Enterprise tier

`enterprise` is a grantable plan with **no Stripe price, on purpose**. The
pricing page quotes €80/seat/month for a tier that is sold on a call — this is
where that call gets switched on. Grant it with the seat count you agreed and
invoice outside the product.

## Fields

| Field | What it does |
|---|---|
| Plan | One of the five in `packages/grants/index.js`. The form is populated from the Worker, so it can never offer a plan the Worker would reject. |
| Seats | Business and enterprise only. Clamped to 500 — an unbounded seat count is an unbounded licence. |
| Days | `0` means no end date. Otherwise it becomes an absolute `expires_at` at grant time, and access stops on its own with nothing scheduled to run. |
| Why | **Required.** In six months this is the only thing that tells a comped account apart from a billing bug, and the person who has to tell them apart is you. |

Granting to an address with no account is refused by default and offers a
tickbox to create it — so a typo in the email box cannot quietly create a
customer. That creation is its own audited event.

## Superseding, revoking, and the trail

Granting a second plan **revokes the first in the same request** and records
that as a `supersede`. Exactly one grant is ever live, so "what does this
account have" has one answer.

Revoking asks for a reason and closes access immediately. Nothing is deleted:
`admin_audit` is append-only, and a revoked grant keeps its row. "What did this
account have on 3 March, and who decided that" has to be answerable from rows.

## What the customer sees

Their account page says the plan is *unlocked for you by Unclaimed Grants,
there is nothing to pay and nothing to manage*, in their own language, and
offers **no billing control at all**. This matters: a granted account has no
Stripe customer, so a Manage billing button there would open a portal session
that cannot be created and fail with an error they can do nothing about.

## Before any of this works

```
npx wrangler d1 execute unclaimed --remote --file=migrations/0008_grants.sql
```

Until that runs, `liveGrantFor()` catches the missing table and answers null —
"nobody has been granted anything", which is exactly true. The site keeps
working and paying customers are unaffected; the audit panel says the migration
has not been applied. It fails closed in every case: a database error can never
manufacture an entitlement, only fail to find one.
