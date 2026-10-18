-- Kopiegroep: kopieën van één taak blijven aan elkaar gekoppeld. copy_group staat alleen op hoofdtaken: het origineel
-- en elke geaccepteerde kopie krijgen dezelfde waarde. Bestaande kopieën hebben geen groep (NULL) en blijven los.
ALTER TABLE tasks ADD COLUMN copy_group TEXT;
CREATE INDEX idx_tasks_copy_group ON tasks (copy_group) WHERE copy_group IS NOT NULL;
