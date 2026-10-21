-- Een vaste id per lijst, per persoon, voor bladwijzers (#/list/<id>). Een lijst blijft een naam; deze tabel koppelt
-- die naam aan een id dat hernoemen overleeft. Een naam zonder rij krijgt zijn id bij de volgende GET /api/lists.
CREATE TABLE list_ids (
  user_id TEXT NOT NULL REFERENCES users(id),
  name    TEXT NOT NULL,
  id      TEXT NOT NULL UNIQUE,
  PRIMARY KEY (user_id, name)
);

INSERT OR IGNORE INTO list_ids (user_id, name, id)
  SELECT user_id, name, lower(hex(randomblob(6))) FROM (
    SELECT user_id, list AS name FROM tasks
    UNION SELECT to_user, list FROM task_shares WHERE status = 'accepted' AND list IS NOT NULL
    UNION SELECT user_id, name FROM lists
  );
