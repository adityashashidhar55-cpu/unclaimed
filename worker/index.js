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
import { policyFor, mayCharge } from '../packages/policy/index.js';

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
 * Note the jurisdiction branch: in France, Germany, Italy and Portugal we do
 * not sell benefits help to the beneficiary — several legislatures have made
 * charging for it an offence or a reserved activity (see packages/policy).
 * Users in those countries are entitled by default rather than being shown a
 * wall we are not allowed to charge them to cross.
 */
async function entitlementFor(env, userId, country) {
  if (!mayCharge(country)) {
    return { entitled: true, reason: 'free_jurisdiction', policy: policyFor(country) };
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

/** Programme data is served from the same static assets the site uses. */
async function loadCountry(env, request, cc) {
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
  const ent = await entitlementFor(env, session.uid, cc);
  if (!ent.entitled) return json({ error: 'subscription required', paywall: ent }, 402);

  const data = await loadCountry(env, request, cc);
  const manifest = await loadManifest(env, request);
  if (!data || !manifest) return bad('unknown country', 404);
  const entry = manifest.countries.find((c) => c.slug === cc);

  const result = match(profile, data, entry);
  const plan = buildPlan({ profile, matches: result.eligible, entry, lang });

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
/* Auth — magic link, no passwords                                     */
/* ------------------------------------------------------------------ */

async function handleAuthRequest(request, env) {
  const { email } = await request.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('valid email required');

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256Hex(token);
  const expires = Date.now() + 15 * 60 * 1000;

  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(hash, email.toLowerCase(), expires)
    .run();

  const link = `${env.APP_ORIGIN}/auth/callback?token=${token}`;

  /* Delivery is intentionally pluggable. Wire MailChannels, Resend or Postmark
     here; in dev the link is returned so the flow is testable without email. */
  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM || 'Unclaimed <hello@unclaimed.app>',
        to: email,
        subject: 'Your sign-in link',
        text: `Sign in to Unclaimed:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      }),
    });
    return json({ ok: true, sent: true });
  }

  return json({ ok: true, sent: false, dev_link: link });
}

async function handleAuthCallback(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return bad('token required');

  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?',
  )
    .bind(hash)
    .first();

  if (!row || row.used_at || row.expires_at < Date.now()) return bad('link expired or already used', 401);

  await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').bind(Date.now(), hash).run();

  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind(id, row.email, Date.now())
      .run();
    user = { id };
  }

  const cookie = await signSession(env, { uid: user.id, email: row.email, exp: Date.now() + 30 * 864e5 });
  return new Response(null, {
    status: 302,
    headers: {
      location: `${env.APP_ORIGIN}/account/`,
      'set-cookie': `ua_session=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
    },
  });
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

async function handleCheckout(request, env) {
  const session = await readSession(env, request.headers.get('cookie'));
  if (!session?.uid) return bad('sign in required', 401);

  const { country = 'gb' } = await request.json().catch(() => ({}));

  /* Refuse to take money where taking it is the offence. This is a server-side
     guard, not a UI nicety — see packages/policy for the statutes. */
  if (!mayCharge(country)) {
    return json(
      {
        error: 'billing_not_available_in_jurisdiction',
        message: 'This country is free to use. We do not charge for benefits help here.',
        policy: policyFor(country),
      },
      403,
    );
  }

  const cs = await stripeCall(env, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_MONTHLY,
    'line_items[0][quantity]': '1',
    success_url: `${env.APP_ORIGIN}/account/?welcome=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_ORIGIN}/pricing/`,
    client_reference_id: session.uid,
    'metadata[user_id]': session.uid,
    customer_email: session.email,
    'subscription_data[metadata][user_id]': session.uid,
    allow_promotion_codes: 'true',
  });

  return json({ url: cs.url });
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
      if (pathname === '/api/me') return await handleMe(request, env);
      if (pathname === '/api/profile') return await handleProfile(request, env);
      if (pathname === '/api/billing/checkout' && request.method === 'POST') return await handleCheckout(request, env);
      if (pathname === '/api/billing/portal' && request.method === 'POST') return await handlePortal(request, env);
      if (pathname === '/auth/request' && request.method === 'POST') return await handleAuthRequest(request, env);
      if (pathname === '/auth/callback') return await handleAuthCallback(request, env);
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
