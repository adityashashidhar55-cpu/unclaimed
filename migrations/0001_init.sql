-- Unclaimed — users, entitlements, consent ledger.
-- D1 (SQLite). Strong consistency: KV's ~60s propagation makes it unusable for
-- a paywall — a user who has just paid must not still see the wall.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  country       TEXT,
  locale        TEXT DEFAULT 'en',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id),
  status                  TEXT NOT NULL,          -- active|trialing|past_due|canceled|free_jurisdiction
  plan                    TEXT NOT NULL,
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  current_period_end      INTEGER,
  updated_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ent_customer ON entitlements(stripe_customer_id);

-- Stripe redelivers webhooks. Primary-key collision = already processed.
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  INTEGER NOT NULL
);

-- Magic-link auth. No passwords stored, ever.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- The application profile the user builds once and reuses everywhere.
CREATE TABLE IF NOT EXISTS profiles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  data        TEXT NOT NULL,       -- JSON, encrypted at rest by D1
  updated_at  INTEGER NOT NULL
);

-- Evidence of exactly what the user was shown and affirmed, per submission.
-- Protects the user as much as us: a benefits declaration is sworn, and the
-- person who repays an error is them.
CREATE TABLE IF NOT EXISTS consents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  programme_slug  TEXT NOT NULL,
  country         TEXT NOT NULL,
  attested_text   TEXT NOT NULL,   -- JSON array, verbatim sentences shown
  values_digest   TEXT NOT NULL,
  consented_at    INTEGER NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  scope           TEXT NOT NULL DEFAULT 'single_submission'
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id, consented_at);

-- What the user has actually done, so we can nudge and track outcomes.
CREATE TABLE IF NOT EXISTS applications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  programme_slug  TEXT NOT NULL,
  country         TEXT NOT NULL,
  state           TEXT NOT NULL,   -- prepared|submitted_by_user|awaiting_docs|decided|abandoned
  amount_min      INTEGER,
  amount_max      INTEGER,
  currency        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id, updated_at);
