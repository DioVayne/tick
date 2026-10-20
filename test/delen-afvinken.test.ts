import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '../src/index';
import { userSettingStmt } from '../src/prefs';
import type { Payload, Sender } from '../src/push';
import { notifyShareDone } from '../src/shares';
import { ADMIN_ID, call, callAs, createTask, createUser, json } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const uniq = () => crypto.randomUUID().slice(0, 8);
const HOOK = 'https://hook.invalid/delen-b';
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;

function fakeSender() {
  const calls: { userId: string; p: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, p: make('nl') });
    return { ok: 0, total: 0 };
  };
  return { send, calls };
}

describe('melding bij afvinken van een gedeelde taak', () => {
  let b: User; let c: User;
  beforeAll(async () => {
    b = await createUser({ name: 'Bram' });
    c = await createUser({ name: 'Cor' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', null).run();
  });

  /** Taak van de beheerder, gedeeld met B en C (C heeft nog niet geaccepteerd als `pendingC`). */
  async function shared(pendingC = false) {
    const title = `Samen ${uniq()}`;
    const t = await createTask({ title });
    for (const u of [b, c]) {
      const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: u.id, mode: 'shared' } }));
      if (u === c && pendingC) continue;
      expect((await callAs(u.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    }
    return { id: t.id, title };
  }

  async function hookSpy() {
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', HOOK).run();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    return () => spy.mock.calls.filter(([u]) => String(u) === HOOK).map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Payload);
  }
  async function expectHits(hits: () => Payload[], n: number) {
    await vi.waitFor(() => expect(hits().length).toBeGreaterThanOrEqual(n));
    await new Promise((r) => setTimeout(r, 50));
    expect(hits().length).toBe(n);
  }

  it('gaat naar de anderen, niet naar wie afvinkte; een open uitnodiging telt niet', async () => {
    const t = await shared(true);
    const byB = fakeSender();
    await notifyShareDone(env, await row(t.id), b.id, 'Bram', 'nl', byB.send);
    expect(byB.calls.map((x) => x.userId)).toEqual([ADMIN_ID]);
    expect(byB.calls[0].p).toMatchObject({ title: 'Bram heeft dit afgevinkt ✓', body: t.title, url: `/?task=${t.id}` });
    const byA = fakeSender();
    await notifyShareDone(env, await row(t.id), ADMIN_ID, 'Admin', 'nl', byA.send);
    expect(byA.calls.map((x) => x.userId)).toEqual([b.id]);
  });

  it('afvinken door een ander stuurt één keer; uitvinken niet', async () => {
    const t = await shared();
    const hits = await hookSpy();
    expect((await callAs(c.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
    await expectHits(hits, 1);
    expect(hits()[0]).toMatchObject({ body: t.title, tag: `share-${t.id}` });
    expect(hits()[0].actions).toBeUndefined();
    await callAs(c.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } });
    await callAs(c.cookie, `/api/tasks/${t.id}/reopen`, { method: 'POST' });
    await expectHits(hits, 1);
    await call(`/api/tasks/${t.id}/done`, { method: 'POST' });
    await expectHits(hits, 2);
  });

  it('zelf afvinken stuurt jou niets, en een subtaak stuurt niets', async () => {
    const t = await shared();
    const kid = await createTask({ title: 'kind', parent_id: t.id });
    const hits = await hookSpy();
    await callAs(b.cookie, `/api/tasks/${kid.id}`, { method: 'PATCH', json: { done: true } });
    await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } });
    await new Promise((r) => setTimeout(r, 100));
    expect(hits()).toEqual([]);
  });
});
