/**
 * UNCLAIMED — Cloudflare Worker.
 *
 * Serves the 4,000-page static site (free, at no request cost) and the gated
 * API (paid). One deployment, one origin, no Node runtime.
 *
 * The paywall line, per the product decision:
 *   FREE  — how much money you're owed. The figure, the counts, the buckets.
 *   PAID  — which schemes, how to claim them, and the prepared applications.
 *
 * Enforced server-side. The free tier returns totals computed from the full
 * match; it never ships the programme list to an unentitled client, because a
 * paywall you can defeat with devtools is a suggestion.
 *
 * Zero npm dependencies: Stripe is called over its REST API with fetch, and
 * webhook signatures are verified with Web Crypto. `stripe-node` would need
 * nodejs_compat and a bundler; this needs neither.
 */

import { match } from '../src/engine/matcher.js';
import { buildPlan, buildPackage, recordConsent } from '../packages/autoapply/index.js';
import { policyFor, mayCharge, mayChargeFor, PRODUCT, PRICING } from '../packages/policy/index.js';
import { DOC_TYPES, expiresAt, KDF_ITERATIONS } from '../packages/vault/index.js';
import { matchStartup, reachFor } from '../src/engine/startup.js';
import { planWithinCeiling, declarationText, headroom } from '../packages/stateaid/index.js';
import { lookupCompany, projectCompany, autofillAvailable } from '../packages/registry/index.js';
import { isStep, funnelRows, worstDrop } from '../packages/analytics/index.js';

/**
 * Every JSON response this Worker sends is per-user and must never be cached.
 *
 * `/api/me` went out with no cache headers at all, so Cloudflare's own edge
 * cached the `{"signed_in": false}` it returned before anybody logged in and
 * kept serving it afterwards — sign-in worked, the cookie was set, the paid
 * dataset came back unlocked, and the account page still said signed out
 * because it was reading a cached answer.
 *
 * That is the mild version of the bug. The severe version is the same
 * mechanism with the entitlement in it: one subscriber's answer cached at an
 * edge and handed to the next person through it. `private` keeps it out of
 * shared caches, `no-store` keeps it out of the browser's, and `Vary: Cookie`
 * is belt and braces for anything that ignores both.
 */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store, max-age=0, must-revalidate',
  vary: 'Cookie',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });

const bad = (msg, status = 400) => json({ error: msg }, status);

/* ------------------------------------------------------------------ */
/* Crypto helpers (Web Crypto only — no node:crypto in Workers)        */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Constant-time compare — never leak signature validity through timing. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(s) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/* ------------------------------------------------------------------ */
/* Sessions — signed cookie, no server-side session store              */
/* ------------------------------------------------------------------ */

/**
 * The key every session cookie is signed with.
 *
 * It used to be a `wrangler secret`, which meant sign-in was broken until
 * somebody remembered to set it — and a missing secret does not announce
 * itself, it just makes every cookie unverifiable, so the symptom is "sign-in
 * silently does nothing for everyone". That is exactly the failure this
 * deployment shipped with.
 *
 * So the Worker provisions its own on first use and keeps it in D1. The trust
 * boundary is unchanged: a Cloudflare secret is readable by this Worker, and
 * so is its own D1 database — nothing else can read either. What changes is
 * that there is no setup step left to forget.
 *
 * `env.SESSION_SIGNING_KEY` still wins if it is set, so rotating by hand stays
 * possible, and an existing deployment keeps every live session.
 *
 * Cached per isolate. The read is one indexed lookup, but it is on the path of
 * every authenticated request and there is no reason to pay for it twice.
 */
let SIGNING_KEY_CACHE = null;

async function signingKey(env) {
  if (env.SESSION_SIGNING_KEY) return env.SESSION_SIGNING_KEY;
  if (SIGNING_KEY_CACHE) return SIGNING_KEY_CACHE;

  const row = await env.DB.prepare("SELECT value FROM worker_config WHERE key = 'session_signing_key'").first();
  if (row?.value) {
    SIGNING_KEY_CACHE = row.value;
    return SIGNING_KEY_CACHE;
  }

  const fresh = toHex(crypto.getRandomValues(new Uint8Array(32)));
  /* INSERT OR IGNORE, then read back. Two isolates can reach this line at the
     same moment on a cold deploy; whichever loses the race must adopt the
     winner's key rather than overwrite it, or the first users to sign in are
     signed out again a second later. */
  await env.DB.prepare(
    "INSERT OR IGNORE INTO worker_config (key, value, created_at) VALUES ('session_signing_key', ?, ?)",
  )
    .bind(fresh, Date.now())
    .run();
  const settled = await env.DB.prepare("SELECT value FROM worker_config WHERE key = 'session_signing_key'").first();
  SIGNING_KEY_CACHE = settled?.value ?? fresh;
  return SIGNING_KEY_CACHE;
}

async function signSession(env, payload) {
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const sig = toHex(await hmac(enc.encode(await signingKey(env)), body));
  return `${body}.${sig}`;
}

/**
 * The session, from a cookie or a bearer token.
 *
 * The web sends a cookie, which JavaScript cannot read and an injected script
 * therefore cannot steal. The packaged app cannot: Capacitor serves from
 * `https://localhost`, so every API call is cross-origin and a SameSite=Lax
 * cookie is simply not attached. It sends the same signed string as a bearer
 * token instead.
 *
 * Both carry identical authority because both are the same value — this adds a
 * second envelope, not a second kind of credential. What it does add is an
 * XSS-readable copy on device, which is why only the app is ever handed one:
 * `/auth/verify` returns the session in the body only when the client asks,
 * and only the app asks.
 */
