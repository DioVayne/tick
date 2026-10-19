-- Vastpinnen: een vastgepinde hoofdtaak staat bovenaan zijn lijst. Per persoon, net als list en position: de eigenaar
-- in tasks.pinned, een deelnemer in zijn deelrij. Subtaken pinnen niet.
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_shares ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
