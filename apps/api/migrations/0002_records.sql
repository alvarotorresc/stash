-- Encrypted records (items, categories and tags) and their per-account counters.
-- The server never sees what a record holds: `blob` is AES-256-GCM ciphertext made on the device,
-- in base64url. Only the id, kind, version, size and dates are visible.

CREATE TABLE records (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Random UUID generated on the client. Unique per account, so ids of two accounts never meet.
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('item', 'category', 'tag')),
  -- Assigned by the server on every change: monotonic per account, the cursor of the pulls.
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  -- NULL once deleted: a tombstone keeps no content.
  blob TEXT,
  -- Decoded bytes of the blob; 0 for a tombstone.
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  CHECK ((deleted = 1 AND blob IS NULL AND size = 0) OR (deleted = 0 AND blob IS NOT NULL))
) STRICT;

-- Pull by cursor: the account's changes after a version, in order. Also keeps versions unique.
CREATE UNIQUE INDEX records_user_version ON records (user_id, version);

-- Rows and blob bytes per account, kept exact by the triggers below, for the account quotas.
CREATE TABLE record_counts (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  records INTEGER NOT NULL,
  bytes INTEGER NOT NULL
) STRICT;

CREATE TRIGGER records_count_insert AFTER INSERT ON records
BEGIN
  INSERT INTO record_counts (user_id, records, bytes) VALUES (NEW.user_id, 1, NEW.size)
  ON CONFLICT (user_id) DO UPDATE SET records = records + 1, bytes = bytes + NEW.size;
END;

CREATE TRIGGER records_count_update AFTER UPDATE OF size ON records
BEGIN
  UPDATE record_counts SET bytes = bytes + NEW.size - OLD.size WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER records_count_delete AFTER DELETE ON records
BEGIN
  UPDATE record_counts SET records = records - 1, bytes = bytes - OLD.size
  WHERE user_id = OLD.user_id;
END;
