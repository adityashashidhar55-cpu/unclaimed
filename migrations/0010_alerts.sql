-- Deadline email alerts.
--
-- The retention feature Instrumentl and Subsdy charge for: tell someone before
-- a deadline closes, not only when they happen to come back and check. Free
-- accounts get one jurisdiction, so the feature is real for a solo founder
-- checking their own country; entitled users (entitlementFor) get every
-- jurisdiction they want, which is the paid version of the same idea.
--
-- Double opt-in throughout, the same reason login is OTP rather than a
-- password: `email` here is not authenticated by anything at subscribe time,
-- so the confirm link is what proves the address is real before we ever mail
-- it again on a schedule nobody asked for.
--
-- One row per (email, audience): a founder tracking companies and someone in
-- the same household tracking benefits are different subscriptions, but
-- re-subscribing the same email to the same audience updates the existing row
-- rather than creating a second one that silently doubles the digest.
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  jurisdictions  TEXT NOT NULL,          -- JSON array of country-code slugs
  audience       TEXT NOT NULL,          -- 'companies' | 'individuals'
  token          TEXT NOT NULL UNIQUE,   -- confirm link now, unsubscribe link forever after
  confirmed_at   INTEGER,                -- NULL until the confirm link is clicked
  created_at     INTEGER NOT NULL,
  last_sent_at   INTEGER,                -- drives "newly open since last time" in the cron
  unsubscribed_at INTEGER,
  user_id        TEXT REFERENCES users(id)  -- NULL: alerts do not require an account
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_subs_email_audience ON alert_subscriptions(email, audience);
-- The cron's hot query: everyone confirmed and not unsubscribed.
CREATE INDEX IF NOT EXISTS idx_alert_subs_active ON alert_subscriptions(confirmed_at, unsubscribed_at);

-- One row per subscription per calendar day a digest actually went out.
-- Idempotency, not analytics: if the cron fires twice in one UTC day (a retry,
-- a redeploy mid-run), the second pass finds today's row here and sends
-- nothing rather than mailing the same person twice. `programme_slugs` is kept
-- only so a support reply ("why did I get this email") can be answered from a
-- row instead of a guess.
CREATE TABLE IF NOT EXISTS alert_sends (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES alert_subscriptions(id),
  sent_date        TEXT NOT NULL,        -- 'YYYY-MM-DD', UTC
  programme_slugs  TEXT NOT NULL,        -- JSON array, what the digest named
  created_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_sends_once_per_day ON alert_sends(subscription_id, sent_date);
