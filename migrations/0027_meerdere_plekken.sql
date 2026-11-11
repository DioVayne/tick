-- Meerdere plekken per taak: de eerste plek blijft in loc_name/loc_lat/loc_lng/loc_radius/loc_trigger staan (zo
-- blijven oudere apps werken met die ene plek), de andere als JSON-lijst [{name, lat, lng, radius}] in loc_more.
-- NULL = alleen de eerste plek. De trigger en loc_notified gelden voor de hele taak: één melding, bij de eerste plek.
ALTER TABLE tasks ADD COLUMN loc_more TEXT;
