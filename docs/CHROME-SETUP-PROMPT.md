# Prompt for Claude in Chrome — Stripe + email + Cloudflare, end to end

Two short things for you (Aditya), then the prompt itself. Everything below the
horizontal rule is what you paste into Claude in Chrome — paste it whole, in one
message.

**Do these three things first, yourself, before pasting.** They are the only
steps a browser agent cannot or must not do, so doing them up front is what lets
the agent run start-to-finish without bouncing a single question back.

1. Be logged in, in this browser, to: Cloudflare (the account that holds the
   `unclaimedgrant` Worker and the unclaimedgrant.com DNS zone), Stripe, and
   Gmail for aditya.shashidhar55@gmail.com.
2. Create a Resend account at resend.com with that same Gmail address and log
   in. Account creation involves a password, so the agent must not do it. Do not
   add the domain — the agent does that.
3. Leave Stripe in **test mode**. The agent works entirely in test mode and will
   say so at the end; going live is a separate switch you flip when you are
   ready.

**Git is deliberately absent from this prompt.** `origin/main` and my working
copy are identical, every commit is already built and deployed by Cloudflare
Workers Builds, and the extension cannot reach my sandbox filesystem anyway.

**The four `price_...` IDs must come back to me.** They are not secrets — they
appear in the checkout URL. But here is the trap the prompt is built around:
Cloudflare **secrets survive a deploy, plaintext variables do not**. Price IDs
set only in the dashboard get overwritten by the `price_REPLACE_ME` placeholders
in `wrangler.jsonc` on the next push, and checkout then fails with no obvious
cause. So the agent sets them in the dashboard *and* prints them, and you paste
those four lines back to me so I can commit them to the repo.

The two real secrets — `sk_test_...` and `whsec_...` — plus the Resend key go
straight from the provider into the Cloudflare secret field and nowhere else.
They must never appear in the chat.

---

You are completing the payments and transactional-email setup for a live site,
**unclaimedgrant.com**, in my logged-in browser. It runs as one Cloudflare
Worker named `unclaimedgrant`, and the domain's DNS zone is in the same
Cloudflare account. I am already logged in to Cloudflare, Stripe, Resend and
Gmail. Stripe is in test mode and must stay in test mode throughout.

**Run this to completion without asking me anything.** Do not stop for
confirmation, do not ask which option to pick, do not check in at the halfway
point. Every choice you could plausibly need to make is decided for you below —
if something is still not covered, choose the option that is reversible and
lowest-risk, write down what you chose, and keep going. Report once, at the end.
Expect this to take 30–60 minutes, mostly waiting on DNS.

**Two hard rules that override everything else in this prompt:**

1. **Never put a secret into a chat message, a document, a note, a form field it
   does not belong in, or a screenshot you describe.** That means any value
   starting `sk_`, `whsec_` or `re_`. Copy it from the provider and paste it
   directly into the matching Cloudflare secret field, in one motion. If a
   provider will only show a value once and you have not yet opened the
   Cloudflare field, open Cloudflare in a second tab *first*, then reveal.
2. **Stay in Stripe test mode.** If you find yourself on a live-mode page,
   switch back to test mode and redo that step there. Never create a live key.

## Part 1 — Stripe products and prices

Stripe dashboard → Product catalogue. Create **two** products, each with two
recurring prices. Currency **EUR** for all four.

| Product | Price | Interval | Notes |
| --- | --- | --- | --- |
| Unclaimed Grants — Personal | €7 | monthly | single seat |
| Unclaimed Grants — Personal | €50 | yearly | single seat |
| Unclaimed Grants — Business | €49 | monthly | **per seat** |
| Unclaimed Grants — Business | €490 | yearly | **per seat** |

Decisions already made — apply them, do not weigh them up:

- Pricing model: **standard / flat rate**, *not* metered, *not* tiered, *not*
  package pricing. "Per seat" is handled by quantity at checkout, so if Stripe
  offers a "usage is metered" toggle, leave it **off**.
- Billing period: monthly and yearly exactly as in the table. No trial period.
  No setup fee. Tax behaviour: leave at the account default.
