# Investor demo runbook

Written to be walked in ten minutes, on the live site, with nothing stubbed.

Everything below **works right now**. The one gap is named at the bottom rather
than buried — a demo that fails on stage is worse than a demo that is one step
shorter than you would like.

## Before you start

Two minutes, the morning of.

1. Open `https://unclaimedgrant.com/` in a **fresh private window**. The site
   should paint the individual hero. If it paints anything else, you have a
   stale cookie from testing — that is what private browsing is for.
2. Sign in as operator at `https://unclaimedgrant.com/admin/`. This unlocks
   every paid surface for twelve hours in that browser, which is what lets you
   show the paid product without a subscription.
3. Leave `/admin/` open in a second tab. It is the last thing you show.

If the operator login fails, run `node scripts/admin-password.mjs <email>` and
reseed — see `docs/ADMIN.md`. Do not discover this at 9:58.

## The walk

### 1. The switch — 30 seconds

Land on the home page. Point at the toggle under the eyebrow: **For me / For my
company**.

Click it. The headline, the lede, the nav, the buttons and the pricing all
change. Navigate to another page — it holds.

> "This is two products behind one domain, and the visitor chooses in one click
> rather than being routed by a salesperson."

### 2. The free answer — 2 minutes

Individual side → **Check what you're owed** → United Kingdom → answer four or
five questions, skip one deliberately.

Two things to land:

- The result is a **number**, computed on device. Nothing was uploaded.
- Skipping a question does not produce a confident £0. It says *"41 waiting on
  you — they depend on your residency status and your age, which you skipped."*

> "The free tier is the honest total and the count. It is deliberately useful
> and deliberately not the directory."

Scroll to the locked panel: empty rows, a count, and a price. Note that the
programme names are not in the page at all — not hidden with CSS, not in the
DOM. Open devtools if the room is technical; there is nothing to find.

### 3. The paid product — 2 minutes

Switch to the tab where you are signed in as operator, and reload the result.

The same screen now names all 114 UK programmes, with amounts, deadlines and
application links.

> "Same page, same code. The difference is a server deciding what to send."

### 4. Enterprise — 3 minutes

Toggle to **For my company** → **Grants workspace**.

Signed out it shows the door. Signed in as operator it opens: portfolio,
projects, pipeline across six stages, deadlines, the de minimis ceiling tracker,
post-award obligations, and a generated application pack per opportunity.

Two things worth saying out loud:

- The workspace **syncs to the account**, not to the browser — a second device
  sees the same pipeline, and a concurrent edit is refused with a revision
  conflict rather than silently overwriting a colleague.
- Auto-fill fills what a company register and a stored profile can fill, then
  **names the fields only a human can write**. It does not invent a project
  summary, because a false declaration on a grant application disqualifies the
  applicant.

### 5. The operator dashboard — 2 minutes

The `/admin/` tab. Visitors, sign-ins, country and language splits, and the
funnel: twelve steps, counted by distinct visitor, with the biggest drop-off
named in people rather than percentages.

> "We know where we lose them, by name, and it updates itself."

## The numbers, as of this build

Every figure is computed from the dataset at build time — none are typed in.

| | |
| --- | --- |
| Benefit programmes | 2,216 across 25 countries |
| Human-verified against the official page | 1,015 (46%) |
| Company funding programmes | 1,684 across 77 jurisdictions |
| Languages | 7, full-page, checked by a build test |
| Pages served | ~5,900 static, at no per-request cost |
| Runtime dependencies | none |

The "human-verified" number is the one to lead with if anyone pushes on data
quality. It is a floor, not a claim: the other 54% are sourced and linked, they
just have not had a second pair of eyes.

## The one gap, said plainly

**Card payment and the emailed sign-in code are not switched on yet.** Both are
built, deployed and tested; both need an API key pasted into the Worker —
Stripe's secret key and webhook secret, and a Resend key. `docs/CHROME-SETUP-PROMPT.md`
is a ready-made prompt that does the whole setup in a browser in about fifteen
minutes, including a live test with a `4242` card.

Until that is done:

- **Do not** demo checkout. `/pricing/` → a plan will fail.
- **Do not** demo email sign-in from a fresh account.
- **Do** use the operator login, which needs neither and shows the identical
  paid product.

If an investor asks directly, the honest answer is short: the payment
integration is complete and waiting on a key, and the operator account you are
demoing from is the same entitlement path a paying customer gets — not a mock.

## If something breaks on the day

| Symptom | Cause | Fix |
| --- | --- | --- |
| Paid names do not appear | operator session expired (12h) | sign in again at `/admin/` |
| Site shows the wrong audience | a cookie from earlier testing | private window |
| Workspace shows the sign-in door | not signed in *in that browser* | sign in at `/admin/` first |
| Anything returns 503 | a secret is unset | it is a secret, not a bug — see DEPLOY.md |
