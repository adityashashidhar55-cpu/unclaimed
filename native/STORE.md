# Store submission — Unclaimed Grants

Everything a reviewer or a listing form asks for, written out. Copy from here
rather than improvising in the console at 11pm.

**Bundle ID / package:** `com.unclaimedgrant.app`
**Category:** Finance (primary) · Productivity (secondary)
**Content rating:** Everyone / 4+
**Price:** Free, with an optional subscription sold on the web

---

## Listing copy

### App name
`Unclaimed Grants`

### Subtitle (iOS, 30 char max)
`Money you're owed, found`

### Short description (Play, 80 char max)
`Find the benefits and grants you qualify for. Works offline. No account.`

### Full description

> Most government money goes unclaimed because nobody can find it. Rent
> support, family payments, energy help, transport concessions, tax credits,
> startup grants — all published, all real, and scattered across thousands of
> pages nobody reads.
>
> Unclaimed Grants collects 3,900 programmes across 77 jurisdictions, each one
> linked to the funding body's own page with the date we last checked it, and
> tells you which ones you qualify for.
>
> **Answer a few questions. See the number.**
> How much you could be owed per year, how many programmes it comes from, and
> how many pay out automatically. Free forever, and it never asks who you are.
>
> **It runs on your phone, not our servers.**
> The eligibility check happens entirely on this device against data stored in
> the app. It works in airplane mode. Your answers are not sent anywhere and we
> could not read them if we wanted to.
>
> **Never miss a deadline again.**
> Grants close. Get a reminder before each one does, and another when a closed
> programme is due to reopen — we track 227 closed programmes with their
> expected return dates, because a grant you miss by a week is worth nothing.
>
> **Keep your paperwork once.**
> Every claim wants a payslip, a proof of address, a birth certificate. Store
> each one once, locked behind Face ID or your fingerprint, and every later
> claim that asks for it is already answered. Files are encrypted on your
> device before they ever reach us.
>
> **What we don't do**
> We never sign in to a government website as you. We never submit on your
> behalf. Every application is sent by you, from your own account — a benefits
> declaration is sworn by the person making it, and keeping it yours is what
> protects you.
>
> Unclaimed Grants is a discovery tool, not legal, tax or financial advice. Only
> the official body named on each programme can confirm what you are entitled
> to.

### Keywords (iOS, 100 char)
`grants,benefits,welfare,funding,startup,subsidy,claim,deadline,tax credit,allowance`

---

## Review notes — paste this into the submission

> The free eligibility check runs entirely on the device against a dataset
> bundled in the app. No account is required and no user data is transmitted to
> our servers for the core function; the app works fully in airplane mode.
>
> We are not affiliated with any government. Every programme record links to
> the official funding body's own page, and the app displays the source URL and
> the date it was last verified. No official seals, crests or agency logos are
> used anywhere in the app.
>
> The optional subscription is sold on our website and unlocks additional
> content for signed-in users. There is no purchase flow inside the app.
>
> Notifications are local only (scheduled deadline reminders). No push server.
>
> To test: open the app, tap "Start the check", choose United Kingdom, enter
> any age, and select any options. Results appear immediately with no sign-in.

---

## The two things that get this category rejected

**1. Impersonating government.** Google Play's government-information policy
bans apps that "falsely claim affiliation with a government entity or offer, or
facilitate government services without proper authorization." Mitigations, all
already in the build:

- no official seals, crests, flags-as-authority or agency logos;
- every programme page names the funder and links to their site;
- the disclaimer bar appears on every screen with programme data;
- complete the **Government apps declaration** in Play Console and declare you
  are *not* a government entity;
- put official source URLs in the store listing itself, not only in-app.

**2. Minimum functionality (Apple 4.2).** A wrapped website gets rejected. This
is not one, and the review notes should say why: the matcher runs locally, the
dataset is bundled, deadlines become OS notifications scheduled months ahead,
the vault is gated by biometrics, and exports go through the native share
sheet. Those are four things a browser tab cannot do.

**On IAP (Apple 3.1.1):** do not argue the content is a "service consumed
outside the app" under 3.1.3(e) — reviewers read eligibility results as digital
content and reject that argument. Ship free, with the subscription sold on the
web and unlocked by signing in. That is Apple's multiplatform allowance and it
is explicitly permitted.

---

## Play Data Safety form

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** (only if the user creates an optional account) |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | Yes — in-app and by email |

**Data types.** Declare only these, and only for the optional account:

- **Personal info → Email address** — Collected, not shared. Purpose: account
  management. Optional (required only to sign in).
- **Financial info → Other financial info** — Collected, not shared. Purpose:
  app functionality. Optional. *The income band and household details used for
  matching. Note in the form that this is processed on-device for the free
  check and only stored if the user creates an account.*
- **Files and docs** — Collected, not shared. Purpose: app functionality.
  Optional. *End-to-end encrypted on device; we cannot read them.*

**Do not declare:** location, contacts, messages, photos, health, device or
other IDs, or app activity — none are collected.

**Health note.** The matcher models disability and caring circumstances as
eligibility inputs. That is user-supplied and processed on-device for the free
check. If you later store it server-side, declare **Health and fitness → Health
info** and be conservative.

---

## App Store privacy labels

- **Data Not Collected** for the app's core function.
- If the optional account is enabled: **Contact Info → Email Address**, linked
  to identity, used for App Functionality only. Not used for tracking.
- Set **"Does this app use the Advertising Identifier?"** to No.

---

## Screenshots to capture

Six per platform, from a real device or simulator, dark UI on black:

1. Home — the four tiles, "The money you are owed."
2. The check — the question flow mid-answer
3. Results — the total, with the programme list beneath
4. A programme with a **Closing in 9 days** status chip
5. Deadlines — grouped by urgency, showing a reopening date
6. Documents — the biometric unlock

Required sizes: iPhone 6.9" (1320×2868) and 6.5" (1242×2688); Android phone
(min 1080px on the short edge) plus a 7" and 10" tablet set if you list for
tablets.

---

## Runbook

Nothing below can be done for you — each step needs an account only you can
open, or a key only you should hold.

**One-off setup**

1. Apple Developer Program — $99/yr. An organisation account needs a D-U-N-S
   number, which can take a week; a sole-trader account is same-day.
2. Google Play Console — $25 once. New personal accounts must run a **closed
   test with 12 testers for 14 days** before production access. Start that
   clock early; it is the longest pole in the whole launch.
3. Create the app record in both consoles with the bundle ID above.
4. Generate the Android upload keystore and **back it up somewhere you will
   still have in five years**:
   ```
   keytool -genkey -v -keystore upload.keystore -alias unclaimedgrant \
     -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.keystore     # → ANDROID_KEYSTORE_BASE64 secret
   ```
5. Add every secret listed at the bottom of `.github/workflows/mobile.yml`.

**Every release**

```
git tag v1.0.0 && git push --tags        # CI builds both binaries
```
or run the **Mobile apps** workflow by hand with `submit: true`.

**First submission**

- Android: upload to the `internal` track, add testers, promote to production
  once the 14-day requirement is satisfied.
- iOS: the build appears in App Store Connect ~15 minutes after upload; attach
  it to a version, paste the review notes above, submit.

Expect 1–3 days for Apple review and a few hours to a few days for Google.
