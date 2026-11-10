import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { deleteUserStmts } from '../src/users';
import { callAs, createUser, json, type Task } from './helpers';

const uniq = () => crypto.randomUUID().slice(0, 8);
const NOW = '2026-01-01T00:00:00.000Z';

describe('migratie 0022 (melden en blokkeren)', () => {
  it('tabellen blocks en reports, kolommen suspended_at en added_by', async () => {
    const u = await createUser();
    const user = await env.DB.prepare('SELECT suspended_at FROM users WHERE id = ?').bind(u.id).first<{ suspended_at: string | null }>();
    expect(user).toEqual({ suspended_at: null });
    await env.DB.prepare('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(u.id, 'x', NOW).run();
    await env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, task_id, title, created_at) VALUES ('r1', ?, 'x', 'spam', '', 'geen-taak', 'T', ?)")
      .bind(u.id, NOW).run();
    const r = await env.DB.prepare("SELECT status FROM reports WHERE id = 'r1'").first<{ status: string }>();
    expect(r!.status).toBe('open');
    await expect(env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, title, created_at) VALUES ('r2', ?, 'x', 'boos', '', 'T', ?)")
      .bind(u.id, NOW).run()).rejects.toThrow();
  });

  it('een taak die een lid in een gedeelde lijst zet, krijgt added_by = dat lid', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const list = `Samen ${uniq()}`;
    await callAs(a.cookie, '/api/lists', { method: 'POST', json: { name: list } });
    const res = await callAs(a.cookie, '/api/shared-lists', { method: 'POST', json: { name: list, to: b.email } });
    const { list_id } = await json<{ list_id: string }>(res);
    expect((await callAs(b.cookie, `/api/shared-lists/${list_id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const byB = await json<Task & { added_by: string | null }>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'van B', list } }));
    const byA = await json<Task & { added_by: string | null }>(await callAs(a.cookie, '/api/tasks', { method: 'POST', json: { title: 'van A', list } }));
    expect(byB.added_by).toBe(b.id);
    expect(byA.added_by).toBe(a.id);
    const row = await env.DB.prepare('SELECT user_id, added_by FROM tasks WHERE id = ?').bind(byB.id).first<{ user_id: string; added_by: string }>();
    expect(row).toEqual({ user_id: a.id, added_by: b.id });
  });

  it('account verwijderen wist zijn blokkades en koppelt hem los van zijn meldingen', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await env.DB.batch([
      env.DB.prepare('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(a.id, b.id, NOW),
      env.DB.prepare('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(b.id, a.id, NOW),
      env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, title, created_at) VALUES (?, ?, ?, 'spam', '', 'T', ?)").bind(crypto.randomUUID(), a.id, b.id, NOW),
      env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, title, created_at) VALUES (?, ?, ?, 'spam', '', 'T', ?)").bind(crypto.randomUUID(), b.id, a.id, NOW),
    ]);
    await env.DB.batch(deleteUserStmts(env.DB, a.id));
    const n = async (sql: string) => (await env.DB.prepare(sql).bind(a.id).first<{ n: number }>())!.n;
    expect(await n('SELECT COUNT(*) AS n FROM blocks WHERE user_id = ?1 OR blocked_id = ?1')).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?1 OR reported_id = ?1')).toBe(0);
    // Sinds migratie 0026 blijven de meldingen zelf, losgekoppeld van het verwijderde account.
    const left = await env.DB.prepare('SELECT reporter_id, reported_id FROM reports WHERE reporter_id = ?1 OR reported_id = ?1').bind(b.id).all();
    expect(left.results).toEqual(expect.arrayContaining([{ reporter_id: null, reported_id: b.id }, { reporter_id: b.id, reported_id: null }]));
  });
});