- If a product named "Unclaimed Grants — Personal" or "— Business" **already
  exists**: do not create a duplicate. Open it and reuse it. If it already has a
  price at the right amount and interval, reuse that price and record its ID; if
  it has a price at the wrong amount, archive the wrong one and add a correct
  one. Never edit an existing price's amount — Stripe does not allow it and the
  attempt wastes time.
- If a price you need already exists but is **archived**, unarchive it rather
  than creating a second one.
- If you accidentally create something wrong, archive it (never delete) and move
  on.

Record the four price IDs. You will use them in Part 4 and print them at the end.

## Part 2 — Stripe webhook

Stripe → Developers → Webhooks → Add endpoint.

- **Endpoint URL:** `https://unclaimedgrant.com/webhooks/stripe`
- **Events to send:** exactly these five, and nothing else:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Decisions already made:

- API version: whatever Stripe defaults to. Do not pin an older one.
- If an endpoint for that URL **already exists**, open it and edit its event
  list to match the five above exactly — remove extras, add missing ones —
  rather than creating a second endpoint. Two endpoints on one URL means every
  event is delivered twice.
- If Stripe offers "Listen to events on connected accounts", leave it off.
- Do not use the Stripe CLI or a local listener. This is a real HTTPS endpoint.

Reveal the signing secret (`whsec_...`) and copy it. Do not read it out, do not
write it anywhere. Part 4 is where it goes; if you would rather not hold it in
the clipboard across steps, do Part 4's `STRIPE_WEBHOOK_SECRET` row right now
and come back.

## Part 3 — Email for the sign-in code

The site signs people in with a six-digit emailed code and cannot send it until
mail is configured. The Worker calls the **Resend** API and sends from
`hello@unclaimedgrant.com`. I have already created and logged in to the Resend
account, so no sign-up is needed.

1. Resend → Domains → Add domain → `unclaimedgrant.com`. Region: pick the EU
   region if offered (`eu-west-1` / Ireland); otherwise take the default.
2. Resend shows a set of DNS records — typically a DKIM `TXT`, an SPF `TXT` or
   `MX` on a `send` subdomain, and sometimes a DMARC `TXT`. Add every record it
   lists in Cloudflare → the unclaimedgrant.com zone → DNS → Records.
   - Copy names and values **exactly**. If Resend gives a fully-qualified name
     like `resend._domainkey.unclaimedgrant.com` and Cloudflare appends the zone
     automatically, enter just `resend._domainkey` so you do not end up with a
     doubled domain.
   - Every one of these records must be **DNS only (grey cloud)**, never
     proxied. A proxied record will not verify. `TXT` and `MX` records have no
     proxy toggle, which is fine.
   - If a conflicting record already exists (an old SPF `TXT`, or a record at
     the same name from a previous provider): if it is clearly a mail record for
     a provider no longer in use, replace it. If it is an SPF record that would
     collide, merge into a single SPF `TXT` rather than creating two — a domain
     with two SPF records fails SPF entirely.
   - Do not touch the `A`, `AAAA` or `CNAME` records for the apex or `www`.
     Those serve the site; changing them takes the site down.
3. Click Verify. If it does not verify immediately, wait and retry: check again
   after 2 minutes, then 5, then 10, then 15. **Do not stop and ask me** — DNS
   propagation is slow and this is expected. If it is still unverified after
   roughly 30 minutes of retrying, re-read each record side by side with what
   Resend shows, fix any mismatch, and carry on with Part 4 and the payment half
   of Part 5 regardless; then report the email step as blocked with the exact
   record that will not verify.
4. Once verified, Resend → API Keys → Create API Key. Permission: **Sending
   access** (full access is not needed). Domain: unclaimedgrant.com. Copy the
   key. It is shown once. Do not read it out — paste it straight into Cloudflare
   in Part 4.

## Part 4 — Put it into the Worker

Cloudflare dashboard → Workers & Pages → **unclaimedgrant** → Settings →
Variables and Secrets.

