import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0020 (zelf aanmelden)', () => {
  it('bestaande accounts gelden als bevestigd en bestaande links blijven', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0020'));
    await db.prepare("INSERT INTO users (id, name, email, role, created_at) VALUES ('m1', 'Lid', 'lid@ex.test', 'member', ?)").bind(NOW).run();
    await db.prepare("INSERT INTO account_links (id, hash, kind, user_id, created_by, expires_at) VALUES ('l1', 'h1', 'invite', NULL, ?, ?)").bind(ADMIN, NOW).run();
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const u = await db.prepare("SELECT email_verified_at FROM users WHERE id = 'm1'").first<{ email_verified_at: string | null }>();
    expect(u!.email_verified_at).toBe(NOW);
    expect(await db.prepare("SELECT 1 AS x FROM account_links WHERE id = 'l1'").first()).toBeTruthy();
    await db.prepare("INSERT INTO account_links (id, hash, kind, user_id, created_by, expires_at) VALUES ('l2', 'h2', 'verify', 'm1', 'm1', ?)").bind(NOW).run();
    await expect(db.prepare("INSERT INTO account_links (id, hash, kind, user_id, created_by, expires_at) VALUES ('l3', 'h3', 'x', 'm1', 'm1', ?)").bind(NOW).run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO email_invites (id, email, from_user, mode, created_at, expires_at) VALUES ('e1', 'a@ex.test', 'm1', 'shared', ?, ?)").bind(NOW, NOW).run()).rejects.toThrow();
    await db.prepare("INSERT INTO mail_log (id, kind, user_id, sent_at, recipient_hash) VALUES ('x', 'invite_mail', 'm1', ?, 'abc')").bind(NOW).run();
  });
});
