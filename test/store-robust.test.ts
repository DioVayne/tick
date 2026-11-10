import { afterEach, describe, expect, it, vi } from 'vitest';

// db.js met schakelaars: zo kunnen we IndexedDB laten falen (verbinding kwijt, eigenaarscontrole mislukt).
const fail = vi.hoisted(() => ({ outboxAll: false, kvGet: false }));
vi.mock('../public/db.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../public/db.js')>();
  return {
    ...real,
    outboxAll: async () => { if (fail.outboxAll) throw new Error('connection is closing'); return real.outboxAll(); },
    kvGet: async (key: string) => { if (fail.kvGet) throw new Error('idb kapot'); return real.kvGet(key); },
  };
});

import * as db from '../public/db.js';
import { init, load, on, state, toggleDone, update } from '../public/store.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, remind_at: null, repeat: null, ...extra,
});
const errors: string[] = [];
on('error', (msg: string) => { errors.push(msg); });

afterEach(() => {
  vi.restoreAllMocks();
  fail.outboxAll = false;
  fail.kvGet = false;
  errors.length = 0;
});

describe('store: IndexedDB valt weg', () => {
  it('outboxAll faalt tijdens het laden: de verse serverdata komt toch in beeld', async () => {
    await db.clearAll();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([]));
    await init('robust-1');
    state.open = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => (String(input) === '/api/tasks' ? json([task('vers')]) : json([])));
    fail.outboxAll = true;
    await load();
    expect(state.open.map((t: any) => t.id)).toEqual(['vers']);
  });

  it('mislukte eigenaarscontrole: een wijziging zegt dat ze niet bewaard wordt in plaats van stil te verdwijnen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([task('a1')]));
    fail.kvGet = true; // ensureOwner leest de eigenaar uit kv: die faalt
    await init('robust-2');
    expect(state.open.map((t: any) => t.id)).toEqual(['a1']);
    errors.length = 0;
    await update('a1', { title: 'nieuw' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/idb kapot/);
  });
});

describe('store: afvinken ongedaan maken na een verversing', () => {
  it('de taak die intussen uit de open lijst verdween, komt terug als open taak', async () => {
    await db.clearAll();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([]));
    await init('robust-3');
    // Een server die niets terugzet (503): de lokale stand blijft staan en is te bekijken.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 503 }));
    state.justDone.clear();
    state.open = [task('u1')] as any;
    state.done = [];
    const t = state.open[0] as any;
    await toggleDone(t);
    expect(t.done).toBe(true);
    // Verversing: de server geeft de afgevinkte taak niet meer bij de open taken; Afgerond is niet geladen.
    state.open = [];
    await toggleDone(t);
    const back = state.open.find((x: any) => x.id === 'u1') as any;
    expect(back).toBeTruthy();
    expect(back.done).toBe(false);
    expect(state.justDone.has('u1')).toBe(false);
    for (const op of await db.outboxAll()) await db.outboxDelete(op.seq);
  });
});
