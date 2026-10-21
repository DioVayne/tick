-- Locatiemelding per persoon: de eigenaar in tasks.loc_notified, een deelnemer in zijn deelrij (net als pinned).
-- Zo maakt de eerste die op de plek komt de melding niet op voor de anderen. Bestaande deelnemers beginnen ongemeld.
ALTER TABLE task_shares ADD COLUMN loc_notified INTEGER NOT NULL DEFAULT 0;
