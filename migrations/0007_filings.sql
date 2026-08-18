-- Filing on a company's behalf: the authority, the queue, and the audit trail.
--
-- This is the enterprise product, and the reason it is three tables rather than
-- a status column on a workspace document is that every one of them answers a
-- question someone will eventually ask under pressure:
--
--   authorisations       who allowed us to file this, when, and for what
--   filings              what state is each filing in, right now
--   application_events   every transition, append-only, with who did it
--
-- A workspace JSON blob cannot answer the third question at all, because the
-- whole point is that history is not overwritten. When a funder, an auditor or
-- a client asks "on what authority did you submit this on 3 March", the answer
-- has to be a row, not a reconstruction.

-- ------------------------------------------------------------------
-- The authority to act
-- ------------------------------------------------------------------
--
-- Scoped, signed, expiring, revocable. `scope` is JSON: the named programmes.
-- A blanket mandate would be simpler and is exactly what a finance director
-- will not sign, and what a funder will query if it ever looks.
--
-- `signed_by_*` records the human who bound the company. Not the account that
-- clicked — the person who holds the authority to appoint an agent. Those are
-- often the same person and sometimes are not, and only one of them is a
-- defence.
CREATE TABLE IF NOT EXISTS authorisations (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  country        TEXT NOT NULL,
  rail           TEXT NOT NULL,           -- delegated_account | signed_mandate | registered_power
  scope          TEXT NOT NULL,           -- JSON array of {slug, name, funder}
  signed_by_name TEXT NOT NULL,
  signed_by_role TEXT NOT NULL,
  signed_by_email TEXT,
  signed_at      INTEGER NOT NULL,
  signed_ip      TEXT,
  signed_ua      TEXT,
  expires_at     INTEGER,
  revoked_at     INTEGER,
  revoked_by     TEXT,
  created_by     TEXT NOT NULL,           -- users.id of the account that raised it
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_org ON authorisations(org_id, revoked_at);

-- ------------------------------------------------------------------
-- The queue
-- ------------------------------------------------------------------
--
-- Named `filings`, not `applications`, because 0001_init.sql already has an
-- `applications` table for the INDIVIDUAL side, keyed on user_id. Two tables
-- with the same name and different owners is the kind of thing that reads fine
-- until someone writes a join.
--
-- One row per (org, programme) filing attempt. `state` is the machine:
--
--   queued      accepted, nothing done yet
--   preparing   package being assembled
--   needs_input a field or document only the client can supply
--   ready       complete, waiting for the submission window or an operator
--   submitted   filed with the funder
--   acknowledged  funder confirmed receipt, usually with a reference
--   awarded / rejected / withdrawn   terminal
--   failed      we could not file; `error` says why
--
-- `authorisation_id` is NOT NULL on purpose. A filing without a recorded
-- authority is the one row that must not be possible to create.
CREATE TABLE IF NOT EXISTS filings (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  authorisation_id TEXT NOT NULL,
  programme_slug   TEXT NOT NULL,
  programme_name   TEXT,
  funder           TEXT,
  country          TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'queued',
  amount_min       INTEGER,
  amount_max       INTEGER,
  currency         TEXT,
  deadline_at      INTEGER,
  reference        TEXT,                  -- the funder's reference once we have one
  missing          TEXT,                  -- JSON array of fields/documents still needed
  error            TEXT,
  submitted_at     INTEGER,
  decided_at       INTEGER,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filings_org ON filings(org_id, state);
CREATE INDEX IF NOT EXISTS idx_filings_deadline ON filings(state, deadline_at);
-- One live filing per programme per org. Re-applying after a rejection is a new
-- row, which is why the terminal states are excluded rather than the whole
-- history being replaced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_filings_live
  ON filings(org_id, programme_slug)
  WHERE state NOT IN ('rejected', 'withdrawn', 'failed');

-- ------------------------------------------------------------------
-- The audit trail
-- ------------------------------------------------------------------
--
-- Append-only. Never updated, never deleted. `actor` is 'system' for automated
-- transitions and a users.id for anything a person did, because "the system
-- submitted it" and "a person submitted it" are different answers to the only
-- question that matters here.
CREATE TABLE IF NOT EXISTS application_events (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  org_id         TEXT NOT NULL,
  from_state     TEXT,
  to_state       TEXT NOT NULL,
  note           TEXT,
  actor          TEXT NOT NULL,           -- 'system' | users.id
  at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_app ON application_events(application_id, at);
