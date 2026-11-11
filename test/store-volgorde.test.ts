import { afterEach, describe, expect, it, vi } from 'vitest';
// De Workers-runtime heeft geen IndexedDB: db.js valt terug op geheugen.
import * as db from '../public/db.js';
import { state, sync, toggleDone } from '../public/store.js';

const clear = async () => { for (const op of await db.outboxAll()) await db.outboxDelete(op.seq); };
const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('store: outbox over tabbladen heen', () => {
  it('een PATCH uit de outbox draagt x-tick-op met apparaat en volgnummer; aanmaken niet', async () => {
    await clear();
    await db.outboxAdd({ type: 'create', task: { id: 'n1' }, body: { id: 'n1', title: 'nieuw' } });
    await db.outboxAdd({ type: 'update', id: 'n1', body: { title: 'anders' } });
    const ops = await db.outboxAll();
    const sent: { method: string; op: string | null }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, opts: any) => {
      sent.push({ method: opts.method, op: new Headers(opts.headers).get('x-tick-op') });
      return ok();
    });
    expect(await sync()).toBe(true);
    const device = await db.kvGet('device');
    expect(device).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent).toEqual([{ method: 'POST', op: null }, { method: 'PATCH', op: `${device}:${ops[1].seq}` }]);
  });

  it('versturen gebeurt onder het slot tick-outbox, zodat twee tabbladen niet tegelijk dezelfde outbox afspelen', async () => {
    await clear();
    await db.outboxAdd({ type: 'update', id: 'x1', body: { title: 'a' } });
    const names: string[] = [];
    let held = false;
    let overlap = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, fn: () => Promise<unknown>) => {
          names.push(name);
          if (held) overlap = true;
          held = true;
          try { return await fn(); } finally { held = false; }
        },
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok());
    expect(await sync()).toBe(true);
    expect(names).toEqual(['tick-outbox']);
    expect(overlap).toBe(false);
    expect(await db.outboxAll()).toEqual([]);
  });
});

describe('store: ongedaan maken van een herhalende taak', () => {
  it('ongedaan maken noemt de afvinkactie, niet een lokaal voorspelde datum', async () => {
    await clear();
    const at = '2030-01-07T09:00:00.000Z';
    state.open = [{ id: 'u1', title: 'Plant', list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, remind_at: at, notified: true, location: null, location_notified: false, repeat: { rule: 'FREQ=WEEKLY', start: at, at } }] as any;
    state.justDone.clear();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await toggleDone(state.open[0]);
    await toggleDone(state.open[0]);
    const [done, undo] = (await db.outboxAll()).map((op: { body: any }) => op.body);
    expect(done.action).toEqual(expect.any(String));
    expect(undo).toEqual({ done: false, undo: done.action });
    expect((state.open[0] as any).repeat.at).toBe(at);
    await clear();
  });
});
