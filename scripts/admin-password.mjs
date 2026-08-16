#!/usr/bin/env node
/**
 * Mint an operator password for the admin dashboard.
 *
 *   node scripts/admin-password.mjs you@example.com
 *   node scripts/admin-password.mjs you@example.com 'a password I chose'
 *
 * Prints the password once, then the two `wrangler secret put` values that
 * verify it. The password itself is never stored anywhere — not in this repo,
 * not in wrangler.jsonc, not in D1. Lose it and you run this again.
 *
 * PBKDF2-SHA256 at 210,000 iterations, which is OWASP's 2023 figure for this
 * primitive and matches `pbkdf2Hex` in worker/index.js. If you change the count
 * in one place, change it in the other or every login fails.
 */
import crypto from 'node:crypto';

const ITERATIONS = 210_000;

/* Base32-ish alphabet with the characters that get misread over a phone call
   removed: no 0/O, no 1/l/I. A password you retype wrong four times is a
   password you write on a sticky note. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function generate(words = 4, len = 5) {
  const out = [];
  for (let w = 0; w < words; w++) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    out.push(s);
  }
  return out.join('-');
}

const email = (process.argv[2] || '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/admin-password.mjs <email> [password]');
  process.exit(1);
}

const password = process.argv[3] || generate();
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256').toString('hex');

/* 20 characters from a 31-character alphabet, ignoring the separators. */
const bits = Math.round(20 * Math.log2(ALPHABET.length));

console.log(`
  Operator account
  ────────────────
  Email     ${email}
  Password  ${password}${process.argv[3] ? '  (yours)' : `  (~${bits} bits of entropy)`}

  Write these down now. They are not recoverable and not stored in the repo.

  Then set the three secrets:

    npx wrangler secret put ADMIN_EMAIL
    ${email}

    npx wrangler secret put ADMIN_PASSWORD_SALT
    ${salt}

    npx wrangler secret put ADMIN_PASSWORD_HASH
    ${hash}

  Sign in at https://unclaimedgrant.com/admin/ . The session lasts 12 hours and
  unlocks every paid surface on the site for that browser. To revoke it, run
  this script again and re-put the two password secrets.
`);
