-- Prullenbak: verwijderen zet deleted_at; na 30 dagen wist de cron de taak echt.
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_tasks_deleted ON tasks (deleted_at) WHERE deleted_at IS NOT NULL;

-- Taken delen: één rij per uitnodiging of deelname, altijd op een hoofdtaak. list en position zijn die van de
-- ontvanger (de eigenaar houdt tasks.list en tasks.position). Een kopie-rij verdwijnt bij accepteren.
CREATE TABLE task_shares (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_user    TEXT NOT NULL REFERENCES users(id),
  to_user      TEXT NOT NULL REFERENCES users(id),
  mode         TEXT NOT NULL CHECK (mode IN ('shared','copy')),
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  list         TEXT,
  position     REAL,
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE (task_id, to_user)
);
CREATE INDEX idx_shares_to ON task_shares (to_user, status);

-- Bezorging van een herinnering per persoon: voor welke remind_at iemand al een melding kreeg (of opgegeven is).
CREATE TABLE reminder_sent (
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  remind_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
