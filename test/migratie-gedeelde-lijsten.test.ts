import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0017 (gedeelde lijsten)', () => {
  it('maakt de tabellen en kolommen; een naam is per persoon uniek onder de geaccepteerde lidmaatschappen', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['shared_lists', 'list_members', 'task_watch']));
    const cols = (await db.prepare('PRAGMA table_info(tasks)').all<{ name: string }>()).results.map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['shared_list', 'done_by', 'claimed_by']));

    const member = (list: string, status: string) => db.prepare(
      "INSERT INTO list_members (list_id, user_id, role, status, name, created_at) VALUES (?, ?, 'owner', ?, 'Vakantie', ?)").bind(list, ADMIN, status, NOW);
    await db.batch([
      db.prepare("INSERT INTO shared_lists (id, owner_id, created_at) VALUES ('l1', ?1, ?2), ('l2', ?1, ?2), ('l3', ?1, ?2)").bind(ADMIN, NOW),
      member('l1', 'accepted'),
      member('l3', 'pending'), // een openstaande uitnodiging met dezelfde naam mag
    ]);
    await expect(member('l2', 'accepted').run()).rejects.toThrow(/UNIQUE/);
  });
});
