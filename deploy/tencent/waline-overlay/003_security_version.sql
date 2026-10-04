-- Apply only alongside the existing password-reset migration, with explicit deployment authorization.
BEGIN;
CREATE OR REPLACE FUNCTION dc_password_auth_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.type IS DISTINCT FROM OLD.type OR NEW."2fa" IS DISTINCT FROM OLD."2fa" THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
