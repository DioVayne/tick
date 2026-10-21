import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, callAs, createTask, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const uniq = () => crypto.randomUUID().slice(0, 8);
const HOME = { name: 'Thuis', lat: 52.1, lng: 5.1, radius: 200, trigger: 'exit' };
const WEEKLY = 'FREQ=WEEKLY;BYDAY=SU';

describe('location_notified per persoon op een gedeelde taak', () => {
  let b: User;
  beforeAll(async () => { b = await createUser({ name: `Loes ${uniq()}` }); });

  async function shared(extra: Record<string, unknown> = {}) {
    const t = await createTask({ title: `Plek ${uniq()}`, location: HOME, ...extra });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    return t;
  }
  const asOwner = (id: string, body: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: body });
  const asB = (id: string, body: unknown) => callAs(b.cookie, `/api/tasks/${id}`, { method: 'PATCH', json: body });
  const seenBy = async (cookie: string | null, id: string) => {
    const res = cookie ? await callAs(cookie, '/api/tasks') : await call('/api/tasks');
    return (await json<Task[]>(res)).find((x) => x.id === id)!.location_notified;
  };

  it('een melding bij de eigenaar laat de deelnemer ongemoeid, en andersom', async () => {
    const t = await shared();
    expect((await json<Task>(await asOwner(t.id, { location_notified: true }))).location_notified).toBe(true);
    expect(await seenBy(null, t.id)).toBe(true);
    expect(await seenBy(b.cookie, t.id)).toBe(false);

    const u = await shared();
    expect((await json<Task>(await asB(u.id, { location_notified: true }))).location_notified).toBe(true);
    expect(await seenBy(b.cookie, u.id)).toBe(true);
    expect(await seenBy(null, u.id)).toBe(false);
    const row = await env.DB.prepare('SELECT loc_notified FROM tasks WHERE id = ?').bind(u.id).first<{ loc_notified: number }>();
    expect(row!.loc_notified).toBe(0);
  });

  it('een nieuwe plek zet het voor iedereen terug, ook als een deelnemer hem zet', async () => {
    const t = await shared();
    await asOwner(t.id, { location_notified: true });
    await asB(t.id, { location_notified: true });
    expect((await asB(t.id, { location: { ...HOME, trigger: 'enter' } })).status).toBe(200);
    expect(await seenBy(null, t.id)).toBe(false);
    expect(await seenBy(b.cookie, t.id)).toBe(false);

    await asOwner(t.id, { location_notified: true });
    await asB(t.id, { location_notified: true });
    expect((await asOwner(t.id, { location: HOME })).status).toBe(200);
    expect(await seenBy(null, t.id)).toBe(false);
    expect(await seenBy(b.cookie, t.id)).toBe(false);
  });

  it('plek en location_notified in één PATCH: de melding wint, alleen voor wie hem stuurt', async () => {
    const t = await shared();
    await asOwner(t.id, { location_notified: true });
    expect((await json<Task>(await asB(t.id, { location: HOME, location_notified: true }))).location_notified).toBe(true);
    expect(await seenBy(null, t.id)).toBe(false);
  });

  it('doorschuiven van een herhalende taak zet het voor iedereen terug; ongedaan maken herstelt ieders stand', async () => {
    const t = await shared({ remind_at: '2099-10-18T10:00:00', repeat: WEEKLY });
    await asB(t.id, { location_notified: true });
    expect((await asOwner(t.id, { done: true })).status).toBe(200);
    expect(await seenBy(null, t.id)).toBe(false);
    expect(await seenBy(b.cookie, t.id)).toBe(false);
    expect((await asOwner(t.id, { done: false })).status).toBe(200);
    expect(await seenBy(b.cookie, t.id)).toBe(true);
    expect(await seenBy(null, t.id)).toBe(false);
  });

  it('wie later meedoet begint ongemeld', async () => {
    const t = await createTask({ title: `Later ${uniq()}`, location: HOME });
    await asOwner(t.id, { location_notified: true });
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode: 'shared' } }));
    await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} });
    expect(await seenBy(b.cookie, t.id)).toBe(false);
    expect(await seenBy(null, t.id)).toBe(true);
  });
});
