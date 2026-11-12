-- Testfeature "Tijd voor een taak?" (freetime) is verwijderd: zijn instellingen per persoon mogen weg.
DELETE FROM user_settings WHERE key LIKE 'freetime\_%' ESCAPE '\';
