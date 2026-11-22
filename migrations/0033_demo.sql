-- Demo zonder account (src/demo.ts): een tijdelijk account dat na `demo_until` verdwijnt. NULL = een gewoon account.
ALTER TABLE users ADD COLUMN demo_until TEXT;
-- Het meespeel-account ("Sam") van een demo: wie de gedeelde voorbeeldlijst deelt. Verdwijnt samen met die demo.
ALTER TABLE users ADD COLUMN demo_of TEXT;
CREATE INDEX idx_users_demo ON users (demo_until) WHERE demo_until IS NOT NULL;
