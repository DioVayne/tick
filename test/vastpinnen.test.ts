import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, callAs, createTask, createUser, json, openTasks, type Task } from './helpers';

type Pinned = Task & { pinned: boolean };
const uniq = () => crypto.randomUUID().slice(0, 8);
const patch = (id: string, body: Record<string, unknown>, cookie?: string) => cookie
  ? callAs(cookie, `/api/tasks/${id}`, { method: 'PATCH', json: body })
  : call(`/api/tasks/${id}`, { method: 'PATCH', json: body });

describe('vastpinnen', () => {
  it('een vastgepinde taak staat bovenaan, ook boven een nieuwere taak', async () => {
    const list = `Pin ${uniq()}`;
    const a = await createTask({ title: 'a', list });
    const b = await createTask({ title: 'b', list });
    expect(a.position).toBeGreaterThan(b.position); // nieuw komt bovenaan
    const r = await patch(a.id, { pinned: true });
    expect(r.status).toBe(200);
    expect((await json<Pinned>(r)).pinned).toBe(true);
    const c = await createTask({ title: 'c', list });
    const order = (await openTasks() as Pinned[]).filter((t) => t.list === list).map((t) => t.title);
    expect(order).toEqual(['a', 'c', 'b']);
    expect((await json<Pinned>(await patch(a.id, { pinned: false }))).pinned).toBe(false);
    expect(c.position).toBeLessThan(b.position);
  });

  it('weigert een subtaak en een ongeldige waarde; een taak die subtaak wordt verliest zijn pin', async () => {
    const parent = await createTask({ title: `Ouder ${uniq()}` });
    const kid = await createTask({ title: 'kind', parent_id: parent.id });
    expect((await patch(kid.id, { pinned: true })).status).toBe(400);
    expect((await patch(parent.id, { pinned: 'ja' })).status).toBe(400);
    const loose = await createTask({ title: `Los ${uniq()}` });
    await patch(loose.id, { pinned: true });
    const moved = await json<Pinned>(await patch(loose.id, { parent_id: parent.id }));
    expect(moved.pinned).toBe(false);
  });

  it('bij een gedeelde taak heeft ieder zijn eigen pin', async () => {
    const u = await createUser({ name: `Pim ${uniq()}` });
    const t = await createTask({ title: `Samen ${uniq()}` });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: u.email, mode: 'shared' } }));
    expect((await callAs(u.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await patch(t.id, { pinned: true }, u.cookie)).status).toBe(200);
    const theirs = (await json<Pinned[]>(await callAs(u.cookie, '/api/tasks'))).find((x) => x.id === t.id)!;
    const mine = (await openTasks() as Pinned[]).find((x) => x.id === t.id)!;
    expect(theirs.pinned).toBe(true);
    expect(mine.pinned).toBe(false);
    const row = await env.DB.prepare('SELECT pinned FROM tasks WHERE id = ?').bind(t.id).first<{ pinned: number }>();
    expect(row?.pinned).toBe(0);
  });
});
