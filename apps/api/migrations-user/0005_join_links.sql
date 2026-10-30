-- M10.14 (BLUEPRINT §11.4): join links, the one-time QR codes that add a device to a sync chain. A device seals the
-- chain's code with a random key only the link carries (after its #, which never reaches the server) and sends the
-- sealed bytes; the row keeps them under the SHA-256 of the link's id, with the time the link stops working, 10 minutes
-- on. The first DELETE /join/:id answers them and deletes the row in the same statement, so a link works once. WITHOUT
-- ROWID, so the id's hash is the table: a link costs a row written to make and one to delete. No index: links are
-- deleted by their id, and the nightly clean-up's look for expired ones reads a table of a few rows.

CREATE TABLE join_links (
  id_hash TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;