async function readSession(env, cookieHeader, authHeader) {
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader || '')?.[1]?.trim();
  const cookie = (cookieHeader || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('ua_session='));
  const token = bearer || (cookie ? cookie.slice('ua_session='.length) : null);
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = toHex(await hmac(enc.encode(await signingKey(env)), body));
  if (!timingSafeEqual(sig, expect)) return null;
  try {
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Entitlement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Whether this user may see paid content.
 *
 * `product` matters. DISCOVERY — the compiled database and the eligibility
 * calculator — is sold in every country: publishing sourced reference material
 * is not intermediation anywhere in the dataset. ASSISTANCE — drafting the
 * user's letter and projecting their answers onto an agency form — is the
 * conduct France, Germany and Italy regulate, so there it is given away rather
 * than shown behind a wall we are not allowed to charge them to cross.
 */
async function entitlementFor(env, session, country, product = PRODUCT.DISCOVERY) {
  /* An operator session is entitled to everything, everywhere. This is how the
     owner reviews the paid product without holding a subscription, and it is
     deliberately a property of the SESSION rather than a row in entitlements:
     revoking it is rotating one secret, not editing anyone's billing. */
  if (session?.adm) return { entitled: true, reason: 'admin', product, admin: true };
  if (!mayChargeFor(country, product)) {
    return { entitled: true, reason: 'free_in_jurisdiction', product, policy: policyFor(country) };
  }
  const userId = session?.uid;
  if (!userId) return { entitled: false, reason: 'anonymous' };

  const row = await env.DB.prepare(
    'SELECT status, plan, current_period_end FROM entitlements WHERE user_id = ?',
  )
    .bind(userId)
    .first();

  if (!row) return { entitled: false, reason: 'no_subscription' };
  const live = row.status === 'active' || row.status === 'trialing';
  const notExpired = !row.current_period_end || row.current_period_end * 1000 > Date.now();
  return {
    entitled: live && notExpired,
    reason: live ? (notExpired ? 'active' : 'expired') : row.status,
    plan: row.plan,
  };
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/**
 * The full dataset, which the public files are not.
 *
 * /api/v1/programmes/{cc}.json ships with every record past the second one
 * stripped of its name, funder, links and prose, so that gating the pages is
 * not undone by one curl. The Worker needs the whole thing to answer a paid
 * check, so the build also emits an unstripped copy under /api/v1/full/. That
 * prefix is inside run_worker_first, and the router below refuses every
 * external request to it — env.ASSETS.fetch does not re-enter the router, so
 * this code can read what no visitor can.
 */
async function loadFullAsset(env, request, rel) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/full/${rel}`;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  return res.ok ? res.json() : null;
}

async function loadCountry(env, request, cc) {
  const full = await loadFullAsset(env, request, `programmes/${cc}.json`);
  if (full) return full;
  /* No full copy deployed (an older build). Fall back to the public file
     rather than 500: a stripped answer is wrong-ish, a broken one is worse. */
  const url = new URL(request.url);
  url.pathname = `/api/v1/programmes/${cc}.json`;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) return null;
  return res.json();
}

async function loadManifest(env, request) {
  const url = new URL(request.url);
  url.pathname = '/api/v1/countries.json';
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  return res.ok ? res.json() : null;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * POST /api/check — the free half.
 *
 * Returns the money figure and the shape of the result. Deliberately returns
 * NO programme names, amounts or steps to an unentitled caller: the teaser is
 * "you are owed X across Y schemes", and X is the honest computed number.
 */
async function handleCheck(request, env) {
  const profile = await request.json().catch(() => null);
  if (!profile?.country_code) return bad('country_code required');

  const cc = String(profile.country_code).toLowerCase();
  const data = await loadCountry(env, request, cc);
  const manifest = await loadManifest(env, request);
  if (!data || !manifest) return bad('unknown country', 404);

  const entry = manifest.countries.find((c) => c.slug === cc);
  const result = match(profile, data, entry);

  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  const ent = await entitlementFor(env, session, cc);

  /* Free payload — the number, never the list. */
  const free = {
    country: entry.name,
    currency: result.currency,
    total_min: result.total_min,
    total_max: result.total_max,
    counts: {
      eligible: result.eligible.length,
      tapered: (result.tapered || []).length,
      conditional: result.conditional.length,
      needs_answer: result.needs_one_more_answer.length,
      not_eligible: result.not_eligible.length,
      automatic: result.eligible.filter((m) => m.programme.is_automatic).length,
      must_apply: result.eligible.filter((m) => !m.programme.is_automatic).length,
      unpriced: result.unpriced_count,
    },
    /* Category breakdown is a shape, not a scheme list — enough to make the
       number feel real without giving away what you're paying for. */
    by_category: result.eligible.reduce((acc, m) => {
      acc[m.programme.category] = (acc[m.programme.category] || 0) + 1;
      return acc;
    }, {}),
    data_as_of: result.data_as_of,
    disclaimer: result.disclaimer,
    entitled: ent.entitled,
    paywall: ent.entitled ? null : { reason: ent.reason, unlocks: 'schemes, steps, documents and prepared applications' },
  };

  if (!ent.entitled) return json(free);

  /* Paid payload — everything. */
  const strip = (m) => ({
    slug: m.programme.slug,
    name_en: m.programme.name_en,
    name_local: m.programme.name_local,
    funder: m.programme.funder,
    category: m.programme.category,
    amount_min: m.programme.amount_min,
    amount_max: m.programme.amount_max,
    amount_period: m.programme.amount_period,
    amount_note: m.programme.amount_note,
    is_automatic: m.programme.is_automatic,
    application_url: m.programme.application_url,
    documents_required: m.programme.documents_required,
    procedure_steps: m.programme.procedure_steps,
    source_url: m.programme.source_url,
    last_verified_at: m.programme.last_verified_at,
    verification_status: m.programme.verification_status,
    rules_met: m.rules_met,
    rules_failed: m.rules_failed,
    est_annual_max: m.est_annual_max,
    condition_label: m.condition_label ?? null,
    taper_note: m.taper_note ?? null,
  });

  return json({
    ...free,
    eligible: result.eligible.map(strip),
    tapered: (result.tapered || []).map(strip),
    conditional: result.conditional.map(strip),
    needs_one_more_answer: result.needs_one_more_answer.map(strip),
    coverage_note: result.coverage_note,
  });
}

/**
 * POST /api/apply/plan — the moat, gated.
 * Builds submission-ready packages for everything the user qualifies for.
 */
async function handlePlan(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const { profile, lang = 'en' } = await request.json().catch(() => ({}));
  if (!profile?.country_code) return bad('country_code required');

  const cc = String(profile.country_code).toLowerCase();
  const ent = await entitlementFor(env, session, cc, PRODUCT.ASSISTANCE);
  if (!ent.entitled) return json({ error: 'subscription required', paywall: ent }, 402);

  const data = await loadCountry(env, request, cc);
  const manifest = await loadManifest(env, request);
  if (!data || !manifest) return bad('unknown country', 404);
  const entry = manifest.countries.find((c) => c.slug === cc);

  const result = match(profile, data, entry);

  /* Metadata only — types and dates. Enough to say "you already have this",
     which is all the plan needs; the bytes stay encrypted and untouched. */
  const { results: holdings } = await env.DB.prepare(
    'SELECT id, doc_type AS type, checksum, issued_at, created_at FROM vault_documents WHERE user_id = ?',
  )
    .bind(session.uid)
    .all();

  const plan = buildPlan({
    profile,
    matches: result.eligible,
    entry,
    lang,
    holdings: holdings ?? [],
    asOf: Date.now(),
  });

  return json({
    country: entry.name,
    policy: policyFor(cc),
    ready_count: plan.ready_count,
    gaps: plan.gaps,
    packages: plan.packages.map(({ pkg }) => pkg),
  });
}

/**
 * POST /api/apply/consent — record what the user was shown and affirmed.
 * Written BEFORE any package is handed over for submission.
 */
async function handleConsent(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const { programme_slug, country, attestations, values } = await request.json().catch(() => ({}));
  if (!programme_slug || !Array.isArray(attestations) || !attestations.length) {
    return bad('programme_slug and attestations required');
  }

  const rec = recordConsent({
    userId: session.uid,
    programmeSlug: programme_slug,
    attestations,
    values: values ?? {},
    at: Date.now(),
    ip: request.headers.get('cf-connecting-ip'),
    userAgent: request.headers.get('user-agent'),
  });

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO consents (id, user_id, programme_slug, country, attested_text, values_digest, consented_at, ip, user_agent, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      rec.user_id,
      rec.programme_slug,
      String(country || '').toLowerCase(),
      JSON.stringify(rec.attested_text),
      rec.values_digest,
      rec.consented_at,
      rec.ip,
      rec.user_agent,
      rec.scope,
    )
    .run();

  return json({ ok: true, consent_id: id, recorded_at: rec.consented_at });
}

/* ------------------------------------------------------------------ */
/* Auth — email + one-time code, no passwords                          */
/* ------------------------------------------------------------------ */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = { email: 5, ip: 20 };

/**
 * Six digits, uniformly distributed.
 *
 * `Math.random()` is not acceptable here and `% 1000000` on a 32-bit draw is
 * only very slightly biased — but this is the single secret standing between a
 * stranger and someone's benefits profile, so it is drawn from the CSPRNG and
 * rejection-sampled rather than folded.
 */
function sixDigitCode() {
  const LIMIT = 4294000000; // largest multiple of 1e6 below 2^32
  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= LIMIT);
  return String(n % 1000000).padStart(6, '0');
}

/** Per-row salt: two identical codes must not produce identical hashes. */
async function hashCode(code, salt) {
  return sha256Hex(`${salt}:${code}`);
}

/**
 * Fixed-window counter. Coarse on purpose — the goal is to stop this endpoint
 * being a free mail cannon aimed at arbitrary addresses, not to police a burst
 * of three legitimate retries.
 */
async function underSendLimit(env, bucket, limit) {
  const window = Math.floor(Date.now() / 3600000);
  await env.DB.prepare(
    `INSERT INTO send_log (bucket, window, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window) DO UPDATE SET count = count + 1`,
  )
    .bind(bucket, window)
    .run();
  const row = await env.DB.prepare('SELECT count FROM send_log WHERE bucket = ? AND window = ?')
    .bind(bucket, window)
    .first();
  return (row?.count ?? 0) <= limit;
}

async function sendCodeEmail(env, email, code) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Unclaimed Grants <hello@unclaimedgrant.com>',
      to: email,
      subject: `${code} is your sign-in code`,
      text:
        `Your Unclaimed Grants sign-in code is:\n\n    ${code}\n\n` +
        `It expires in 10 minutes and can be used once.\n\n` +
        `If you did not ask to sign in, ignore this email — nobody can get in without this code.`,
    }),
  });
  return res.ok;
}

/**
 * POST /auth/request — { email, account_type? } → sends a code.
 *
 * Always answers the same way whether or not the address has an account.
 * Telling an anonymous caller "no such user" turns this into a free membership
 * oracle, and for a benefits product the membership list is itself sensitive.
 */
async function handleAuthRequest(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const accountType = body.account_type === 'business' ? 'business' : 'individual';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('valid email required');

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const okEmail = await underSendLimit(env, `email:${email}`, MAX_SENDS_PER_HOUR.email);
  const okIp = await underSendLimit(env, `ip:${ip}`, MAX_SENDS_PER_HOUR.ip);
  if (!okEmail || !okIp) {
    return json({ error: 'too_many_requests', message: 'Too many codes requested. Try again in an hour.' }, 429);
  }

  /* Supersede any code still outstanding for this address, so a second request
     cannot leave two valid codes alive at once. */
  await env.DB.prepare('UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL')
    .bind(Date.now(), email)
    .run();

  const code = sixDigitCode();
  const salt = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO login_codes (id, email, code_hash, salt, expires_at, requested_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), email, await hashCode(code, salt), salt, Date.now() + CODE_TTL_MS, ip, Date.now())
    .run();

  const sent = await sendCodeEmail(env, email, code);

  /* With no mail provider configured the code comes back in the response so
     the flow is testable end to end. Guarded by an explicit env flag: shipping
     this to production would hand every account away. */
  const devEcho = !sent && env.ALLOW_DEV_CODE_ECHO === 'true' ? { dev_code: code } : {};
  return json({ ok: true, sent, account_type: accountType, expires_in: CODE_TTL_MS / 1000, ...devEcho });
}

/**
 * POST /auth/verify — { email, code } → session cookie.
 *
 * Attempts are counted on the stored row, not in memory: a Worker isolate is
 * not a place to keep state, and an attacker who can spread six-digit guesses
 * across isolates would otherwise face no limit at all.
 */
async function handleAuthVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '').trim();
  const accountType = body.account_type === 'business' ? 'business' : 'individual';

  if (!/^\d{6}$/.test(code)) return bad('six-digit code required');

  const row = await env.DB.prepare(
    `SELECT id, code_hash, salt, expires_at, attempts, consumed_at
       FROM login_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(email)
    .first();

  const invalid = () => json({ error: 'invalid_code', message: 'That code is wrong or has expired.' }, 401);

  if (!row || row.consumed_at || row.expires_at < Date.now()) return invalid();
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
    return json({ error: 'too_many_attempts', message: 'Too many wrong codes. Request a new one.' }, 429);
  }

  await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();

  const expected = await hashCode(code, row.salt);
  if (!timingSafeEqual(expected, row.code_hash)) return invalid();

  await env.DB.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').bind(Date.now(), row.id).run();

  const now = Date.now();
  let user = await env.DB.prepare('SELECT id, account_type FROM users WHERE email = ?').bind(email).first();
  const isNewUser = !user;
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, email, account_type, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, email, accountType, now, now)
      .run();
    user = { id, account_type: accountType };
  } else {
    /* Reaching a verified state is one-way. An existing individual who signs
       in through the business door is not silently converted — that would move
       them onto a different price. */
    await env.DB.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
      .bind(now, user.id)
      .run();
  }

  /* A business account owns an organisation, and the organisation owns the
     workspace. Created on first business sign-in rather than asked for in a
     form: nobody wants a "name your organisation" step before they have seen
     the product, and the name is editable in the workspace afterwards.
     Individual accounts get no org — a solo business user's workspace is keyed
     to them directly, and joining an org later moves the row. */
  if (user.account_type === 'business') {
    const member = await env.DB.prepare('SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1')
      .bind(user.id)
      .first();
    if (!member) {
      const orgId = crypto.randomUUID();
      /* Named from the email domain, which is right far more often than not
         for a business address and harmless when it is not. Free-mail domains
         would produce "Gmail", so those fall back to the local part. */
      const domain = email.split('@')[1] ?? '';
      const freeMail = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me'];
      const label = freeMail.includes(domain) ? email.split('@')[0] : domain.split('.')[0];
      const name = label ? label[0].toUpperCase() + label.slice(1) : 'My organisation';
      await env.DB.prepare(
        'INSERT INTO orgs (id, name, domain, owner_id, seats, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      )
        .bind(orgId, name, freeMail.includes(domain) ? null : domain || null, user.id, now)
        .run();
      await env.DB.prepare(
        "INSERT INTO org_members (org_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)",
      )
        .bind(orgId, user.id, now)
        .run();
    }
  }

  /* The admin dashboard's "who signed in" table. Written here rather than
     derived from `users.created_at`, because a sign-in is an event and an
     account is a row — a returning user creates no row at all, and they are
     exactly who the retention number is about. */
  await env.DB.prepare(
    `INSERT INTO login_events (id, ts, day, user_id, email, account_type, is_new, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'otp')`,
  )
    .bind(
      crypto.randomUUID(),
      now,
      new Date(now).toISOString().slice(0, 10),
      user.id,
      email,
      user.account_type,
      isNewUser ? 1 : 0,
    )
    .run();

  const cookie = await signSession(env, {
    uid: user.id,
    email,
    typ: user.account_type,
    exp: now + 30 * 864e5,
  });

  /* The packaged app asks for the session in the body because it cannot use
     the cookie — see readSession(). Everyone else gets the cookie only, so no
     browser is ever handed a token it did not need and could not protect. */
  const native = body.client === 'native';

  return json(
    {
      ok: true,
      user: { id: user.id, email, account_type: user.account_type },
      verified: true,
      ...(native ? { session: cookie } : {}),
    },
    200,
    {
      'set-cookie': `ua_session=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
    },
  );
}

/* ------------------------------------------------------------------ */
/* Stripe — REST over fetch, no SDK                                    */
/* ------------------------------------------------------------------ */

async function stripeCall(env, path, params, method = 'POST') {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2025-10-29.clover',
    },
    body,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message || 'stripe error');
  return out;
}


/* ------------------------------------------------------------------ */
/* Vault — ciphertext in, ciphertext out                               */
/* ------------------------------------------------------------------ */

/**
 * The Worker is deliberately dumb about documents. It stores bytes it cannot
 * read, returns them on request, and keeps enough metadata to answer "which
 * of your claims does this unlock" and "is this too old to be accepted".
 *
 * It never decrypts, never derives a key, and never sees a passphrase. If a
 * future handler here needs the plaintext, the design has been broken.
 */

const MAX_DOC_BYTES = 15 * 1024 * 1024;

/** Per-user KDF salt, created on first use. Not secret; must be stable. */
async function vaultSalt(env, userId) {
  const row = await env.DB.prepare('SELECT kdf_salt, kdf_iterations FROM vault_keys WHERE user_id = ?')
    .bind(userId)
    .first();
  if (row) return { salt: [...new Uint8Array(row.kdf_salt)], iterations: row.kdf_iterations };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await env.DB.prepare(
    'INSERT INTO vault_keys (user_id, kdf_salt, kdf_iterations, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, salt, KDF_ITERATIONS, Date.now())
    .run();
  return { salt: [...salt], iterations: KDF_ITERATIONS };
}

/** GET /api/vault — metadata list plus the KDF parameters for this user. */
async function handleVaultList(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const { results } = await env.DB.prepare(
    `SELECT id, doc_type, bytes, checksum, issued_at, created_at, expires_at, source
       FROM vault_documents WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(session.uid)
    .all();

  return json({ kdf: await vaultSalt(env, session.uid), documents: results ?? [] });
}

/**
 * PUT /api/vault/:id — store one encrypted document.
 *
 * Body is the raw ciphertext; crypto parameters ride in headers so the body
 * stays a clean byte stream. Everything here was produced on the client.
 */
async function handleVaultPut(request, env, id) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const h = request.headers;
  const docType = h.get('x-doc-type');
  if (!docType || !DOC_TYPES[docType]) return bad('unknown or missing x-doc-type');
  if (docType === 'not_required') return bad('not a storable document type');

  const b64 = (name) => {
    const v = h.get(name);
    if (!v) return null;
    return Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  };
  const iv = b64('x-iv');
  const wrappedKey = b64('x-wrapped-key');
  const wrapIv = b64('x-wrap-iv');
  if (!iv || !wrappedKey || !wrapIv) return bad('missing encryption parameters');

  const ciphertext = new Uint8Array(await request.arrayBuffer());
  if (!ciphertext.length) return bad('empty body');
  if (ciphertext.length > MAX_DOC_BYTES) return bad('document too large', 413);

  /* Reject anything that decodes as a plausible plaintext document. A client
     bug that skipped encryption must fail loudly here rather than quietly
     filling the bucket with readable payslips. */
  const magic = String.fromCharCode(...ciphertext.slice(0, 5));
  if (magic.startsWith('%PDF') || magic.startsWith('PK') || magic.startsWith('\xFF\xD8')) {
    return bad('body is not encrypted — refusing to store plaintext', 400);
  }

  const checksum = await sha256Hex(String.fromCharCode(...ciphertext.slice(0, 4096)) + ciphertext.length);
  const objectKey = `vault/${session.uid}/${id}`;
  await env.VAULT.put(objectKey, ciphertext);

  const now = Date.now();
  const issuedAt = Number(h.get('x-issued-at')) || now;
  const exp = expiresAt({ type: docType, issued_at: issuedAt, created_at: now });

  await env.DB.prepare(
    `INSERT INTO vault_documents
       (id, user_id, doc_type, object_key, bytes, iv, wrapped_key, wrap_iv, checksum, issued_at, created_at, expires_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       doc_type=excluded.doc_type, bytes=excluded.bytes, iv=excluded.iv,
       wrapped_key=excluded.wrapped_key, wrap_iv=excluded.wrap_iv,
       checksum=excluded.checksum, issued_at=excluded.issued_at, expires_at=excluded.expires_at`,
  )
    .bind(id, session.uid, docType, objectKey, ciphertext.length, iv, wrappedKey, wrapIv, checksum, issuedAt, now, exp, h.get('x-source') || 'upload')
    .run();

  await env.DB.prepare('INSERT INTO vault_access_log (user_id, document_id, action, at) VALUES (?, ?, ?, ?)')
    .bind(session.uid, id, 'put', now)
    .run();

  return json({ id, doc_type: docType, bytes: ciphertext.length, checksum, expires_at: exp }, 201);
}

/** GET /api/vault/:id — ciphertext plus the parameters needed to decrypt it. */
async function handleVaultGet(request, env, id) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const row = await env.DB.prepare(
    'SELECT object_key, iv, wrapped_key, wrap_iv, doc_type FROM vault_documents WHERE id = ? AND user_id = ?',
  )
    .bind(id, session.uid)
    .first();
  if (!row) return bad('not found', 404);

  const obj = await env.VAULT.get(row.object_key);
  if (!obj) return bad('object missing', 410);

  await env.DB.prepare('INSERT INTO vault_access_log (user_id, document_id, action, at) VALUES (?, ?, ?, ?)')
    .bind(session.uid, id, 'get', Date.now())
    .run();

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'x-doc-type': row.doc_type,
      'x-iv': b64(row.iv),
      'x-wrapped-key': b64(row.wrapped_key),
      'x-wrap-iv': b64(row.wrap_iv),
    },
  });
}

