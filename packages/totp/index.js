/**
 * A second factor for the operator door.
 *
 * The admin password already unlocks every paid surface on the site for twelve
 * hours. The URL is guessable, the email is guessable, and that leaves exactly
 * one secret between the internet and the whole product. Rate limiting makes
 * guessing slow; it does nothing about a password that has leaked.
 *
 * So: RFC 6238 TOTP, the six digits from an authenticator app. No dependency —
 * it is HMAC-SHA1 over a counter, and Web Crypto does HMAC-SHA1. SHA-1 is
 * correct here rather than a compromise: TOTP is specified on it, every
 * authenticator app implements it, and the security of the scheme rests on the
 * shared secret and the 30-second window, not on collision resistance.
 *
 * Two decisions that matter more than the maths:
 *
 *   1. **Opt-in, and never inferred.** If no secret is stored, the door works
 *      exactly as it did. An owner cannot be locked out by deploying this, and
 *      enrolling takes a code they have already proved they can generate.
 *   2. **A used code is dead.** A six-digit code is valid for up to 90 seconds
 *      across the drift window, and anything that can read it once — a
 *      shoulder, a screenshot, a phishing page relaying it — can replay it
 *      inside that window. `consume()` is what makes the second use fail.
 */

/* ------------------------------------------------------------------ */
/* Base32, because that is what authenticator apps read               */
/* ------------------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding — the form every otpauth:// URI uses. */
export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decode, forgivingly.
 *
 * Authenticator apps print secrets in groups of four and people paste them
 * back with the spaces still in, in whatever case they landed. Refusing that
 * would produce "invalid code" for a secret that is perfectly correct, which
 * is indistinguishable from a real failure at the moment somebody is trying to
 * get in.
 */
export function base32Decode(s) {
  const clean = String(s ?? '').toUpperCase().replace(/[\s-]+/g, '').replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ------------------------------------------------------------------ */
/* The code itself                                                     */
/* ------------------------------------------------------------------ */

export const STEP_SECONDS = 30;
export const DIGITS = 6;

/** How many steps either side of now are accepted. One is 30s of clock drift
 *  in each direction, which covers a phone that has not synced recently
 *  without widening the replay window beyond what consume() can cover. */
export const DRIFT_STEPS = 1;

export const stepFor = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The eight-byte big-endian counter RFC 4226 hashes. */
function counterBytes(counter) {
  const b = new Uint8Array(8);
  /* BigInt rather than bit shifts: `counter << 32` in JS is a 32-bit
     operation and silently wraps, which produces a plausible wrong code
     roughly forever after 2038. */
  let n = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return b;
}

/** One code, for one counter. */
export async function hotp(secretBytes, counter, digits = DIGITS) {
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The code for right now. */
export async function totp(secretB32, at = Date.now(), digits = DIGITS) {
  const bytes = base32Decode(secretB32);
  if (!bytes) return null;
  return hotp(bytes, stepFor(at), digits);
}

/**
 * Is this the right code?
 *
 * Returns the step it matched, or null. The step is the point: the caller
 * stores it so the same code cannot be used twice, which a boolean could not
 * support.
 *
 * The comparison is constant-time over the digits. A six-digit space is small
 * enough that a timing oracle on the first digit would cut the search by ten,
 * and it costs nothing to close.
 */
export async function verify(secretB32, code, { at = Date.now(), drift = DRIFT_STEPS } = {}) {
  const digits = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const bytes = base32Decode(secretB32);
  if (!bytes) return null;

  const now = stepFor(at);
  let matched = null;
  /* Every candidate is checked even after one matches, so the time taken does
     not reveal which step it was. */
  for (let d = -drift; d <= drift; d += 1) {
    const step = now + d;
    const expected = await hotp(bytes, step, DIGITS);
    let diff = 0;
    for (let i = 0; i < DIGITS; i += 1) diff |= expected.charCodeAt(i) ^ digits.charCodeAt(i);
    if (diff === 0 && matched === null) matched = step;
  }
  return matched;
}

/**
 * A fresh secret, 20 bytes as RFC 4226 recommends.
 *
 * Returned base32-encoded because that is the only form anything else wants —
 * the QR code, the manual-entry field, and the row in the database.
 */
export function newSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * The otpauth:// URI an authenticator app scans.
 *
 * `issuer` appears twice on purpose: in the label for older apps that only
 * read the label, and as a parameter for everything since. Apps that read both
 * require them to agree, so they are built from one value here.
 */
export function otpauthUri({ secret, account, issuer = 'Unclaimed Grants' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Replay protection.
 *
 * The store is whatever the caller has — a D1 row, a Map in a test. It only
 * has to remember the last step that was accepted, because steps only ever go
 * forwards: a code from a step at or before the last accepted one is either a
 * replay or a code from the past, and neither should open the door.
 */
export function isReplay(step, lastUsedStep) {
  if (lastUsedStep == null) return false;
  return step <= lastUsedStep;
}
