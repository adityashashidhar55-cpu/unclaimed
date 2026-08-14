-- UNCLAIMED — document vault.
--
-- What is NOT in this table is the point of it. There is no filename, no
-- label, no note, no plaintext and no key that can decrypt anything. The
-- bytes live in R2 as AES-GCM ciphertext; the wrapped data key is stored
-- here but is itself encrypted under a key derived from the user's
-- passphrase, which never leaves their device.
--
-- Consequence, stated plainly so nobody weakens it later: an operator with
-- full database and bucket access still cannot read a single payslip. If a
-- future change adds a server-side "preview" or "OCR" feature, that property
-- is gone and this comment is the thing that was ignored.

CREATE TABLE IF NOT EXISTS vault_documents (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,

  -- Canonical type from packages/vault DOC_TYPES. Coarse by design: it tells
  -- us a document is income evidence, never whose or how much.
  doc_type      TEXT NOT NULL,

  -- R2 object key. Ciphertext only.
  object_key    TEXT NOT NULL,
  bytes         INTEGER NOT NULL,

  -- AES-GCM parameters and the wrapped data key. Useless without the user's
  -- passphrase-derived KEK, which the server never receives.
  iv            BLOB NOT NULL,
  wrapped_key   BLOB NOT NULL,
  wrap_iv       BLOB NOT NULL,

  -- SHA-256 of the CIPHERTEXT, for integrity checks on download.
  checksum      TEXT NOT NULL,

  -- Dates drive the "your payslip is three months old" nudge. issued_at is
  -- what agencies care about; created_at is when we received it.
  issued_at     INTEGER,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,

  -- Where it came from: 'upload' or a consented rail such as 'digilocker'.
  source        TEXT NOT NULL DEFAULT 'upload',

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_user ON vault_documents(user_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_vault_expiry ON vault_documents(user_id, expires_at);

-- Per-user KDF salt. Not a secret, must not be reused, must survive so the
-- user can decrypt on a second device with the same passphrase.
CREATE TABLE IF NOT EXISTS vault_keys (
  user_id       TEXT PRIMARY KEY,
  kdf_salt      BLOB NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Every read of a document, so the user can see their own access history.
-- Deliberately records the actor, not the content.
CREATE TABLE IF NOT EXISTS vault_access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  document_id TEXT NOT NULL,
  action      TEXT NOT NULL,   -- 'put' | 'get' | 'delete'
  at          INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_log_user ON vault_access_log(user_id, at DESC);