/** DELETE /api/vault/:id — object first, then the row. */
async function handleVaultDelete(request, env, id) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const row = await env.DB.prepare('SELECT object_key FROM vault_documents WHERE id = ? AND user_id = ?')
    .bind(id, session.uid)
    .first();
  if (!row) return bad('not found', 404);

  await env.VAULT.delete(row.object_key);
  await env.DB.prepare('DELETE FROM vault_documents WHERE id = ? AND user_id = ?').bind(id, session.uid).run();
  await env.DB.prepare('INSERT INTO vault_access_log (user_id, document_id, action, at) VALUES (?, ?, ?, ?)')
    .bind(session.uid, id, 'delete', Date.now())
    .run();

  return json({ deleted: id });
}


/* ------------------------------------------------------------------ */
/* Startup grants                                                      */
/* ------------------------------------------------------------------ */

async function loadStartupPool(env, request, pool) {
  const url = new URL(request.url);
  /* Same split as the benefits data: the full copy for a paid answer, the
     stripped public file only as a fallback. */
  const fullPool = await loadFullAsset(env, request, `startups/${pool}.json`);
  if (fullPool) return fullPool;
  url.pathname = `/api/v1/startups/${pool}.json`;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  return res.ok ? res.json() : null;
}

/**
 * POST /api/startups/check — the free half, same contract as /api/check.
 *
 * Returns totals and counts, never the programme list. Note that totals are
 * per instrument AND per currency: mixing cloud credits into a cash figure,
 * or EUR into USD, would produce a headline number that is not true.
 */
async function handleStartupCheck(request, env) {
  const profile = await request.json().catch(() => null);
  if (!profile?.country_code) return bad('country_code required');

  const pools = reachFor(profile.country_code);
  const datasets = {};
  for (const pool of pools) {
    const d = await loadStartupPool(env, request, pool);
    if (d) datasets[pool] = d;
  }
  if (!Object.keys(datasets).length) return bad('unknown country', 404);

  const r = matchStartup(profile, datasets, Date.now());

  return json({
    country: r.country,
    pools: r.pools,
    sme_category: r.sme_category,
    counts: {
      eligible: r.eligible.length,
      conditional: r.conditional.length,
      needs_answer: r.needs_answer.length,
      not_eligible: r.not_eligible.length,
      closed: r.closed.length,
    },
    /* Free: the money. Paid: which programmes. */
    non_dilutive: r.non_dilutive,
    totals: r.totals,
    unlocks: r.unlocks.map((u) => ({ field: u.field, count: u.count })),
  });
}

