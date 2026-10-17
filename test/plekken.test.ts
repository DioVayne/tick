import { describe, expect, it } from 'vitest';
import { call, createTask, json, type Task } from './helpers';

type Place = { id: string; name: string; lat: number; lng: number; radius: number };

const post = (body: unknown) => call('/api/places', { method: 'POST', json: body });
const patch = (id: string, body: unknown) => call(`/api/places/${id}`, { method: 'PATCH', json: body });
const del = (id: string) => call(`/api/places/${id}`, { method: 'DELETE' });
const list = async () => json<Place[]>(await call('/api/places'));

describe('favoriete plekken', () => {
  it('maakt, toont, hernoemt en verwijdert een favoriet', async () => {
    const res = await post({ name: 'Mey', lat: 51.84, lng: 5.86 });
    expect(res.status).toBe(201);
    const p = await json<Place>(res);
    expect(p).toMatchObject({ name: 'Mey', lat: 51.84, lng: 5.86, radius: 500 });
    expect(p.id).toBeTruthy();
    expect((await list()).map((x) => x.id)).toContain(p.id);

    const r = await patch(p.id, { name: 'Mey thuis' });
    expect(r.status).toBe(200);
    expect((await json<Place>(r)).name).toBe('Mey thuis');

    expect(await json(await del(p.id))).toEqual({ ok: true });
    expect((await list()).map((x) => x.id)).not.toContain(p.id);
  });

  it('sorteert op naam', async () => {
    await post({ name: 'zz-b', lat: 51, lng: 5 });
    await post({ name: 'ZZ-a', lat: 51, lng: 5 });
    const names = (await list()).map((x) => x.name).filter((n) => n.toLowerCase().startsWith('zz-'));
    expect(names).toEqual(['ZZ-a', 'zz-b']);
  });

  it('weigert een dubbele naam, ook met andere hoofdletters', async () => {
    expect((await post({ name: 'Werk-dubbel', lat: 51, lng: 5 })).status).toBe(201);
    const dup = await post({ name: 'werk-DUBBEL', lat: 51, lng: 5 });
    expect(dup.status).toBe(409);
    expect(await json(dup)).toEqual({ error: 'a favorite with this name already exists' });
    const other = await json<Place>(await post({ name: 'Andere-plek', lat: 51, lng: 5 }));
    const res = await patch(other.id, { name: 'Werk-dubbel' });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'a favorite with this name already exists' });
  });

  it('valideert zoals een locatie', async () => {
    const ok = { name: 'Geldig', lat: 51, lng: 5 };
    expect((await post({ ...ok, lat: 91 })).status).toBe(400);
    expect((await post({ ...ok, radius: 50 })).status).toBe(400);
    expect((await post({ ...ok, name: '' })).status).toBe(400);
    const p = await json<Place>(await post({ ...ok, name: 'Met-trigger', trigger: 'exit' }));
    expect(p).not.toHaveProperty('trigger');
    expect((await patch(p.id, { lat: 'x' })).status).toBe(400);
  });

  it('404 bij een onbekend id', async () => {
    const id = crypto.randomUUID();
    expect((await patch(id, { name: 'Nergens' })).status).toBe(404);
    expect((await del(id)).status).toBe(404);
  });

  it('een favoriet aanpassen of verwijderen verplaatst geen taken', async () => {
    const p = await json<Place>(await post({ name: 'Taakplek', lat: 51.5, lng: 5.5 }));
    const location = { name: p.name, lat: p.lat, lng: p.lng, radius: p.radius, trigger: 'enter' };
    const t = await createTask({ title: 'bij de plek', location });
    expect((await json<Place>(await patch(p.id, { lat: 52 }))).lat).toBe(52);
    await del(p.id);
    const after = (await json<Task[]>(await call('/api/tasks'))).find((x) => x.id === t.id);
    expect(after?.location).toEqual(location);
  });
});
