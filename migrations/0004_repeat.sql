-- Herhalende reminders: het ritme per taak (RRULE-subset, Amsterdamse tijd).
-- repeat_start: eerste reminder (bepaalt tijd en reeks), repeat_at: de huidige keer,
-- repeat_prev: JSON om een afvinken ongedaan te maken.
ALTER TABLE tasks ADD COLUMN repeat_rule TEXT;
ALTER TABLE tasks ADD COLUMN repeat_start TEXT;
ALTER TABLE tasks ADD COLUMN repeat_at TEXT;
ALTER TABLE tasks ADD COLUMN repeat_prev TEXT;