/** POST /api/startups/plan — paid. The list, plus the de minimis ceiling applied. */
async function handleStartupPlan(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const { profile, prior_aid = [] } = await request.json().catch(() => ({}));
  if (!profile?.country_code) return bad('country_code required');

  const cc = String(profile.country_code).toLowerCase();
  const ent = await entitlementFor(env, session, cc, PRODUCT.ASSISTANCE);
  if (!ent.entitled) return json({ error: 'subscription required', paywall: ent }, 402);

  const datasets = {};
  for (const pool of reachFor(cc)) {
    const d = await loadStartupPool(env, request, pool);
    if (d) datasets[pool] = d;
  }
  const r = matchStartup(profile, datasets, Date.now());

  /* The ceiling is applied to the PLAN, not to each grant in isolation —
     otherwise we would hand a founder a list they cannot lawfully take. */
  const ceiling = planWithinCeiling(r.eligible, {
    awards: prior_aid,
    memberState: cc,
    asOf: Date.now(),
  });

  return json({
    ...r,
    de_minimis: {
      ...ceiling,
      declaration: declarationText(prior_aid, cc, Date.now()),
    },
  });
}

/**
 * POST /api/startups/autofill — one identifier, most of a form.
 *
 * This reads a PUBLIC company register. It never touches the company's own
 * account on any portal and holds no credential of theirs; the API keys used
 * here are ours, and live in Worker secrets.
 */
async function handleStartupAutofill(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const { country_code, identifier, programme_slug, profile = {} } = await request.json().catch(() => ({}));
  if (!country_code || !identifier) return bad('country_code and identifier required');

  if (!autofillAvailable(country_code)) {
    return json({ ok: false, reason: 'no_machine_readable_register', country: country_code }, 200);
  }

  const result = await lookupCompany({
    countryCode: country_code,
    identifier,
    fetchImpl: fetch,
    keys: { companiesHouse: env.COMPANIES_HOUSE_KEY, samGov: env.SAM_GOV_KEY },
  });
  if (!result.ok) return json(result, 200);

  let programme = null;
  if (programme_slug) {
    for (const pool of reachFor(country_code)) {
      const d = await loadStartupPool(env, request, pool);
      const hit = d?.programmes?.find((p) => p.slug === programme_slug);
      if (hit) { programme = hit; break; }
    }
  }

  return json({
    ok: true,
    company: result.company,
    registry: { name: result.registry.name, auth: result.registry.auth },
    projection: projectCompany({ company: result.company, programme, profile }),
  });
}

async function handleCheckout(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  const body = await request.json().catch(() => ({}));
  const { country = 'gb' } = body;

  /* The real guard is the SHAPE of the fee, not the country.
     
     A flat subscription to software is a subscription. A fee that scales with
     what the user recovers is a procurement commission — "émoluments convenus
     d'avance" — and that single change is what would turn this product into
     the intermediary CSS L554-2 targets. So the amount must never be
     parameterised by the match result. If a future caller tries, refuse:
     it is cheaper to fail a checkout than to argue about it later. */
  const CONTINGENT_KEYS = ['amount', 'total', 'total_min', 'total_max', 'percent', 'percentage', 'share', 'success_fee', 'commission'];
  const contingent = CONTINGENT_KEYS.filter((k) => body[k] != null);
  if (contingent.length) {
    return json(
      {
        error: 'contingent_pricing_refused',
        message:
          'Checkout amount may not depend on what the user is owed. The fee is a flat subscription to the software.',
        offending_fields: contingent,
        pricing: PRICING,
      },
      400,
    );
  }

  /* Dormant by design: today every country sells both halves. Kept so that if
     research ever moves a country out of PRODUCT.DISCOVERY, billing stops
     there without anyone remembering to change the checkout page. */
  if (!mayCharge(country)) {
    return json(
      {
        error: 'billing_not_available_in_jurisdiction',
        message: 'We cannot sell a subscription in this country.',
        policy: policyFor(country),
      },
      403,
    );
  }

  /* Three products, one endpoint. The price id is chosen from a fixed table
     rather than taken from the request: a client-supplied price is a client
     that can subscribe itself to a price of its choosing. */
  const PLANS = {
    personal_monthly: { price: env.STRIPE_PRICE_PERSONAL_MONTHLY, seats: false, account: 'individual' },
    personal_annual: { price: env.STRIPE_PRICE_PERSONAL_ANNUAL, seats: false, account: 'individual' },
    business_monthly: { price: env.STRIPE_PRICE_BUSINESS_MONTHLY, seats: true, account: 'business' },
    business_annual: { price: env.STRIPE_PRICE_BUSINESS_ANNUAL, seats: true, account: 'business' },
  };

  /* 'auto' is what the locked panels ask for.
     
     They are rendered into a static page long before anyone signs in, so they
     cannot name a plan — and hardcoding personal_annual sold a business
     account a single seat at 7 euros a month, which is not the licence their
     colleagues need. The session knows which door this user came in by, and
     the session lives here, so the resolution lives here too: one rule, in the
     one place that holds the authoritative answer. Annual, because that is the
     plan every button that says "auto" is labelled with. */
  const requested = String(body.plan ?? 'personal_annual');
  const planKey =
    requested === 'auto' ? (session.typ === 'business' ? 'business_annual' : 'personal_annual') : requested;
  const plan = PLANS[planKey];
  if (!plan) return bad(`unknown plan: ${planKey}`);
  if (!plan.price || plan.price.startsWith('price_REPLACE')) {
    return json(
      {
        error: 'price_not_configured',
        message: `No Stripe price is configured for ${planKey}. Run scripts/stripe-setup.mjs and set the secret.`,
      },
      503,
    );
  }

  /* Seats are billed per unit on the business plan. Clamped rather than
     trusted: quantity comes over the wire, and an unbounded one is an
     unbounded invoice pointed at whoever's card is on file. */
  const seats = plan.seats ? Math.min(Math.max(parseInt(body.seats, 10) || 1, 1), 500) : 1;

  /* Reuse the Stripe customer if this account already has one. It is also what
     makes `customer_update` legal below — Stripe rejects the whole session
     with "`customer_update` can only be used with `customer`" when it is sent
     alongside a bare customer_email, which is what every business checkout
     did: a 500 from the endpoint, on the one plan an enterprise buyer would
     press. Passing both `customer` and `customer_email` is also an error, so
     it is one or the other. */
  const existing = await env.DB.prepare('SELECT stripe_customer_id FROM entitlements WHERE user_id = ?')
    .bind(session.uid)
    .first()
    .catch(() => null);
  const customerId = existing?.stripe_customer_id || null;

  const cs = await stripeCall(env, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': plan.price,
    'line_items[0][quantity]': String(seats),
    ...(plan.seats ? { 'line_items[0][adjustable_quantity][enabled]': 'true' } : {}),
    success_url: `${env.APP_ORIGIN}/account/?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_ORIGIN}/pricing/`,
    client_reference_id: session.uid,
    'metadata[user_id]': session.uid,
    'metadata[plan]': planKey,
    ...(customerId ? { customer: customerId } : { customer_email: session.email }),
    'subscription_data[metadata][user_id]': session.uid,
    'subscription_data[metadata][plan]': planKey,
    /* A business buying software wants an invoice with their VAT number on it,
       and collecting it after the fact means reissuing every invoice. */
    ...(plan.seats
      ? {
          'tax_id_collection[enabled]': 'true',
          billing_address_collection: 'required',
          /* Only with a customer on the session. Without one there is nothing
             to update, and Stripe treats it as a hard error rather than
             ignoring it. */
          ...(customerId ? { 'customer_update[name]': 'auto', 'customer_update[address]': 'auto' } : {}),
        }
      : {}),
    allow_promotion_codes: 'true',
  });

  return json({ url: cs.url, plan: planKey, seats });
}

/**
 * Stripe webhook. Three things that break in Workers and are handled here:
 *  1. the body must be read ONCE, raw — never request.json() first;
 *  2. signature verification must be async (Web Crypto has no sync HMAC);
 *  3. Stripe redelivers, so the event id is an idempotency key.
 */
async function handleStripeWebhook(request, env, ctx) {
  const sig = request.headers.get('stripe-signature');
  if (!sig) return bad('missing signature');
  const body = await request.text();

  const parts = Object.fromEntries(
    sig.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  const timestamp = parts.t;
  const v1s = sig
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));

  if (!timestamp || !v1s.length) return bad('malformed signature');
  /* Reject replays outside Stripe's 5-minute tolerance. */
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return bad('timestamp outside tolerance');

  const expected = toHex(await hmac(enc.encode(env.STRIPE_WEBHOOK_SECRET), `${timestamp}.${body}`));
  /* Only v1 is trusted — Stripe sends a decoy v0 on test events. */
  if (!v1s.some((v) => timingSafeEqual(v, expected))) return bad('invalid signature');

  const event = JSON.parse(body);

  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)',
  )
    .bind(event.id, event.type, Date.now())
    .run();
  if (ins.meta.changes === 0) return json({ received: true, duplicate: true });

  /* Acknowledge immediately; do the writes after. Stripe times out around 10s
     and the free plan gives 10ms CPU per invocation. */
  ctx.waitUntil(applyStripeEvent(event, env));
  return json({ received: true });
}

