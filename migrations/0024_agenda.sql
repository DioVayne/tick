-- Gekoppelde agenda's (geheime iCal-adressen). De URL staat alleen versleuteld in url_enc (AES-GCM); url_hash is
-- om dubbel koppelen te herkennen. Per afspraak alleen titel, begin, einde en hele dag, voor 14 dagen vooruit.
CREATE TABLE calendar_feeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  url_enc TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  host TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fetched_at TEXT,
  status TEXT,
  error TEXT,
  events INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, url_hash)
);
CREATE INDEX calendar_feeds_fetched ON calendar_feeds (fetched_at);

CREATE TABLE calendar_events (
  feed_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX calendar_events_user ON calendar_events (user_id, start_at);
CREATE INDEX calendar_events_feed ON calendar_events (feed_id);
