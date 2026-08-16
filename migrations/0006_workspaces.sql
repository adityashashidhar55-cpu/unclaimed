-- The enterprise workspace, held on the server.
--
-- Until now the whole workspace — companies, projects, pipeline, documents,
-- post-award obligations — lived in one localStorage key. That was a defensible
-- starting point (it works before you have an account, and a fund can try it on
-- a real portfolio without the portfolio leaving the building) and it is not a
-- product: it is per-browser, so a workspace does not survive a new laptop, a
-- cleared cache, or a second person on the same team, and "shared pipeline" is
-- the thing an enterprise buyer is actually buying.
--
-- One row per owner. `scope` is 'org' when the workspace belongs to an
-- organisation and 'user' when it belongs to one person, so a solo business
-- account works without inventing an org for them, and adding an org later
-- moves the row rather than merging two.
--
-- `rev` is the concurrency control and it is not decoration. Two tabs, or a
-- laptop and a phone, will both PUT: without a revision check the later write
-- silently erases whatever the earlier one added, and the user's evidence is a
-- pipeline entry that "disappeared". The Worker refuses a PUT whose `rev` is
-- not the current one and hands back the current document so the client can
-- reconcile rather than guess.
--
-- The document is stored as JSON rather than shredded into tables on purpose.
-- The shape is still moving, the whole thing is read and written together, and
-- nothing server-side queries inside it. When something does need to query it —
-- cross-org deadline reporting is the obvious one — that is the moment to
-- normalise, not before.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,          -- 'org:<id>' or 'user:<id>'
  scope       TEXT NOT NULL,             -- 'org' | 'user'
  owner_id    TEXT NOT NULL,             -- orgs.id or users.id
  doc         TEXT NOT NULL,             -- JSON, the whole workspace
  rev         INTEGER NOT NULL DEFAULT 1,
  bytes       INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,                      -- users.id of the last writer
  updated_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(scope, owner_id);
