-- Run in the Waline PostgreSQL database before enabling the avatar upload UI.
CREATE TABLE IF NOT EXISTS dc_user_avatars (
  user_id integer PRIMARY KEY REFERENCES wl_users(id) ON DELETE CASCADE,
  digest char(64) NOT NULL,
  image bytea NOT NULL CHECK (octet_length(image) <= 393216),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dc_user_avatars_digest ON dc_user_avatars(digest);
