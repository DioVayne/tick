import { afterEach, describe, expect, it, vi } from 'vitest';
// De Workers-runtime heeft geen IndexedDB: db.js valt dan terug op geheugen, en dat lezen we hier uit.
import { nextOccurrence } from '../public/repeat.js';
import * as db from '../public/db.js';
import { claim, createList, deleteList, doneInList, ensureOwner, init, load, renameList, sharedOf, state, sync, toggleDone, update } from '../public/store.js';

describe('store: lijst-ops', () => {
  it('een nieuwe lege lijst gaat via de outbox naar de server, en hernoemen en verwijderen gaan mee', async () => {
    const clear = async () => { for (const op of await db.outboxAll()) await db.outboxDelete(op.seq); };
    await clear();
    state.extraLists = [];
    expect(createList('Nieuw ')).toBe('Nieuw');
    expect(state.extraLists).toEqual(['Nieuw']);
    expect(createList('nieuw')).toBe('Nieuw'); // bestaande schrijfwijze wint, geen tweede op
    await renameList('Nieuw', 'Anders');
    expect(state.extraLists).toEqual(['Anders']);
    await deleteList('Anders', 'inbox');
    expect(state.extraLists).toEqual([]);
    expect((await db.outboxAll()).map((op: { type: string }) => op.type)).toEqual(['list-create', 'list-rename', 'list-delete']);
    await clear();
  });

  it('een lege lijst die alleen de server kent, blijft bij hernoemen bestaan onder de nieuwe naam', async () => {
    const clear = async () => { for (const op of await db.outboxAll()) await db.outboxDelete(op.seq); };
    await clear();
    state.extraLists = [];
    state.serverLists = [{ name: 'Inbox', open: 0 }, { name: 'Leeg', open: 0 }] as any;
    await renameList('Leeg', 'Ander');
    expect(state.serverLists.map((l: { name: string }) => l.name)).toEqual(['Inbox']);
    expect(state.extraLists).toEqual(['Ander']);
    state.serverLists = [];
    state.extraLists = [];
    await clear();
  });
});

