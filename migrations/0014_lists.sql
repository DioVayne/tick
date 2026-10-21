-- Lijsten die je zelf aanmaakt, per persoon. Verder bestaat een lijst als `list` van taken (en deelrijen); deze rij
-- houdt een nieuwe, nog lege lijst vast. Heeft hij taken, dan is hij dubbel bekend; GET /api/lists toont hem één keer.
CREATE TABLE lists (
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, name)
);
