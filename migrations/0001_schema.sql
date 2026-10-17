-- Basisschema. IF NOT EXISTS: in productie bestaan deze tabellen al van voor de migraties.
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  list        TEXT NOT NULL DEFAULT 'Inbox',
  parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  position    REAL NOT NULL,
  remind_at   TEXT,              -- ISO UTC
  notified    INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  source      TEXT NOT NULL DEFAULT 'app',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (remind_at) WHERE done = 0 AND notified = 0 AND remind_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