describe('store: herhalende taken', () => {
  const rep = (at: string) => ({ rule: 'FREQ=WEEKLY', start: at, at });
  const setup = (at: string, id = 'r1') => {
    state.open = [{ id, title: 'Plant water', list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, remind_at: at, notified: true, location: null, location_notified: false, repeat: rep(at) }] as any;
    state.done = [];
    state.justDone.clear();
  };

  it('afvinken van een herhalende taak schuift lokaal door en zet occurrence in de outbox', async () => {
    const oudeAt = '2030-01-07T09:00:00.000Z';
    setup(oudeAt);
    for (const op of await db.outboxAll()) await db.outboxDelete(op.seq);
    await toggleDone(state.open[0]);
    const t = state.open[0] as any;
    expect(t.done).toBe(false);
    expect(t.remind_at).toBe('2030-01-14T09:00:00.000Z');
    expect(t.repeat.at).toBe('2030-01-14T09:00:00.000Z');
    expect(t.notified).toBe(false);
    expect((await db.outboxAll())[0].body).toEqual({ done: true, occurrence: oudeAt });
  });

  it('nogmaals tikken binnen het venster zet de oude stand terug', async () => {
    const oudeAt = '2030-01-07T09:00:00.000Z';
    setup(oudeAt, 'r2');
    await toggleDone(state.open[0]);
    await toggleDone(state.open[0]);
    const t = state.open[0] as any;
    expect(t.remind_at).toBe(oudeAt);
    expect(t.repeat.at).toBe(oudeAt);
    expect(t.notified).toBe(true);
  });

  it('twee keer doorschuiven en dan ongedaan maken zet de laatste stap terug, met occurrence in de outbox', async () => {
    const oudeAt = '2030-01-07T09:00:00.000Z';
    setup(oudeAt, 'r5');
    await toggleDone(state.open[0]);
    // Het venster van 3 s is voorbij: de volgende tik is een nieuwe stap.
    clearTimeout(state.justDone.get('r5')!.timer);
    state.justDone.clear();
    await toggleDone(state.open[0]);
    const t = state.open[0] as any;
    expect(t.repeat.at).toBe('2030-01-21T09:00:00.000Z');
    for (const op of await db.outboxAll()) await db.outboxDelete(op.seq);
    await toggleDone(state.open[0]);
    expect(t.repeat.at).toBe('2030-01-14T09:00:00.000Z');
    expect(t.remind_at).toBe('2030-01-14T09:00:00.000Z');
    expect((await db.outboxAll())[0].body).toEqual({ done: false, occurrence: '2030-01-21T09:00:00.000Z' });
  });

  it('remind_at null wist het ritme, ook als er tegelijk een repeat-regel staat', async () => {
    setup('2030-01-07T09:00:00.000Z', 'r3');
    await update('r3', { remind_at: null, repeat: 'FREQ=DAILY' });
    const t = state.open[0] as any;
    expect(t.repeat).toBeNull();
    expect(t.remind_at).toBeNull();
  });

  it('een lokaal gekozen ritme rekent start en at uit met de engine', async () => {
    const start = '2030-01-07T09:00:00.000Z';
    state.open = [{ id: 'r4', title: 'X', list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, remind_at: start, notified: true, location: null, location_notified: false, repeat: null }] as any;
    await update('r4', { repeat: 'FREQ=WEEKLY;INTERVAL=1' });
    const t = state.open[0] as any;
    expect(t.repeat.rule).toBe('FREQ=WEEKLY');
    expect(t.repeat.start).toBe(start);
    expect(t.repeat.at).toBe(nextOccurrence('FREQ=WEEKLY', start, Date.now() - 1));
    expect(t.remind_at).toBe(t.repeat.at);
    expect(t.notified).toBe(false);
  });
});

describe('store: lokale gegevens per gebruiker', () => {
  it('een andere gebruiker dan in de cache: cache en outbox eerst wissen', async () => {
    await db.kvSet('owner', 'user-a'); await db.kvSet('open', [{ id: 'x' }]); await db.outboxAdd({ type: 'update', id: 'x', body: {} });
    expect(await ensureOwner('user-b')).toBe(true);
    expect(await db.kvGet('open')).toBeUndefined(); expect(await db.outboxAll()).toEqual([]); expect(await db.kvGet('owner')).toBe('user-b');
    expect(await ensureOwner('user-b')).toBe(false);
  });

  it('een cache van vóór de update (zonder eigenaar) wordt gewist', async () => {
    await db.clearAll(); await db.kvSet('open', [{ id: 'y' }]);
    expect(await ensureOwner('user-a')).toBe(true); expect(await db.kvGet('open')).toBeUndefined();
  });

  it('sync tijdens init wacht op de eigenaarscontrole: de outbox van de vorige gebruiker gaat nooit naar de server', async () => {
    await db.clearAll(); await db.kvSet('owner', 'user-y'); await db.kvSet('open', [{ id: 'oud' }]);
    await db.outboxAdd({ type: 'update', id: 'oud', body: { title: 'van y' } });
    const calls: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, opts: any) => {
      calls.push(`${opts?.method ?? 'GET'} ${String(input)}`);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      await Promise.all([init('user-z'), sync()]);
    } finally { spy.mockRestore(); }
    expect(calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
    expect(await db.outboxAll()).toEqual([]);
    expect(state.open).toEqual([]);
    expect(await db.kvGet('owner')).toBe('user-z');
  });
});

