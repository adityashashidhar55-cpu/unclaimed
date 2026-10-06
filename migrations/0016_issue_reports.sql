-- "Report an error" on a programme page, and the MCP report_issue tool.
--
-- One row per report. Nothing here is shown publicly; the admin list
-- (GET /api/admin/issues) reads it, and `status` is how an operator clears the
-- queue: open -> fixed | rejected | duplicate.
--
-- No account is needed to report, so there is no user_id. The reporter's
-- address is optional and used only to say "fixed" back; the network address is
-- stored as a short hash — enough to see one source flooding the queue, not
-- enough to identify anyone.
--
-- Like 0010-0013 this is applied by hand after deploy
-- (`wrangler d1 migrations apply`). Until then POST /api/report-issue answers
-- 503 (see isMissingSchema in worker/index.js) and the programme-page link
-- tells the reader to try again shortly; nothing else reads this table.
CREATE TABLE IF NOT EXISTS issue_reports (
  id               TEXT PRIMARY KEY,
  reference        TEXT NOT NULL,          -- what the reporter is shown ("ir-xxxxxxxx")
  source           TEXT NOT NULL,          -- 'web' | 'mcp'
  audience         TEXT,                   -- 'household' | 'company' | NULL
  country_code     TEXT,                   -- lowercase slug, e.g. 'gb', 'eu', 'global'
  slug             TEXT NOT NULL,          -- programme slug as published on the page
  issue_type       TEXT NOT NULL,          -- wrong_amount | dead_link | rule_changed | wrong_deadline | other
  description      TEXT NOT NULL,
  suggested        TEXT,                   -- what the reporter says it should be
  evidence_url     TEXT,                   -- the official page that shows it
  page_url         TEXT,                   -- where they were when they reported
  locale           TEXT,
  reporter_contact TEXT,                   -- optional email
  status           TEXT NOT NULL DEFAULT 'open',
  resolution_note  TEXT,
  resolved_by      TEXT,
  resolved_at      INTEGER,
  created_at       INTEGER NOT NULL,
  ip_hash          TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_reports_status_created ON issue_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_issue_reports_slug ON issue_reports(country_code, slug);
