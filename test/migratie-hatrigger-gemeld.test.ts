import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const NOW = '2026-11-25T10:00:00.000Z';

describe('migratie 0035 (Home Assistant: gemeld per taak)', () => {
  it('neemt "gemeld" uit de JSON over; taken die weg zijn of nooit meldden niet', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0035'));
    await db.prepare("INSERT INTO users (id, name, role, created_at) VALUES ('ua', 'Sam', 'member', ?)").bind(NOW).run();
    for (const id of ['gemeld', 'klaar']) {
      await db.prepare('INSERT INTO tasks (id, user_id, title, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').bind(id, 'ua', id, NOW, NOW).run();
    }
    const links = {
      gemeld: { ids: ['zon'], fired: NOW, rep: '2026-11-26T08:00:00.000Z', by: 'zon' },
      klaar: { ids: ['zon'], fired: null, rep: null },
      weg: { ids: ['zon'], fired: NOW, rep: null, by: 'zon' },
    };
    await db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES ('ua', 'hatrigger:tasks', ?)").bind(JSON.stringify(links)).run();
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const { results } = await db.prepare('SELECT * FROM hatrigger_fired').all();
    expect(results).toEqual([{ task_id: 'gemeld', user_id: 'ua', fired: NOW, rep: '2026-11-26T08:00:00.000Z', fired_by: 'zon' }]);
  });
});
