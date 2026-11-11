import { describe, expect, it } from 'vitest';
import { call, createTask, json, openTasks, type Task } from './helpers';

const patch = (id: string, body: unknown, op?: string) =>
  call(`/api/tasks/${id}`, { method: 'PATCH', json: body, headers: op ? { 'x-tick-op': op } : {} });
const post = (id: string, path: 'done' | 'reopen', body?: unknown) =>
  call(`/api/tasks/${id}/${path}`, { method: 'POST', ...(body === undefined ? {} : { json: body }) });
const get = async (id: string) => (await openTasks()).find((t) => t.id === id);
/** Zondag 18-10-2099 10:00 Amsterdam en de zondagen erna. */
const ZO1 = '2099-10-18T08:00:00.000Z';
const ZO2 = '2099-10-25T09:00:00.000Z';
const ZO3 = '2099-11-01T09:00:00.000Z';
const wekelijks = () => createTask({ title: 'wekelijks', remind_at: '2099-10-18T10:00:00', repeat: 'freq=weekly;byday=su' });
const DEV = '11111111-2222-3333-4444-555555555555';

describe('verouderde wijzigingen uit een outbox (x-tick-op)', () => {
  it('een vertraagd ouder verzoek van hetzelfde apparaat overschrijft de nieuwere tekst niet', async () => {
    const t = await createTask({ title: 'begin' });
    expect((await json<Task>(await patch(t.id, { title: 'nieuw' }, `${DEV}:5`))).title).toBe('nieuw');
    const res = await patch(t.id, { title: 'oud' }, `${DEV}:4`);
    expect(res.status).toBe(200);
    expect((await json<Task>(res)).title).toBe('nieuw');
    expect((await get(t.id))?.title).toBe('nieuw');
  });

  it('hetzelfde volgnummer nog eens (opnieuw geprobeerd) en een hoger volgnummer gaan gewoon door', async () => {
    const t = await createTask({ title: 'begin' });
    await patch(t.id, { title: 'a' }, `${DEV}:7`);
    expect((await json<Task>(await patch(t.id, { title: 'b' }, `${DEV}:7`))).title).toBe('b');
    expect((await json<Task>(await patch(t.id, { title: 'c' }, `${DEV}:8`))).title).toBe('c');
  });

  it('een ander apparaat, een andere taak of geen header wordt niet tegengehouden', async () => {
    const t = await createTask({ title: 'begin' });
    const u = await createTask({ title: 'ander' });
    await patch(t.id, { title: 'a' }, `${DEV}:9`);
    expect((await json<Task>(await patch(t.id, { title: 'b' }, 'aaaaaaaa-bbbb:1'))).title).toBe('b');
    expect((await json<Task>(await patch(u.id, { title: 'c' }, `${DEV}:1`))).title).toBe('c');
    expect((await json<Task>(await patch(t.id, { title: 'd' }))).title).toBe('d');
    expect((await json<Task>(await patch(t.id, { title: 'e' }, 'onzin'))).title).toBe('e');
  });

  it('een verouderd verzoek op een onbekende taak blijft 404', async () => {
    const t = await createTask({ title: 'x' });
    await patch(t.id, { title: 'y' }, `${DEV}:3`);
    expect((await patch('bestaat-niet', { title: 'z' }, `${DEV}:1`)).status).toBe(404);
  });
});

describe('ongedaan maken met het id van de afvinkactie', () => {
  it('draait precies die stap terug, ook als de server een andere volgende keer berekende dan de client', async () => {
    const t = await wekelijks();
    expect((await json<Task>(await patch(t.id, { done: true, occurrence: ZO1, action: 'a1' }))).repeat?.at).toBe(ZO2);
    // De client voorspelde (offline) een andere keer: met undo telt die niet.
    const u = await json<Task>(await patch(t.id, { done: false, occurrence: ZO3, undo: 'a1' }));
    expect(u.repeat?.at).toBe(ZO1);
    expect(u.remind_at).toBe(ZO1);
  });

  it('een ander actie-id doet niets', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1, action: 'a1' });
    expect((await json<Task>(await patch(t.id, { done: false, undo: 'b2' }))).repeat?.at).toBe(ZO2);
  });

  it('een vertraagd ongedaan maken van een eerdere stap draait de nieuwere niet terug', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1, action: 'a1' });
    await patch(t.id, { done: true, occurrence: ZO2, action: 'a2' });
    expect((await json<Task>(await patch(t.id, { done: false, undo: 'a1' }))).repeat?.at).toBe(ZO3);
    expect((await json<Task>(await patch(t.id, { done: false, undo: 'a2' }))).repeat?.at).toBe(ZO2);
  });

  it('undo bij een stap zonder actie-id (oudere client) doet niets; zonder undo werkt occurrence nog', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1 });
    expect((await json<Task>(await patch(t.id, { done: false, undo: 'a1' }))).repeat?.at).toBe(ZO2);
    expect((await json<Task>(await patch(t.id, { done: false, occurrence: ZO2 }))).repeat?.at).toBe(ZO1);
  });
});

describe('POST /done en /reopen (Android-widget)', () => {
  it('een verouderd widgetitem (oude keer) schuift de taak niet nog een keer door', async () => {
    const t = await wekelijks();
    await patch(t.id, { done: true, occurrence: ZO1 }); // op de website afgevinkt
    expect((await post(t.id, 'done', { occurrence: ZO1, action: 'android-1' })).status).toBe(200);
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
  });

  it('afvinken met de huidige keer en ongedaan maken met dezelfde actie', async () => {
    const t = await wekelijks();
    await post(t.id, 'done', { occurrence: ZO1, action: 'android-2' });
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
    await post(t.id, 'reopen', { undo: 'android-3' });
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
    await post(t.id, 'reopen', { undo: 'android-2' });
    expect((await get(t.id))?.repeat?.at).toBe(ZO1);
  });

  it('zonder body werkt het nog zoals voorheen', async () => {
    const t = await wekelijks();
    await post(t.id, 'done');
    expect((await get(t.id))?.repeat?.at).toBe(ZO2);
    await post(t.id, 'reopen');
    expect((await get(t.id))?.repeat?.at).toBe(ZO1);
  });
});
