-- Sleutels die in de app worden gemaakt. Alleen de SHA-256 van de sleutel staat hier; hint = laatste 4 tekens.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('full','inbox')),
  hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
);
-- Status die een Android-telefoon zelf meldt, per sleutel (key_id 'env-api' = de oude API_TOKEN).
CREATE TABLE devices (
  key_id TEXT PRIMARY KEY, name TEXT NOT NULL, notifications INTEGER NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('always','foreground','off')), app_version TEXT, seen_at TEXT NOT NULL
);
-- Taal per push-abonnement: de server maakt meldingen 's nachts en kent de browser dan niet.
ALTER TABLE push_subscriptions ADD COLUMN locale TEXT;
