-- Operator-granted access, and the trail of who granted it.
--
-- Why this is not a column on `entitlements`:
--
--   1. `entitlements` is owned by the Stripe webhook. `applyStripeEvent()`
--      upserts on user_id and assigns `status` unconditionally, so an
--      operator's edit would survive exactly until that customer's next
--      invoice event and then vanish, leaving no record it had existed.
--
--   2. A comped account carrying status='active' in the same table as paying
--      customers makes every revenue figure wrong, silently and permanently.
--      MRR would count people who have never paid.
--
-- So access is the union of "has a live subscription" and "has a live grant",
-- computed in entitlementFor(). Granting creates no Stripe customer; revoking
-- cancels no subscription. The two systems never write to each other.

CREATE TABLE IF NOT EXISTS grants (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  org_id         TEXT REFERENCES orgs(id),
  plan           TEXT NOT NULL,            -- see GRANTABLE_PLANS in packages/grants
  seats          INTEGER NOT NULL DEFAULT 1,
  gen_allowance  INTEGER,                  -- operator override; NULL = whatever the plan gives
  reason         TEXT NOT NULL,            -- required: see packages/grants/index.js
  granted_by     TEXT NOT NULL,            -- operator email from the session
  granted_at     INTEGER NOT NULL,
  expires_at     INTEGER,                  -- NULL = no end date
  revoked_at     INTEGER,
  revoked_by     TEXT,
  revoke_reason  TEXT
);

-- The hot query is "does this user have a live grant", asked on every gated
-- request, so it is indexed the way it is asked.
CREATE INDEX IF NOT EXISTS idx_grants_user ON grants(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_grants_recent ON grants(granted_at DESC);

-- Append-only. Every operator action that changes what somebody can see.
--
-- Nothing here is ever updated or deleted, including for a grant that is later
-- revoked: the revocation is its own row. "What did this account have on 3
-- March, and who decided that" has to be answerable from rows, not inferred
-- from the current state of another table.
CREATE TABLE IF NOT EXISTS admin_audit (
  id        TEXT PRIMARY KEY,
  ts        INTEGER NOT NULL,
  actor     TEXT NOT NULL,       -- operator email
  action    TEXT NOT NULL,       -- grant | revoke | supersede | create_user
  subject   TEXT,                -- the customer's email, denormalised so the
                                 -- trail still reads after a user row is gone
  user_id   TEXT,
  grant_id  TEXT,
  detail    TEXT                 -- JSON: plan, seats, days, reason
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON admin_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON admin_audit(user_id, ts DESC);
