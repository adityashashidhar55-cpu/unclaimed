-- "Email me this result": the free check runs entirely in the browser, so a
-- visitor who does not buy today is gone for good. This table is the opt-in
-- bridge back — one row per (email, audience), created only when someone
-- types their address into the results screen and presses the button.
--
-- Two different permissions live in one row, on purpose kept apart:
--   * the one transactional email ("here is the result you asked for") is
--     sent because the person asked for it, consent box or not;
--   * everything after that (the day 2/5/10/21 sequence and the weekly
--     "new matches" digest) is marketing, and is sent ONLY when consent_at
--     is set — i.e. the box was ticked.
-- With no consent the profile and share_link (which encodes the same answers)
-- are blanked as soon as the one email is sent (profile = '{}', share_link = ''),
-- so nothing about the household or company is kept that nobody has agreed to
-- us keeping. Unsubscribing blanks them too.
--
-- No new table is read by sign-in, checkout or /api/check, so a Worker
-- deployed ahead of this migration answers 503 on the new endpoint and the
-- cron skips — see isMissingSchema() in worker/index.js.
CREATE TABLE IF NOT EXISTS result_subscribers (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  audience         TEXT NOT NULL,          -- 'household' | 'company'
  country          TEXT NOT NULL,          -- lowercase cc slug
  locale           TEXT NOT NULL DEFAULT 'en',
  profile          TEXT NOT NULL,          -- JSON, exactly as entered; '{}' once there is no consent to keep it
  share_link       TEXT NOT NULL,          -- the #r=<answers> link the visitor could have copied themselves
  token            TEXT NOT NULL UNIQUE,   -- unsubscribe capability, kept across re-submits
  consent_at       INTEGER,                -- NULL: transactional email only, no follow-ups
  created_at       INTEGER NOT NULL,
  sent_at          INTEGER,                -- when the result email went out
  seq_step         INTEGER NOT NULL DEFAULT 0,  -- last follow-up sent: 0 none, 1=day 2, 2=day 5, 3=day 10, 4=day 21
  last_mail_at     INTEGER,                -- last marketing email of any kind (sequence or digest)
  result_sig       TEXT,                   -- signature of the free result last emailed; drives "changed since"
  unsubscribed_at  INTEGER,
  ip               TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_result_subs_email_audience ON result_subscribers(email, audience);
-- The cron's hot query: consented, not unsubscribed.
CREATE INDEX IF NOT EXISTS idx_result_subs_active ON result_subscribers(consent_at, unsubscribed_at);
