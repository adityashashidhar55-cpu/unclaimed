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

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

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

async function signSession(env, payload) {
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const sig = toHex(await hmac(enc.encode(env.SESSION_SIGNING_KEY), body));
  return `${body}.${sig}`;
}

async function readSession(env, cookieHeader) {
  const raw = (cookieHeader || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('ua_session='));
  if (!raw) return null;
  const [body, sig] = raw.slice('ua_session='.length).split('.');
  if (!body || !sig) return null;
  const expect = toHex(await hmac(enc.encode(env.SESSION_SIGNING_KEY), body));
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
async function entitlementFor(env, userId, country, product = PRODUCT.DISCOVERY) {
  if (!mayChargeFor(country, product)) {
    return { entitled: true, reason: 'free_in_jurisdiction', product, policy: policyFor(country) };
  }
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

  const session = await readSession(env, request.headers.get('cookie'));
  const ent = await entitlementFor(env, session?.uid, cc);

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
  const session = await readSession(env, request.headers.get('cookie'));
  if (!session?.uid) return bad('sign in required', 401);

  const { profile, lang = 'en' } = await request.json().catch(() => ({}));
  if (!profile?.country_code) return bad('country_code required');

  const cc = String(profile.country_code).toLowerCase();
  const ent = await entitlementFor(env, session.uid, cc, PRODUCT.ASSISTANCE);
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
  const session = await readSession(env, request.headers.get('cookie'));
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

  const cookie = await signSession(env, {
    uid: user.id,
    email,
    typ: user.account_type,
    exp: now + 30 * 864e5,
  });

  return json(
    { ok: true, user: { id: user.id, email, account_type: user.account_type }, verified: true },
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
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
  if (!session?.uid) return bad('sign in required', 401);

  const { profile, prior_aid = [] } = await request.json().catch(() => ({}));
  if (!profile?.country_code) return bad('country_code required');

  const cc = String(profile.country_code).toLowerCase();
  const ent = await entitlementFor(env, session.uid, cc, PRODUCT.ASSISTANCE);
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
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
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

  const planKey = String(body.plan ?? 'personal_annual');
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
    customer_email: session.email,
    'subscription_data[metadata][user_id]': session.uid,
    'subscription_data[metadata][plan]': planKey,
    /* A business buying software wants an invoice with their VAT number on it,
       and collecting it after the fact means reissuing every invoice. */
    ...(plan.seats
      ? { 'tax_id_collection[enabled]': 'true', 'customer_update[name]': 'auto', billing_address_collection: 'required' }
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
         plan = excluded.plan,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, entitlements.stripe_subscription_id),
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        fields.status,
        fields.plan ?? 'monthly',
        fields.customer ?? null,
        fields.subscription ?? null,
        fields.period_end ?? null,
        now,
      )
      .run();
  };

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
  const session = await readSession(env, request.headers.get('cookie'));
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
/* Profile                                                             */
/* ------------------------------------------------------------------ */

async function handleProfile(request, env) {
  const session = await readSession(env, request.headers.get('cookie'));
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
  const session = await readSession(env, request.headers.get('cookie'));
  if (!session?.uid) return json({ signed_in: false });
  const url = new URL(request.url);
  const country = url.searchParams.get('country') || 'gb';
  const ent = await entitlementFor(env, session.uid, country);
  return json({ signed_in: true, email: session.email, entitlement: ent });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/webhooks/stripe' && request.method === 'POST') {
        return await handleStripeWebhook(request, env, ctx);
      }
      if (pathname === '/api/check' && request.method === 'POST') return await handleCheck(request, env);
      if (pathname === '/api/apply/plan' && request.method === 'POST') return await handlePlan(request, env);
      if (pathname === '/api/apply/consent' && request.method === 'POST') return await handleConsent(request, env);
      if (pathname === '/api/startups/check' && request.method === 'POST') return await handleStartupCheck(request, env);
      if (pathname === '/api/startups/plan' && request.method === 'POST') return await handleStartupPlan(request, env);
      if (pathname === '/api/startups/autofill' && request.method === 'POST') return await handleStartupAutofill(request, env);
      if (pathname === '/api/vault' && request.method === 'GET') return await handleVaultList(request, env);
      if (pathname.startsWith('/api/vault/')) {
        const id = pathname.slice('/api/vault/'.length);
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return bad('bad document id');
        if (request.method === 'PUT') return await handleVaultPut(request, env, id);
        if (request.method === 'GET') return await handleVaultGet(request, env, id);
        if (request.method === 'DELETE') return await handleVaultDelete(request, env, id);
        return bad('method not allowed', 405);
      }
      /* The unstripped copies are for this Worker, not for the internet. */
      if (pathname.startsWith('/api/v1/full/')) {
        return new Response('Not found', { status: 404 });
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
          const session = await readSession(env, request.headers.get('cookie'));
          const ent = session?.uid ? await entitlementFor(env, session.uid, m[2]) : null;
          if (ent?.entitled) {
            const full = await loadFullAsset(env, request, `${m[1]}/${m[2]}.json`);
            if (full) {
              return new Response(JSON.stringify(full), {
                headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
              });
            }
          }
        }
      }

      if (pathname === '/api/me') return await handleMe(request, env);
      if (pathname === '/api/profile') return await handleProfile(request, env);
      if (pathname === '/api/billing/checkout' && request.method === 'POST') return await handleCheckout(request, env);
      if (pathname === '/api/billing/portal' && request.method === 'POST') return await handlePortal(request, env);
      if (pathname === '/auth/request' && request.method === 'POST') return await handleAuthRequest(request, env);
      if (pathname === '/auth/verify' && request.method === 'POST') return await handleAuthVerify(request, env);
      if (pathname === '/auth/signout') {
        return new Response(null, {
          status: 302,
          headers: { location: `${env.APP_ORIGIN}/`, 'set-cookie': 'ua_session=; Path=/; Max-Age=0' },
        });
      }

      /* Everything else is a static asset — free, and not billed as a Worker
         request, which is why 4,000 SEO pages cost nothing. */
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: 'internal', detail: String(err?.message ?? err) }, 500);
    }
  },
};
