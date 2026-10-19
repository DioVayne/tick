import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { loadInstallPrefs, userSettingStmt } from '../src/prefs';
import { localNow, MAX_OVERDUE, runOverdue } from '../src/overdue';
import { overduePayload, type Payload, type Sender } from '../src/push';
import { localToUtcIso } from '../src/time';
import { callAs, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

// Vaste klok in de testzone (Europe/Amsterdam, zomertijd): 15 juni 2030, 10:00 lokaal.
const NOW = Date.parse('2030-06-15T08:00:00Z');
const YESTERDAY = '2030-06-14T10:00:00Z';
const EARLIER_TODAY = '2030-06-15T05:00:00Z'; // 07:00 lokaal

/** Sender die bijhoudt wie welke melding kreeg (in het Nederlands) en altijd bezorgt. */
function fakeSender() {
  const calls: { userId: string; payload: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, payload: make('nl') });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}

const task = async (u: User, remind_at: string, extra: Record<string, unknown> = {}) =>
  json<Task>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: `Taak ${crypto.randomUUID().slice(0, 6)}`, remind_at, ...extra } }));

async function run(now = NOW) {
  const { send, calls } = fakeSender();
  await runOverdue(env, await loadInstallPrefs(env), send, now);
  return calls;
}
const idsFor = (calls: Awaited<ReturnType<typeof run>>, u: User) => calls.filter((c) => c.userId === u.id).map((c) => c.payload.taskId);

describe('dagelijkse melding van verlopen taken', () => {
  it('meldt een taak van gisteren met Klaar en Morgen, en maar één keer per dag', async () => {
    const u = await createUser();
    const t = await task(u, YESTERDAY);
    const calls = await run();
    const mine = calls.filter((c) => c.userId === u.id);
    expect(mine.map((c) => c.payload.taskId)).toEqual([t.id]);
    expect(mine[0].payload.title).toBe(`Verlopen: ${t.title}`);
    expect(mine[0].payload.actions).toEqual([{ action: 'done', title: 'Klaar' }, { action: 'tomorrow', title: 'Morgen' }]);
    expect(idsFor(await run(NOW + 60_000), u)).toEqual([]);
    // De dag erna weer.
    expect(idsFor(await run(NOW + 86_400_000), u)).toEqual([t.id]);
  });

  it('een taak van eerder vandaag telt nog niet als verlopen', async () => {
    const u = await createUser();
    await task(u, EARLIER_TODAY);
    expect(idsFor(await run(), u)).toEqual([]);
  });

  it('niet vóór de ingestelde tijd, wel erna; uit = niets', async () => {
    const u = await createUser();
    const t = await task(u, YESTERDAY);
    expect(idsFor(await run(Date.parse('2030-06-15T06:30:00Z')), u)).toEqual([]); // 08:30 lokaal
    await userSettingStmt(env.DB, u.id, 'overdue_time', '07:30').run();
    expect(idsFor(await run(Date.parse('2030-06-15T05:45:00Z')), u)).toEqual([t.id]); // 07:45 lokaal

    const v = await createUser();
    await task(v, YESTERDAY);
    await userSettingStmt(env.DB, v.id, 'overdue_time', 'off').run();
    expect(idsFor(await run(), v)).toEqual([]);
  });

  it('afgeronde taken en taken in de prullenbak niet', async () => {
    const u = await createUser();
    const done = await task(u, YESTERDAY);
    await callAs(u.cookie, `/api/tasks/${done.id}`, { method: 'PATCH', json: { done: true } });
    const gone = await task(u, YESTERDAY);
    await callAs(u.cookie, `/api/tasks/${gone.id}`, { method: 'DELETE' });
    expect(idsFor(await run(), u)).toEqual([]);
  });

  it('een gedeelde taak gaat ook naar de deelnemer', async () => {
    const a = await createUser();
    const b = await createUser();
    const t = await task(a, YESTERDAY);
    const s = await json<{ id: string }>(await callAs(a.cookie, '/api/shares', { method: 'POST', json: { task_id: t.id, to: b.email, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const calls = await run();
    expect(idsFor(calls, a)).toEqual([t.id]);
    expect(idsFor(calls, b)).toEqual([t.id]);
  });

  it(`hoogstens ${MAX_OVERDUE} meldingen, de oudste eerst`, async () => {
    const u = await createUser();
    const made: Task[] = [];
    for (let i = 0; i < MAX_OVERDUE + 2; i++) made.push(await task(u, `2030-06-${String(1 + i).padStart(2, '0')}T10:00:00Z`));
    expect(idsFor(await run(), u)).toEqual(made.slice(0, MAX_OVERDUE).map((t) => t.id));
  });

  it('de melding van een herhalende taak draagt de keer mee', () => {
    const p = overduePayload({ id: 'x', title: 'T', description: '', repeat_at: YESTERDAY }, 'en');
    expect(p).toMatchObject({ title: 'Overdue: T', occurrence: YESTERDAY, tag: 'overdue-x' });
  });
});

describe('POST /api/tasks/:id/tomorrow', () => {
  it('zet de taak op morgen op de standaardtijd, in de zone van de eigenaar', async () => {
    const u = await createUser();
    const t = await task(u, YESTERDAY);
    const res = await callAs(u.cookie, `/api/tasks/${t.id}/tomorrow`, { method: 'POST', json: {} });
    expect(res.status).toBe(200);
    const z = { timeZone: 'Europe/Amsterdam', reminderTime: '09:00' };
    const want = localToUtcIso(localNow(z, Date.now()).tomorrow, z);
    expect((await json<{ remind_at: string }>(res)).remind_at).toBe(want);
    const row = await env.DB.prepare('SELECT remind_at, notified FROM tasks WHERE id = ?').bind(t.id).first<{ remind_at: string; notified: number }>();
    expect(row).toEqual({ remind_at: want, notified: 0 });
  });

  it('een herhalende taak houdt haar ritme', async () => {
    const u = await createUser();
    const t = await task(u, YESTERDAY, { repeat: 'FREQ=DAILY' });
    await callAs(u.cookie, `/api/tasks/${t.id}/tomorrow`, { method: 'POST', json: {} });
    const row = await env.DB.prepare('SELECT repeat_rule FROM tasks WHERE id = ?').bind(t.id).first<{ repeat_rule: string | null }>();
    expect(row!.repeat_rule).not.toBeNull();
  });

  it('een taak van een ander: 404', async () => {
    const a = await createUser();
    const b = await createUser();
    const t = await task(a, YESTERDAY);
    expect((await callAs(b.cookie, `/api/tasks/${t.id}/tomorrow`, { method: 'POST', json: {} })).status).toBe(404);
  });
});

describe('instelling overdueTime', () => {
  it('standaard 09:00, te wijzigen, uit te zetten, en ongeldig geeft 400', async () => {
    const u = await createUser();
    const get = async () => (await json<{ overdueTime: string | null }>(await callAs(u.cookie, '/api/settings'))).overdueTime;
    const patch = (overdueTime: unknown) => callAs(u.cookie, '/api/settings', { method: 'PATCH', json: { overdueTime } });
    expect(await get()).toBe('09:00');
    expect((await patch('07:15')).status).toBe(200);
    expect(await get()).toBe('07:15');
    expect((await patch(null)).status).toBe(200);
    expect(await get()).toBeNull();
    expect((await patch('25:00')).status).toBe(400);
    expect((await patch(9)).status).toBe(400);
  });
});
