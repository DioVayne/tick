import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// De Workers-runtime heeft geen IndexedDB: db.js valt terug op geheugen.
import * as db from '../public/db.js';
import { SET_ASIDE_AFTER_MS, SET_ASIDE_ATTEMPTS, init, on, state, sync } from '../public/store.js';

const ok = (body: unknown = []) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, error = 'kapot') => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, remind_at: null, repeat: null, ...extra,
});
const errors: string[] = [];
on('error', (msg: string) => { errors.push(msg); });

/** Nep-server: `answer(method, path)` geeft een Response, of gooit (geen netwerk). Houdt de verzoeken bij. */
const serve = (answer: (method: string, path: string, body: any) => Response) => {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, opts: any) => {
    const method = opts?.method ?? 'GET';
    calls.push(`${method} ${String(input)}`);
    return answer(method, String(input), opts?.body ? JSON.parse(opts.body) : null);
  });
  return calls;
};
let clock = Date.parse('2026-11-10T12:00:00Z');
const tick = (ms: number) => { clock += ms; };
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  serve(() => ok([]));
  await db.clearAll();
  await init(`opzij-${Math.random()}`);
  errors.length = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const op of await db.outboxAll()) await db.outboxDelete(op.seq);
});

describe('outbox: een wijziging die steeds een 5xx krijgt', () => {
  it('telt pogingen; pas na 5 keer én 10 minuten gaat hij opzij, met een melding met de taaknaam, en de rest gaat door', async () => {
    state.open = [task('a', { title: 'Melk kopen' }), task('b')] as any;
    await db.outboxAdd({ type: 'update', id: 'a', body: { title: 'Melk kopen!' }, at: '' });
    await db.outboxAdd({ type: 'update', id: 'b', body: { title: 'b!' }, at: '' });
    const calls = serve((m, p) => (m === 'PATCH' && p === '/api/tasks/a' ? fail(503) : ok([])));

    for (let i = 1; i < SET_ASIDE_ATTEMPTS; i++) {
      expect(await sync()).toBe(false);
      const [head] = await db.outboxAll();
      expect(head).toMatchObject({ id: 'a', attempts: i, firstFailAt: Date.parse('2026-11-10T12:00:00Z') });
      tick(60_000);
    }
    // 5e poging, maar de eerste fout is pas 4 minuten oud: blijft staan.
    expect(await sync()).toBe(false);
    expect((await db.outboxAll()).map((o: any) => o.id)).toEqual(['a', 'b']);
    expect(errors).toEqual([]);
    expect(calls.some((c) => c === 'PATCH /api/tasks/b')).toBe(false);

    tick(SET_ASIDE_AFTER_MS);
    expect(await sync()).toBe(true);
    expect(await db.outboxAll()).toEqual([]);
    expect(calls.filter((c) => c === 'PATCH /api/tasks/b')).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Melk kopen');
    await settle();
    expect(calls).toContain('GET /api/tasks'); // daarna de stand van de server ophalen
  });

  it('offline of een netwerkfout telt niet als poging', async () => {
    state.open = [task('c')] as any;
    await db.outboxAdd({ type: 'update', id: 'c', body: { title: 'c!' }, at: '' });
    serve(() => { throw new TypeError('Failed to fetch'); });
    for (let i = 0; i < SET_ASIDE_ATTEMPTS + 2; i++) { expect(await sync()).toBe(false); tick(SET_ASIDE_AFTER_MS); }
    const [op] = await db.outboxAll();
    expect(op.attempts).toBeUndefined();
    expect(state.offline).toBe(true);
    expect(errors).toEqual([]);
  });

  it('een 401 telt ook niet', async () => {
    await db.outboxAdd({ type: 'update', id: 'd', body: { title: 'd!' }, at: '' });
    vi.stubGlobal('location', { href: '' });
    serve(() => fail(401));
    for (let i = 0; i < SET_ASIDE_ATTEMPTS + 1; i++) { await sync(); tick(SET_ASIDE_AFTER_MS); }
    expect((await db.outboxAll())[0].attempts).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('een opzijgezette nieuwe taak: wijzigingen en subtaken die erop volgen, vervallen zonder eigen melding', async () => {
    await db.outboxAdd({ type: 'create', task: task('n1', { title: 'Nieuw' }), body: { id: 'n1', title: 'Nieuw' }, at: '' });
    await db.outboxAdd({ type: 'update', id: 'n1', body: { title: 'Nieuwer' }, at: '' });
    await db.outboxAdd({ type: 'create', task: task('n2', { parent_id: 'n1' }), body: { id: 'n2', title: 'Sub', parent_id: 'n1' }, at: '' });
    await db.outboxAdd({ type: 'update', id: 'n2', body: { title: 'Sub!' }, at: '' });
    await db.outboxAdd({ type: 'update', id: 'z', body: { title: 'anders' }, at: '' });
    const calls = serve((m, p, body) => {
      if (m === 'POST' && p === '/api/tasks') return body?.parent_id ? fail(400, 'parent missing') : fail(500);
      if (m === 'PATCH' && (p === '/api/tasks/n1' || p === '/api/tasks/n2')) return fail(404);
      return ok([]);
    });
    for (let i = 0; i < SET_ASIDE_ATTEMPTS; i++) { await sync(); tick(3 * 60_000); }
    expect(await db.outboxAll()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Nieuw');
    expect(calls).toContain('PATCH /api/tasks/z');
  });

  it('een geweigerde nieuwe taak (4xx): één melding, de subtaak eronder vervalt stil', async () => {
    await db.outboxAdd({ type: 'create', task: task('r1'), body: { id: 'r1', title: 'Te lang' }, at: '' });
    await db.outboxAdd({ type: 'create', task: task('r2', { parent_id: 'r1' }), body: { id: 'r2', title: 'Sub', parent_id: 'r1' }, at: '' });
    serve((m) => (m === 'POST' ? fail(400, 'nee') : ok([])));
    expect(await sync()).toBe(true);
    expect(errors).toHaveLength(1);
    expect(await db.outboxAll()).toEqual([]);
  });
});

describe('db.js: verbinding met IndexedDB kwijt', () => {
  it('na een InvalidStateError opent de volgende aanroep een nieuwe verbinding', async () => {
    vi.resetModules();
    let opens = 0;
    const store = new Map<string, unknown>();
    const goodDb = {
      transaction: () => {
        const t: any = {};
        t.objectStore = () => ({
          get: (k: string) => { const req: any = { result: store.get(k) }; setTimeout(() => t.oncomplete?.()); return req; },
          put: (v: unknown, k: string) => { store.set(k, v); const req: any = { result: k }; setTimeout(() => t.oncomplete?.()); return req; },
        });
        return t;
      },
    };
    const closedDb = { transaction: () => { throw Object.assign(new Error('The database connection is closing.'), { name: 'InvalidStateError' }); } };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: any = {};
        req.result = opens++ === 0 ? closedDb : goodDb;
        setTimeout(() => req.onsuccess?.());
        return req;
      },
    });
    try {
      const fresh = await import('../public/db.js');
      await expect(fresh.kvGet('x')).rejects.toMatchObject({ name: 'InvalidStateError' });
      await fresh.kvSet('x', 1);
      expect(await fresh.kvGet('x')).toBe(1);
      expect(opens).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
