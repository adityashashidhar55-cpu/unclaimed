# Deploying Unclaimed

Three artefacts: a static site, a Cloudflare Worker (paywall + auto-apply API), and an
Expo app for iOS and Android. They share one engine — `src/engine/matcher.js` is
byte-identical in all three, so a rule change lands everywhere at once.

---

## 1. Cloudflare

**Workers with Static Assets, not Pages.** Cloudflare has a
[Pages→Workers migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
and none in the other direction; Pages cannot bind Durable Objects natively and has no
Cron Triggers. Pages is not EOL but it is feature-frozen relative to Workers.

The decisive detail for this project: **static asset requests are free and do not count
against the 100,000 Worker requests/day.** With `run_worker_first` scoped to `/api/*`,
the 4,115 SEO pages cost nothing no matter how much traffic they get. Only the API burns
quota.

```bash
npm i -D wrangler@latest

npx wrangler d1 create unclaimed-prod       # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply unclaimed-prod --remote

npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put SESSION_SIGNING_KEY   # openssl rand -hex 32
npx wrangler secret put RESEND_API_KEY        # optional; magic-link delivery

node src/build.mjs
npx wrangler dev            # http://localhost:8787
npx wrangler deploy
```

Then in the Stripe dashboard add the webhook endpoint `https://<domain>/webhooks/stripe`
for `checkout.session.completed`, `customer.subscription.*` and `invoice.payment_failed`.

### Things that will bite

- **Custom domains on Workers require the domain's nameservers to be on Cloudflare.**
  Pages did not have this restriction.
- Moving off GitHub Pages means `SITE_BASE` changes from `/unclaimed` to empty. Rebuild.
- Free tier caps static assets at **20,000 files**. We ship 4,115 pages — roughly 9,000
  programmes would break it and force the paid plan.
- Go to the **$5/month paid plan the day you take real money.** You do not want a 1027
  rate-limit error on the Stripe webhook endpoint.

### Why D1 and not KV for entitlements

KV is eventually consistent — up to ~60 seconds globally. A user who has just paid would
keep seeing the paywall until propagation caught up, on a different colo, at random.
That is a support ticket every single time. KV's free tier is also 1,000 writes/day,
which caps you at ~500 signups/day. D1 is strongly consistent; use KV only for
read-mostly cached public JSON.

---

## 2. Stripe on Workers

No SDK. `stripe-node` needs `nodejs_compat` and a bundler; the Worker calls the REST API
with `fetch` and verifies webhooks with Web Crypto. Three failure modes are handled
explicitly in `worker/index.js`:

1. **Read the body once, raw.** `request.json()` first and the signature can never match.
2. **HMAC must be async.** Web Crypto has no synchronous digest, so the usual
   `constructEvent` throws `SubtleCryptoProvider cannot be used in a synchronous context`.
3. **Stripe redelivers.** The event id is a primary key in `stripe_events`; a collision
   means already processed.

Only `v1` signatures are trusted. Stripe sends a decoy `v0` on test events to catch
downgrade bugs — verified in the test suite.

### India

Do not sell an auto-renewing subscription in India without reading
[Stripe's India recurring payments docs](https://docs.stripe.com/india-recurring-payments).
RBI's e-mandate framework (consolidated 21 April 2026) requires a registered mandate, a
pre-debit notice 24 hours before every charge, and Stripe therefore **delays collection by
26 hours** — your entitlement logic must not read `processing` as failure. Charges above
₹15,000 need 3DS every time. Worst trap: for a non-INR subscription a mandate is only
created if an India payment method is attached **at subscription creation**; attach it
later and every renewal silently declines.

**Recommendation: sell India as a one-time annual payment** and skip the mandate
machinery entirely.

---

## 3. Mobile

```bash
cd mobile
npm install
npx expo start                    # dev
eas build --platform android --profile preview      # APK to sideload
eas build --platform all --profile production       # store builds
eas submit --platform ios
```

Fill the placeholders in `app.json` (`eas.projectId`) and `eas.json` (Apple ID, ASC app
id, team id, Play service-account JSON) first.

### The subscription is sold on the web, not in-app — on purpose

Apple requires IAP for in-app unlocks and, outside the US, forbids linking out. But a user
who subscribed **on the web** may sign in and use paid content: Apple's multiplatform
allowance. That keeps 100% of revenue in all eight markets and stays out of the
Epic/Apple commission fight entirely.

Current US position (14 Aug 2026): since the April 2025 contempt ruling Apple has been
barred from charging commission on US link-outs, and the guidelines now say entitlements
are **not required** for US storefront apps. But the Ninth Circuit partially reversed in
December 2025, the Supreme Court granted cert on 30 June 2026 with argument in October,
and Apple filed proposed rates on 13 August 2026 (15% standard / 5% Small Business).
**Assume a 5–15% US link-out fee lands in 2027** and keep the StoreKit path implementable.

### Store review — the two things that get benefits apps rejected

Not the category. Both of these are yours to control:

1. **Impersonating government.** No official seals, no CAF/DWP/IRS logos, nothing implying
   official status. Google Play's
   [government information policy](https://support.google.com/googleplay/android-developer/answer/9514050)
   bans apps that "falsely claim affiliation with a government entity or offer, or
   facilitate government services without proper authorization." Complete the
   **Government apps declaration** in Play Console and declare you are not a government
   entity. Put official source URLs in the store listing itself, not just in-app.
2. **IAP (guideline 3.1.1).** Do not argue your content is a "service consumed outside the
   app" under 3.1.3(e). Reviewers read eligibility results as digital content and reject
   it. Ship free + web-subscription sign-in.

Also declare health/sensitive data in Play's Data Safety form — the matcher models
disability and caring circumstances.

Say this in the review notes: **the free check runs entirely in the browser/on device and
answers are not stored server-side unless the user creates an account.** It converts the
reviewer's biggest concern into the selling point.

---

## 4. Where to actually list it

"List it on Cloudflare" is not a thing. The old Cloudflare Apps marketplace is dead —
`cloudflareapps.com` does not even resolve. The Workers template gallery is developer
starter code, and the Partner Network is a B2B reseller programme. Cloudflare is where
the app *runs*; distribution comes from elsewhere.

| Where | Cost | Worth it? |
|---|---|---|
| **Your own domain (PWA)** | £0 | **Primary channel.** No gatekeeper, no commission. |
| **Apple App Store** | $99/yr | Yes. [Mes Allocs](https://apps.apple.com/fr/app/mes-allocs-aides-d%C3%A9marches/id6469999788) — a paid French benefits finder — ships today. Category is approvable. |
| **Google Play** | $25 once | Yes. Government-apps declaration required. |
| **Product Hunt** | £0 | One good launch day. Tue–Thu, 00:01 PT. |
| **AlternativeTo** | £0 | Permanent backlink; ranks for "alternative to Mes Allocs". |
| **Microsoft Store (PWA)** | £0 | Now free for company accounts too. PWABuilder wraps the existing site in minutes. |
| **Samsung Galaxy Store** | £0 | Real share in India. Same AAB. |
| **G2 / Capterra** | £0 basic | B2B-skewed; free listing, low expectations. |
| **F-Droid** | — | **No.** Requires 100% FOSS; a Stripe paywall disqualifies it. |
| **Setapp / AppSumo** | — | **No.** Bundle/lifetime-deal economics are wrong for a data-curation product. |

For a benefits product the real distribution is not app stores. It is
[beta.gouv.fr](https://beta.gouv.fr/startups/mes-aides.html) and the OpenFisca ecosystem
in France, Les Pépites Tech, aide-sociale.fr, and Citizens Advice / Turn2us referral
routes in the UK.

**EU compliance, which matters more than any store:** the Consumer Rights Directive gives
a 14-day withdrawal right on subscriptions, and from June 2026 the **European
Accessibility Act** applies to consumer e-commerce — EN 301 549 / WCAG 2.1 AA. An app for
low-income and disabled users that fails accessibility is exposed in FR, DE, ES, IT and
PT. The site already targets AA; keep it there.

---

## 5. What is NOT done

- Nothing here has been installed, compiled or deployed. The build sandbox has no npm
  registry access, so `wrangler dev`, `expo start` and every store build are **unrun**.
  See `docs/status.md` for exactly what was and was not verified.
- Stripe products and prices do not exist yet. `STRIPE_PRICE_MONTHLY` is a placeholder.
- No legal review. `packages/policy/index.js` encodes research, not advice. France
  (L554-2), Germany (RDG) and Italy (patronato) need local counsel before you charge
  anyone. Portugal is genuinely unresolved.
