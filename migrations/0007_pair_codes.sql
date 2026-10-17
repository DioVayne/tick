-- Eenmalige koppelcodes: de PWA vraagt er een aan, de Android-app wisselt hem in voor een full-sleutel.
CREATE TABLE pair_codes (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT);
