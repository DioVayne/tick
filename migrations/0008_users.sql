-- Meerdere accounts. De bestaande installatie (en een verse) wordt één beheerder met een vaste id.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE COLLATE NOCASE,
  password_hash   TEXT,
  role            TEXT NOT NULL CHECK (role IN ('admin','member')),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  last_seen       TEXT
);
INSERT INTO users (id, name, email, password_hash, role, session_version, created_at)
SELECT '00000000-0000-4000-8000-000000000001', 'Tick', NULL,
  NULLIF((SELECT value FROM settings WHERE key = 'password_hash'), ''), 'admin',
  COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'session_version'), 1),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Instellingen per persoon; settings houdt alleen wat voor de hele installatie geldt.
CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO user_settings (user_id, key, value)
SELECT '00000000-0000-4000-8000-000000000001', key, value FROM settings
WHERE key IN ('timezone', 'reminder_time', 'week_start', 'fallback_webhook');

-- Uitnodigings- en resetlinks; alleen de SHA-256 van de code staat hier.
CREATE TABLE account_links (
  id         TEXT PRIMARY KEY,
  hash       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  user_id    TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
