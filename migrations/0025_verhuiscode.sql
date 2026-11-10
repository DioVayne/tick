-- Verhuiscodes: met zo'n code haalt een andere Tick een uur lang je gegevens op (src/move.ts). Alleen de hash van
-- het geheim staat hier; een nieuwe code van dezelfde persoon wist de vorige.
CREATE TABLE move_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  hash       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_move_codes_user ON move_codes (user_id);