async function applyStripeEvent(event, env) {
  const o = event.data.object;
  const now = Date.now();

  const upsert = async (userId, fields) => {
    await env.DB.prepare(
      `INSERT INTO entitlements (user_id, status, plan, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         /* COALESCE, not a straight assignment. Stripe sends
            checkout.session.completed and customer.subscription.created for
            the same purchase, and only one of them carries our plan metadata
            depending on how the session was made. Overwriting with whatever
            the second event happened to know threw the plan away again. */
         plan = COALESCE(excluded.plan, entitlements.plan),
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, entitlements.stripe_subscription_id),
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        fields.status,
        /* A hardcoded "monthly" default used to sit here, and nothing ever
           passed a plan — so every subscriber in the table, annual and
           business alike, was recorded as monthly, and the account page
           dutifully told an annual subscriber their monthly was active. The
           plan travels in metadata on both the session and the subscription;
           read it, and when it is genuinely absent write null so the COALESCE
           above keeps what we already knew rather than inventing a plan. */
        fields.plan ?? null,
        fields.customer ?? null,
        fields.subscription ?? null,
        fields.period_end ?? null,
        now,
      )
      .run();
  };

  /* Which plan this purchase is for, in the Worker's own vocabulary.
     Set on the checkout session as metadata[plan] and copied onto the
     subscription as subscription_data[metadata][plan], so whichever event
     arrives first can answer. Never derived from the price id: that would put
     a second copy of the price table in a second place. */
  const planFrom = (obj) => obj?.metadata?.plan ?? null;

  const userIdFrom = async (obj) => {
    const direct = obj.metadata?.user_id || obj.client_reference_id;
    if (direct) return direct;
    if (obj.customer) {
      const row = await env.DB.prepare('SELECT user_id FROM entitlements WHERE stripe_customer_id = ?')
        .bind(obj.customer)
        .first();
      return row?.user_id ?? null;
    }
    return null;
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const uid = await userIdFrom(o);
      if (uid) {
        await upsert(uid, {
          status: 'active',
          plan: planFrom(o),
          customer: o.customer,
          subscription: o.subscription,
          period_end: null,
        });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const uid = await userIdFrom(o);
      if (uid) {
        await upsert(uid, {
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : o.status,
          plan: planFrom(o),
          customer: o.customer,
          subscription: o.id,
          period_end: o.current_period_end ?? null,
        });
      }
      break;
    }
    case 'invoice.payment_failed': {
      const uid = await userIdFrom(o);
      if (uid) await upsert(uid, { status: 'past_due', customer: o.customer });
      break;
    }
    default:
      break;
  }
}

async function handlePortal(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);
  const row = await env.DB.prepare('SELECT stripe_customer_id FROM entitlements WHERE user_id = ?')
    .bind(session.uid)
    .first();
  if (!row?.stripe_customer_id) return bad('no subscription', 404);
  const portal = await stripeCall(env, 'billing_portal/sessions', {
    customer: row.stripe_customer_id,
    return_url: `${env.APP_ORIGIN}/account/`,
  });
  return json({ url: portal.url });
}

/* ------------------------------------------------------------------ */
/* The enterprise workspace, held on the server                        */
/* ------------------------------------------------------------------ */

/* A workspace document is a whole portfolio, so it is not small — but it is
   also not a file store, and something has gone wrong if it approaches this.
   Rejected with a clear message rather than truncated, because a silently
   truncated pipeline is worse than a failed save. */
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;

/**
 * Which workspace this session may touch.
 *
 * An org workspace if the user belongs to one, their own otherwise. A solo
 * business account should not need an organisation invented for it, and a user
 * who later joins an org should move to that org's workspace rather than end
 * up with two.
 *
 * Returns null for an operator session: /admin/ is for reading the business,
 * not for editing a customer's pipeline. An admin who wants to see the product
 * signs in as themselves.
 */
async function workspaceKeyFor(env, session) {
  if (!session?.uid) return null;
  const row = await env.DB.prepare('SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1')
    .bind(session.uid)
    .first();
  return row?.org_id
    ? { id: `org:${row.org_id}`, scope: 'org', owner_id: row.org_id }
    : { id: `user:${session.uid}`, scope: 'user', owner_id: session.uid };
}

/**
 * Everything under /api/workspace needs a signed-in, entitled business user.
 *
 * Entitlement is checked here rather than trusted from the client for the
 * ordinary reason: the workspace is the paid product, and a gate the browser
 * enforces is a gate a devtools panel removes. The page can hide itself all it
 * likes; this is the part that decides.
 */
async function workspaceGate(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return { error: json({ error: 'signed_out' }, 401) };

  const url = new URL(request.url);
  const country = url.searchParams.get('country') || 'gb';
  const ent = await entitlementFor(env, session, country, PRODUCT.DISCOVERY);
  if (!ent.entitled) {
    return { error: json({ error: 'not_entitled', reason: ent.reason, entitlement: ent }, 402) };
  }

  const key = await workspaceKeyFor(env, session);
  if (!key) return { error: json({ error: 'no_workspace' }, 403) };
  return { session, key, ent };
}

/** GET /api/workspace — the document and its revision. */
async function handleWorkspaceGet(request, env) {
  const gate = await workspaceGate(request, env);
  if (gate.error) return gate.error;

  const row = await env.DB.prepare('SELECT doc, rev, updated_at, updated_by FROM workspaces WHERE id = ?')
    .bind(gate.key.id)
    .first();

  /* No row yet is not an error — it is a new customer. rev 0 means "nothing
     stored", and a PUT at rev 0 is how the first save happens. */
  if (!row) return json({ rev: 0, doc: null, scope: gate.key.scope });

  return json({
    rev: row.rev,
    doc: JSON.parse(row.doc),
    scope: gate.key.scope,
    updated_at: row.updated_at,
    updated_by_you: row.updated_by === gate.session.uid,
  });
}

/**
 * PUT /api/workspace — { rev, doc }.
 *
 * `rev` must match what is stored. Two tabs, or a laptop and a phone, will
 * both write; without this the second write erases whatever the first added
 * and the only evidence is a pipeline entry that vanished. On a mismatch this
 * returns 409 WITH the current document, so the client can merge rather than
 * be told to try again with no way to know what changed.
 */
async function handleWorkspacePut(request, env) {
  const gate = await workspaceGate(request, env);
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.doc !== 'object' || body.doc === null) return bad('doc required');
  const rev = Number.isInteger(body.rev) ? body.rev : null;
  if (rev === null || rev < 0) return bad('rev required');

  const text = JSON.stringify(body.doc);
  if (text.length > MAX_WORKSPACE_BYTES) {
    return json(
      { error: 'too_large', message: 'That workspace is larger than we store. Export and split it.' },
      413,
    );
  }

  const now = Date.now();
  const current = await env.DB.prepare('SELECT doc, rev FROM workspaces WHERE id = ?').bind(gate.key.id).first();
  const currentRev = current?.rev ?? 0;

  if (rev !== currentRev) {
    return json(
      {
        error: 'conflict',
        message: 'Someone else saved first.',
        rev: currentRev,
        doc: current ? JSON.parse(current.doc) : null,
      },
      409,
    );
  }

  const nextRev = currentRev + 1;
  await env.DB.prepare(
    `INSERT INTO workspaces (id, scope, owner_id, doc, rev, bytes, updated_by, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       doc = excluded.doc, rev = excluded.rev, bytes = excluded.bytes,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(gate.key.id, gate.key.scope, gate.key.owner_id, text, nextRev, text.length, gate.session.uid, now, now)
    .run();

  return json({ ok: true, rev: nextRev });
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

async function handleProfile(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return bad('sign in required', 401);

  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(session.uid).first();
    return json({ profile: row ? JSON.parse(row.data) : null });
  }

  const profile = await request.json().catch(() => null);
  if (!profile) return bad('body required');
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(session.uid, JSON.stringify(profile), Date.now())
    .run();
  return json({ ok: true });
}

async function handleMe(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  /* An operator session carries `adm` and no `uid` — it is not a user account,
     it is a role. Testing for `uid` alone reported a signed-in operator as
     signed out, which made the admin dashboard bounce straight back to its own
     login form after a successful login. */
  if (!session || (!session.uid && !session.adm)) return json({ signed_in: false });
  const url = new URL(request.url);
  const country = url.searchParams.get('country') || 'gb';
  const ent = await entitlementFor(env, session, country);
  return json({
    signed_in: true,
    email: session.email,
    admin: !!session.adm,
    /* Which door they came in by. The account page needs this to offer the
       right plan: a business account was being shown Personal at 7 euros a
       month, which is not the product they signed up for and not the seat
       licence their colleagues need. Operator sessions carry no account type. */
    account_type: session.typ ?? null,
    entitlement: ent,
  });
}

/* ------------------------------------------------------------------ */
/* Filing on a company's behalf                                        */
/* ------------------------------------------------------------------ */

/**
 * The enterprise product, server side.
 *
 * A company signs one scoped authorisation; after that, filings are queued,
 * prepared, submitted and tracked here rather than by a person remembering.
 * Three rules hold the whole thing up:
 *
 *   1. No filing may exist without a recorded authority. `authorisation_id` is
 *      NOT NULL and every write re-checks that the authority is live and names
 *      the programme — checking once at queue time would let a revocation be
 *      outrun by a job that is already moving.
 *   2. Every transition is appended, never overwritten. When a funder or an
 *      auditor asks "on what authority did you submit this on 3 March", the
 *      answer must be a row.
 *   3. The org boundary is enforced on every read and write. A filing is
 *      commercially sensitive — which grants a company is chasing is strategy —
 *      so a query without an org scope is a bug, not an optimisation.
 */

/** The state machine, and the only transitions that exist. */
const FILING_STATES = {
  queued: ['preparing', 'withdrawn', 'failed'],
  preparing: ['needs_input', 'ready', 'failed'],
  needs_input: ['preparing', 'ready', 'withdrawn', 'failed'],
  ready: ['submitted', 'needs_input', 'withdrawn', 'failed'],
  submitted: ['acknowledged', 'rejected', 'awarded', 'failed'],
  acknowledged: ['awarded', 'rejected'],
  awarded: [],
  rejected: [],
  withdrawn: [],
  failed: ['queued'],
};
const TERMINAL_STATES = new Set(['awarded', 'rejected', 'withdrawn']);

/** Only an org account may file: there is no company to bind otherwise. */
async function orgGate(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  if (!session?.uid) return { error: json({ error: 'signed_out' }, 401) };
  const ent = await entitlementFor(env, session, 'gb', PRODUCT.DISCOVERY);
  if (!ent.entitled) return { error: json({ error: 'not_entitled', entitlement: ent }, 402) };

  const member = await env.DB.prepare('SELECT org_id, role FROM org_members WHERE user_id = ? LIMIT 1')
    .bind(session.uid)
    .first();
  if (!member) {
    return {
      error: json(
        {
          error: 'no_organisation',
          message: 'Filing is done on behalf of a company. Sign in with a business account to create one.',
        },
        403,
      ),
    };
  }
  return { session, orgId: member.org_id, role: member.role };
}

const uuid = () => crypto.randomUUID();

async function recordEvent(env, { app, from, to, note, actor }) {
  await env.DB.prepare(
    'INSERT INTO application_events (id, application_id, org_id, from_state, to_state, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(uuid(), app.id, app.org_id, from ?? null, to, note ?? null, actor, Date.now())
    .run();
}

/**
 * Is this authority live, and does it cover this programme?
 *
 * Re-checked on every transition rather than once at queue time. An
 * authorisation revoked at 10:00 must stop a filing that was queued at 09:00
 * and is still moving — otherwise "revoke" means "revoke eventually", which is
 * not what the word means to the person clicking it.
 */
async function liveAuthorisation(env, orgId, authId, programmeSlug) {
  const row = await env.DB.prepare('SELECT * FROM authorisations WHERE id = ? AND org_id = ?')
    .bind(authId, orgId)
    .first();
  if (!row) return { ok: false, code: 'authorisation_not_found' };
  if (row.revoked_at) return { ok: false, code: 'authorisation_revoked' };
  if (row.expires_at && row.expires_at < Date.now()) return { ok: false, code: 'authorisation_expired' };
  if (programmeSlug) {
    let scope = [];
    try {
      scope = JSON.parse(row.scope);
    } catch {
      scope = [];
    }
    if (!scope.some((x) => x.slug === programmeSlug)) return { ok: false, code: 'programme_out_of_scope' };
  }
  return { ok: true, row };
}

/** POST /api/enterprise/authorisations — the company signs. */
async function handleAuthorisationCreate(request, env) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;
  /* Only an owner or admin can appoint an agent. A seat holder cannot bind the
     company, and pretending otherwise would make the mandate worthless. */
  if (gate.role !== 'owner' && gate.role !== 'admin') {
    return json({ error: 'not_authorised_to_sign', message: 'Only an owner or admin can sign an authorisation.' }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.signed_by_name ?? '').trim();
  const role = String(body.signed_by_role ?? '').trim();
  const country = String(body.country ?? 'gb').toLowerCase();
  const scope = Array.isArray(body.scope) ? body.scope.filter((x) => x && x.slug) : [];

  if (!name || !role) return bad('the name and role of the person signing are required');
  if (!scope.length) return bad('an authorisation must name at least one programme');
  /* Scoped, not blanket — enforced here rather than trusted from the client. */
  if (scope.length > 200) return bad('an authorisation may name at most 200 programmes');

  const rail = ['delegated_account', 'signed_mandate', 'registered_power'].includes(body.rail)
    ? body.rail
    : 'signed_mandate';
  const now = Date.now();
  const months = Math.min(Math.max(parseInt(body.months, 10) || 12, 1), 36);
  const id = uuid();

  await env.DB.prepare(
    `INSERT INTO authorisations
       (id, org_id, country, rail, scope, signed_by_name, signed_by_role, signed_by_email,
        signed_at, signed_ip, signed_ua, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, gate.orgId, country, rail, JSON.stringify(scope), name, role,
      body.signed_by_email ?? null, now,
      request.headers.get('cf-connecting-ip') ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 300),
      now + months * 30 * 864e5, gate.session.uid, now,
    )
    .run();

  return json({ ok: true, id, expires_at: now + months * 30 * 864e5, scope_count: scope.length }, 201);
}

/** GET /api/enterprise/authorisations */
async function handleAuthorisationList(request, env) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;
  const rows = await env.DB.prepare(
    `SELECT id, country, rail, scope, signed_by_name, signed_by_role, signed_at, expires_at, revoked_at
       FROM authorisations WHERE org_id = ? ORDER BY signed_at DESC`,
  )
    .bind(gate.orgId)
    .all();
  const now = Date.now();
  return json({
    authorisations: rows.results.map((r) => ({
      ...r,
      scope: JSON.parse(r.scope || '[]'),
      live: !r.revoked_at && (!r.expires_at || r.expires_at > now),
    })),
  });
}

/** POST /api/enterprise/authorisations/<id>/revoke — one click, immediate. */
async function handleAuthorisationRevoke(request, env, id) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;
  if (gate.role !== 'owner' && gate.role !== 'admin') return json({ error: 'not_authorised_to_sign' }, 403);

  const now = Date.now();
  const res = await env.DB.prepare(
    'UPDATE authorisations SET revoked_at = ?, revoked_by = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL',
  )
    .bind(now, gate.session.uid, id, gate.orgId)
    .run();
  if (res.meta.changes === 0) return json({ error: 'not_found_or_already_revoked' }, 404);

  /* Everything still in flight under this authority stops now. Filings already
     submitted are NOT retracted — we cannot unsend them, and pretending
     otherwise on screen would be the lie. They stay on the record. */
  const live = await env.DB.prepare(
    `SELECT id, org_id, state FROM filings
      WHERE org_id = ? AND authorisation_id = ? AND state IN ('queued','preparing','needs_input','ready')`,
  )
    .bind(gate.orgId, id)
    .all();
  for (const app of live.results) {
    /* org_id in the WHERE as well as in the SELECT that found the row. Both
       are scoped today; if they ever drift apart, the write is the one that
       must not be the weak side. */
    await env.DB.prepare('UPDATE filings SET state = ?, error = ?, updated_at = ? WHERE id = ? AND org_id = ?')
      .bind('withdrawn', 'authorisation revoked', now, app.id, gate.orgId)
      .run();
    await recordEvent(env, { app, from: app.state, to: 'withdrawn', note: 'authorisation revoked', actor: gate.session.uid });
  }

  return json({ ok: true, revoked_at: now, withdrawn: live.results.length });
}

/** POST /api/enterprise/applications — queue filings. */
async function handleFilingCreate(request, env) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => ({}));
  const authId = String(body.authorisation_id ?? '');
  const items = Array.isArray(body.programmes) ? body.programmes.filter((p) => p && p.slug) : [];
  if (!authId) return bad('authorisation_id is required — nothing is filed without a recorded authority');
  if (!items.length) return bad('no programmes given');
  if (items.length > 100) return bad('queue at most 100 filings at a time');

  const now = Date.now();
  const queued = [];
  const refused = [];

  for (const p of items) {
    const auth = await liveAuthorisation(env, gate.orgId, authId, p.slug);
    if (!auth.ok) {
      refused.push({ slug: p.slug, code: auth.code });
      continue;
    }
    const id = uuid();
    try {
      await env.DB.prepare(
        `INSERT INTO filings
           (id, org_id, authorisation_id, programme_slug, programme_name, funder, country, state,
            amount_min, amount_max, currency, deadline_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id, gate.orgId, authId, p.slug, p.name ?? null, p.funder ?? null,
          (p.country ?? auth.row.country ?? 'gb').toLowerCase(),
          p.amount_min ?? null, p.amount_max ?? null, p.currency ?? null, p.deadline_at ?? null,
          gate.session.uid, now, now,
        )
        .run();
      await recordEvent(env, { app: { id, org_id: gate.orgId }, from: null, to: 'queued', note: null, actor: gate.session.uid });
      queued.push({ id, slug: p.slug });
    } catch (err) {
      /* The unique index on (org_id, programme_slug) for non-terminal states.
         Queueing the same programme twice is a double submission to the funder,
         which is worse than a refused button. */
      refused.push({ slug: p.slug, code: /UNIQUE/i.test(String(err?.message)) ? 'already_in_flight' : 'insert_failed' });
    }
  }

  return json({ ok: true, queued, refused }, queued.length ? 201 : 409);
}

/** GET /api/enterprise/applications — the queue. */
async function handleFilingList(request, env) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;
  const rows = await env.DB.prepare(
    `SELECT id, authorisation_id, programme_slug, programme_name, funder, country, state,
            amount_min, amount_max, currency, deadline_at, reference, missing, error,
            submitted_at, decided_at, created_at, updated_at
       FROM filings WHERE org_id = ? ORDER BY
         CASE state WHEN 'needs_input' THEN 0 WHEN 'ready' THEN 1 WHEN 'preparing' THEN 2
                    WHEN 'queued' THEN 3 WHEN 'submitted' THEN 4 WHEN 'acknowledged' THEN 5 ELSE 6 END,
         COALESCE(deadline_at, 9e18) ASC`,
  )
    .bind(gate.orgId)
    .all();

  const apps = rows.results.map((r) => ({ ...r, missing: r.missing ? JSON.parse(r.missing) : [] }));
  const counts = {};
  for (const a of apps) counts[a.state] = (counts[a.state] ?? 0) + 1;
  return json({ applications: apps, counts });
}

/** POST /api/enterprise/applications/<id>/advance — move one filing along. */
async function handleFilingAdvance(request, env, id) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => ({}));
  const to = String(body.to ?? '');
  const app = await env.DB.prepare('SELECT * FROM filings WHERE id = ? AND org_id = ?')
    .bind(id, gate.orgId)
    .first();
  if (!app) return json({ error: 'not_found' }, 404);

  const allowed = FILING_STATES[app.state] ?? [];
  if (!allowed.includes(to)) {
    return json(
      { error: 'illegal_transition', message: `A filing cannot go from ${app.state} to ${to}.`, allowed },
      409,
    );
  }

  /* Authority is re-checked here, not only at queue time — see
     liveAuthorisation(). Withdrawing does not need it: stopping is always
     allowed, and requiring authority to stop would be perverse. */
  if (to !== 'withdrawn' && to !== 'failed') {
    const auth = await liveAuthorisation(env, gate.orgId, app.authorisation_id, app.programme_slug);
    if (!auth.ok) return json({ error: auth.code, message: 'The authority for this filing is no longer valid.' }, 403);
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE filings SET state = ?, reference = COALESCE(?, reference), missing = ?, error = ?,
            submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
            decided_at = CASE WHEN ? IN ('awarded','rejected') THEN ? ELSE decided_at END,
            updated_at = ?
      WHERE id = ? AND org_id = ?`,
  )
    .bind(
      to, body.reference ?? null,
      Array.isArray(body.missing) ? JSON.stringify(body.missing) : app.missing,
      to === 'failed' ? String(body.error ?? 'unspecified') : null,
      to, now, to, now, now, id, gate.orgId,
    )
    .run();

  await recordEvent(env, { app, from: app.state, to, note: body.note ?? null, actor: gate.session.uid });
  return json({ ok: true, id, state: to, terminal: TERMINAL_STATES.has(to) });
}

/** GET /api/enterprise/applications/<id>/events — the audit trail. */
async function handleFilingEvents(request, env, id) {
  const gate = await orgGate(request, env);
  if (gate.error) return gate.error;
  const rows = await env.DB.prepare(
    'SELECT from_state, to_state, note, actor, at FROM application_events WHERE application_id = ? AND org_id = ? ORDER BY at ASC',
  )
    .bind(id, gate.orgId)
    .all();
  return json({ events: rows.results });
}

/* ------------------------------------------------------------------ */
/* Admin — one operator login, and the analytics it exists to read     */
/* ------------------------------------------------------------------ */

/* Deliberately shorter than a user session. An operator session is a key to
   the whole paid product; leaving one alive on a laptop for a month is the
   only realistic way this leaks. */
const ADMIN_SESSION_MS = 12 * 3600e3;
const ADMIN_PBKDF2_ITERATIONS = 100_000;
const ADMIN_MAX_ATTEMPTS_PER_HOUR = 8;

/**
 * PBKDF2-SHA256, the same shape `scripts/admin-password.mjs` produces.
 *
 * Not SHA-256 of the password, which the rest of this file uses for six-digit
 * codes: a code lives ten minutes and has a million possibilities, so a fast
 * hash is fine. A password lives until someone rotates it and is drawn from a
 * distribution an attacker can guess, so it needs to be slow on purpose.
 *
 * 100,000 is not a preference, it is the ceiling: Workers' Web Crypto refuses
 * PBKDF2 above it outright —
 *
 *   Pbkdf2 failed: iteration counts above 100000 are not supported
 *
 * — with a 500, which is how this was found. OWASP's figure for PBKDF2-SHA256
 * is higher, and the gap is covered at the other end: the generated password
 * carries ~99 bits, where the iteration count stops mattering because nobody
 * is brute-forcing it at any speed. It matters for a password a human chooses,
 * so `scripts/admin-password.mjs` generates one by default and only accepts a
 * chosen one if you insist.
 */
async function pbkdf2Hex(password, saltHex, iterations = ADMIN_PBKDF2_ITERATIONS) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** UTC 'YYYY-MM-DD'. Grouping by local time would move the day boundary per visitor. */
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * POST /auth/admin — { email, password } → an operator session.
 *
 * Three secrets, all set with `wrangler secret put`: ADMIN_EMAIL,
 * ADMIN_PASSWORD_SALT, ADMIN_PASSWORD_HASH. With any of them unset the
 * endpoint is off rather than open — a missing secret must never mean "no
 * password required", which is the single most common way an admin door is
 * left unlocked.
 */
/**
 * The operator credential, from secrets if they are set, from D1 if not.
 *
 * Same reasoning as the signing key: a `wrangler secret` that nobody has set
 * yet is indistinguishable, from the outside, from a broken login. The three
 * rows in worker_config hold the email, the PBKDF2 salt and the hash — never
 * the password, which exists only in whatever `scripts/admin-password.mjs`
 * printed once.
 *
 * Secrets still take precedence, so setting them later overrides the row
 * without a code change, and returns null when neither source has a full set —
 * which keeps the fail-closed behaviour below exactly as it was.
 */
async function adminCredential(env) {
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH && env.ADMIN_PASSWORD_SALT) {
    return { email: env.ADMIN_EMAIL, salt: env.ADMIN_PASSWORD_SALT, hash: env.ADMIN_PASSWORD_HASH };
  }
  const rows = await env.DB.prepare(
    "SELECT key, value FROM worker_config WHERE key IN ('admin_email','admin_password_salt','admin_password_hash')",
  ).all();
  const m = Object.fromEntries((rows.results || []).map((r) => [r.key, r.value]));
  if (!m.admin_email || !m.admin_password_salt || !m.admin_password_hash) return null;
  return { email: m.admin_email, salt: m.admin_password_salt, hash: m.admin_password_hash };
}

async function handleAdminLogin(request, env) {
  const cred = await adminCredential(env);
  if (!cred) {
    return json({ error: 'admin_disabled', message: 'No operator account is configured.' }, 503);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipHash = await sha256Hex(`${ip}:${await signingKey(env)}`);
  const since = Date.now() - 3600e3;
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM admin_attempts WHERE ip_hash = ? AND ok = 0 AND ts > ?',
  )
    .bind(ipHash, since)
    .first();
  if ((recent?.n ?? 0) >= ADMIN_MAX_ATTEMPTS_PER_HOUR) {
    return json({ error: 'too_many_attempts', message: 'Locked for an hour.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const expected = await pbkdf2Hex(password, cred.salt);
  /* Both comparisons run whatever happens, so a wrong email and a wrong
     password take the same time and cost the same attempt. */
  const emailOk = timingSafeEqual(email, String(cred.email).trim().toLowerCase());
  const passOk = timingSafeEqual(expected, cred.hash);
  const ok = emailOk && passOk;

  await env.DB.prepare('INSERT INTO admin_attempts (id, ts, ip_hash, ok) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), Date.now(), ipHash, ok ? 1 : 0)
    .run();

  if (!ok) return json({ error: 'invalid', message: 'Wrong email or password.' }, 401);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO login_events (id, ts, day, user_id, email, account_type, is_new, kind)
     VALUES (?, ?, ?, NULL, ?, 'admin', 0, 'admin')`,
  )
    .bind(crypto.randomUUID(), now, dayKey(now), email)
    .run();

  const cookie = await signSession(env, { adm: true, email, exp: now + ADMIN_SESSION_MS });
  return json({ ok: true, email, expires_in: ADMIN_SESSION_MS / 1000 }, 200, {
    'set-cookie': `ua_session=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_MS / 1000}`,
  });
}

