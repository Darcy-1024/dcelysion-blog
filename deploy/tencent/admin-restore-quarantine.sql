-- Run ONLY on the newly restored, isolated database before starting any consumer.
BEGIN;
UPDATE dc_admin.sessions SET revoked_at=now() WHERE revoked_at IS NULL;
UPDATE dc_admin.jobs SET status='failed',stage='restore_quarantine',
 error='RESTORE_REQUIRES_REVIEW',updated_at=now() WHERE status IN ('queued','running');
UPDATE dc_admin.media SET document=document || jsonb_build_object(
 'local',CASE WHEN document->>'local'='uploading' THEN 'failed' ELSE document->>'local' END,
 'privateCopy','failed','stage','restore_quarantine','error','RESTORE_REQUIRES_REVIEW'),updated_at=now()
 WHERE document->>'local'='uploading' OR document->>'privateCopy' IN ('queued','running');
COMMIT;
