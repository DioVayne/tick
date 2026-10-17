import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashKey } from '../src/keys';
import { call, callAs, createTask, createUser, json, openTasks, session, ADMIN_ID, type Task } from './helpers';

describe('isolatie per gebruiker', () => {
  let b: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => { b = await createUser(); });

  it('B krijgt 404 op elke taakroute met een id van A, en A merkt niets', async () => {
    const a = await createTask({ title: 'Van A', list: 'Geheim', remind_at: '2030-01-01T10:00:00Z' });
    for (const [m, p, body] of [['PATCH', `/api/tasks/${a.id}`, { title: 'x' }], ['DELETE', `/api/tasks/${a.id}`, undefined],
      ['POST', `/api/tasks/${a.id}/done`, {}], ['POST', `/api/tasks/${a.id}/reopen`, {}], ['POST', `/api/tasks/${a.id}/snooze`, { minutes: 5 }]] as const)
      expect((await callAs(b.cookie, p, { method: m, json: body })).status).toBe(404);
    expect((await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'kind', parent_id: a.id } })).status).toBe(400);
    const own = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'eigen' } }));
    expect((await callAs(b.cookie, `/api/tasks/${own.id}`, { method: 'PATCH', json: { parent_id: a.id } })).status).toBe(400);
    expect((await openTasks()).find((t) => t.id === a.id)).toMatchObject({ title: 'Van A', done: false, remind_at: '2030-01-01T10:00:00.000Z', parent_id: null });
  });

  it('lijsten en zoeken tonen B niets van A', async () => {
    const a = await createTask({ title: 'Zoekwoord-A open', list: 'Geheim' });
    const d = await createTask({ title: 'Zoekwoord-A klaar', list: 'Geheim' });
    expect((await call(`/api/tasks/${d.id}/done`, { method: 'POST', json: {} })).status).toBe(200);
    const open = await json<Task[]>(await callAs(b.cookie, '/api/tasks'));
    const done = await json<Task[]>(await callAs(b.cookie, '/api/tasks?done=1'));
    const found = await json<Task[]>(await callAs(b.cookie, '/api/tasks?q=Zoekwoord'));
    const foundDone = await json<Task[]>(await callAs(b.cookie, '/api/tasks?done=1&q=Zoekwoord'));
    for (const rows of [open, done, found, foundDone]) {
      expect(rows.map((t) => t.id)).not.toContain(a.id);
      expect(rows.map((t) => t.id)).not.toContain(d.id);
      expect(rows.some((t) => t.title.includes('Zoekwoord-A'))).toBe(false);
    }
    const lists = await json<{ name: string }[]>(await callAs(b.cookie, '/api/lists'));
    expect(lists.map((l) => l.name)).not.toContain('Geheim');
  });

  it('dezelfde lijstnaam bij A en B: hernoemen en verwijderen door B raakt alleen B', async () => {
    const a = await createTask({ title: 'A werk', list: 'Werk' });
    await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'B werk', list: 'Werk' } });
    const ren = await callAs(b.cookie, '/api/lists/rename', { method: 'POST', json: { from: 'Werk', to: 'Klus' } });
    expect(await json(ren)).toEqual({ moved: 1 });
    expect((await openTasks()).find((t) => t.id === a.id)!.list).toBe('Werk');
    const del = await callAs(b.cookie, '/api/lists/delete', { method: 'POST', json: { name: 'Klus', tasks: 'delete' } });
    expect(await json(del)).toEqual({ deleted: 1 });
    expect((await openTasks()).find((t) => t.id === a.id)).toBeTruthy();
    // Ook 'naar Inbox' verplaatsen raakt alleen B.
    await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'B werk 2', list: 'Werk' } });
    const mv = await callAs(b.cookie, '/api/lists/delete', { method: 'POST', json: { name: 'Werk', tasks: 'inbox' } });
    expect(await json(mv)).toEqual({ moved: 1 });
    expect((await openTasks()).find((t) => t.id === a.id)!.list).toBe('Werk');
  });

  it('een client-id van A geeft B een 409 en verandert niets', async () => {
    const a = await createTask({ title: 'Origineel' });
    const res = await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { id: a.id, title: 'Overschreven' } });
    expect(res.status).toBe(409);
    expect((await openTasks()).find((t) => t.id === a.id)!.title).toBe('Origineel');
  });

  it('een taak van B staat in de database bij B', async () => {
    const t = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'van B' } }));
    expect(await env.DB.prepare('SELECT user_id FROM tasks WHERE id = ?').bind(t.id).first()).toEqual({ user_id: b.id });
  });

  it('plek "Thuis" kan bij allebei bestaan; B kan A\'s plek niet wijzigen of verwijderen', async () => {
    const place = { name: 'Thuis', lat: 52, lng: 5 };
    const pa = await json<{ id: string }>(await call('/api/places', { method: 'POST', json: place }));
    expect((await callAs(b.cookie, '/api/places', { method: 'POST', json: place })).status).toBe(201);
    expect((await callAs(b.cookie, `/api/places/${pa.id}`, { method: 'PATCH', json: { name: 'Weg' } })).status).toBe(404);
    expect((await callAs(b.cookie, `/api/places/${pa.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await json<{ id: string }[]>(await callAs(b.cookie, '/api/places'))).map((p) => p.id)).not.toContain(pa.id);
  });
  it("sleutels en telefoons zijn per persoon; B kan A's sleutel niet intrekken", async () => {
    const cookieA = await session();
    const ka = await json<{ id: string; key: string }>(await callAs(cookieA, '/api/keys', { method: 'POST', json: { name: 'Pixel A', kind: 'full' } }));
    expect((await callAs(b.cookie, `/api/keys/${ka.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await call('/api/tasks', { auth: `Bearer ${ka.key}` })).status).toBe(200);
    const keysB = await json<{ keys: { id: string }[]; env: unknown[] }>(await callAs(b.cookie, '/api/keys'));
    expect(keysB.keys.map((k) => k.id)).not.toContain(ka.id);
    expect(keysB.env).toEqual([]);
    const dev = await json<{ phones: { key_id: string }[] }>(await callAs(b.cookie, '/api/devices'));
    expect(dev.phones.map((p) => p.key_id)).not.toContain(ka.id);
    expect(dev.phones.map((p) => p.key_id)).not.toContain('env-api');
    for (const id of ['env-api', 'env-inbox']) {
      expect((await callAs(b.cookie, `/api/keys/${id}`, { method: 'PATCH', json: { off: true } })).status).toBe(403);
    }
    const devA = await json<{ phones: { key_id: string }[] }>(await callAs(cookieA, '/api/devices'));
    expect(devA.phones.map((p) => p.key_id)).toContain(ka.id);
    expect(devA.phones.map((p) => p.key_id)).toContain('env-api');
  });

  it('de inbox-sleutel van B zet de taak bij B', async () => {
    const k = await json<{ key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'n8n', kind: 'inbox' } }));
    const t = await json<Task>(await call('/api/inbox', { method: 'POST', auth: `Bearer ${k.key}`, json: { title: 'via inbox' } }));
    expect(await env.DB.prepare('SELECT user_id FROM tasks WHERE id = ?').bind(t.id).first()).toEqual({ user_id: b.id });
    expect(await env.DB.prepare('SELECT user_id FROM api_keys WHERE hash = ?').bind(await hashKey(k.key)).first()).toEqual({ user_id: b.id });
  });

  it("een browser die zich aanmeldt terwijl B is ingelogd, gaat over naar B; B kan A's abonnement niet wissen", async () => {
    const cookieA = await session();
    const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
    const owner = async (endpoint: string) => (await env.DB.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<{ user_id: string }>())?.user_id;
    const E = 'https://push.test/E-' + crypto.randomUUID();
    const F = 'https://push.test/F-' + crypto.randomUUID();
    expect((await callAs(cookieA, '/api/push/subscribe', { method: 'POST', json: sub(E) })).status).toBe(200);
    expect(await owner(E)).toBe(ADMIN_ID);
    expect((await callAs(b.cookie, '/api/push/subscribe', { method: 'POST', json: sub(E) })).status).toBe(200);
    expect(await owner(E)).toBe(b.id);
    const browsersA = await json<{ browsers: { endpoint: string }[] }>(await callAs(cookieA, '/api/devices'));
    expect(browsersA.browsers.map((x) => x.endpoint)).not.toContain(E);
    const browsersB = await json<{ browsers: { endpoint: string }[] }>(await callAs(b.cookie, '/api/devices'));
    expect(browsersB.browsers.map((x) => x.endpoint)).toContain(E);
    await callAs(cookieA, '/api/push/subscribe', { method: 'POST', json: sub(F) });
    expect((await callAs(b.cookie, '/api/push/subscribe', { method: 'DELETE', json: { endpoint: F } })).status).toBe(200);
    expect(await owner(F)).toBe(ADMIN_ID);
    await callAs(cookieA, '/api/push/subscribe', { method: 'DELETE', json: { endpoint: F } });
    expect(await owner(F)).toBeUndefined();
  });
});