/** Every /api/admin/* route goes through this. */
async function requireAdmin(request, env) {
  const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
  return session?.adm ? session : null;
}

/**
 * POST /api/v1/event — the beacon.
 *
 * Open to anonymous callers, because the whole point is measuring people who
 * have not signed in. That makes it forgeable, and it is worth being clear
 * about what that does and does not cost: someone could inflate a step count.
 * They cannot read anything, and they cannot deflate a count, so the failure
 * mode is a wrong number in a private dashboard rather than a breach. The
 * alternatives — a signed beacon, a bot check — cost more than the number is
 * worth. Unknown step names are rejected so the table cannot be used as free
 * storage.
 */
async function handleEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const step = String(body.step ?? '');
  if (!isStep(step)) return bad('unknown step');

  const visitor = String(body.visitor ?? '').slice(0, 40);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(visitor)) return bad('bad visitor id');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO events (id, ts, day, step, visitor, country, locale, surface)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      now,
      dayKey(now),
      step,
      visitor,
      String(body.country ?? '').slice(0, 8) || null,
      String(body.locale ?? '').slice(0, 8) || null,
      ['web', 'pwa', 'native'].includes(body.surface) ? body.surface : 'web',
    )
    .run();

  return json({ ok: true }, 202);
}

const clampDays = (v) => Math.min(365, Math.max(1, parseInt(v, 10) || 30));

