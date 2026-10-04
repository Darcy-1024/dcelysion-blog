BEGIN;
CREATE SCHEMA IF NOT EXISTS dc_admin;
CREATE TABLE IF NOT EXISTS dc_admin.sessions (
  token_digest bytea PRIMARY KEY CHECK (octet_length(token_digest) = 32),
  user_id integer NOT NULL,
  auth_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON dc_admin.sessions (expires_at);
CREATE TABLE IF NOT EXISTS dc_admin.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id integer,
  action text NOT NULL,
  result text NOT NULL
);
COMMIT;
