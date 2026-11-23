import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { BASE, callWith, createUser, INBOX, call } from './helpers';
import { armed, cleanTriggers, stale, STALE_DAYS } from '../src/hatrigger';

// Testfeature hatrigger: triggers uit Home Assistant bij een taak (src/hatrigger.ts).
const on = { ...env, TEST_FEATURES: 'hatrigger' };
type User = Awaited<ReturnType<typeof createUser>>;
type State = { triggers: { id: string; name: string; last: string | null }[]; tasks: Record<string, { ids: string[]; fired: string | null }> };

const req = (u: User, path: string, method = 'GET', json?: unknown) => callWith(on, path, { method, json, cookie: u.cookie });
const state = async (u: User) => (await req(u, '/api/hatrigger')).json() as Promise<State>;
const task = async (u: User, title: string, extra: Record<string, unknown> = {}) =>
  ((await (await req(u, '/api/tasks', 'POST', { title, ...extra })).json()) as { id: string }).id;
const fire = async (u: User, id: string) => req(u, '/api/hatrigger/fire', 'POST', { id });
/** Zoals de HA-integratie: met een full-sleutel. */
async function asHa(key: string, path: string, method = 'GET', json?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${key}` });
  if (json !== undefined) headers.set('content-type', 'application/json');
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }), on, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('hatrigger: triggers uit Home Assistant', () => {
  let a: User;
  let b: User;
  beforeAll(async () => {
    a = await createUser({ name: 'Ada' });
    b = await createUser({ name: 'Bo' });
  });

  it('bestaat niet zonder de testfeature', async () => {
    expect((await callWith({ ...env, TEST_FEATURES: '' }, '/api/hatrigger', { cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/hatrigger', { auth: INBOX })).status).toBe(403); // een inbox-sleutel komt hier nooit
  });

  it('lijstje opslaan: schoon, per persoon, en "laatst" blijft bij dezelfde id', async () => {
    const res = await req(a, '/api/hatrigger/triggers', 'PUT', { triggers: [
      { id: 'sam_thuis', name: '  Sam   komt thuis ', entity: 'person.sam' },
      { id: 'zon_onder', name: 'Zon onder' },
      { id: 'sam_thuis', name: 'dubbel' },
    ] });
    expect(res.status).toBe(200);
    const s = await state(a);
    expect(s.triggers.map((x) => [x.id, x.name])).toEqual([['sam_thuis', 'Sam komt thuis'], ['zon_onder', 'Zon onder']]);
    expect((await state(b)).triggers).toEqual([]);
    expect((await req(a, '/api/hatrigger/triggers', 'PUT', { triggers: [{ id: 'x y', name: 'Fout' }] })).status).toBe(400);
    expect((await req(a, '/api/hatrigger/triggers', 'PUT', { triggers: [{ id: 'leeg', name: '  ' }] })).status).toBe(400);
  });

  it('cleanTriggers houdt "laatst" vast en begrenst', () => {
    const old = [{ id: 'a', name: 'A', entity: null, last: '2026-11-23T10:00:00.000Z' }];
    expect(cleanTriggers([{ id: 'a', name: 'Nieuwe naam' }], old)[0]).toMatchObject({ name: 'Nieuwe naam', last: '2026-11-23T10:00:00.000Z' });
    expect(() => cleanTriggers(Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, name: 'T' })), [])).toThrow();
    expect(() => cleanTriggers({}, [])).toThrow();
  });

  it('eerste trigger meldt één keer; daarna gemeld tot Opnieuw melden', async () => {
    const id = await task(a, 'Vraag naar huiswerk');
    const put = await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['sam_thuis', 'zon_onder', 'onbekend'] });
    expect(put.status).toBe(200);
    expect((await state(a)).tasks[id]).toMatchObject({ ids: ['sam_thuis', 'zon_onder'], fired: null });

    const first = await (await fire(a, 'zon_onder')).json() as { notified: string[]; trigger: string };
    expect(first).toEqual({ trigger: 'Zon onder', notified: [id] });
    const s = await state(a);
    expect(s.tasks[id].fired).toBeTruthy();
    expect(s.triggers.find((x) => x.id === 'zon_onder')!.last).toBeTruthy();
    // De andere trigger van dezelfde taak meldt niet nog eens.
    expect((await (await fire(a, 'sam_thuis')).json() as { notified: string[] }).notified).toEqual([]);
    // Opnieuw melden = dezelfde triggers opnieuw opslaan.
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['sam_thuis', 'zon_onder'] });
    expect((await (await fire(a, 'sam_thuis')).json() as { notified: string[] }).notified).toEqual([id]);
  });

  it('afgevinkte taken melden niet; een onbekende trigger is 404', async () => {
    const id = await task(a, 'Gordijnen dicht');
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['zon_onder'] });
    await req(a, `/api/tasks/${id}/done`, 'POST');
    expect((await (await fire(a, 'zon_onder')).json() as { notified: string[] }).notified).not.toContain(id);
    expect((await fire(a, 'bestaat_niet')).status).toBe(404);
    expect((await fire(a, 'x y')).status).toBe(400);
  });

  it('alleen je eigen hoofdtaak; een ander zijn taak is 404', async () => {
    const id = await task(a, 'Van Ada');
    expect((await req(b, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: [] })).status).toBe(404);
    const sub = await task(a, 'Subtaak', { parent_id: id });
    expect((await req(a, `/api/hatrigger/tasks/${sub}`, 'PUT', { ids: ['zon_onder'] })).status).toBe(404);
    expect((await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: 'zon_onder' })).status).toBe(400);
  });

  it('een trigger die uit HA verdwijnt, gaat ook uit de taken', async () => {
    const id = await task(a, 'Ventilator');
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['zon_onder'] });
    await req(a, '/api/hatrigger/triggers', 'PUT', { triggers: [{ id: 'sam_thuis', name: 'Sam komt thuis' }] });
    expect((await state(a)).tasks[id]).toBeUndefined();
  });

  it('weken niets van HA gehoord: de app ziet geen triggers meer; komt HA terug, dan wel', async () => {
    const u = await createUser({ name: 'Cas' });
    const key = ((await (await req(u, '/api/keys', 'POST', { name: 'Home Assistant', kind: 'full' })).json()) as { key: string }).key;
    expect((await asHa(key, '/api/hatrigger/triggers', 'PUT', { triggers: [{ id: 'licht', name: 'Badkamerlicht aan' }] })).status).toBe(200);
    const id = await task(u, 'Ventilator');
    await req(u, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['licht'] });
    expect((await state(u)).triggers).toHaveLength(1);

    const old = new Date(Date.now() - (STALE_DAYS + 1) * 86_400_000).toISOString();
    await env.DB.prepare("UPDATE user_settings SET value = ? WHERE user_id = ? AND key = 'hatrigger:seen'").bind(JSON.stringify(old), u.id).run();
    const hidden = await state(u) as State & { stale: boolean };
    expect(hidden).toMatchObject({ triggers: [], tasks: {}, stale: true });
    // HA zelf krijgt alles nog, en zijn teken van leven maakt het weer zichtbaar.
    const ha = await (await asHa(key, '/api/hatrigger')).json() as State;
    expect(ha.triggers).toHaveLength(1);
    const back = await state(u) as State & { stale: boolean };
    expect(back.stale).toBe(false);
    expect(back.tasks[id].ids).toEqual(['licht']);
  });

  it('stale: zonder teken van leven (nog nooit een sleutel) niet', () => {
    expect(stale(null)).toBe(false);
    expect(stale(new Date().toISOString())).toBe(false);
    expect(stale('2026-01-01T00:00:00.000Z', Date.parse('2026-03-01T00:00:00.000Z'))).toBe(true);
  });

  it('armed: een herhalende taak die doorschoof, staat weer klaar', () => {
    expect(armed({ ids: ['a'], fired: null, rep: null }, null)).toBe(true);
    expect(armed({ ids: ['a'], fired: 'x', rep: '2026-11-23T08:00:00.000Z' }, '2026-11-23T08:00:00.000Z')).toBe(false);
    expect(armed({ ids: ['a'], fired: 'x', rep: '2026-11-23T08:00:00.000Z' }, '2026-11-24T08:00:00.000Z')).toBe(true);
    expect(armed({ ids: ['a'], fired: 'x', rep: null }, null)).toBe(false);
  });
});
