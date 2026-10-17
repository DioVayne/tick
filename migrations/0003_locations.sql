-- Locatie-reminders: een optionele locatie per taak (loc_notified: al gemeld, net als notified)
-- en opgeslagen favoriete plekken.
ALTER TABLE tasks ADD COLUMN loc_name TEXT;
ALTER TABLE tasks ADD COLUMN loc_lat REAL;
ALTER TABLE tasks ADD COLUMN loc_lng REAL;
ALTER TABLE tasks ADD COLUMN loc_radius INTEGER;
ALTER TABLE tasks ADD COLUMN loc_trigger TEXT;
ALTER TABLE tasks ADD COLUMN loc_notified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS places (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
