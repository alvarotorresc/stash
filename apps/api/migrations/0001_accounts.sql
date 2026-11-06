-- Accounts, sessions and rate limiting.
-- Keys are never stored: only HMAC-SHA-256 digests keyed with the Worker's pepper (base64url).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Trimmed, NFC-normalised and lowercased, exactly as the clients bind it into the salt.
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  kdf_memory_kib INTEGER NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_parallelism INTEGER NOT NULL,
  login_key_hash TEXT NOT NULL,
  recovery_key_hash TEXT NOT NULL,
  wrapped_data_key TEXT NOT NULL,
  recovery_wrapped_data_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- Without a rowid, storing a session writes the row and its `user_id` index entry only. Expired
-- sessions are deleted by the daily sweep, which scans the table instead of keeping an index.
CREATE TABLE sessions (
  -- HMAC of the bearer token; the token itself only exists on the client.
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_user_id ON sessions (user_id);

-- Fixed-window counters. `key` is an HMAC of the bucket and its subject (IP, email or account),
-- so neither emails nor IP addresses are stored in clear. Without a rowid or a secondary index,
-- counting a request writes exactly one row, which is what the D1 write quota counts. The daily
-- sweep scans the whole table instead, which costs reads only.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
