# Prompt for Claude in Chrome — Stripe + email + Cloudflare secrets

Paste everything between the lines into Claude in Chrome. It is written for an
agent driving your logged-in browser.

Two things to know before you start.

**Git is not in this prompt, on purpose.** There is nothing to push —
`origin/main` and my working copy are identical, and every commit is already
deployed by Cloudflare Workers Builds. The Chrome extension also has no access
to my sandbox filesystem, so it could not push my commits even if there were
any. Pushing *is* the deploy: any commit to `main` triggers a build.

**The four Stripe price IDs are not secrets and must come back to me.** Price
IDs appear in the checkout URL anyway. They live in `wrangler.jsonc` in the
repo, and here is the trap: if they are only set in the Cloudflare dashboard as
variables, the next `wrangler deploy` overwrites them with the `price_REPLACE_ME`
placeholders and checkout breaks with no obvious cause. Secrets survive a
deploy; plaintext variables do not. So the prompt sets them in both places and
asks the agent to print them, and you paste those four lines back to me so I can
commit them.

The two actual secrets — the Stripe secret key and the webhook signing secret —
go straight from Stripe into the Cloudflare secret field and nowhere else. Do
not paste them into this chat, and do not paste them back to me.

---

You are setting up payments and transactional email for a live site,
**unclaimedgrant.com**. It runs as a single Cloudflare Worker named
`unclaimedgrant` in the Cloudflare account for aditya.shashidhar55@gmail.com.
The domain's DNS is in that same Cloudflare account. I am already logged in to
Cloudflare and Stripe in this browser.

Work through the three parts in order and tell me the result of each. If you hit
something ambiguous, stop and ask rather than guessing.

**Rule for the whole task: never type a secret value into a chat message, a
document, or any field other than the one it belongs in.** Copy it from the
provider and paste it directly into the Cloudflare secret field. If you cannot
do that in one step, tell me and I will do that step myself.

## Part 1 — Stripe products and prices

In the Stripe dashboard, in **test mode** first, create one product with four
recurring prices. Currency EUR for all four.

| Product | Price | Interval | Notes |
| --- | --- | --- | --- |
| Unclaimed Grants — Personal | €7 | monthly | single seat |
| Unclaimed Grants — Personal | €50 | yearly | single seat |
| Unclaimed Grants — Business | €49 | monthly | **per seat** — set "usage is metered" off, quantity billing on |
| Unclaimed Grants — Business | €490 | yearly | **per seat** |

You can put all four prices on two products (Personal, Business) rather than
four separate products — the Worker only ever references price IDs.

When they exist, print the four price IDs in plain text, labelled exactly like
this, so I can paste them back to the developer:

```
STRIPE_PRICE_PERSONAL_MONTHLY = price_...
STRIPE_PRICE_PERSONAL_ANNUAL  = price_...
STRIPE_PRICE_BUSINESS_MONTHLY = price_...
STRIPE_PRICE_BUSINESS_ANNUAL  = price_...
```

## Part 2 — Stripe webhook

Add a webhook endpoint in Stripe:

- **URL:** `https://unclaimedgrant.com/webhooks/stripe`
- **Events**, exactly these five and no others:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Stripe will show a signing secret starting `whsec_`. Do not read it out. Reveal
it and copy it — you will paste it into Cloudflare in Part 4.

## Part 3 — Email for the sign-in code

The site signs people in with a six-digit code, and it cannot send that code
until a mail provider is configured. The Worker calls the **Resend** API and
sends from `hello@unclaimedgrant.com`.

1. Go to resend.com. If there is no account yet, stop and tell me — I will
   create it, then you can carry on.
2. Add and verify the domain **unclaimedgrant.com**. Resend will show DKIM,
   SPF and a return-path record. Add those records in the Cloudflare DNS for
   unclaimedgrant.com (same account, DNS → Records). Set them exactly as Resend
   gives them, **DNS only** (grey cloud), not proxied — a proxied DKIM record
   will not verify.
3. Wait for Resend to show the domain as Verified.
4. Create an API key with send permission. Copy it. Do not read it out.

## Part 4 — Put it all into the Worker

Cloudflare dashboard → **Workers & Pages** → **unclaimedgrant** → **Settings** →
**Variables and Secrets**.

Add these as **Secret** (encrypted), not as plaintext variables:

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | the Stripe test secret key, `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from Part 2 |
| `RESEND_API_KEY` | the Resend key from Part 3 |

Add these as **plaintext Variable**, using the four price IDs from Part 1:

- `STRIPE_PRICE_PERSONAL_MONTHLY`
- `STRIPE_PRICE_PERSONAL_ANNUAL`
- `STRIPE_PRICE_BUSINESS_MONTHLY`
- `STRIPE_PRICE_BUSINESS_ANNUAL`

Deploy / save so the Worker picks them up.

## Part 5 — Prove it works, do not assume it

Two checks. Report exactly what you see, including failures.

**Email.** Open `https://unclaimedgrant.com/account/`, enter
`aditya.shashidhar55@gmail.com`, click "Send me a code". Then open Gmail and
confirm a message titled like `123456 is your sign-in code` arrived. Enter the
code on the site and confirm the page changes to a signed-in state showing the
email address. If the code does not arrive within two minutes, check Resend's
Logs tab and tell me what the delivery status says.

**Payment.** While signed in, go to `https://unclaimedgrant.com/pricing/`,
choose the Personal annual plan, and complete Stripe test checkout with card
`4242 4242 4242 4242`, any future expiry, any CVC. You should land back on
`/account/?welcome=1`. Then confirm two things:

1. In Stripe → Developers → Webhooks, the `checkout.session.completed` delivery
   shows a **200** response, not a 4xx. A 400 here means the signing secret is
   wrong.
2. Back on the site, the account page shows an active plan, and
   `https://unclaimedgrant.com/check/` now shows real programme names rather
   than locked placeholder rows.

If either fails, paste the exact error text and the Stripe webhook response
body. Do not retry blindly more than twice.

## When you are done

Report:

- the four price IDs, in the labelled block from Part 1
- whether the sign-in email arrived, and how long it took
- the webhook response code for `checkout.session.completed`
- whether the paid programme list unlocked after payment
- anything you could not do and why

Do not include any `sk_`, `whsec_` or `re_` value in that report.
