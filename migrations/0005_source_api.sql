-- Taken uit de inbox-API heetten eerst 'n8n'; nu algemeen 'api'.
UPDATE tasks SET source = 'api' WHERE source = 'n8n';
