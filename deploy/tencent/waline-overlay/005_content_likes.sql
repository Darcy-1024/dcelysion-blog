-- Account-linked content likes; existing anonymous wl_counter.reaction0 is untouched.
CREATE TABLE IF NOT EXISTS dc_content_likes (
  path varchar(1024) NOT NULL CHECK (length(path) > 0 AND left(path, 1) = '/'),
  user_id integer NOT NULL REFERENCES wl_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (path, user_id)
);
CREATE INDEX IF NOT EXISTS dc_content_likes_recent
  ON dc_content_likes(path, created_at DESC, user_id DESC);
