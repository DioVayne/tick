import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

describe('migratie 0023 (kopie van)', () => {
  it('bestaande kopieën in een groep krijgen de eigenaar van het oudste andere exemplaar', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0023'));
    for (const [id, name] of [['ua', 'Anna'], ['ub', 'Bert'], ['uc', 'Cor']]) {
      await db.prepare("INSERT INTO users (id, name, role, created_at) VALUES (?, ?, 'member', ?)").bind(id, name, NOW).run();
    }
    const task = (id: string, user: string, source: string, group: string | null, at: string, parent: string | null = null) =>
      db.prepare('INSERT INTO tasks (id, user_id, title, position, source, copy_group, parent_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
        .bind(id, user, id, source, group, parent, at, at).run();
    await task('orig', 'ua', 'web', 'g1', NOW);
    await task('kopie-b', 'ub', 'share', 'g1', LATER);
    await task('kind-b', 'ub', 'share', null, LATER, 'kopie-b');
    await task('kopie-c', 'uc', 'share', 'g1', LATER);
    await task('los', 'uc', 'share', null, NOW);
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    const { results } = await db.prepare('SELECT id, copied_from FROM tasks ORDER BY id').all();
    expect(results).toEqual([
      { id: 'kind-b', copied_from: null },
      { id: 'kopie-b', copied_from: 'ua' },
      { id: 'kopie-c', copied_from: 'ua' },
      { id: 'los', copied_from: null },
      { id: 'orig', copied_from: null },
    ]);
  });
});
