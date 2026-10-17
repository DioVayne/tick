-- Instellingen als sleutel/waarde. session_version zit in elke sessiecookie;
-- ophogen maakt alle bestaande sessies ongeldig.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('session_version', '1');
