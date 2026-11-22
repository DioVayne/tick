-- Import ongedaan maken (src/importer.ts): elke taak die een import (TickTick, Todoist) toevoegde, krijgt de id van die
-- import. "Laatste import ongedaan maken" zet precies die taken in de prullenbak. NULL = niet uit een import (of van vóór dit).
ALTER TABLE tasks ADD COLUMN import_id TEXT;
CREATE INDEX idx_tasks_import ON tasks (user_id, import_id) WHERE import_id IS NOT NULL;
