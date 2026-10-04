BEGIN;
-- Existing JSON records and fixed job plans stay untouched; absent purpose is legacy.
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='media_purpose_valid' AND conrelid='dc_admin.media'::regclass) THEN
ALTER TABLE dc_admin.media ADD CONSTRAINT media_purpose_valid CHECK (
 NOT(document ? 'purpose') OR COALESCE(document->>'purpose' IN ('article','gallery','wallpaper','music'),false)
);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='media_destination_snapshot' AND conrelid='dc_admin.media'::regclass) THEN
ALTER TABLE dc_admin.media ADD CONSTRAINT media_destination_snapshot CHECK (
 NOT(document ? 'purpose') OR COALESCE((
 document->>'version'='1' AND document->'destination'->>'purpose'=document->>'purpose'
 AND document->'destination'->>'version'='1'
 AND document->'destination'->>'bucket' IS NOT NULL
 AND document->'destination'->>'publicBase' IS NOT NULL
 ),false)
);
END IF;
END $$;
COMMIT;
