-- Verstuurde mails (via Resend), voor de grenzen per account en per dag. kind: 'reset' (herstellink), later bijv.
-- 'verify'; 'cap_notice' legt vast dat de beheerder vandaag al gemeld is dat de daggrens bereikt is.
CREATE TABLE mail_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  sent_at TEXT NOT NULL
);
CREATE INDEX mail_log_kind_sent ON mail_log (kind, sent_at);
CREATE INDEX mail_log_user_sent ON mail_log (user_id, sent_at);