/** GET /api/admin/overview?days=30 — traffic, by day and by dimension. */
async function handleAdminOverview(request, env) {
  if (!(await requireAdmin(request, env))) return bad('admin only', 403);
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const since = Date.now() - days * 864e5;

  const [byDay, byCountry, byLocale, bySurface, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS events
         FROM events WHERE ts > ? GROUP BY day ORDER BY day`,
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT COALESCE(country, 'unknown') AS k, COUNT(DISTINCT visitor) AS n
         FROM events WHERE ts > ? GROUP BY k ORDER BY n DESC LIMIT 12`,
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT COALESCE(locale, 'en') AS k, COUNT(DISTINCT visitor) AS n
         FROM events WHERE ts > ? GROUP BY k ORDER BY n DESC LIMIT 12`,
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT surface AS k, COUNT(DISTINCT visitor) AS n
         FROM events WHERE ts > ? GROUP BY k ORDER BY n DESC`,
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS events FROM events WHERE ts > ?`,
    ).bind(since).first(),
  ]);

  const logins = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT email) AS people,
            SUM(CASE WHEN is_new = 1 THEN 1 ELSE 0 END) AS new_accounts
       FROM login_events WHERE ts > ? AND kind = 'otp'`,
  ).bind(since).first();

  return json({
    days,
    totals: { ...totals, ...logins },
    by_day: byDay.results,
    by_country: byCountry.results,
    by_locale: byLocale.results,
    by_surface: bySurface.results,
  });
}

