-- Demo users for the screenshots: Robin (the admin), Sanne and Alex, with API keys tick_demorobin…, tick_demosanne… and
-- tick_demoalex… (see seed.mjs). LOCAL ONLY: run it with --local (reset.sh does). On a real Tick these known keys
-- would let anyone in.
UPDATE users SET name='Robin', email='robin@example.com' WHERE role='admin';
INSERT INTO users (id,name,email,role,created_at,last_seen) VALUES ('00000000-0000-4000-8000-0000000000a1','Sanne','sanne@example.com','member','2026-10-01T10:00:00Z','2026-10-27T08:00:00Z');
INSERT INTO users (id,name,email,role,created_at,last_seen) VALUES ('00000000-0000-4000-8000-0000000000a2','Alex','alex@example.com','member','2026-10-01T10:00:00Z','2026-10-26T20:00:00Z');
INSERT INTO api_keys (id,name,kind,hash,hint,created_at,user_id) VALUES ('k-sanne','demo','full','5d4e14f12eeac3266f31516bd623d94fa1394fb634a641ab290204b0dd3fabd6','0000','2026-10-01T10:00:00Z','00000000-0000-4000-8000-0000000000a1');
INSERT INTO api_keys (id,name,kind,hash,hint,created_at,user_id) VALUES ('k-alex','demo','full','0fb539efbd0e4ceed47ad00fdf7cd46aecb5c0be0c3aeec5ea488d0bae5b58cc','0000','2026-10-01T10:00:00Z','00000000-0000-4000-8000-0000000000a2');
INSERT INTO api_keys (id,name,kind,hash,hint,created_at,user_id) VALUES ('k-robin','demo','full','7abdde4bf951cb58cc4f6689660a7fd7b0d15ab09b19b76e83f377852c801569','0000','2026-10-01T10:00:00Z','00000000-0000-4000-8000-000000000001');
