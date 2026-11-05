-- Zelf aanmelden (OPEN_SIGNUP): bevestigde e-mailadressen, bevestigingslinks en uitnodigingen aan e-mailadressen.

-- NULL = niet bevestigd. Bestaande accounts (gemaakt door of via de beheerder) gelden als bevestigd.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = created_at;
-- Alleen een zelf aangemaakt account dat nooit bevestigd werd, wordt na deze tijd opgeruimd (NULL = nooit opruimen).
ALTER TABLE users ADD COLUMN verify_deadline TEXT;

-- account_links krijgt de soort 'verify'; een CHECK kan in SQLite alleen via een nieuwe tabel veranderen.
PRAGMA defer_foreign_keys = true;
CREATE TABLE account_links_new (
  id         TEXT PRIMARY KEY,
  hash       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite','reset','verify')),
  user_id    TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
INSERT INTO account_links_new (id, hash, kind, user_id, created_by, expires_at, used_at)
  SELECT id, hash, kind, user_id, created_by, expires_at, used_at FROM account_links;
DROP TABLE account_links;
ALTER TABLE account_links_new RENAME TO account_links;

-- Een uitnodiging (taak of lijst) aan een adres zonder bevestigd account; wordt een gewone uitnodiging zodra een
-- account met dit adres bevestigd is. 30 dagen geldig.
CREATE TABLE email_invites (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  from_user  TEXT NOT NULL REFERENCES users(id),
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  list_id    TEXT REFERENCES shared_lists(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK (mode IN ('shared','copy')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((task_id IS NULL) <> (list_id IS NULL)),
  UNIQUE (email, task_id),
  UNIQUE (email, list_id)
);
CREATE INDEX email_invites_email ON email_invites (email);
CREATE INDEX email_invites_from ON email_invites (from_user);
CREATE INDEX email_invites_task ON email_invites (task_id);
CREATE INDEX email_invites_list ON email_invites (list_id);

-- Voor "hooguit één uitnodigingsmail per adres per dag": SHA-256 van het adres, nooit het adres zelf.
ALTER TABLE mail_log ADD COLUMN recipient_hash TEXT;
CREATE INDEX mail_log_recipient ON mail_log (kind, recipient_hash, sent_at);