/** GET /api/admin/funnel?days=30 — where people stop. */
async function handleAdminFunnel(request, env) {
  if (!(await requireAdmin(request, env))) return bad('admin only', 403);
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  const since = Date.now() - days * 864e5;

  /* Distinct visitors per step, not events. Someone who reloads the results
     screen four times is one person who got to the results screen. */
  const rowsRaw = await env.DB.prepare(
    `SELECT step, COUNT(DISTINCT visitor) AS n FROM events WHERE ts > ? GROUP BY step`,
  ).bind(since).all();

  const reached = Object.fromEntries(rowsRaw.results.map((r) => [r.step, r.n]));
  const rows = funnelRows(reached);
  return json({ days, rows, worst: worstDrop(rows) });
}

/** GET /api/admin/logins?limit=100 — who signed in. */
async function handleAdminLogins(request, env) {
  if (!(await requireAdmin(request, env))) return bad('admin only', 403);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 100));

  const rows = await env.DB.prepare(
    `SELECT l.ts, l.email, l.account_type, l.is_new, l.kind,
            e.status AS ent_status, e.plan AS ent_plan
       FROM login_events l
       LEFT JOIN entitlements e ON e.user_id = l.user_id
      ORDER BY l.ts DESC LIMIT ?`,
  ).bind(limit).all();

  return json({ logins: rows.results });
}

/* ------------------------------------------------------------------ */
/* CORS — for the packaged app, and nobody else                        */
/* ------------------------------------------------------------------ */

/**
 * The only cross-origin callers we want are our own app shells.
 *
 * Capacitor serves the bundle from `https://localhost` on both platforms (the
 * `androidScheme`/`iosScheme` in capacitor.config.json), and the iOS simulator
 * sometimes uses `capacitor://localhost`. Those three, and nothing else.
 *
 * Deliberately NOT a wildcard. `Access-Control-Allow-Origin: *` cannot be
 * combined with credentials at all, and reflecting whatever Origin arrives
 * would let any page on the internet make authenticated calls with a user's
 * bearer token — which is the entire attack this list exists to prevent.
 */
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost']);

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin || !APP_ORIGINS.has(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const cors = corsHeaders(request);

    /* Preflight. Answered before anything else and without touching the
       database — a browser sending OPTIONS is asking a question about policy,
       not making a request. */
    if (request.method === 'OPTIONS' && cors) {
      return new Response(null, { status: 204, headers: cors });
    }

    /* Every API answer below picks up the CORS headers on the way out, so no
       individual handler has to remember. Asset responses do not: they are
       public, cacheable, and adding a Vary: Origin to 5,900 files would cost
       cache hits for nothing. */
    const withCors = (res) => {
      if (!cors || !res) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    };

    try {
      if (pathname === '/webhooks/stripe' && request.method === 'POST') {
        return withCors(await handleStripeWebhook(request, env, ctx));
      }
      if (pathname === '/api/check' && request.method === 'POST') return withCors(await handleCheck(request, env));
      if (pathname === '/api/apply/plan' && request.method === 'POST') return withCors(await handlePlan(request, env));
      if (pathname === '/api/apply/consent' && request.method === 'POST') return withCors(await handleConsent(request, env));
      if (pathname === '/api/startups/check' && request.method === 'POST') return withCors(await handleStartupCheck(request, env));
      if (pathname === '/api/startups/plan' && request.method === 'POST') return withCors(await handleStartupPlan(request, env));
      if (pathname === '/api/startups/autofill' && request.method === 'POST') return withCors(await handleStartupAutofill(request, env));
      /* The vault needs R2. If the bucket is not bound — a fresh account where
         R2 has not been enabled yet — say so plainly on the vault routes and
         leave every other route working. A storage feature that is not turned
         on must not take sign-in and checkout down with it. */
      if (pathname === '/api/vault' || pathname.startsWith('/api/vault/')) {
        if (!env.VAULT) {
          return withCors(json(
            { error: 'vault_unavailable', message: 'Document storage is not switched on for this deployment yet.' },
            503,
          ));
        }
      }
      if (pathname === '/api/vault' && request.method === 'GET') return withCors(await handleVaultList(request, env));
      if (pathname.startsWith('/api/vault/')) {
        const id = pathname.slice('/api/vault/'.length);
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return withCors(bad('bad document id'));
        if (request.method === 'PUT') return withCors(await handleVaultPut(request, env, id));
        if (request.method === 'GET') return withCors(await handleVaultGet(request, env, id));
        if (request.method === 'DELETE') return withCors(await handleVaultDelete(request, env, id));
        return withCors(bad('method not allowed', 405));
      }
      /* The unstripped copies are for this Worker, not for the internet. */
      if (pathname.startsWith('/api/v1/full/')) {
        return withCors(new Response('Not found', { status: 404 }));
      }

      /* Same URL, more data if you have paid for it. An entitled client asking
         for the dataset it already fetches gets the whole file; everyone else
         falls through to the stripped static asset below. Serving the paid
         data at a different URL would mean the app needed to know which one to
         ask for, and a client that picks its own privilege level is not a
         gate. */
      if (request.method === 'GET') {
        const m = pathname.match(/^\/api\/v1\/(programmes|startups)\/([a-z0-9_-]+)\.json$/);
        if (m) {
          const session = await readSession(env, request.headers.get('cookie'), request.headers.get('authorization'));
          const ent = session ? await entitlementFor(env, session, m[2]) : null;
          if (ent?.entitled) {
            const full = await loadFullAsset(env, request, `${m[1]}/${m[2]}.json`);
            if (full) {
              return withCors(new Response(JSON.stringify(full), {
                headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
              }));
            }
          }
        }
      }

      if (pathname === '/api/workspace' && request.method === 'GET') return withCors(await handleWorkspaceGet(request, env));
      /* POST as a synonym for PUT. `navigator.sendBeacon` can only POST, and
         the beacon is how the last edit survives a tab closing mid-save —
         flush() returns early while a save is in flight, and the retry never
         runs because the page is unloading. */
      if (pathname === '/api/workspace' && (request.method === 'PUT' || request.method === 'POST')) {
        return withCors(await handleWorkspacePut(request, env));
      }
      if (pathname === '/api/me') return withCors(await handleMe(request, env));
      if (pathname === '/api/profile') return withCors(await handleProfile(request, env));
      if (pathname === '/api/billing/checkout' && request.method === 'POST') return withCors(await handleCheckout(request, env));
      if (pathname === '/api/billing/portal' && request.method === 'POST') return withCors(await handlePortal(request, env));
      if (pathname === '/api/v1/event' && request.method === 'POST') return withCors(await handleEvent(request, env));
      /* Filing on a company's behalf. Every one of these is org-scoped inside
         the handler; there is deliberately no route that reads a filing
         without an org, because which grants a company is chasing is strategy
         and a missing scope would be a data leak rather than a slow query. */
      if (pathname === '/api/enterprise/authorisations' && request.method === 'POST') {
        return withCors(await handleAuthorisationCreate(request, env));
      }
      if (pathname === '/api/enterprise/authorisations' && request.method === 'GET') {
        return withCors(await handleAuthorisationList(request, env));
      }
      {
        const m = pathname.match(/^\/api\/enterprise\/authorisations\/([A-Za-z0-9-]+)\/revoke$/);
        if (m && request.method === 'POST') return withCors(await handleAuthorisationRevoke(request, env, m[1]));
      }
      if (pathname === '/api/enterprise/applications' && request.method === 'POST') {
        return withCors(await handleFilingCreate(request, env));
      }
      if (pathname === '/api/enterprise/applications' && request.method === 'GET') {
        return withCors(await handleFilingList(request, env));
      }
      {
        const m = pathname.match(/^\/api\/enterprise\/applications\/([A-Za-z0-9-]+)\/advance$/);
        if (m && request.method === 'POST') return withCors(await handleFilingAdvance(request, env, m[1]));
      }
      {
        const m = pathname.match(/^\/api\/enterprise\/applications\/([A-Za-z0-9-]+)\/events$/);
        if (m && request.method === 'GET') return withCors(await handleFilingEvents(request, env, m[1]));
      }

      if (pathname === '/api/admin/overview') return withCors(await handleAdminOverview(request, env));
      if (pathname === '/api/admin/funnel') return withCors(await handleAdminFunnel(request, env));
      if (pathname === '/api/admin/logins') return withCors(await handleAdminLogins(request, env));
      if (pathname === '/auth/admin' && request.method === 'POST') return withCors(await handleAdminLogin(request, env));
      if (pathname === '/auth/request' && request.method === 'POST') return withCors(await handleAuthRequest(request, env));
      if (pathname === '/auth/verify' && request.method === 'POST') return withCors(await handleAuthVerify(request, env));
      if (pathname === '/auth/signout') {
        /* Signing out is a state change, so a GET has to prove it came from a
           click and not from an <img src="/auth/signout"> on someone else's
           page. Sec-Fetch-* is set by the browser and cannot be forged by
           page script; a cross-site image request arrives as dest=image,
           site=cross-site and is refused. POST is always accepted — that is
           the packaged app, which sends a bearer token and no cookie.
           Requests with no Sec-Fetch headers at all (older clients, curl) are
           allowed through: refusing them would break sign-out for the sake of
           an attack that needs a browser to work. */
        const dest = request.headers.get('sec-fetch-dest');
        const site = request.headers.get('sec-fetch-site');
        const topLevel = !dest || dest === 'document' || dest === 'empty';
        const ourOwn = !site || site === 'same-origin' || site === 'same-site' || site === 'none';
        if (request.method !== 'POST' && !(topLevel && ourOwn)) {
          return withCors(json({ error: 'cross_site_signout_refused' }, 403));
        }
        const clear = 'ua_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
        if (request.method === 'POST') {
          return withCors(json({ ok: true }, 200, { 'set-cookie': clear }));
        }
        return withCors(new Response(null, {
          status: 302,
          headers: { location: `${env.APP_ORIGIN}/`, 'set-cookie': clear },
        }));
      }

      /* Everything else is a static asset — free, and not billed as a Worker
         request, which is why 4,000 SEO pages cost nothing. */
      return env.ASSETS.fetch(request);
    } catch (err) {
      return withCors(json({ error: 'internal', detail: String(err?.message ?? err) }, 500));
    }
  },
};
