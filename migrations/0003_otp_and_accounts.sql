-- Email + OTP sign-in, and the individual/business split.
--
-- Why OTP rather than the magic link this replaces: a link has to survive an
-- email client that rewrites URLs for scanning (Outlook Safe Links follows
-- them, which consumes a single-use token before the human ever clicks it) and
-- it opens in whatever browser the mail app prefers, which is not the one
-- holding the session. A six-digit code typed back into the tab that asked for
-- it has neither problem, and it is the flow people already expect.
--
-- Why not passwords: there is nothing to leak, nothing to reset, nothing to
-- reuse from another breach. The whole password surface simply does not exist.

CREATE TABLE IF NOT EXISTS login_codes (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,       -- SHA-256 of the code + a per-row salt
  salt          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  consumed_at   INTEGER,
  requested_ip  TEXT,
  created_at    INTEGER NOT NULL
);

-- Verification is by email, so the lookup is by email + freshness.
CREATE INDEX IF NOT EXISTS idx_codes_email ON login_codes(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_codes_expiry ON login_codes(expires_at);

-- Send-rate ledger. Without this, the endpoint is a free way to send mail to
-- any address on the internet with our domain in the From header, which is how
-- a sending reputation dies.
CREATE TABLE IF NOT EXISTS send_log (
  bucket    TEXT NOT NULL,           -- 'email:<addr>' or 'ip:<addr>'
  window    INTEGER NOT NULL,        -- unix hour
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window)
);

-- Individual and business accounts are different products with different
-- prices, so the account carries which one it is.
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN org_name TEXT;
ALTER TABLE users ADD COLUMN org_domain TEXT;

-- Seats, for the business tier. A single row per org keeps the join cheap and
-- the model honest: an org is a billing unit, not a directory.
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  seats       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_domain ON orgs(domain) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'member',   -- owner|admin|member
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

-- Entitlements can now be held by an org rather than a person, so a business
-- subscription covers every seat without one row per member drifting apart.
ALTER TABLE entitlements ADD COLUMN org_id TEXT REFERENCES orgs(id);
CREATE INDEX IF NOT EXISTS idx_ent_org ON entitlements(org_id);
