BEGIN;
ALTER TABLE dc_admin.sessions ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON dc_admin.sessions(public_id);
ALTER TABLE dc_admin.audit ADD COLUMN IF NOT EXISTS object_id text;
ALTER TABLE dc_admin.audit ADD COLUMN IF NOT EXISTS request_id uuid;
COMMIT;
