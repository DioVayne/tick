-- Openbare Tick: een openstaande uitnodiging toont de eigenaar het e-mailadres dat hij zelf typte. Kwam de uitnodiging
-- via een bekende (keuze op naam, to_user), dan typte hij geen adres en ziet hij de naam: anders verraadt Tick het
-- adres van iemand die hij alleen bij naam kent. Bestaande rijen: zoals tot nu toe (adres).
ALTER TABLE task_shares ADD COLUMN by_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE list_members ADD COLUMN by_email INTEGER NOT NULL DEFAULT 1;
