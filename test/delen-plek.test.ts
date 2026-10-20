import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '../src/index';
import { userSettingStmt } from '../src/prefs';
import type { Payload, Sender } from '../src/push';
import { notifyShareLocation } from '../src/shares';
import { ADMIN_ID, call, callAs, createTask, createUser, json } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const uniq = () => crypto.randomUUID().slice(0, 8);
const HOOK = 'https://hook.invalid/delen-plek';
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const place = (extra: Record<string, unknown> = {}) => ({ name: 'Thuis', lat: 52.1, lng: 5.1, radius: 200, trigger: 'exit', ...extra });

describe('melding als een ander een plek op een gedeelde taak zet', () => {
  let b: User;
  beforeAll(async () => { b = await createUser({ name: 'Bram' }); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', null).run();
  });

  async function shared() {
    const title = `Plek ${uniq()}`;
    const t = await createTask({ title });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    return { id: t.id, title };
  }
  async function hookSpy() {
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', HOOK).run();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    return () => spy.mock.calls.filter(([u]) => String(u) === HOOK).map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Payload);
  }
  const settle = () => new Promise((r) => setTimeout(r, 100));
  const patch = (id: string, location: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: { location } });

  it('gaat naar de anderen, met geo=1 in het adres', async () => {
    const t = await shared();
    const calls: { userId: string; p: Payload }[] = [];
    const send: Sender = async (_env, userId, make) => { calls.push({ userId, p: make('nl') }); return { ok: 0, total: 1 }; };
    await notifyShareLocation(env, await row(t.id), ADMIN_ID, 'Dio', 'nl', send);
    expect(calls.map((x) => x.userId)).toEqual([b.id]);
    expect(calls[0].p).toMatchObject({ title: 'Dio gaf een gedeelde taak een plek', body: t.title, url: `/?task=${t.id}&geo=1`, tag: `share-loc-${t.id}`, actions: [] });
  });

  it('een nieuwe of andere plek meldt; dezelfde plek, een nieuwe naam of wissen niet', async () => {
    const t = await shared();
    const hits = await hookSpy();
    expect((await patch(t.id, place())).status).toBe(200);
    await vi.waitFor(() => expect(hits().length).toBe(1));
    expect(hits()[0]).toMatchObject({ body: t.title, url: `/?task=${t.id}&geo=1` });
    await patch(t.id, place());
    await patch(t.id, place({ name: 'Huis' }));
    await patch(t.id, null);
    await settle();
    expect(hits().length).toBe(1);
    await patch(t.id, place({ trigger: 'enter' }));
    await vi.waitFor(() => expect(hits().length).toBe(2));
  });

  it('wie de plek zet krijgt zelf niets; een taak die niet gedeeld is stuurt niets', async () => {
    const t = await shared();
    const hits = await hookSpy();
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { location: place() } })).status).toBe(200);
    const alone = await createTask({ title: 'alleen' });
    await patch(alone.id, place());
    await settle();
    expect(hits()).toEqual([]);
  });
});
