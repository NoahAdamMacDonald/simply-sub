-- M10.8 (BLUEPRINT §11.4): device sync's chains. A chain is the sealed copy its devices share: its id (each device
-- derives it from the sync code, as it does the auth secret), the SHA-256 of its auth secret, the version each write
-- moves on (the ETag that makes a write conditional), the copy as base64 (sealed on the device, so the server can't
-- read it; D1 would answer a BLOB as an array of numbers), its size in bytes, when it last changed, and the day it's
-- deleted on, 180 days after its last write. Rows of up to a MiB, so it keeps its rowid.

CREATE TABLE sync_chains (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  copy TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  expires_on TEXT NOT NULL
) STRICT;

CREATE INDEX sync_chains_by_expiry ON sync_chains (expires_on);
