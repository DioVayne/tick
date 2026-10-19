import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { nextOccurrence } from '../public/repeat.js';
import { call, createTask, INBOX, json, openTasks, type Task } from './helpers';

const patch = (id: string, body: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: body });
const WEKELIJKS = 'freq=weekly;byday=su';
const get = async (id: string) => (await openTasks()).find((t) => t.id === id);
const prevOf = async (id: string) =>
  (await env.DB.prepare('SELECT repeat_prev FROM tasks WHERE id = ?').bind(id).first<{ repeat_prev: string | null }>())!.repeat_prev;
/** Zondag 18-10-2099 10:00 Amsterdam en de zondagen erna. */
const ZO1 = '2099-10-18T08:00:00.000Z';
const ZO2 = '2099-10-25T09:00:00.000Z';
const ZO3 = '2099-11-01T09:00:00.000Z';

describe('herhalende taken', () => {
  it('nieuwe taak heeft repeat null', async () => {
    const t = await createTask({ title: 'los' });
    expect(t.repeat).toBeNull();
    expect(t).not.toHaveProperty('repeat_rule');
    expect(t).not.toHaveProperty('repeat_prev');
  });

  it('ritme instellen normaliseert en zet remind_at op de eerste keer', async () => {
    const t = await createTask({ title: 'wekelijks', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    expect(t.repeat?.rule).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(t.repeat?.at).toBe('2099-10-18T08:00:00.000Z');
    expect(t.remind_at).toBe('2099-10-18T08:00:00.000Z');
    expect(t.notified).toBe(false);
  });

  it('ritme zonder reminder start vandaag om 09:00', async () => {
    const t = await createTask({ title: 'dagelijks', repeat: 'FREQ=DAILY' });
    expect(t.repeat?.start).toMatch(/T0[78]:00:00\.000Z$/);
    expect(t.remind_at).toBe(t.repeat?.at);
  });

  it('ongeldig ritme geeft 400', async () => {
    const res = await call('/api/tasks', { method: 'POST', json: { title: 'x', remind_at: '2099-10-18T10:00:00', repeat: 'FREQ=HOURLY' } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/invalid repeat rule/);
    const t = await createTask({ title: 'blijft', remind_at: '2099-10-18T10:00:00' });
    expect((await patch(t.id, { repeat: 'onzin' })).status).toBe(400);
  });

  it('met een einddatum rondt de laatste keer de taak af', async () => {
    const t = await createTask({ title: 'twee keer', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS + ';until=20991025' });
    expect(t.repeat?.rule).toBe('FREQ=WEEKLY;BYDAY=SU;UNTIL=20991025');
    const u = await json<Task>(await patch(t.id, { done: true }));
    expect(u.done).toBe(false);
    expect(u.repeat?.at).toBe(ZO2);
    const v = await json<Task>(await patch(t.id, { done: true }));
    expect(v.done).toBe(true);
    expect(v.remind_at).toBe(ZO2);
  });

  it('een einddatum die al voorbij is geeft 400', async () => {
    const res = await call('/api/tasks', { method: 'POST', json: { title: 'x', remind_at: '2020-01-05T10:00:00', repeat: 'FREQ=DAILY;UNTIL=20200110' } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/end date/);
  });

  it('ritme instellen via PATCH gebruikt de reminder van de taak', async () => {
    const t = await createTask({ title: 'later', remind_at: '2099-10-18T10:00:00' });
    const u = await json<Task>(await patch(t.id, { repeat: WEKELIJKS }));
    expect(u.repeat).toEqual({ rule: 'FREQ=WEEKLY;BYDAY=SU', start: '2099-10-18T08:00:00.000Z', at: '2099-10-18T08:00:00.000Z' });
    expect(u.remind_at).toBe(u.repeat?.at);
  });

  it('reminder verzetten laat start en at staan', async () => {
    const t = await createTask({ title: 'verzet', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    const u = await json<Task>(await patch(t.id, { remind_at: '2099-10-21T10:00:00' }));
    expect(u.repeat?.start).toBe(t.repeat?.start);
    expect(u.repeat?.at).toBe(t.repeat?.at);
    expect(u.remind_at).toBe('2099-10-21T08:00:00.000Z');
  });

  it('reminder wissen zet het ritme uit', async () => {
    const t = await createTask({ title: 'wis', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    const u = await json<Task>(await patch(t.id, { remind_at: null }));
    expect(u.repeat).toBeNull();
    expect(u.remind_at).toBeNull();
  });

  it('repeat null zet het ritme uit en laat de reminder staan', async () => {
    const t = await createTask({ title: 'uit', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    const u = await json<Task>(await patch(t.id, { repeat: null }));
    expect(u.repeat).toBeNull();
    expect(u.remind_at).toBe(t.remind_at);
  });

  it('subtaak kan niet herhalen', async () => {
    const parent = await createTask({ title: 'ouder' });
    const res = await call('/api/tasks', { method: 'POST', json: { title: 'kind', parent_id: parent.id, remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('only top-level tasks can repeat');
    const kind = await createTask({ title: 'kind', parent_id: parent.id, remind_at: '2099-10-18T10:00:00' });
    expect((await patch(kind.id, { repeat: WEKELIJKS })).status).toBe(400);
  });

  it('hoofdtaak met ritme die subtaak wordt, verliest het ritme', async () => {
    const parent = await createTask({ title: 'ouder' });
    const t = await createTask({ title: 'wordt kind', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    const u = await json<Task>(await patch(t.id, { parent_id: parent.id }));
    expect(u.repeat).toBeNull();
  });

  it('inbox accepteert repeat', async () => {
    const res = await call('/api/inbox', {
      method: 'POST', auth: INBOX,
      json: { title: 'via inbox', datum: '2099-10-18', repeat: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU' },
    });
    expect(res.status).toBe(201);
    const t = await json<Task>(res);
    expect(t.repeat?.rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU');
    expect(t.remind_at).toBe('2099-10-18T07:00:00.000Z');
  });

  it('een lege repeat (inbox, POST of PATCH) is geen ritme en geen 400', async () => {
    for (const repeat of ['', '  ']) {
      const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'leeg ritme', datum: '2099-10-18', repeat } });
      expect(res.status).toBe(201);
      expect((await json<Task>(res)).repeat).toBeNull();
    }
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'leeg ritme', repeat: '' } })).status).toBe(201);
    const t = await createTask({ title: 'wist ritme', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
    const u = await json<Task>(await patch(t.id, { repeat: '' }));
    expect(u.repeat).toBeNull();
  });
});

describe('herhalende taken afvinken', () => {
  const wekelijks = () => createTask({ title: 'planten', remind_at: '2099-10-18T10:00:00', repeat: WEKELIJKS });
  const done = (id: string) => call(`/api/tasks/${id}/done`, { method: 'POST' });
  const reopen = (id: string) => call(`/api/tasks/${id}/reopen`, { method: 'POST' });

  it('afvinken schuift door naar volgende zondag en blijft open', async () => {
    const t = await createTask({ title: 'zondag', remind_at: '2020-01-05T10:00:00', repeat: WEKELIJKS });
    // De keer staat nog op de start in het verleden, alsof de reminder lang is blijven liggen.
    await env.DB.prepare('UPDATE tasks SET remind_at = repeat_start, repeat_at = repeat_start, notified = 1 WHERE id = ?').bind(t.id).run();
    const u = await json<Task>(await patch(t.id, { done: true }));
    expect(u.done).toBe(false);
    expect(u.done_at).toBeNull();
    expect(u.notified).toBe(false);
    const at = Date.parse(u.repeat!.at);
    expect(at).toBeGreaterThan(Date.now());
    expect(at - Date.now()).toBeLessThanOrEqual(7 * 24 * 3600_000);
    expect(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(at))
      .toBe('zondag 10:00');
    expect(u.repeat!.at).toBe(nextOccurrence('FREQ=WEEKLY;BYDAY=SU', '2020-01-05T09:00:00.000Z', Date.now()));
    expect(u.remind_at).toBe(u.repeat!.at);
    expect(u.repeat!.start).toBe('2020-01-05T09:00:00.000Z');
    expect((await get(t.id))?.repeat?.at).toBe(u.repeat!.at);
  });

  it('vroeg afvinken slaat de huidige keer over', async () => {
    const t = await wekelijks();
    expect(t.repeat?.at).toBe(ZO1);
    expect((await done(t.id)).status).toBe(200);
    const u = (await get(t.id))!;
    expect(u.done).toBe(false);
    expect(u.repeat?.at).toBe(ZO2);
    expect(u.remind_at).toBe(ZO2);
  });

  it('snoozen houdt het ritme', async () => {
    const t = await wekelijks();
    const s = await call(`/api/tasks/${t.id}/snooze`, { method: 'POST', json: { minutes: 30 } });
    expect(s.status).toBe(200);
    expect((await get(t.id))?.repeat?.at).toBe(ZO1);
    const u = await json<Task>(await patch(t.id, { done: true, occurrence: ZO1 }));
    expect(u.repeat?.at).toBe(ZO2);
    expect(u.remind_at).toBe(ZO2);
  });

  it('snoozen wist de ongedaan-maakstand', async () => {
    const t = await wekelijks();
    await done(t.id);
    expect(await prevOf(t.id)).not.toBeNull();
    await call(`/api/tasks/${t.id}/snooze`, { method: 'POST', json: { minutes: 30 } });
    expect(await prevOf(t.id)).toBeNull();
  });

  it('dubbel done met dezelfde occurrence schuift één keer door', async () => {
    const t = await wekelijks();
    const a = await patch(t.id, { done: true, occurrence: ZO1 });
    const b = await patch(t.id, { done: true, occurrence: ZO1 });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await json<Task>(b)).repeat?.at).toBe(ZO2);
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
  });

  it('occurrence zonder done blijft niets te wijzigen', async () => {
    const t = await wekelijks();
    expect((await patch(t.id, { occurrence: ZO1 })).status).toBe(400);
  });

  it('ongedaan maken zet reminder en subtaken terug', async () => {
    const t = await wekelijks();
    const af = await createTask({ title: 'al af', parent_id: t.id });
    const open = await createTask({ title: 'nog open', parent_id: t.id });
    const afDone = await json<Task>(await patch(af.id, { done: true }));
    expect(afDone.done_at).not.toBeNull();
    // De reminder was al afgegaan: na ongedaan maken mag de cron hem niet nog een keer sturen.
    await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ?').bind(t.id).run();
    const rolled = await json<Task>(await patch(t.id, { done: true, occurrence: ZO1 }));
    expect(rolled.notified).toBe(false);
    let kids = (await openTasks()).filter((x) => x.parent_id === t.id);
    expect(kids.map((k) => k.id).sort()).toEqual([af.id, open.id].sort());
    expect((await reopen(t.id)).status).toBe(200);
    const u = (await get(t.id))!;
    expect(u.repeat?.at).toBe(ZO1);
    expect(u.remind_at).toBe(ZO1);
    expect(u.notified).toBe(true);
    expect(await prevOf(t.id)).toBeNull();
    kids = (await openTasks()).filter((x) => x.parent_id === t.id);
    expect(kids.map((k) => k.id)).toEqual([open.id]);
    const terug = await env.DB.prepare('SELECT done, done_at FROM tasks WHERE id = ?').bind(af.id).first<{ done: number; done_at: string }>();
    expect(terug).toEqual({ done: 1, done_at: afDone.done_at });
  });

  it('ongedaan maken via PATCH done:false werkt ook', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1 });
    const u = await json<Task>(await patch(t.id, { done: false }));
    expect(u.repeat?.at).toBe(ZO1);
    expect(u.done).toBe(false);
  });

  it('twee keer doorschuiven binnen 15 min, dan ongedaan maken zet de laatste stap terug', async () => {
    const t = await wekelijks();
    await done(t.id);
    await done(t.id);
    expect((await get(t.id))?.repeat?.at).toBe(ZO3);
    await reopen(t.id);
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
    // De stand is verbruikt: nog een keer terug kan niet.
    await reopen(t.id);
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
  });

  it('ongedaan maken met een oude occurrence doet niets', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1 });
    await patch(t.id, { done: true, occurrence: ZO2 });
    // Een vertraagd ongedaan maken van de eerste stap (die toen ZO2 opleverde) mag de tweede niet terugdraaien.
    const u = await json<Task>(await patch(t.id, { done: false, occurrence: ZO2 }));
    expect(u.repeat?.at).toBe(ZO3);
    const v = await json<Task>(await patch(t.id, { done: false, occurrence: ZO3 }));
    expect(v.repeat?.at).toBe(ZO2);
  });

  it('ongedaan maken na 15 minuten doet niets', async () => {
    const t = await wekelijks();
    await done(t.id);
    const prev = JSON.parse((await prevOf(t.id))!);
    prev.at = new Date(Date.now() - 15 * 60_000 - 1000).toISOString();
    await env.DB.prepare('UPDATE tasks SET repeat_prev = ? WHERE id = ?').bind(JSON.stringify(prev), t.id).run();
    await reopen(t.id);
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
  });

  it('ongedaan maken zonder doorschuiven doet niets', async () => {
    const t = await wekelijks();
    const u = await json<Task>(await patch(t.id, { done: false }));
    expect(u.repeat?.at).toBe(ZO1);
    expect(u.done).toBe(false);
  });
});