describe('store: push-abonnement bij een eigenaarwissel', () => {
  // Stubt navigator.serviceWorker met een abonnement waarvan we unsubscribe tellen.
  const stubPush = () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription = { unsubscribe };
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) },
    });
    return unsubscribe;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('een wissel van user-a naar user-b meldt het push-abonnement van de browser af', async () => {
    const unsubscribe = stubPush();
    await db.clearAll(); await db.kvSet('owner', 'user-a');
    expect(await ensureOwner('user-b')).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('zonder vorige eigenaar (cache van vóór de update) blijft het abonnement staan', async () => {
    const unsubscribe = stubPush();
    await db.clearAll();
    expect(await ensureOwner('user-a')).toBe(true);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('dezelfde eigenaar: het abonnement blijft staan', async () => {
    const unsubscribe = stubPush();
    await db.clearAll(); await db.kvSet('owner', 'user-a');
    expect(await ensureOwner('user-a')).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('een service worker die nooit klaar is, houdt de wissel niet tegen', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { ready: new Promise(() => {}) } });
    await db.clearAll(); await db.kvSet('owner', 'user-a');
    expect(await ensureOwner('user-b')).toBe(true);
    expect(await db.kvGet('owner')).toBe('user-b');
  });
});

describe('store: verversen', () => {
  const fakeServer = (delayMs = 0) => {
    const calls: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, opts: any) => {
      calls.push(`${opts?.method ?? 'GET'} ${String(input)}`);
      await new Promise((r) => setTimeout(r, delayMs));
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { calls, spy };
  };
  afterEach(() => vi.restoreAllMocks());

  it('drie snelle wijzigingen geven hoogstens twee keer GET /api/tasks, en alle PATCHes gaan mee', async () => {
    await db.clearAll(); await ensureOwner('user-load');
    state.open = ['l1', 'l2', 'l3'].map((id, i) => ({ id, title: id, list: 'Inbox', parent_id: null, position: i, done: false, done_at: null })) as any;
    const { calls } = fakeServer(20);
    await Promise.all(['l1', 'l2', 'l3'].map((id) => update(id, { title: id + '!' })));
    expect(calls.filter((c) => c === 'GET /api/tasks')).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(3);
    expect(await db.outboxAll()).toEqual([]);
  });

  it('de verzoeken van één ronde starten tegelijk', async () => {
    const { calls } = fakeServer(30);
    const done = load();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(expect.arrayContaining(['GET /api/tasks', 'GET /api/lists', 'GET /api/shares/incoming']));
    await done;
  });
});

describe('store: gedeelde lijsten', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: id, list: 'Boodschappen', parent_id: null, position: 0, done: false, done_at: null, shared_list: 'L1', claimed_by: null, done_by: null, watch: false, ...extra,
  });
  // Een server die niets terugzet: zo blijft de lokale stand staan en kunnen we hem bekijken.
  const quiet = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 503 }));
  const clear = async () => { for (const op of await db.outboxAll()) await db.outboxDelete(op.seq); };
  afterEach(() => vi.restoreAllMocks());

  it('init kent de ingelogde gebruiker; sharedDone en listInvites komen van de server en sharedDone gaat in de cache', async () => {
    await db.clearAll();
    const shared = { id: 'L1', mine: true, owner: { id: 'me', name: 'Ik' }, members: [], notify_done: false };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url === '/api/tasks?shared_done=1') return json([task('sd1', { done: true, done_at: '2030-01-01T10:00:00.000Z' })]);
      if (url === '/api/shared-lists/incoming') return json([{ id: 'L9', name: 'Klus', from: { name: 'Bob' }, open: 2 }]);
      if (url === '/api/lists') return json([{ name: 'Inbox', open: 0 }, { name: 'Boodschappen', open: 0, id: 'L1', shared }]);
      return json([]);
    });
    await init('me', 'Ik');
    expect(state.sharedDone.map((t: any) => t.id)).toEqual(['sd1']);
    expect(state.listInvites).toEqual([{ id: 'L9', name: 'Klus', from: { name: 'Bob' }, open: 2 }]);
    expect(sharedOf('Boodschappen')).toEqual(shared);
    expect(sharedOf('Inbox')).toBeNull();
    expect((await db.kvGet('sharedDone')).map((t: any) => t.id)).toEqual(['sd1']);
  });

  it('doneInList combineert zonder dubbelen en sorteert op done_at', () => {
    state.justDone.clear();
    state.sharedDone = [
      task('a', { done: true, done_at: '2030-01-01T10:00:00.000Z' }),
      task('b', { done: true, done_at: '2030-01-03T10:00:00.000Z' }),
      task('weer-open', { done: true, done_at: '2030-01-05T10:00:00.000Z' }),
      task('elders', { list: 'Klus', done: true, done_at: '2030-01-06T10:00:00.000Z' }),
    ] as any;
    state.done = [task('b', { done: true, done_at: '2030-01-03T10:00:00.000Z' }), task('c', { done: true, done_at: '2030-01-02T10:00:00.000Z' })] as any;
    state.open = [
      task('d', { done: true, done_at: '2030-01-04T10:00:00.000Z' }), // lokaal afgevinkt
      task('e', { done: true, done_at: '2030-01-07T10:00:00.000Z' }), // net afgevinkt: nog in justDone
      task('sub', { parent_id: 'd', done: true, done_at: '2030-01-04T10:00:00.000Z' }),
      task('weer-open'), // lokaal heropend: niet meer afgevinkt
      task('f'),
    ] as any;
    state.justDone.set('e', { timer: 0, task: state.open[1] } as any);
    expect(doneInList('Boodschappen').map((t: any) => t.id)).toEqual(['d', 'b', 'c', 'a']);
    state.justDone.clear();
  });

  it('claim zet claimed_by lokaal en staat in de outbox', async () => {
    await clear();
    state.open = [task('c1')] as any;
    state.done = [];
    quiet();
    await claim('c1', true);
    expect((state.open[0] as any).claimed_by).toEqual({ id: 'me', name: 'Ik' });
    expect((await db.outboxAll()).map((op: any) => op.body)).toEqual([{ claimed: true }]);
    await claim('c1', false);
    expect((state.open[0] as any).claimed_by).toBeNull();
    await clear();
  });

  it('lokaal afvinken in een gedeelde lijst zet done_by', async () => {
    await clear();
    state.justDone.clear();
    state.open = [task('k1'), task('k1s', { parent_id: 'k1' })] as any;
    state.done = [];
    quiet();
    await toggleDone(state.open[0]);
    expect(state.open.map((t: any) => t.done_by)).toEqual([{ id: 'me', name: 'Ik' }, { id: 'me', name: 'Ik' }]);
    await toggleDone(state.open[0]); // ongedaan maken
    expect(state.open.map((t: any) => t.done_by)).toEqual([null, null]);
    await clear();
  });

  it('toggleDone op andermans taak op naam doet niets', async () => {
    await clear();
    state.justDone.clear();
    const bob = { id: 'bob', name: 'Bob' };
    state.open = [task('o1', { claimed_by: bob }), task('o1s', { parent_id: 'o1' })] as any;
    state.done = [];
    quiet();
    await toggleDone(state.open[0]);
    await toggleDone(state.open[1]); // subtaak: de ouder staat op naam van een ander
    expect(state.open.map((t: any) => t.done)).toEqual([false, false]);
    expect(state.justDone.size).toBe(0);
    expect(await db.outboxAll()).toEqual([]);
  });

  it('een lijst hernoemen past ook sharedDone aan', async () => {
    await clear();
    state.open = [];
    state.done = [];
    state.sharedDone = [task('h1', { done: true, done_at: '2030-01-01T10:00:00.000Z' })] as any;
    quiet();
    await renameList('Boodschappen', 'Winkel');
    expect(state.sharedDone.map((t: any) => t.list)).toEqual(['Winkel']);
    state.sharedDone = [];
    await clear();
  });
});
