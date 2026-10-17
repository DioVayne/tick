import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, createTask, json, openTasks, type Task } from './helpers';

const patch = (id: string, body: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: body });
const UTRECHT = { name: 'Utrecht', lat: 52.0907, lng: 5.1214, radius: 500, trigger: 'enter' };

describe('locatie op taken', () => {
  it('nieuwe taak heeft geen locatie', async () => {
    const t = await createTask({ title: 'zonder' });
    expect(t).toMatchObject({ location: null, location_notified: false });
    expect(t).not.toHaveProperty('loc_lat');
  });

  it('zet een locatie bij aanmaken en via PATCH', async () => {
    const a = await createTask({ title: 'pakketje', location: UTRECHT });
    expect(a.location).toEqual(UTRECHT);
    const b = await createTask({ title: 'later' });
    expect((await json<Task>(await patch(b.id, { location: { ...UTRECHT, trigger: 'exit' } }))).location).toMatchObject({ trigger: 'exit' });
  });

  it('vult straal en trigger aan met standaardwaarden', async () => {
    const t = await createTask({ title: 'kaal', location: { name: ' Werk ', lat: 51.8, lng: 5.8 } });
    expect(t.location).toEqual({ name: 'Werk', lat: 51.8, lng: 5.8, radius: 500, trigger: 'enter' });
  });

  it('wissen met null', async () => {
    const t = await createTask({ title: 'weg', location: UTRECHT });
    expect((await json<Task>(await patch(t.id, { location: null }))).location).toBeNull();
  });

  it('weigert ongeldige locaties', async () => {
    const t = await createTask({ title: 'blijft' });
    for (const location of [
      { ...UTRECHT, lat: 91 }, { ...UTRECHT, lng: -181 }, { ...UTRECHT, lat: 'x' },
      { ...UTRECHT, radius: 99 }, { ...UTRECHT, radius: 2001 }, { ...UTRECHT, radius: 500.5 },
      { ...UTRECHT, name: '  ' }, { ...UTRECHT, name: 'x'.repeat(101) }, { ...UTRECHT, trigger: 'soms' },
      'Utrecht', [],
    ]) {
      expect((await patch(t.id, { location })).status).toBe(400);
      expect((await call('/api/tasks', { method: 'POST', json: { title: 'x', location } })).status).toBe(400);
    }
    expect((await openTasks()).find((x) => x.id === t.id)?.location).toBeNull();
  });

  it('location_notified: zetten en weer resetten door opnieuw instellen (ook met dezelfde waarde)', async () => {
    const t = await createTask({ title: 'één keer', location: UTRECHT });
    expect((await json<Task>(await patch(t.id, { location_notified: true }))).location_notified).toBe(true);
    expect((await json<Task>(await patch(t.id, { location: UTRECHT }))).location_notified).toBe(false);
    expect((await patch(t.id, { location_notified: 'ja' })).status).toBe(400);
  });

  it('GET /api/tasks geeft de locatie mee', async () => {
    const t = await createTask({ title: 'in lijst', location: UTRECHT });
    expect((await openTasks()).find((x) => x.id === t.id)).toMatchObject({ location: UTRECHT, location_notified: false });
  });

  it('slaat de kolommen op in D1', async () => {
    const t = await createTask({ title: 'db', location: UTRECHT });
    const row = await env.DB.prepare('SELECT loc_name, loc_lat, loc_lng, loc_radius, loc_trigger, loc_notified FROM tasks WHERE id = ?').bind(t.id).first();
    expect(row).toEqual({ loc_name: 'Utrecht', loc_lat: 52.0907, loc_lng: 5.1214, loc_radius: 500, loc_trigger: 'enter', loc_notified: 0 });
  });
});
