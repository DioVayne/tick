-- Wat per persoon is, staat sinds 0008 in users en user_settings; deze rijen in settings gelden niet meer.
DELETE FROM settings WHERE key IN ('password_hash', 'session_version', 'timezone', 'reminder_time', 'week_start', 'fallback_webhook');
