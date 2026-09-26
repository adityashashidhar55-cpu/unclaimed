-- "Get expert help" leads: the handoff to involve-consulting.com, the owner's
-- separate paid consulting business. Flat-fee referrals only — this table
-- carries no price, no fee amount and no success/contingency field, because
-- that pricing model is never used and this schema should not make it easy
-- to add by accident.
--
-- Stored even when RESEND_API_KEY (and so LEADS_TO) is unset: the form still
-- captures the lead, it just cannot notify anyone by email until a key is
-- configured — same degrade-to-store-only shape as alert_subscriptions.
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  country         TEXT,                  -- lowercase cc slug, or NULL
  audience        TEXT,                  -- 'company' | 'household' | NULL
  programme_slug  TEXT,                  -- which page the CTA was clicked from, or NULL
  message         TEXT,
  consent         INTEGER NOT NULL DEFAULT 0,
  notified_at     INTEGER,               -- when the LEADS_TO email was sent, or NULL
  created_at      INTEGER NOT NULL,
  ip              TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
