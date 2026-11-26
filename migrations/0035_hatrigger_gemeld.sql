-- Home Assistant-triggers (src/hatrigger.ts): "gemeld" per taak in een eigen rij, in plaats van in de JSON van
-- user_settings 'hatrigger:tasks'. Zo claimt POST /fire een taak in één stap (INSERT … ON CONFLICT … WHERE … RETURNING):
-- twee triggers tegelijk geven nooit twee meldingen en overschrijven elkaars stand niet.
-- Een rij = de taak is gemeld (fired), bij herhalen voor de keer `rep`, door trigger `fired_by`; `user_id` is wiens
-- keuze het was (de eigenaar van de rij in 'hatrigger:tasks'). Geen rij = klaar om te melden.
CREATE TABLE hatrigger_fired (
  task_id  TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL,
  fired    TEXT NOT NULL,
  rep      TEXT,
  fired_by TEXT
);
CREATE INDEX idx_hatrigger_fired_user ON hatrigger_fired (user_id);

-- De stand van nu overnemen (de JSON houdt daarna alleen de gekozen triggers bij).
INSERT OR IGNORE INTO hatrigger_fired (task_id, user_id, fired, rep, fired_by)
SELECT j.key, s.user_id, json_extract(j.value, '$.fired'), json_extract(j.value, '$.rep'), json_extract(j.value, '$.by')
FROM (SELECT user_id, value FROM user_settings WHERE key = 'hatrigger:tasks' AND json_valid(value)) s, json_each(s.value) j
WHERE json_extract(j.value, '$.fired') IS NOT NULL AND j.key IN (SELECT id FROM tasks);