Add as **Secret** (encrypted):

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | the Stripe **test** secret key, `sk_test_...` (Stripe → Developers → API keys → Secret key → Reveal) |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from Part 2 |
| `RESEND_API_KEY` | the `re_...` from Part 3 |

Add as **plaintext Variable**, with the four IDs from Part 1:

- `STRIPE_PRICE_PERSONAL_MONTHLY`
- `STRIPE_PRICE_PERSONAL_ANNUAL`
- `STRIPE_PRICE_BUSINESS_MONTHLY`
- `STRIPE_PRICE_BUSINESS_ANNUAL`

Decisions already made:

- If any of these names already exists with a placeholder value such as
  `price_REPLACE_ME`, or with any other stale value, **overwrite it**. Do not
  create a second variable with a suffixed name.
- Names are case-sensitive and must match exactly. A typo here fails silently at
  runtime.
- Set them on the **Production** environment. If the Worker has preview or
  staging environments, ignore them.
- After entering everything, click **Deploy** (or Save and deploy) so the Worker
  picks the values up. Confirm the deployment shows as succeeded before moving
  on; if it fails, read the error, and if it is a transient build error just
  redeploy once.

## Part 5 — Prove it works. Do not assume it.

**Email check.** Open `https://unclaimedgrant.com/account/`, enter
`aditya.shashidhar55@gmail.com`, click "Send me a code". Open Gmail and find a
message with a subject like `123456 is your sign-in code`. Enter that code on
the site. The page must change to a signed-in state showing the email address.

- If nothing arrives within 2 minutes, check Gmail spam, then Resend → Logs, and
  note the delivery status. If Resend shows the send but Gmail does not have it,
  wait 3 more minutes and check once more.
- If Resend shows nothing at all, the `RESEND_API_KEY` secret is wrong or was
  not deployed — re-enter it and redeploy once, then retry.
- Two full attempts is the limit. Then record the failure and continue to the
  payment check anyway; the two are independent.

**Payment check.** While signed in, open `https://unclaimedgrant.com/pricing/`,
choose **Personal annual**, and complete Stripe test checkout with card
`4242 4242 4242 4242`, any future expiry, any three-digit CVC, any postcode. You
should land on `https://unclaimedgrant.com/account/?welcome=1`.

Then confirm both of these:

1. Stripe → Developers → Webhooks → the endpoint → recent deliveries: the
   `checkout.session.completed` attempt shows **200**.
   - A **400** means the signing secret does not match. Go back to Part 2,
     reveal the signing secret again, re-enter it as `STRIPE_WEBHOOK_SECRET` in
     Cloudflare, redeploy, then use Stripe's "Resend" button on that failed
     delivery. Do this correction at most twice.
   - A **404** or **522** means the request is not reaching the Worker — check
     the endpoint URL is exactly `https://unclaimedgrant.com/webhooks/stripe`
     with no trailing slash and no `www`.
2. Back on the site, `https://unclaimedgrant.com/account/` shows an active plan,
   and `https://unclaimedgrant.com/check/` shows real programme names instead of
   locked placeholder rows. Hard-refresh once before concluding it did not work.

If checkout will not even open, the most likely cause is a price ID mismatch:
re-check the four variables in Part 4 against the IDs in Stripe, character for
character.

## Report — once, at the end, and only then

Give me:

1. The four price IDs, in exactly this block, plain text:

```
STRIPE_PRICE_PERSONAL_MONTHLY = price_...
STRIPE_PRICE_PERSONAL_ANNUAL  = price_...
STRIPE_PRICE_BUSINESS_MONTHLY = price_...
STRIPE_PRICE_BUSINESS_ANNUAL  = price_...
```

2. Whether the sign-in email arrived, and how long it took.
3. The webhook response code for `checkout.session.completed`.
4. Whether `/check/` unlocked real programme names after payment.
5. Whether the Resend domain reached Verified, and which records you added.
6. Anything you decided for yourself that was not spelled out above.
7. Anything still not working, with the exact error text.

**Do not include any `sk_`, `whsec_` or `re_` value anywhere in that report**, or
any partial or masked form of one.
