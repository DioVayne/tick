import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { notifyCopyDone } from '../src/copies';
import type { TaskRow } from '../src/index';
import { userSettingStmt } from '../src/prefs';
import type { Payload, Sender } from '../src/push';
import { ADMIN_ID, call, callAs, createTask, createUser, json } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const uniq = () => crypto.randomUUID().slice(0, 8);
const HOOK = 'https://hook.invalid/kopie-b';
const HOOK_C = 'https://hook.invalid/kopie-c';
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const patch = (id: string, b: unknown, as?: User) => as
  ? callAs(as.cookie, `/api/tasks/${id}`, { method: 'PATCH', json: b })
  : call(`/api/tasks/${id}`, { method: 'PATCH', json: b });

/** Sender die alles bijhoudt en (zonder abonnementen) niets bezorgt. */
function fakeSender() {
  const calls: { userId: string; p: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, p: make('nl') });
    return { ok: 0, total: 0 };
  };
  return { send, calls };
}

describe('melding bij afvinken in een kopiegroep', () => {
  let b: User; let c: User; let d: User;
  beforeAll(async () => {
    b = await createUser({ name: 'Bea' });
    c = await createUser({ name: 'Cas' });
    d = await createUser({ name: 'D' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', null).run();
  });

  async function copyTo(taskId: string, u: User) {
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: taskId, to_user: u.id, mode: 'copy' } }));
    expect((await callAs(u.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    return (await env.DB.prepare('SELECT id FROM tasks WHERE user_id = ? AND copy_group = (SELECT copy_group FROM tasks WHERE id = ?)')
      .bind(u.id, taskId).first<{ id: string }>())!.id;
  }

  /** Groep A (beheerder), B en C; B's exemplaar is gedeeld met D. */
  async function makeGroup(extra: Record<string, unknown> = {}) {
    const title = `Klus ${uniq()}`;
    const a = (await createTask({ title, ...extra })).id;
    const bId = await copyTo(a, b);
    const cId = await copyTo(a, c);
    const s = await json<{ id: string }>(await callAs(b.cookie, '/api/shares', { method: 'POST', json: { task_id: bId, to_user: d.id, mode: 'shared' } }));
    expect((await callAs(d.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    return { title, a, b: bId, c: cId };
  }

  /** Fetch-spy; B heeft een eigen fallback-webhook en geen abonnement. */
  async function hookSpy() {
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', HOOK).run();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    const hits = (url = HOOK) => spy.mock.calls.filter(([u]) => String(u) === url).map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Payload);
    return { spy, hits };
  }
  /** Wacht tot er `n` meldingen bij B's webhook zijn en kijkt dan of er niet meer komen. */
  async function expectHits(hits: (url?: string) => Payload[], n: number) {
    await vi.waitFor(() => expect(hits().length).toBeGreaterThanOrEqual(n));
    await new Promise((r) => setTimeout(r, 50));
    expect(hits().length).toBe(n);
  }

  it('notifyCopyDone gaat naar de andere leden, niet naar het afgevinkte exemplaar', async () => {
    const g = await makeGroup();
    const viaB = fakeSender();
    await notifyCopyDone(env, await row(g.b), 'Bea', 'nl', viaB.send);
    expect(viaB.calls.map((x) => x.userId).sort()).toEqual([ADMIN_ID, c.id].sort());
    const viaA = fakeSender();
    await notifyCopyDone(env, await row(g.a), 'Admin', 'nl', viaA.send);
    expect(viaA.calls.map((x) => x.userId).sort()).toEqual([b.id, c.id, d.id].sort());
  });

  it('titel en tekst', async () => {
    const g = await makeGroup();
    await env.DB.prepare('UPDATE tasks SET title = ? WHERE id = ?').bind('Mijn eigen naam', g.b).run();
    const { send, calls } = fakeSender();
    await notifyCopyDone(env, await row(g.b), 'Bea', 'nl', send);
    const p = calls.find((x) => x.userId === c.id)!.p;
    expect(p.title).toBe('Bea is klaar ✓');
    expect(p.body).toBe(g.title);
    expect(p.url).toBe(`/?task=${g.c}`);
    expect(p.taskId).toBeUndefined();
    expect(p.actions).toEqual([]);
    expect(p.tag).toMatch(/^copy-/);
  });

  it('naam is wie afvinkte', async () => {
    const g = await makeGroup();
    const { send, calls } = fakeSender();
    await notifyCopyDone(env, await row(g.b), 'D', 'nl', send);
    expect(calls.find((x) => x.userId === ADMIN_ID)!.p.title).toBe('D is klaar ✓');
    // Via de route komt de naam van wie ingelogd is: D vinkt B's exemplaar af, C's webhook (standaardtaal en) krijgt hem.
    const { hits } = await hookSpy();
    await userSettingStmt(env.DB, c.id, 'fallback_webhook', HOOK_C).run();
    try {
      expect((await patch(g.b, { done: true }, d)).status).toBe(200);
      await vi.waitFor(() => expect(hits(HOOK_C)).toHaveLength(1));
      expect(hits(HOOK_C)[0].title).toBe('D is done ✓');
      expect(hits()).toEqual([]); // B zit op het afgevinkte exemplaar
    } finally {
      await userSettingStmt(env.DB, c.id, 'fallback_webhook', null).run();
    }
  });

  it('exemplaar in de prullenbak krijgt niets', async () => {
    const g = await makeGroup();
    await callAs(c.cookie, `/api/tasks/${g.c}`, { method: 'DELETE' });
    const { send, calls } = fakeSender();
    await notifyCopyDone(env, await row(g.a), 'Admin', 'nl', send);
    expect(calls.map((x) => x.userId).sort()).toEqual([b.id, d.id].sort());
  });

  it('PATCH done stuurt via de fallback-webhook van de ontvanger', async () => {
    const g = await makeGroup();
    const { spy, hits } = await hookSpy();
    expect((await patch(g.a, { done: true })).status).toBe(200);
    await expectHits(hits, 1);
    expect(hits()[0]).toMatchObject({ body: g.title, url: `/?task=${g.b}`, tag: expect.stringMatching(/^copy-/) });
    expect(hits()[0].title).toMatch(/ ✓$/);
    expect(hits()[0].actions).toBeUndefined();
    // Niets naar een andere webhook (FALLBACK_WEBHOOK geldt alleen voor de beheerder, en die vinkte af).
    expect(spy.mock.calls.every(([u]) => String(u) === HOOK)).toBe(true);
  });

  it('uitvinken stuurt niets, nog een keer done: true ook niet', async () => {
    const g = await makeGroup();
    const { hits } = await hookSpy();
    await patch(g.a, { done: true });
    await expectHits(hits, 1);
    await patch(g.a, { done: true }); // outbox
    await patch(g.a, { done: false });
    await patch(g.a, { done: true }); // weer echt afgevinkt: de enige nieuwe melding
    await expectHits(hits, 2);
  });

  it('POST /api/tasks/:id/done (widget) stuurt ook', async () => {
    const g = await makeGroup();
    const { hits } = await hookSpy();
    expect((await call(`/api/tasks/${g.a}/done`, { method: 'POST' })).status).toBe(200);
    await expectHits(hits, 1);
    await call(`/api/tasks/${g.a}/done`, { method: 'POST' });
    await call(`/api/tasks/${g.a}/reopen`, { method: 'POST' });
    await call(`/api/tasks/${g.a}/done`, { method: 'POST' });
    await expectHits(hits, 2);
  });

  it('herhalend exemplaar: doorschuiven stuurt, ongedaan maken niet', async () => {
    const g = await makeGroup({ remind_at: '2099-10-18T10:00:00', repeat: 'FREQ=WEEKLY' });
    const { hits } = await hookSpy();
    const at = (await row(g.a)).repeat_at;
    await patch(g.a, { done: true, occurrence: at });
    await expectHits(hits, 1);
    await patch(g.a, { done: true, occurrence: at }); // outbox: zelfde keer, schuift niet nog eens door
    await patch(g.a, { done: false });
    expect((await row(g.a)).repeat_at).toBe(at);
    await patch(g.a, { done: true });
    await expectHits(hits, 2);
  });

  it('subtaak afvinken stuurt niets; taak zonder groep ook niet', async () => {
    const g = await makeGroup();
    const kid = await createTask({ title: 'kind', parent_id: g.a });
    const los = await createTask({ title: `Los ${uniq()}` });
    const { spy, hits } = await hookSpy();
    await patch(kid.id, { done: true });
    await patch(los.id, { done: true });
    await call(`/api/tasks/${los.id}/reopen`, { method: 'POST' });
    await call(`/api/tasks/${los.id}/done`, { method: 'POST' });
    await patch(g.a, { done: true }); // markering: de enige melding
    await expectHits(hits, 1);
    expect(spy.mock.calls.length).toBe(1);
  });
});
