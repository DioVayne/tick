import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, callAs, createTask, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type ListItem = { name: string; id: string; review: boolean };
type Dated = Task & { reviewed_at: string | null; updated_at: string; created_at: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
const reviewed = (id: string, as?: string) => as
  ? callAs(as, `/api/tasks/${id}/reviewed`, { method: 'POST', json: {} })
  : call(`/api/tasks/${id}/reviewed`, { method: 'POST', json: {} });
const lists = async (u?: User) => json<ListItem[]>(await (u ? callAs(u.cookie, '/api/lists') : call('/api/lists')));
const listNamed = async (name: string, u?: User) => (await lists(u)).find((l) => l.name === name)!;
const setInclude = (id: string, include: unknown, as?: string) => as
  ? callAs(as, `/api/review/lists/${id}`, { method: 'PUT', json: { include } })
  : call(`/api/review/lists/${id}`, { method: 'PUT', json: { include } });
const taskOf = async (id: string) => (await json<Dated[]>(await call('/api/tasks'))).find((t) => t.id === id)!;
const skipRows = async (listId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM review_skip_lists WHERE list_id = ?').bind(listId).first<{ n: number }>())!.n;

describe('Tickmanager: routes', () => {
  let b: User;
  beforeAll(async () => { b = await createUser({ name: `Bea ${uniq()}` }); });

  it('reviewed zet reviewed_at en updated_at', async () => {
    const start = new Date().toISOString();
    const t = await createTask({ title: `Oud ${uniq()}` });
    const before = await taskOf(t.id);
    const res = await reviewed(t.id);
    expect(res.status).toBe(200);
    const out = await json<{ ok: boolean; reviewed_at: string }>(res);
    expect(out.ok).toBe(true);
    expect(new Date(out.reviewed_at).toISOString()).toBe(out.reviewed_at);
    expect(out.reviewed_at >= start).toBe(true);
    const after = await taskOf(t.id);
    expect(after.reviewed_at).toBe(out.reviewed_at);
    expect(after.updated_at).toBe(out.reviewed_at);
    expect(after.created_at).toBe(before.created_at);
  });

  it('reviewed: 404 zonder toegang en voor een onbekend id', async () => {
    const t = await createTask({ title: `Van A ${uniq()}` });
    expect((await reviewed(t.id, b.cookie)).status).toBe(404);
    expect((await reviewed(crypto.randomUUID())).status).toBe(404);
  });

  it('reviewed: deelnemer van een gedeelde lijst mag het, en de eigenaar ziet het', async () => {
    const name = `Samen ${uniq()}`;
    const t = await createTask({ title: `Gedeeld ${uniq()}`, list: name });
    const sh = await call('/api/shared-lists', { method: 'POST', json: { name, to: b.email } });
    expect(sh.status).toBe(201);
    const { list_id } = await json<{ list_id: string }>(sh);
    expect((await callAs(b.cookie, `/api/shared-lists/${list_id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const res = await reviewed(t.id, b.cookie);
    expect(res.status).toBe(200);
    const { reviewed_at } = await json<{ reviewed_at: string }>(res);
    expect((await taskOf(t.id)).reviewed_at).toBe(reviewed_at);
  });

  it('review-lijst aan en uit', async () => {
    const inbox = await listNamed('Inbox');
    expect(inbox.review).toBe(true);
    expect((await setInclude(inbox.id, false)).status).toBe(200);
    expect((await listNamed('Inbox')).review).toBe(false);
    expect((await setInclude(inbox.id, false)).status).toBe(200);
    expect((await listNamed('Inbox')).review).toBe(false);
    expect((await setInclude(inbox.id, true)).status).toBe(200);
    expect((await listNamed('Inbox')).review).toBe(true);
  });

  it('review-lijst: 404 voor andermans of onbekende id, 400 zonder boolean', async () => {
    const theirs = (await listNamed('Inbox', b)).id;
    expect((await setInclude(theirs, false)).status).toBe(404);
    expect((await setInclude('zzz', false)).status).toBe(404);
    const mine = (await listNamed('Inbox')).id;
    const res = await setInclude(mine, 'nee');
    expect(res.status).toBe(400);
  });

  it('overslaan overleeft hernoemen; verwijderen ruimt de rij op', async () => {
    const name = `Ooit-${uniq()}`;
    const to = `Later-${uniq()}`;
    await createTask({ title: 'Iets', list: name });
    const id = (await listNamed(name)).id;
    expect((await setInclude(id, false)).status).toBe(200);
    expect((await call('/api/lists/rename', { method: 'POST', json: { from: name, to } })).status).toBe(200);
    expect((await listNamed(to)).review).toBe(false);
    expect(await skipRows(id)).toBe(1);
    expect((await call('/api/lists/delete', { method: 'POST', json: { name: to, tasks: 'inbox' } })).status).toBe(200);
    expect(await skipRows(id)).toBe(0);
  });
});
