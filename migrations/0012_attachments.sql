-- Bijlagen: de bytes staan in R2 (binding FILES) onder r2_key, hier alleen wat erbij hoort. Geen foreign key met
-- ON DELETE CASCADE: het object in R2 moet ook weg, en dat kan niet in een D1-batch. De cron ruimt rijen op waarvan de
-- taak weg is (en daarna het object, als geen andere rij het nog gebruikt). Een geaccepteerde kopie deelt het object.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_task ON attachments (task_id);
CREATE INDEX idx_attachments_key ON attachments (r2_key);
