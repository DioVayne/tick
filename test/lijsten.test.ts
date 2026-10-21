import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, createTask, INBOX, json, openTasks, type Task } from './helpers';

/** Unieke lijstnaam per test, zodat taken uit andere tests niet meetellen. */
const tag = () => 'L' + crypto.randomUUID().slice(0, 8);

const rename = (from: string, to: string) => call('/api/lists/rename', { method: 'POST', json: { from, to } });
const del = (name: string, tasks: string) => call('/api/lists/delete', { method: 'POST', json: { name, tasks } });
const lists = async () => json<{ name: string; open: number; id: string }[]>(await call('/api/lists'));
const finish = async (t: Task) => expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
const doneTasks = async () => json<Task[]>(await call('/api/tasks?done=1&limit=500'));

describe('lijsten', () => {
  it('GET /api/lists telt open taken, ook subtaken, en kent lijsten met alleen afgeronde taken', async () => {
    const a = tag(), b = tag();
    const p = await createTask({ title: 'p', list: a });
    await createTask({ title: 'kind', parent_id: p.id });
    await finish(await createTask({ title: 'k', list: b }));
    const all = await lists();
    expect(all.find((l) => l.name === a)).toEqual({ name: a, open: 2, id: expect.any(String) });
    expect(all.find((l) => l.name === b)).toEqual({ name: b, open: 0, id: expect.any(String) });
    expect(all.some((l) => l.name === 'Inbox')).toBe(true);
  });

  it('sorteert hoofdletterongevoelig op Nederlands', async () => {
    // Op codepunt zou het Beta, Zeta, alpha zijn.
    const x = tag();
    const names = [`Zeta ${x}`, `alpha ${x}`, `Beta ${x}`];
    for (const list of names) await createTask({ title: 't', list });
    expect((await lists()).map((l) => l.name).filter((n) => n.endsWith(x))).toEqual([`alpha ${x}`, `Beta ${x}`, `Zeta ${x}`]);
  });

  it('hernoemen dat alleen hoofdletters verandert, werkt', async () => {
    const x = tag();
    const t = await createTask({ title: 't', list: `werk ${x}` });
    expect(await json(await rename(`werk ${x}`, `Werk ${x}`))).toEqual({ moved: 1 });
    expect((await openTasks()).find((o) => o.id === t.id)?.list).toBe(`Werk ${x}`);
    const names = (await lists()).map((l) => l.name);
    expect(names).toContain(`Werk ${x}`);
    expect(names).not.toContain(`werk ${x}`);
  });

  it('hernoemen verplaatst open en afgeronde taken en geeft het aantal', async () => {
    const a = tag(), b = tag();
    const open = await createTask({ title: 'open', list: a });
    const klaar = await createTask({ title: 'klaar', list: a });
    await finish(klaar);
    const res = await rename(a, b);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ moved: 2 });
    expect((await openTasks()).find((t) => t.id === open.id)?.list).toBe(b);
    expect((await doneTasks()).find((t) => t.id === klaar.id)?.list).toBe(b);
  });

  it('hernoemen naar een bestaande lijst voegt samen', async () => {
    const a = tag(), b = tag();
    const ta = await createTask({ title: 'a', list: a });
    const tb = await createTask({ title: 'b', list: b });
    await rename(a, b);
    const open = await openTasks();
    expect(open.find((t) => t.id === ta.id)?.list).toBe(b);
    expect(open.find((t) => t.id === tb.id)?.list).toBe(b);
    const all = await lists();
    expect(all.some((l) => l.name === a)).toBe(false);
    expect(all.find((l) => l.name === b)?.open).toBe(2);
  });

  it('hernoemen naar dezelfde naam doet niets', async () => {
    const a = tag();
    await createTask({ title: 'a', list: a });
    const res = await rename(a, a);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ moved: 0 });
  });

  it('weigert Inbox, lege namen en namen boven 100 tekens', async () => {
    expect((await rename('Inbox', tag())).status).toBe(400);
    expect((await rename(tag(), '   ')).status).toBe(400);
    expect((await rename('  ', tag())).status).toBe(400);
    expect((await rename(tag(), 'x'.repeat(101))).status).toBe(400);
    expect((await del('Inbox', 'inbox')).status).toBe(400);
    expect((await del('  ', 'inbox')).status).toBe(400);
    expect((await del(tag(), 'weg')).status).toBe(400);
  });

  it('verwijderen met tasks=inbox zet alle taken op Inbox', async () => {
    const a = tag();
    const open = await createTask({ title: 'open', list: a });
    const klaar = await createTask({ title: 'klaar', list: a });
    await finish(klaar);
    const kind = await createTask({ title: 'kind', parent_id: open.id });
    const res = await del(a, 'inbox');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ moved: 3 });
    const o = await openTasks();
    expect(o.find((t) => t.id === open.id)?.list).toBe('Inbox');
    expect(o.find((t) => t.id === kind.id)?.list).toBe('Inbox');
    expect((await doneTasks()).find((t) => t.id === klaar.id)?.list).toBe('Inbox');
  });

  it('verwijderen met tasks=delete verwijdert ook subtaken en afgeronde taken', async () => {
    const a = tag();
    const open = await createTask({ title: 'open', list: a });
    const klaar = await createTask({ title: 'klaar', list: a });
    await finish(klaar);
    const kind = await createTask({ title: 'kind', parent_id: open.id });
    const res = await del(a, 'delete');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ deleted: 3 });
    const ids = [...(await openTasks()), ...(await doneTasks())].map((t) => t.id);
    for (const t of [open, klaar, kind]) expect(ids).not.toContain(t.id);
  });

  it('POST en PATCH /api/tasks weigeren een lijstnaam boven 100 tekens', async () => {
    expect((await call('/api/tasks', { method: 'POST', json: { title: 't', list: 'x'.repeat(101) } })).status).toBe(400);
    const t = await createTask({ title: 't', list: 'x'.repeat(100) });
    expect(t.list).toBe('x'.repeat(100));
    const patch = (list: string) => call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { list } });
    expect((await patch('x'.repeat(101))).status).toBe(400);
    expect((await patch('y'.repeat(100))).status).toBe(200);
  });

  it('inbox kapt een te lange lijstnaam af in plaats van te weigeren', async () => {
    const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'inbox', list: 'y'.repeat(150) } });
    expect(res.status).toBe(201);
    expect((await json<Task>(res)).list).toBe('y'.repeat(100));
  });

  // Oude data (import, oude PATCH) kan ongetrimde lijstnamen bevatten; de routes moeten die exact raken.
  const rawList = async (t: Task, list: string) => {
    await env.DB.prepare('UPDATE tasks SET list = ? WHERE id = ?').bind(list, t.id).run();
  };

  it('hernoemen van een ongetrimde naam voegt samen met de getrimde', async () => {
    const x = tag();
    const a = await createTask({ title: 'a', list: x });
    const b = await createTask({ title: 'b', list: x });
    await rawList(b, x + ' ');
    const res = await rename(x + ' ', x);
    expect(await json(res)).toEqual({ moved: 1 });
    const open = await openTasks();
    expect(open.find((t) => t.id === a.id)?.list).toBe(x);
    expect(open.find((t) => t.id === b.id)?.list).toBe(x);
  });

  it('verwijderen van een ongetrimde naam laat de getrimde lijst met rust', async () => {
    const x = tag();
    const a = await createTask({ title: 'a', list: x });
    const b = await createTask({ title: 'b', list: x });
    await rawList(b, x + ' ');
    expect(await json(await del(x + ' ', 'delete'))).toEqual({ deleted: 1 });
    const open = await openTasks();
    expect(open.some((t) => t.id === a.id)).toBe(true);
    expect(open.some((t) => t.id === b.id)).toBe(false);
  });

  it('GET /api/lists geeft een ongetrimde naam ongewijzigd terug', async () => {
    const x = tag();
    await rawList(await createTask({ title: 'a' }), x + ' ');
    expect((await lists()).some((l) => l.name === x + ' ')).toBe(true);
  });

  it('inbox trimt na het afkappen', async () => {
    const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'inbox', list: 'y'.repeat(99) + '   z' } });
    expect((await json<Task>(res)).list).toBe('y'.repeat(99));
  });

  it('POST /api/lists bewaart een lege lijst; met taken staat hij er één keer', async () => {
    const a = tag();
    const make = (name: string) => call('/api/lists', { method: 'POST', json: { name } });
    const res = await make(` ${a} `);
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ name: a });
    expect((await make(a)).status).toBe(201); // nog eens: verandert niets
    expect((await lists()).filter((l) => l.name === a)).toEqual([{ name: a, open: 0, id: expect.any(String) }]);
    await createTask({ title: 't', list: a });
    expect((await lists()).filter((l) => l.name === a)).toEqual([{ name: a, open: 1, id: expect.any(String) }]);
    expect((await make('  ')).status).toBe(400);
    expect((await make('x'.repeat(101))).status).toBe(400);
    expect((await make('Inbox')).status).toBe(201);
    expect((await lists()).filter((l) => l.name === 'Inbox')).toHaveLength(1);
  });

  it('hernoemen en verwijderen werken de bewaarde lege lijst bij', async () => {
    const a = tag(), b = tag(), c = tag();
    await call('/api/lists', { method: 'POST', json: { name: a } });
    expect(await json(await rename(a, b))).toEqual({ moved: 0 });
    let names = (await lists()).map((l) => l.name);
    expect(names).toContain(b);
    expect(names).not.toContain(a);
    // Samenvoegen met een andere bewaarde lijst laat er één over.
    await call('/api/lists', { method: 'POST', json: { name: c } });
    await rename(c, b);
    names = (await lists()).map((l) => l.name);
    expect(names.filter((n) => n === b)).toHaveLength(1);
    expect(names).not.toContain(c);
    expect(await json(await del(b, 'inbox'))).toEqual({ moved: 0 });
    expect((await lists()).map((l) => l.name)).not.toContain(b);
  });

  it('lijstroutes vereisen inlog', async () => {
    expect((await call('/api/lists', { auth: null })).status).toBe(401);
    // Het inbox-token mag alleen naar /api/inbox: daar geeft de middleware 403.
    expect((await call('/api/lists/rename', { method: 'POST', auth: INBOX, json: { from: 'a', to: 'b' } })).status).toBe(403);
  });

  it('elke lijst heeft een vaste id: hernoemen houdt hem, samenvoegen houdt die van het doel, verwijderen niet', async () => {
    const a = tag(), b = tag(), c = tag();
    await createTask({ title: 't', list: a });
    await createTask({ title: 't', list: c });
    const idOf = async (name: string) => (await lists()).find((l) => l.name === name)?.id;
    const first = await idOf(a);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(await idOf(a)).toBe(first); // nog eens opvragen: dezelfde
    expect(await idOf('Inbox')).toEqual(expect.any(String));
    await rename(a, b);
    expect(await idOf(b)).toBe(first);
    const target = await idOf(c);
    await rename(b, c);
    expect(await idOf(c)).toBe(target);
    await del(c, 'inbox');
    await createTask({ title: 't', list: c });
    const again = await idOf(c);
    expect(again).not.toBe(target);
    expect(again).not.toBe(first);
  });
});
