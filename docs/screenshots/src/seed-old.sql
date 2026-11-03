-- Makes the Tickmanager tasks from seed.mjs old, relative to the fixed clock of the screenshots (2026-10-27).
UPDATE tasks SET created_at = '2026-09-02T10:00:00.000Z' WHERE title = 'Fix the bike light';
UPDATE tasks SET created_at = '2026-08-21T19:30:00.000Z' WHERE title = 'Sort out the old photos';
UPDATE tasks SET created_at = '2026-07-14T08:15:00.000Z' WHERE title = 'Learn to bake sourdough';
UPDATE tasks SET created_at = '2026-09-28T12:00:00.000Z' WHERE title = 'Return the library books';
UPDATE tasks SET created_at = '2026-06-30T16:45:00.000Z' WHERE title = 'Clean out the shed';
UPDATE tasks SET created_at = '2026-09-15T09:00:00.000Z' WHERE title = 'Update the team wiki';
UPDATE tasks SET created_at = '2026-09-10T09:00:00.000Z' WHERE title IN ('Renew passport', 'Book train tickets');
-- Every other task was created "today" in the clock of the screenshots, so nothing else counts as old.
UPDATE tasks SET created_at = '2026-10-26T09:00:00.000Z' WHERE created_at > '2026-10-27';
