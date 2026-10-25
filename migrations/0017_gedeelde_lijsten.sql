-- Gedeelde lijsten: een lijst met een eigen id, en per persoon een lidmaatschap met de eigen naam van de lijst.
-- Elke hoofdtaak in de lijst is van de eigenaar (tasks.user_id) en draagt tasks.shared_list; elk ander geaccepteerd
-- lid heeft een gewone deelrij (task_shares, modus shared). mode 'copy' is voor later; de API weigert hem nog.
CREATE TABLE shared_lists (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  mode       TEXT NOT NULL DEFAULT 'shared' CHECK (mode IN ('shared','copy')),
  created_at TEXT NOT NULL
);
CREATE TABLE list_members (
  list_id      TEXT NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL CHECK (role IN ('owner','member')),
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  name         TEXT NOT NULL,
  notify_done  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  PRIMARY KEY (list_id, user_id)
);
CREATE UNIQUE INDEX idx_members_name ON list_members (user_id, name) WHERE status = 'accepted';
CREATE INDEX idx_members_user ON list_members (user_id, status);

-- Wie een taak afvinkte (done_by) en op wiens naam hij staat (claimed_by, alleen in een gedeelde lijst).
ALTER TABLE tasks ADD COLUMN shared_list TEXT;
ALTER TABLE tasks ADD COLUMN done_by TEXT;
ALTER TABLE tasks ADD COLUMN claimed_by TEXT;
CREATE INDEX idx_tasks_shared_list ON tasks (shared_list) WHERE shared_list IS NOT NULL;

-- Melding bij afvinken per taak, voor wie hem op lijstniveau uit heeft staan.
CREATE TABLE task_watch (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);
