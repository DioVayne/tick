-- Dagelijkse ronde van verlopen taken (src/overdue.ts): per persoon het volgende moment dat hij aan de beurt is, als
-- user_settings-rij 'overdue_next' (UTC-ISO; '' = meteen kijken, '9999' = nooit, bij uit). De ronde (elke minuut) leest
-- via de index alleen wie aan de beurt is, in plaats van alle mensen met hun instellingen.
CREATE INDEX idx_user_settings_key_value ON user_settings (key, value);

-- Iedereen die er al is: bij de eerste ronde meteen kijken (die rekent het moment uit).
INSERT OR IGNORE INTO user_settings (user_id, key, value) SELECT id, 'overdue_next', '' FROM users;

-- Een nieuw account ook.
CREATE TRIGGER overdue_next_new_user AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (NEW.id, 'overdue_next', '');
END;
-- En weer weg met het account: deze rij mag het wissen van een gebruiker nooit tegenhouden (verwijzing naar users).
CREATE TRIGGER overdue_next_user_gone BEFORE DELETE ON users
BEGIN
  DELETE FROM user_settings WHERE user_id = OLD.id AND key = 'overdue_next';
END;

-- Een andere tijd of tijdzone (hoe dan ook gezet: instellingen, verhuizen, beheer): het moment opnieuw uitrekenen.
CREATE TRIGGER overdue_next_setting_insert AFTER INSERT ON user_settings WHEN NEW.key IN ('overdue_time', 'timezone')
BEGIN
  INSERT INTO user_settings (user_id, key, value) VALUES (NEW.user_id, 'overdue_next', '')
  ON CONFLICT (user_id, key) DO UPDATE SET value = '';
END;
CREATE TRIGGER overdue_next_setting_update AFTER UPDATE ON user_settings WHEN NEW.key IN ('overdue_time', 'timezone')
BEGIN
  INSERT INTO user_settings (user_id, key, value) VALUES (NEW.user_id, 'overdue_next', '')
  ON CONFLICT (user_id, key) DO UPDATE SET value = '';
END;
-- Terug naar de standaard (rij weg): alleen bijwerken, niet invoegen. Bij het verwijderen van een account gaan alle rijen
-- in één DELETE weg; een nieuwe rij zou het wissen van de gebruiker daarna blokkeren (verwijzing).
CREATE TRIGGER overdue_next_setting_delete AFTER DELETE ON user_settings WHEN OLD.key IN ('overdue_time', 'timezone')
BEGIN
  UPDATE user_settings SET value = '' WHERE user_id = OLD.user_id AND key = 'overdue_next';
END;
