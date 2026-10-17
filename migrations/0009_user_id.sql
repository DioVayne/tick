-- Elke persoonlijke rij hoort bij een account; bestaande rijen bij de beheerder. SQLite staat bij ADD COLUMN geen
-- REFERENCES met een standaardwaarde toe; een account verwijderen ruimt de Worker daarom zelf op.
ALTER TABLE tasks ADD COLUMN user_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE push_subscriptions ADD COLUMN user_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE api_keys ADD COLUMN user_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE pair_codes ADD COLUMN user_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
CREATE INDEX idx_tasks_user ON tasks (user_id, done, position);
CREATE INDEX idx_push_user ON push_subscriptions (user_id);
CREATE INDEX idx_keys_user ON api_keys (user_id);

-- Plekken: de naam is uniek per account. Een constraint aanpassen kan niet in SQLite, dus opnieuw opbouwen.
CREATE TABLE places_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES users(id),
  name       TEXT NOT NULL COLLATE NOCASE,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
INSERT INTO places_new (id, user_id, name, lat, lng, radius, created_at, updated_at)
SELECT id, '00000000-0000-4000-8000-000000000001', name, lat, lng, radius, created_at, updated_at FROM places;
DROP TABLE places;
ALTER TABLE places_new RENAME TO places;
