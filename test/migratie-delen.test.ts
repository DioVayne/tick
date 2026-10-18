import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0010 (delen en prullenbak)', () => {
  it('bestaande taken blijven staan, buiten de prullenbak, en de nieuwe tabellen werken', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0010'));
    await db.batch([
      db.prepare("INSERT INTO tasks (id, user_id, title, position, remind_at, created_at, updated_at) VALUES ('ouder', ?, 'Ouder', 1, '2030-01-01T09:00:00.000Z', ?, ?)").bind(ADMIN, NOW, NOW),
      db.prepare("INSERT INTO tasks (id, user_id, title, parent_id, position, created_at, updated_at) VALUES ('kind', ?, 'Kind', 'ouder', 2, ?, ?)").bind(ADMIN, NOW, NOW),
    ]);
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    expect((await db.prepare('SELECT id, parent_id, deleted_at FROM tasks ORDER BY id').all()).results).toEqual([
      { id: 'kind', parent_id: 'ouder', deleted_at: null },
      { id: 'ouder', parent_id: null, deleted_at: null },
    ]);
    await db.prepare("INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, created_at) VALUES ('s1', 'ouder', ?, ?, 'shared', 'pending', ?)").bind(ADMIN, ADMIN, NOW).run();
    await db.prepare("INSERT INTO reminder_sent (task_id, user_id, remind_at) VALUES ('ouder', ?, '2030-01-01T09:00:00.000Z')").bind(ADMIN).run();
    // Een taak echt wissen neemt zijn deelrijen en bezorgrijen mee (ON DELETE CASCADE).
    await db.batch([db.prepare("DELETE FROM tasks WHERE id = 'kind'"), db.prepare("DELETE FROM tasks WHERE id = 'ouder'")]);
    expect(await db.prepare('SELECT count(*) AS n FROM task_shares').first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT count(*) AS n FROM reminder_sent').first()).toEqual({ n: 0 });
  });
});
