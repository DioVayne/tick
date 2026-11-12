-- Melding als er in een gekoppelde agenda een nieuwe afspraak verschijnt op het moment van een taak.
-- ok_at: de laatste keer dat een feed goed opgehaald werd. Alleen een afspraak die toen al binnen het venster van 14
-- dagen had moeten staan, telt als nieuw (een herhaling die er aan het eind van het venster bij komt niet).
ALTER TABLE calendar_feeds ADD COLUMN ok_at TEXT;
UPDATE calendar_feeds SET ok_at = fetched_at WHERE status = 'ok';

-- Per persoon, taak en herinneringstijd hooguit één melding. Rijen gaan weg zodra de herinnering voorbij is.
CREATE TABLE calendar_clashes (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id, remind_at)
);
