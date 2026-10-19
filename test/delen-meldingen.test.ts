import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadInstallPrefs, userSettingStmt } from '../src/prefs';
import { runReminders, type Sender } from '../src/push';
import { ADMIN_ID, call, callAs, createTask, createUser, json } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const notified = async (id: string) =>
  (await env.DB.prepare('SELECT notified FROM tasks WHERE id = ?').bind(id).first<{ notified: number }>())!.notified;
const sentRows = async (id: string) =>
  (await env.DB.prepare('SELECT user_id, remind_at FROM reminder_sent WHERE task_id = ? ORDER BY user_id').bind(id).all<{ user_id: string; remind_at: string }>()).results;

/** Sender die per gebruiker een vast resultaat geeft en bijhoudt wie wat kreeg (taak-id en titel in de taal). */
function fakeSender(ok: Record<string, boolean>) {
  const calls: { userId: string; taskId?: string; title: string }[] = [];
  const send: Sender = async (_env, userId, make) => {
    const p = make(userId === ADMIN_ID ? 'en' : 'nl');
    calls.push({ userId, taskId: p.taskId, title: p.title });
    return ok[userId] === undefined ? { ok: 0, total: 0 } : { ok: ok[userId] ? 1 : 0, total: 1 };
  };
  return { send, calls };
}

describe('herinneringen bij een gedeelde taak', () => {
  let b: User;
  beforeAll(async () => { b = await createUser({ name: 'Meldingen B' }); });
  afterEach(() => vi.restoreAllMocks());

  async function shared(remind_at: string) {
    const t = await createTask({ title: `Samen ${crypto.randomUUID().slice(0, 6)}`, remind_at });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: b.email, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    return t;
  }

  it('gaat naar de eigenaar en de deelnemer', async () => {
    const t = await shared(minutesAgo(1));
    const { send, calls } = fakeSender({ [ADMIN_ID]: true, [b.id]: true });
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((x) => x.taskId === t.id).map((x) => x.userId).sort()).toEqual([ADMIN_ID, b.id].sort());
    expect(await notified(t.id)).toBe(1);
    const at = (await env.DB.prepare('SELECT remind_at FROM tasks WHERE id = ?').bind(t.id).first<{ remind_at: string }>())!.remind_at;
    expect((await sentRows(t.id)).map((r) => r.remind_at)).toEqual([at, at]);
  });

  it('bezorgd bij de eigenaar en niet bij de deelnemer: alleen de deelnemer krijgt hem opnieuw', async () => {
    const t = await shared(minutesAgo(1));
    const first = fakeSender({ [ADMIN_ID]: true, [b.id]: false });
    await runReminders(env, await loadInstallPrefs(env), first.send);
    expect(await notified(t.id)).toBe(0);
    const second = fakeSender({ [ADMIN_ID]: true, [b.id]: true });
    await runReminders(env, await loadInstallPrefs(env), second.send);
    expect(second.calls.filter((x) => x.taskId === t.id).map((x) => x.userId)).toEqual([b.id]);
    expect(await notified(t.id)).toBe(1);
  });

  it('na 15 minuten zonder bezorging bij de deelnemer: zijn eigen fallback-webhook, dan klaar', async () => {
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', 'https://hook.invalid/b').run();
    // Eerst de spy: ook de uitnodiging gaat (zonder abonnement) naar de webhook.
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    const t = await shared(minutesAgo(20));
    const { send } = fakeSender({ [ADMIN_ID]: true, [b.id]: false });
    await runReminders(env, await loadInstallPrefs(env), send);
    const hooks = spy.mock.calls.filter(([url]) => String(url) === 'https://hook.invalid/b');
    const bodies = hooks.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ shareId: expect.any(String), body: t.title }), // de uitnodiging
      expect.objectContaining({ taskId: t.id, title: t.title }), // de herinnering
    ]));
    expect(await notified(t.id)).toBe(1);
    await userSettingStmt(env.DB, b.id, 'fallback_webhook', null).run();
  });

  it('snoozen maakt hem weer meldbaar voor iedereen', async () => {
    const t = await shared(minutesAgo(1));
    await runReminders(env, await loadInstallPrefs(env), fakeSender({ [ADMIN_ID]: true, [b.id]: true }).send);
    expect(await notified(t.id)).toBe(1);
    await callAs(b.cookie, `/api/tasks/${t.id}/snooze`, { method: 'POST', json: { minutes: 1 } });
    await env.DB.prepare('UPDATE tasks SET remind_at = ? WHERE id = ?').bind(minutesAgo(1), t.id).run();
    const again = fakeSender({ [ADMIN_ID]: true, [b.id]: true });
    await runReminders(env, await loadInstallPrefs(env), again.send);
    expect(again.calls.filter((x) => x.taskId === t.id).map((x) => x.userId).sort()).toEqual([ADMIN_ID, b.id].sort());
  });

  it('een subtaak met herinnering gaat ook naar de deelnemer', async () => {
    const t = await shared(new Date(Date.now() + 3_600_000).toISOString());
    const k = await json<{ id: string }>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'subtaak met bel', parent_id: t.id, remind_at: minutesAgo(1) } }));
    const { send, calls } = fakeSender({ [ADMIN_ID]: true, [b.id]: true });
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((x) => x.taskId === k.id).map((x) => x.userId).sort()).toEqual([ADMIN_ID, b.id].sort());
  });

  it('stoppen met delen wist ook de bezorgrijen van de subtaken (opnieuw delen meldt ze weer)', async () => {
    for (const leave of ['stop', 'purge'] as const) {
      const t = await createTask({ title: `Weer delen ${leave}`, remind_at: new Date(Date.now() + 3_600_000).toISOString() });
      const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: b.email, mode: 'shared' } }));
      await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} });
      const k = await json<{ id: string }>(await call('/api/tasks', { method: 'POST', json: { title: 'sub', parent_id: t.id, remind_at: minutesAgo(1) } }));
      await runReminders(env, await loadInstallPrefs(env), fakeSender({ [ADMIN_ID]: true, [b.id]: true }).send);
      expect((await sentRows(k.id)).map((r) => r.user_id)).toContain(b.id);
      if (leave === 'stop') await callAs(b.cookie, `/api/shares/${s.id}`, { method: 'DELETE' });
      else {
        await call(`/api/tasks/${t.id}`, { method: 'DELETE' });
        expect((await callAs(b.cookie, `/api/tasks/${t.id}?purge=1`, { method: 'DELETE' })).status).toBe(200);
      }
      expect((await sentRows(k.id)).map((r) => r.user_id)).not.toContain(b.id);
    }
  });

  it('een uitnodiging die nog openstaat krijgt geen herinnering', async () => {
    const t = await createTask({ title: 'Nog niet geaccepteerd', remind_at: minutesAgo(1) });
    await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: b.email, mode: 'shared' } });
    const { send, calls } = fakeSender({ [ADMIN_ID]: true, [b.id]: true });
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((x) => x.taskId === t.id).map((x) => x.userId)).toEqual([ADMIN_ID]);
  });
});
