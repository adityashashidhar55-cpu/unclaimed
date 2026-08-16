-- Admin access and product analytics.
--
-- Two separate needs that share one migration because they share one audience:
-- the person who owns the site.
--
--   1. An operator login that can see the paid product without paying for it.
--      Not a discount code and not a free plan — a role on the session, so it
--      leaves a trail and can be revoked by rotating one secret.
--
--   2. Enough event data to answer "where do people stop". Which is not a
--      pageview counter: a pageview count tells you 4,000 people arrived and
--      nothing about the fact that 3,900 of them left on question three.
--
-- What is deliberately NOT stored: no IP addresses, no user agents, no
-- referrer URLs with query strings, and nothing a visitor typed. A funnel
-- needs to know that a step happened, not who took it. The `visitor` column is
-- a random id the browser keeps for the session only, so day-over-day the same
-- person counts as a new visitor — which understates returning users and is
-- the right direction to be wrong in.

-- One row per funnel step reached.
CREATE TABLE IF NOT EXISTS events (
  id        TEXT PRIMARY KEY,
  ts        INTEGER NOT NULL,
  day       TEXT NOT NULL,          -- 'YYYY-MM-DD', UTC, so grouping is an index scan
  step      TEXT NOT NULL,          -- see FUNNEL in worker/index.js
  visitor   TEXT NOT NULL,          -- per-tab random id, not a person
  country   TEXT,                   -- the country being checked, not the visitor's
  locale    TEXT,
  surface   TEXT                    -- 'web' | 'pwa' | 'native'
);

CREATE INDEX IF NOT EXISTS idx_events_day  ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_step ON events(day, step);
CREATE INDEX IF NOT EXISTS idx_events_vis  ON events(visitor, step);

-- Who signed in, and when. The admin dashboard's "who logged in" table.
-- Email is stored because the operator already has it — these are their own
-- customers' accounts, listed in their own admin panel.
CREATE TABLE IF NOT EXISTS login_events (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  day           TEXT NOT NULL,
  user_id       TEXT,
  email         TEXT NOT NULL,
  account_type  TEXT NOT NULL DEFAULT 'individual',
  is_new        INTEGER NOT NULL DEFAULT 0,   -- first ever sign-in for this address
  kind          TEXT NOT NULL DEFAULT 'otp'   -- 'otp' | 'admin'
);

CREATE INDEX IF NOT EXISTS idx_logins_ts    ON login_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logins_day   ON login_events(day);
CREATE INDEX IF NOT EXISTS idx_logins_email ON login_events(email, ts DESC);

-- Failed admin password attempts, so a brute force is visible and rate
-- limitable without a second store.
CREATE TABLE IF NOT EXISTS admin_attempts (
  id       TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  ip_hash  TEXT NOT NULL,          -- SHA-256(ip + signing key), never the address
  ok       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_attempts ON admin_attempts(ip_hash, ts DESC);
