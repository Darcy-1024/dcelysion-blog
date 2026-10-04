BEGIN;
CREATE TABLE IF NOT EXISTS dc_admin.media (
 id uuid PRIMARY KEY,
 owner_id integer NOT NULL,
 upload_hash text,
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dc_admin.media_refs (
 media_id uuid NOT NULL REFERENCES dc_admin.media(id),
 kind text NOT NULL,
 ref_id text NOT NULL,
 PRIMARY KEY(media_id,kind,ref_id)
);
ALTER TABLE dc_admin.jobs ADD COLUMN IF NOT EXISTS media_plan jsonb;
CREATE OR REPLACE FUNCTION dc_admin.record_draft_media() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body text; reference text;
BEGIN
 body:=NEW.result->>'source'; reference:=NEW.draft_id::text || ':' || NEW.request_id::text;
 INSERT INTO dc_admin.media_refs(media_id,kind,ref_id)
 SELECT id,'draft_revision',reference FROM dc_admin.media
 WHERE owner_id=(NEW.result->>'owner_id')::integer
 AND (position('/__managed-media/' || id::text || '/' IN body)>0
 OR (document->'original'->>'key'<>'' AND position(document->'original'->>'key' IN body)>0)
 OR (document ? 'preview' AND position(document->'preview'->>'key' IN body)>0))
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- Separate functions avoid referring to fields absent from a trigger's row type.
CREATE OR REPLACE FUNCTION dc_admin.record_current_media() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM dc_admin.media_refs WHERE kind='draft' AND ref_id=NEW.id::text;
 INSERT INTO dc_admin.media_refs SELECT id,'draft',NEW.id::text FROM dc_admin.media
 WHERE owner_id=NEW.owner_id AND (position('/__managed-media/' || id::text || '/' IN NEW.source)>0
 OR (document->'original'->>'key'<>'' AND position(document->'original'->>'key' IN NEW.source)>0)
 OR (document ? 'preview' AND position(document->'preview'->>'key' IN NEW.source)>0)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_draft_refs ON dc_admin.drafts;
CREATE TRIGGER media_draft_refs AFTER INSERT OR UPDATE OF source ON dc_admin.drafts FOR EACH ROW EXECUTE FUNCTION dc_admin.record_current_media();
DROP TRIGGER IF EXISTS media_revision_refs ON dc_admin.draft_saves;
CREATE TRIGGER media_revision_refs AFTER INSERT ON dc_admin.draft_saves FOR EACH ROW EXECUTE FUNCTION dc_admin.record_draft_media();
CREATE OR REPLACE FUNCTION dc_admin.record_job_media() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO dc_admin.media_refs SELECT (dependency->>'id')::uuid,'job',NEW.id::text
 FROM jsonb_array_elements(COALESCE(NEW.media_plan->'dependencies','[]'::jsonb)) dependency ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_job_refs ON dc_admin.jobs;
CREATE TRIGGER media_job_refs AFTER INSERT ON dc_admin.jobs FOR EACH ROW EXECUTE FUNCTION dc_admin.record_job_media();
COMMIT;
