BEGIN;
CREATE TABLE IF NOT EXISTS dc_admin.jobs (
 id uuid PRIMARY KEY,
 owner_id integer NOT NULL,
 request_hash text NOT NULL,
 draft_id uuid NOT NULL REFERENCES dc_admin.drafts(id),
 revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 target jsonb NOT NULL,
 kind text NOT NULL CHECK (kind IN ('preview','publish')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','failed','succeeded')),
 stage text NOT NULL DEFAULT 'snapshot',
 effects jsonb NOT NULL DEFAULT '{}',
 error text,
 attempt integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_owner_created_idx ON dc_admin.jobs(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS dc_admin.job_logs (
 id bigserial PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES dc_admin.jobs(id),
 stage text NOT NULL,
 message text NOT NULL CHECK (length(message) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
