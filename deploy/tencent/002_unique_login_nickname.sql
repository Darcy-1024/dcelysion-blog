-- All user states reserve their nickname. A duplicate in an existing database
-- causes this migration to fail without changing any account.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS wl_users_display_name_unique
  ON wl_users (display_name);
COMMIT;
