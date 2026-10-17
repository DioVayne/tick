import { afterEach, describe, expect, it, vi } from 'vitest';
// De Workers-runtime heeft geen IndexedDB: db.js valt dan terug op geheugen, en dat lezen we hier uit.
import { nextOccurrence } from '../public/repeat.js';
import * as db from '../public/db.js';
import { deleteList, ensureOwner, init, renameList, state, sync, toggleDone, update } from '../public/store.js';

describe('store: lijst-ops', () => {
  it('een lijst die alleen in deze sessie bestaat, hernoemen of verwijderen geeft geen outbox-op', async () => {
    state.extraLists = ['Nieuw'];
    await renameList('Nieuw', 'Anders');
    expect(state.extraLists).toEqual(['Anders']);
    await deleteList('Anders', 'inbox');
    expect(state.extraLists).toEqual([]);
    expect(await db.outboxAll()).toHaveLength(0);
    expect(state.pending).toBe(0);
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
