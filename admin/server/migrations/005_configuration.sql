BEGIN;
ALTER TABLE dc_admin.drafts DROP CONSTRAINT IF EXISTS drafts_kind_check;
ALTER TABLE dc_admin.drafts ADD CONSTRAINT drafts_kind_check CHECK (kind IN ('posts','dynamic','music','gallery','settings'));
ALTER TABLE dc_admin.drafts ADD COLUMN IF NOT EXISTS base_dependencies jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Existing transaction-bound reference triggers also protect normalized JSON values.
CREATE OR REPLACE FUNCTION dc_admin.record_configuration_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE album jsonb; item jsonb; body jsonb; ref text; field_name text; media_row record;
BEGIN
 IF NEW.kind NOT IN ('music','gallery','settings') THEN RETURN NEW; END IF;
 DELETE FROM dc_admin.media_refs WHERE kind='configuration_' || NEW.kind AND ref_id LIKE NEW.id::text || ':%';
 body:=NEW.source::jsonb;
 IF NEW.kind='music' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(body->'tracks') LOOP
   FOREACH field_name IN ARRAY ARRAY['url','cover','lrc'] LOOP
    ref:=NEW.id::text || ':' || (item->>'id') || ':' || field_name;
    FOR media_row IN SELECT id,document FROM dc_admin.media WHERE owner_id=NEW.owner_id LOOP
     IF position('/__managed-media/' || media_row.id::text || '/' IN COALESCE(item->>field_name,''))>0 OR position(media_row.document->'original'->>'key' IN COALESCE(item->>field_name,''))>0 THEN
      INSERT INTO dc_admin.media_refs VALUES(media_row.id,'configuration_music',ref) ON CONFLICT DO NOTHING;
     END IF;
    END LOOP;
   END LOOP;
  END LOOP;
 ELSIF NEW.kind='gallery' THEN
  FOR album IN SELECT value FROM jsonb_array_elements(body->'albums') LOOP
   FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(album->'photos','[]'::jsonb)) UNION ALL SELECT jsonb_build_object('id','cover','original',album->>'cover') LOOP
    FOREACH field_name IN ARRAY ARRAY['original','preview'] LOOP
     ref:=NEW.id::text || ':' || (album->>'id') || ':' || (item->>'id') || ':' || field_name;
     FOR media_row IN SELECT id,document FROM dc_admin.media WHERE owner_id=NEW.owner_id LOOP
      IF position('/__managed-media/' || media_row.id::text || '/' IN COALESCE(item->>field_name,''))>0 OR position(media_row.document->'original'->>'key' IN COALESCE(item->>field_name,''))>0 OR position(media_row.document->'preview'->>'key' IN COALESCE(item->>field_name,''))>0 THEN
       INSERT INTO dc_admin.media_refs VALUES(media_row.id,'configuration_gallery',ref) ON CONFLICT DO NOTHING;
      END IF;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_configuration_refs ON dc_admin.drafts;
CREATE TRIGGER media_configuration_refs AFTER INSERT OR UPDATE OF source ON dc_admin.drafts FOR EACH ROW EXECUTE FUNCTION dc_admin.record_configuration_fields();
COMMIT;
