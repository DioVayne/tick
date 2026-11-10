-- Een melding blijft bestaan als de melder of de gemelde zijn account verwijdert, maar zonder die persoon: zijn id
-- wordt NULL (en deleteUserStmts wist ook zijn naam-, titel- en tekstsporen in de rij). Daarvoor mogen reporter_id en
-- reported_id NULL zijn; een NOT NULL kan in SQLite alleen via een nieuwe tabel weg. Verder dezelfde tabel als 0022.
CREATE TABLE reports_new (
  id              TEXT PRIMARY KEY,
  reporter_id     TEXT,
  reported_id     TEXT,
  reason          TEXT NOT NULL CHECK (reason IN ('spam','inappropriate','illegal','other')),
  note            TEXT NOT NULL DEFAULT '',
  task_id         TEXT,
  list_id         TEXT,
  attachment_id   TEXT,
  title           TEXT NOT NULL,
  attachment_name TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','removed','suspended')),
  created_at      TEXT NOT NULL,
  handled_at      TEXT
);
INSERT INTO reports_new (id, reporter_id, reported_id, reason, note, task_id, list_id, attachment_id, title, attachment_name, status, created_at, handled_at)
  SELECT id, reporter_id, reported_id, reason, note, task_id, list_id, attachment_id, title, attachment_name, status, created_at, handled_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX reports_status ON reports (status, created_at);
CREATE INDEX reports_reporter ON reports (reporter_id, created_at);
CREATE INDEX reports_reported ON reports (reported_id);
