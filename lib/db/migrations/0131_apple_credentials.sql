CREATE TABLE IF NOT EXISTS apple_credentials (
  subject text PRIMARY KEY,
  student_id integer REFERENCES students(id) ON DELETE RESTRICT,
  ciphertext text NOT NULL, iv text NOT NULL, auth_tag text NOT NULL, key_version text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoke_pending')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz, retry_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apple_credentials_retry_idx ON apple_credentials(state,retry_at);
CREATE TABLE IF NOT EXISTS apple_auth_challenges (
  token_hash text PRIMARY KEY, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
