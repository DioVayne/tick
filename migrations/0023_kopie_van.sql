-- Kopie van: wie een geaccepteerde kopie stuurde (users.id), alleen op de hoofdtaak van de ontvanger. De app toont
-- daarmee "Kopie van <naam>". Geen verwijzing naar users: bij het verwijderen van een account zet de app hem op NULL.
ALTER TABLE tasks ADD COLUMN copied_from TEXT;

-- Bestaande kopieën in een groep: de eigenaar van het oudste andere exemplaar in de groep, meestal het origineel.
UPDATE tasks SET copied_from = (
  SELECT o.user_id FROM tasks o
  WHERE o.copy_group = tasks.copy_group AND o.parent_id IS NULL AND o.id <> tasks.id AND o.user_id <> tasks.user_id
  ORDER BY o.created_at, o.id LIMIT 1
)
WHERE source = 'share' AND parent_id IS NULL AND copy_group IS NOT NULL;
