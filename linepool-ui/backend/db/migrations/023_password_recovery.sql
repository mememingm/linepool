CREATE TABLE password_reset_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_tokens_expiry ON password_reset_tokens(expires_at);
