-- Import ongedaan maken (src/importer.ts) zoekt de taken van een import ook als ze van een ander zijn (in een gedeelde
-- lijst van iemand anders): op import_id alleen, zonder user_id.
CREATE INDEX idx_tasks_import_id ON tasks (import_id) WHERE import_id IS NOT NULL;
