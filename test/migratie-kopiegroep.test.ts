import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0011 (kopiegroep)', () => {
  it('bestaande taken krijgen geen groep en de kolom is te zetten', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0011'));
    await db.prepare("INSERT INTO tasks (id, user_id, title, position, created_at, updated_at) VALUES ('oud', ?, 'Oud', 1, ?, ?)").bind(ADMIN, NOW, NOW).run();
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    expect(await db.prepare("SELECT copy_group FROM tasks WHERE id = 'oud'").first()).toEqual({ copy_group: null });
    await db.prepare("UPDATE tasks SET copy_group = 'g1' WHERE id = 'oud'").run();
    expect(await db.prepare("SELECT copy_group FROM tasks WHERE id = 'oud'").first()).toEqual({ copy_group: 'g1' });
  });
});
