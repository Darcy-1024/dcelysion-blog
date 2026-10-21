-- Install after 005_content_likes.sql, before enabling the mail worker.
BEGIN;
CREATE TABLE IF NOT EXISTS dc_interaction_mail (
  event_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error varchar(40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dc_interaction_mail_due ON dc_interaction_mail(next_attempt_at)
  WHERE finished_at IS NULL AND attempts < 5;

-- Keep old likes as deduplication tombstones, without sending historical mail.
INSERT INTO dc_interaction_mail(event_key,payload,finished_at)
  SELECT 'like:'||l.user_id||':'||l.path,'{}'::jsonb,now() FROM dc_content_likes l
    JOIN wl_users u ON u.id=l.user_id WHERE u.type <> 'administrator'
  ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION dc_queue_interaction_mail() RETURNS trigger AS $$
DECLARE account wl_users%ROWTYPE; event text; body jsonb;
BEGIN
  SELECT * INTO account FROM wl_users WHERE id=NEW.user_id;
  IF account.type = 'administrator' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'dc_content_likes' THEN
    event := 'like:'||NEW.user_id||':'||NEW.path;
    body := jsonb_build_object('kind','like','path',NEW.path,'nick',account.display_name,
      'mail',account.email);
  ELSE
    IF NEW.status = 'spam' THEN RETURN NEW; END IF;
    event := 'comment:'||NEW.id;
    body := jsonb_build_object('kind','comment','path',NEW.url,'id',NEW.id,
      'nick',COALESCE(account.display_name,NEW.nick),'mail',COALESCE(account.email,NEW.mail),
      'comment',NEW.comment,'status',NEW.status);
  END IF;
  INSERT INTO dc_interaction_mail(event_key,payload) VALUES(event,body) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS dc_content_like_mail ON dc_content_likes;
CREATE TRIGGER dc_content_like_mail AFTER INSERT ON dc_content_likes
  FOR EACH ROW EXECUTE FUNCTION dc_queue_interaction_mail();
DROP TRIGGER IF EXISTS dc_comment_mail ON wl_comment;
CREATE TRIGGER dc_comment_mail AFTER INSERT ON wl_comment
  FOR EACH ROW EXECUTE FUNCTION dc_queue_interaction_mail();
COMMIT;
