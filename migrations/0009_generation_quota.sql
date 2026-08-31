-- Metered generation: what was produced, and what was bought.
--
-- Two tables and no counters. A "generations used this month" column on the
-- org would be one number to keep correct across concurrent requests, and the
-- failure mode is silent overspend on a model bill. Rows are appended and the
-- total is a SUM over an indexed month key, which cannot drift.
--
-- What a row is NOT: a record of an application, a claim, or an award. See
-- METERING in packages/quota — a unit counts a document produced, never a
-- filing made or a benefit obtained, and nothing here may be derived from an
-- amount. That distinction is what keeps a top-up a compute charge rather than
-- a procurement commission.

CREATE TABLE IF NOT EXISTS generation_usage (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  month           TEXT NOT NULL,          -- 'YYYY-MM', UTC
  org_id          TEXT,                   -- the billing unit, when there is one
  user_id         TEXT NOT NULL,
  type            TEXT NOT NULL,          -- see GENERATORS in packages/quota
  units           INTEGER NOT NULL,
  from_allowance  INTEGER NOT NULL DEFAULT 0,
  from_credits    INTEGER NOT NULL DEFAULT 0,
  programme_slug  TEXT,                   -- what it was about, for the customer's own history
  ok              INTEGER NOT NULL DEFAULT 1
);

-- The hot query is "how many units has this billing unit spent this month".
CREATE INDEX IF NOT EXISTS idx_gen_org_month ON generation_usage(org_id, month);
CREATE INDEX IF NOT EXISTS idx_gen_user_month ON generation_usage(user_id, month);
CREATE INDEX IF NOT EXISTS idx_gen_ts ON generation_usage(ts DESC);

-- Purchased packs. `remaining` is decremented rather than recomputed, because
-- a pack is a bucket the customer paid for and must not be silently refilled
-- by a bug in a SUM.
--
-- Never expires. A pack that evaporates at the end of a month is a pack the
-- customer will describe, accurately, as having been taken from them.
CREATE TABLE IF NOT EXISTS generation_credits (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT,
  user_id            TEXT NOT NULL,
  pack_id            TEXT NOT NULL,
  units              INTEGER NOT NULL,
  remaining          INTEGER NOT NULL,
  price_cents        INTEGER,
  source             TEXT NOT NULL DEFAULT 'stripe',  -- 'stripe' | 'granted'
  stripe_session_id  TEXT UNIQUE,                     -- redelivered webhooks are duplicates
  purchased_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credits_org ON generation_credits(org_id, remaining);
CREATE INDEX IF NOT EXISTS idx_credits_user ON generation_credits(user_id, remaining);
