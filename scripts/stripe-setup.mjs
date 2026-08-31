#!/usr/bin/env node
/**
 * Create the three Stripe prices, once.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
 *
 * Idempotent by lookup_key: run it twice and it finds what it made the first
 * time rather than creating a second €80 price that silently competes with the
 * first. Prints the three lines to paste into wrangler.jsonc.
 *
 * No SDK — Stripe's REST API over fetch, same as the Worker. Adding
 * `stripe-node` here would mean this repo grows a node_modules for one script.
 */

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set.\n\nGet it from https://dashboard.stripe.com/apikeys');
  console.error('Use the TEST key (sk_test_...) until you have run a payment through end to end.');
  process.exit(1);
}
const LIVE = KEY.startsWith('sk_live_');

/* Prices are in cents, in euros, per the pricing page. Changing a price here
   does NOT change what existing subscribers pay — Stripe prices are immutable
   once created, and a new one has to be created and migrated onto. That is a
   feature: nobody's bill changes because someone edited a constant. */
const PLANS = [
  {
    lookup: 'ug_personal_monthly_v1',
    product: 'Unclaimed Grants — Personal',
    nickname: 'Personal, monthly',
    unit_amount: 700,
    interval: 'month',
    description: 'Every programme you match, with deadlines, documents and prepared applications.',
  },
  {
    lookup: 'ug_personal_annual_v1',
    product: 'Unclaimed Grants — Personal',
    nickname: 'Personal, annual',
    unit_amount: 5000,
    interval: 'year',
    description: 'The personal plan, billed yearly. Two months cheaper than monthly.',
  },
  {
    lookup: 'ug_business_monthly_v1',
    product: 'Unclaimed Grants — Business',
    nickname: 'Business, per seat, monthly',
    /* €49, because that is what /pricing/ says in all seven languages. It said
       8000 here — so anyone running this script would have created a price
       that charges €80 against a page promising €49, and the first anyone
       would know is a chargeback. scripts/test-pricing.mjs now asserts the two
       agree. */
    unit_amount: 4900,
    interval: 'month',
    description: 'Grant discovery across 77 jurisdictions, de minimis tracking, exports and a team dashboard.',
  },
  {
    lookup: 'ug_business_annual_v1',
    product: 'Unclaimed Grants — Business',
    nickname: 'Business, per seat, annual',
    unit_amount: 49000,
    interval: 'year',
    description: 'The business plan, billed yearly per seat. Two months cheaper than monthly.',
  },
];

/* Generation credit packs — one-off payments, not subscriptions.
 *
 * Units, prices and the margin they clear live in packages/quota, and
 * scripts/test-quota.mjs fails the build if any of them drops below the floor.
 * This script only creates the Stripe prices that match them. */
const PACKS = [
  { lookup: 'ug_pack_25_v1',  id: 'pack_25',  nickname: '25 generations',  unit_amount: 2900 },
  { lookup: 'ug_pack_100_v1', id: 'pack_100', nickname: '100 generations', unit_amount: 9900 },
  { lookup: 'ug_pack_300_v1', id: 'pack_300', nickname: '300 generations', unit_amount: 24900 },
];

const api = async (path, params, method = 'POST') => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${body.error?.message ?? res.status}`);
  return body;
};

/* One product per tier, reused across its prices, so the customer portal shows
   "Personal" with a monthly/annual switch rather than two unrelated products. */
const products = new Map();
async function productFor(name, description) {
  if (products.has(name)) return products.get(name);
  const found = await api(`products/search?query=${encodeURIComponent(`name:'${name}'`)}`, null, 'GET');
  const existing = found.data?.[0];
  const p = existing ?? (await api('products', { name, description }));
  products.set(name, p.id);
  return p.id;
}

console.log(`\nStripe setup — ${LIVE ? 'LIVE MODE' : 'test mode'}\n`);
if (LIVE) console.log('  Creating real prices against your live account.\n');

const out = [];
for (const plan of PLANS) {
  const existing = await api(
    `prices?lookup_keys[]=${encodeURIComponent(plan.lookup)}&limit=1`,
    null,
    'GET',
  );

  let price = existing.data?.[0];
  if (price) {
    console.log(`  = ${plan.nickname.padEnd(28)} already exists  ${price.id}`);
  } else {
    const productId = await productFor(plan.product, plan.description);
    price = await api('prices', {
      product: productId,
      currency: 'eur',
      unit_amount: String(plan.unit_amount),
      'recurring[interval]': plan.interval,
      nickname: plan.nickname,
      lookup_key: plan.lookup,
      /* Per-seat on business: the quantity is the seat count. */
      ...(plan.lookup.includes('business') ? { 'recurring[usage_type]': 'licensed' } : {}),
    });
    console.log(`  + ${plan.nickname.padEnd(28)} created         ${price.id}`);
  }

  const varName = {
    ug_personal_monthly_v1: 'STRIPE_PRICE_PERSONAL_MONTHLY',
    ug_personal_annual_v1: 'STRIPE_PRICE_PERSONAL_ANNUAL',
    ug_business_monthly_v1: 'STRIPE_PRICE_BUSINESS_MONTHLY',
    ug_business_annual_v1: 'STRIPE_PRICE_BUSINESS_ANNUAL',
  }[plan.lookup];
  out.push(`    "${varName}": "${price.id}",`);
}

/* The packs. One product, three prices, no recurring interval — a pack is
   bought, not subscribed to, and giving it an interval would bill it monthly
   forever. */
{
  const productId = await productFor('Unclaimed Grants — Generations', 'Documents written for a specific funder’s published criteria. Bought once; they do not expire.');
  for (const p of PACKS) {
    const existing = await api(`prices?lookup_keys[]=${encodeURIComponent(p.lookup)}&limit=1`, null, 'GET');
    let price = existing.data?.[0];
    if (price) {
      console.log(`  = ${p.nickname.padEnd(28)} already exists  ${price.id}`);
    } else {
      price = await api('prices', {
        product: productId,
        currency: 'eur',
        unit_amount: String(p.unit_amount),
        nickname: p.nickname,
        lookup_key: p.lookup,
      });
      console.log(`  + ${p.nickname.padEnd(28)} created         ${price.id}`);
    }
    out.push(`    "STRIPE_PRICE_${p.id.toUpperCase()}": "${price.id}",`);
  }
}

console.log('\nPaste into the "vars" block of wrangler.jsonc:\n');
console.log(out.join('\n').replace(/,$/, ''));
console.log(`
Then, once:

  wrangler secret put STRIPE_SECRET_KEY
  wrangler secret put STRIPE_WEBHOOK_SECRET     # from the webhook you create below
  wrangler secret put SESSION_SIGNING_KEY       # openssl rand -hex 32
  wrangler secret put RESEND_API_KEY            # so sign-in codes actually send

Webhook endpoint to add at https://dashboard.stripe.com/webhooks:

  URL     https://unclaimedgrant.com/webhooks/stripe
  Events  checkout.session.completed
          customer.subscription.created
          customer.subscription.updated
          customer.subscription.deleted
          invoice.payment_failed
`);
