-- Two workspace quick wins that both need a new secret on the server side:
-- a private calendar feed, and optional TOTP for account holders.
--
-- CALENDAR TOKENS
--
-- The pipeline's deadlines, as an .ics URL a calendar app can subscribe to
-- (GET /api/calendar/<token>.ics). Unlike the admin/account TOTP secret below,
-- this "secret" is a bearer capability: whoever holds the URL can read that
-- person's pipeline deadlines, with no sign-in. So it is revocable (a stray
-- forward, a screenshot in Slack, is not permanent), and only the hash is
-- stored — never the token itself — so a dump of this table hands nobody a
-- working feed. One user can hold several rows over time (rotate keeps the
-- old row for audit instead of overwriting it); at most one is live at once,
-- which the Worker enforces by revoking the previous row before inserting a
-- new one.
CREATE TABLE IF NOT EXISTS calendar_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_hash ON calendar_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user ON calendar_tokens(user_id, revoked_at);

-- ACCOUNT TOTP
--
-- The same RFC 6238 second factor the operator door already has
-- (packages/totp, worker_config.admin_totp_*), offered to signed-in account
-- holders. Opt-in and one row per user: no row means the email code alone is
-- still sufficient, exactly as it always has been, so shipping this cannot
-- lock anyone out. `last_step` is replay protection — the same reasoning as
-- admin_totp_last_step, kept per-user here rather than in one config row.
CREATE TABLE IF NOT EXISTS user_totp (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  secret      TEXT NOT NULL,
  last_step   INTEGER,
  enabled_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Ten single-use codes, issued the moment TOTP is enabled, for the phone that
-- is lost or the app that is uninstalled. Hashed like the login codes and the
-- admin password: a dump of this table must not be a dump of working codes.
CREATE TABLE IF NOT EXISTS user_totp_recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  code_hash   TEXT NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_user ON user_totp_recovery_codes(user_id);
