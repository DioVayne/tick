-- Volgnummer van de laatste wijziging per taak uit de outbox van één browser (header x-tick-op: <apparaat>:<volgnummer>).
-- Komt een ouder verzoek van hetzelfde apparaat later binnen (bijvoorbeeld vertraagd in een tweede tabblad), dan
-- overschrijft het de nieuwere wijziging niet. Rijen ouder dan een dag ruimt de cron op.
CREATE TABLE op_seen (
  user_id TEXT NOT NULL,
  device TEXT NOT NULL,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (user_id, device, task_id)
);
CREATE INDEX op_seen_at ON op_seen (at);
