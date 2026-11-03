import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0018 (Tickmanager)', () => {
  it('migratie 0018: bestaande taken krijgen reviewed_at = NULL en review_skip_lists bestaat', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0018'));
    await db.prepare("INSERT INTO tasks (id, user_id, title, list, position, created_at, updated_at) VALUES ('a', ?1, 'A', 'Werk', 1, ?2, ?2)").bind(ADMIN, NOW).run();
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const row = await db.prepare("SELECT reviewed_at FROM tasks WHERE id = 'a'").first<{ reviewed_at: string | null }>();
    expect(row!.reviewed_at).toBeNull();
    const insert = () => db.prepare("INSERT INTO review_skip_lists (user_id, list_id) VALUES (?, 'abc')").bind(ADMIN).run();
    await insert();
    await expect(insert()).rejects.toThrow();
  });
});
