-- Wanneer iemand de taak in de Tickmanager voor het laatst bekeek (laten staan, bovenaan, ingepland). Eén waarde per
-- taak: in een gedeelde lijst geldt bekeken voor iedereen.
ALTER TABLE tasks ADD COLUMN reviewed_at TEXT;
-- Lijsten die iemand niet in zijn opruimronde wil, per persoon. list_id is de vaste id uit list_ids (overleeft hernoemen).
CREATE TABLE review_skip_lists (
  user_id TEXT NOT NULL REFERENCES users(id),
  list_id TEXT NOT NULL,
  PRIMARY KEY (user_id, list_id)
);
