import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { driveTasks, nearestPlace } from '../public/drive.js';
import { call, callAs, createTask, createUser, json, openTasks, session, type Task } from './helpers';

// Meerdere plekken per taak: de eerste in de gewone velden, de andere in `location.more` (kolom loc_more).
const patch = (id: string, body: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: body });
const AH1 = { name: 'AH Centrum', lat: 52.0907, lng: 5.1214, radius: 500, trigger: 'enter' };
const AH2 = { name: 'AH Noord', lat: 52.11, lng: 5.12, radius: 300 };
const AH3 = { name: 'AH Zuid', lat: 52.07, lng: 5.13, radius: 500 };
const loc = (t: Task) => t.location as Record<string, unknown> | null;
const row = (id: string) => env.DB.prepare('SELECT loc_name, loc_more, loc_notified FROM tasks WHERE id = ?').bind(id)
  .first<{ loc_name: string | null; loc_more: string | null; loc_notified: number }>();

describe('meerdere plekken per taak', () => {
  it('bewaart de extra plekken en geeft ze terug in location.more', async () => {
    const t = await createTask({ title: 'boodschappen', location: { ...AH1, more: [AH2, AH3] } });
    expect(loc(t)).toEqual({ ...AH1, more: [AH2, AH3] });
    expect((await openTasks()).find((x) => x.id === t.id)?.location).toEqual({ ...AH1, more: [AH2, AH3] });
    const r = await row(t.id);
    expect(r?.loc_name).toBe('AH Centrum');
    expect(JSON.parse(r!.loc_more!)).toEqual([AH2, AH3]);
  });

  it('één plek blijft precies zoals hij was: geen more, loc_more leeg', async () => {
    const t = await createTask({ title: 'een', location: { ...AH1, more: [] } });
    expect(loc(t)).toEqual(AH1);
    expect(loc(t)).not.toHaveProperty('more');
    expect((await row(t.id))?.loc_more).toBeNull();
  });

  it('een extra plek zonder straal krijgt de standaard van de trigger; namen worden bijgeknipt', async () => {
    const t = await createTask({ title: 'weg', location: { ...AH1, trigger: 'exit', radius: 200, more: [{ name: ' Werk ', lat: 51.8, lng: 5.8 }] } });
    expect(loc(t)?.more).toEqual([{ name: 'Werk', lat: 51.8, lng: 5.8, radius: 200 }]);
    const a = await createTask({ title: 'aan', location: { ...AH1, more: [{ name: 'Werk', lat: 51.8, lng: 5.8 }] } });
    expect(loc(a)?.more).toEqual([{ name: 'Werk', lat: 51.8, lng: 5.8, radius: 500 }]);
  });

  it('hooguit 10 plekken; ongeldige extra plekken geven 400 en veranderen niets', async () => {
    const t = await createTask({ title: 'blijft', location: AH1 });
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...AH2, name: `AH ${i}` }));
    expect((await patch(t.id, { location: { ...AH1, more: nine } })).status).toBe(200);
    const ten = [...nine, AH3];
    const res = await patch(t.id, { location: { ...AH1, more: ten } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/10/);
    for (const more of ['AH', { ...AH2 }, [null], [{ ...AH2, lat: 91 }], [{ ...AH2, radius: 150 }], [{ ...AH2, name: '' }], [{ ...AH2, name: 'x'.repeat(101) }]]) {
      expect((await patch(t.id, { location: { ...AH1, more } })).status).toBe(400);
      expect((await call('/api/tasks', { method: 'POST', json: { title: 'x', location: { ...AH1, more } } })).status).toBe(400);
    }
    expect(loc((await openTasks()).find((x) => x.id === t.id)!)?.more).toHaveLength(9);
  });

  it('een PATCH van location vervangt alles: zonder more blijft alleen de eerste plek over', async () => {
    const t = await createTask({ title: 'vervangen', location: { ...AH1, more: [AH2] } });
    const p = await json<Task>(await patch(t.id, { location: AH3 }));
    expect(loc(p)).toEqual({ ...AH3, trigger: 'enter' });
    expect((await row(t.id))?.loc_more).toBeNull();
    expect(loc(await json<Task>(await patch(t.id, { location: null })))).toBeNull();
  });

  it('één melding voor de hele taak: location_notified geldt voor alle plekken en een nieuwe plek zet hem terug', async () => {
    const t = await createTask({ title: 'eens', location: { ...AH1, more: [AH2] } });
    expect((await json<Task>(await patch(t.id, { location_notified: true }))).location_notified).toBe(true);
    const p = await json<Task>(await patch(t.id, { location: { ...AH1, more: [AH2, AH3] } }));
    expect(p.location_notified).toBe(false);
  });

  it('een gedeelde taak: de ander ziet alle plekken en heeft zijn eigen melding', async () => {
    const b = await createUser({ name: `Bea ${crypto.randomUUID().slice(0, 6)}` });
    const t = await createTask({ title: 'samen', location: { ...AH1, more: [AH2] } });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const seen = async (cookie?: string) => (cookie
      ? await json<Task[]>(await callAs(cookie, '/api/tasks'))
      : await openTasks()).find((x) => x.id === t.id)!;
    expect(loc(await seen(b.cookie))?.more).toEqual([AH2]);
    // B's telefoon meldt (bij AH Noord): alleen B is gemeld, de eigenaar nog niet.
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { location_notified: true } })).status).toBe(200);
    expect((await seen(b.cookie)).location_notified).toBe(true);
    expect((await seen()).location_notified).toBe(false);
  });

  it('een kopie neemt alle plekken mee', async () => {
    const b = await createUser({ name: `Kees ${crypto.randomUUID().slice(0, 6)}` });
    const t = await createTask({ title: 'kopie', location: { ...AH1, more: [AH2, AH3] } });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode: 'copy' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const mine = (await json<Task[]>(await callAs(b.cookie, '/api/tasks'))).find((x) => x.title === 'kopie' && x.id !== t.id)!;
    expect(loc(mine)).toEqual({ ...AH1, more: [AH2, AH3] });
  });

  it('back-up: de extra plekken gaan mee; een kapotte loc_more wordt bij terugzetten weggelaten', async () => {
    const t = await createTask({ title: 'backup', location: { ...AH1, more: [AH2] } });
    const cookie = await session();
    const asSession = (path: string, init: RequestInit & { json?: unknown } = {}) => call(path, { ...init, auth: null, headers: { cookie } });
    const backup = await json<{ tasks: Record<string, unknown>[] }>(await asSession('/api/export'));
    const item = backup.tasks.find((x) => x.id === t.id)!;
    expect(JSON.parse(item.loc_more as string)).toEqual([AH2]);
    await patch(t.id, { location: AH1 });
    expect((await asSession('/api/import/backup', { method: 'POST', json: { ...backup, tasks: [item] } })).status).toBe(200);
    expect(loc((await openTasks()).find((x) => x.id === t.id)!)?.more).toEqual([AH2]);
    expect((await asSession('/api/import/backup', { method: 'POST', json: { ...backup, tasks: [{ ...item, loc_more: '{kapot' }] } })).status).toBe(200);
    expect((await row(t.id))?.loc_more).toBeNull();
    expect(loc((await openTasks()).find((x) => x.id === t.id)!)).toEqual(AH1);
  });

  it('een kapotte loc_more in de database: alleen de eerste plek', async () => {
    const t = await createTask({ title: 'kapot', location: AH1 });
    await env.DB.prepare('UPDATE tasks SET loc_more = ? WHERE id = ?').bind('[{"name":"x"}]', t.id).run();
    expect(loc((await openTasks()).find((x) => x.id === t.id)!)).toEqual(AH1);
  });
});

describe('rijmodus met meerdere plekken', () => {
  const here = { lat: 52.11, lng: 5.12 }; // bij AH Noord, ver van AH Centrum (>2 km)
  const task = { id: 'm', title: 'boodschappen', done: false, parent_id: null, location: { ...AH1, more: [AH2, AH3] }, location_notified: false };

  it('de dichtstbijzijnde plek telt, niet alleen de eerste', () => {
    expect(nearestPlace(here, task.location).place.name).toBe('AH Noord');
    expect(nearestPlace(here, task.location).d).toBeLessThan(1);
    expect(driveTasks([task], Date.now(), here).near.map((t: { id: string }) => t.id)).toEqual(['m']);
    const far = { lat: 53.2, lng: 6.5 };
    expect(driveTasks([task], Date.now(), far).near).toEqual([]);
  });
});
