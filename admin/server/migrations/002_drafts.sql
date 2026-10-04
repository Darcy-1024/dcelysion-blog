BEGIN;
CREATE TABLE IF NOT EXISTS dc_admin.drafts (
 id uuid PRIMARY KEY,
 owner_id integer NOT NULL,
 kind text NOT NULL CHECK (kind IN ('posts','dynamic')),
 path text NOT NULL,
 content_id text NOT NULL,
 source_id text,
 base_commit text,
 base_blob text,
 base_hash text,
 base_source text,
 source text NOT NULL CHECK (octet_length(source) <= 524288),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 copied_from uuid,
 snapshot boolean NOT NULL DEFAULT false,
 last_request uuid NOT NULL,
 last_payload text NOT NULL,
 creation_payload text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drafts_new_path_idx ON dc_admin.drafts (kind, lower(regexp_replace(path, '\.(md|mdx)$', ''))) WHERE source_id IS NULL AND copied_from IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drafts_new_slug_idx ON dc_admin.drafts (kind, lower(content_id)) WHERE source_id IS NULL AND copied_from IS NULL;
CREATE INDEX IF NOT EXISTS drafts_owner_updated_idx ON dc_admin.drafts (owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS dc_admin.draft_saves (
 draft_id uuid NOT NULL REFERENCES dc_admin.drafts(id),
 request_id uuid NOT NULL,
 payload text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY (draft_id, request_id)
);
COMMIT;
