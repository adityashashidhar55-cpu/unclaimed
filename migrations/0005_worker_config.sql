-- Configuration the Worker owns, rather than configuration a human must
-- remember to set.
--
-- Two things lived as `wrangler secret` values and were, predictably, never
-- set: the session signing key and the operator credential. A missing secret
-- does not announce itself. It makes every session cookie unverifiable, and
-- the symptom a user reports is "sign-in does nothing" — which is exactly what
-- this deployment shipped with, for everybody, for weeks.
--
-- So the Worker provisions what it can provision. The signing key is generated
-- on first use and kept here. The operator credential is seeded here too.
--
-- The trust boundary does not move: a Cloudflare secret is readable by this
-- Worker and so is its own D1 database, and nothing else can read either. What
-- changes is that there is no setup step left to forget. Environment secrets
-- still take precedence wherever they are set, so rotating by hand stays
-- available and an existing deployment keeps its live sessions.
--
-- What must NEVER go in this table: anything a third party issued us — Stripe
-- keys, webhook signing secrets, mail provider keys. Those are secrets in the
-- proper sense, they are rotated elsewhere, and a database row is the wrong
-- place for them. This table is for values this Worker generates or that only
-- this Worker verifies.

CREATE TABLE IF NOT EXISTS worker_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
