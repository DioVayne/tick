-- Wachtrij voor uitgaande mail: elke mail gaat hier in en blijft staan tot hij
-- verstuurd is (de cron probeert het opnieuw), zodat er geen mail stilletjes zoekraakt.
-- De rij bevat nooit een e-mailadres of inhoud; het adres wordt bij het versturen
-- opgezocht via user_id / ref.
CREATE TABLE mail_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- 'verify' | 'reset' | 'invite' | 'report'
  user_id TEXT,                  -- account waar de mail over gaat (verify/reset: ontvanger; invite: deler; report: melder)
  ref TEXT,                      -- invite: email_invites.id; report: reports.id; anders NULL
  lang TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_try_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status TEXT               -- '429', '500', 'network' …; nooit een adres
);
CREATE INDEX mail_queue_next ON mail_queue (next_try_at);
