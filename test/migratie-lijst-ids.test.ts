import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0016 (lijst-ids)', () => {
  it('bestaande lijsten krijgen elk een id: uit taken en bewaarde lege lijsten, één per naam', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0016'));
    await db.batch([
      db.prepare("INSERT INTO tasks (id, user_id, title, list, position, created_at, updated_at) VALUES ('a', ?1, 'A', 'Werk', 1, ?2, ?2), ('b', ?1, 'B', 'Werk', 2, ?2, ?2), ('c', ?1, 'C', 'Inbox', 3, ?2, ?2)").bind(ADMIN, NOW),
      db.prepare("INSERT INTO lists (user_id, name, created_at) VALUES (?, 'Leeg', ?)").bind(ADMIN, NOW),
    ]);
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const rows = (await db.prepare('SELECT name, id FROM list_ids WHERE user_id = ? ORDER BY name').bind(ADMIN).all<{ name: string; id: string }>()).results;
    expect(rows.map((r) => r.name)).toEqual(['Inbox', 'Leeg', 'Werk']);
    for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});
