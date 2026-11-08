-- Melden en blokkeren (openbare Tick): blokkades tussen accounts, meldingen voor de beheerder, geschorste accounts,
-- en wie een taak in een gedeelde lijst zette.

-- user_id blokkeert blocked_id. Weg met het verwijderen van een van beide accounts (deleteUserStmts).
CREATE TABLE blocks (
  user_id    TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

-- Een melding. Geen foreign keys op taak, lijst en bijlage: de melding blijft staan als de inhoud weg is (title en
-- attachment_name bewaren wat het was).
CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  reporter_id     TEXT NOT NULL,
  reported_id     TEXT NOT NULL,
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
CREATE INDEX reports_status ON reports (status, created_at);
CREATE INDEX reports_reporter ON reports (reporter_id, created_at);
CREATE INDEX reports_reported ON reports (reported_id);

-- NULL = niet geschorst.
ALTER TABLE users ADD COLUMN suspended_at TEXT;

-- Wie een hoofdtaak in een gedeelde lijst zette (de taak staat op naam van de eigenaar); NULL = onbekend (ouder).
ALTER TABLE tasks ADD COLUMN added_by TEXT;
