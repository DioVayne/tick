-- De knop in de uitnodigingsmail: een unieke link (/join/<code>). Alleen de SHA-256 van de code staat hier.
ALTER TABLE email_invites ADD COLUMN join_hash TEXT;
CREATE INDEX email_invites_join ON email_invites (join_hash);
