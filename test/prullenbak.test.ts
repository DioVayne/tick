import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { loadInstallPrefs } from '../src/prefs';
import { runReminders } from '../src/push';
import { purgeTrash } from '../src/trash';
import { call, callAs, createTask, json, openTasks, session, type Task } from './helpers';

type Trashed = Task & { deleted_at: string };
const trash = async () => json<Trashed[]>(await call('/api/tasks?deleted=1'));
const del = (id: string, purge = false) => call(`/api/tasks/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' });
const restore = (id: string) => call(`/api/tasks/${id}/restore`, { method: 'POST', json: {} });
const row = (id: string) => env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Record<string, unknown>>();

describe('prullenbak', () => {
  it('verwijderen zet de taak en subtaken in de prullenbak', async () => {
    const p = await createTask({ title: 'Prul-ouder', list: 'Prullijst' });
    const k = await createTask({ title: 'Prul-kind', parent_id: p.id });
    expect((await del(p.id)).status).toBe(200);
    const ids = (await openTasks()).map((t) => t.id);
    expect(ids).not.toContain(p.id);
    expect(ids).not.toContain(k.id);
    expect((await json<Task[]>(await call('/api/tasks?q=Prul-'))).length).toBe(0);
    const lists = await json<{ name: string }[]>(await call('/api/lists'));
    expect(lists.map((l) => l.name)).not.toContain('Prullijst');
    const t = await trash();
    expect(t.find((x) => x.id === p.id)?.deleted_at).toEqual(expect.any(String));
    expect(t.find((x) => x.id === k.id)).toBeUndefined();
    expect((await row(k.id))!.deleted_at).toBe((await row(p.id))!.deleted_at);
  });

  it('een afgeronde taak in de prullenbak staat niet in Afgerond', async () => {
    const d = await createTask({ title: 'Prul-klaar' });
    await call(`/api/tasks/${d.id}/done`, { method: 'POST', json: {} });
    await del(d.id);
    expect((await json<Task[]>(await call('/api/tasks?done=1'))).map((t) => t.id)).not.toContain(d.id);
  });

  it('terugzetten zet ouder en subtaken terug', async () => {
    const p = await createTask({ title: 'Terug-ouder' });
    const k = await createTask({ title: 'Terug-kind', parent_id: p.id });
    await del(p.id);
    expect((await restore(p.id)).status).toBe(200);
    const ids = (await openTasks()).map((t) => t.id);
    expect(ids).toContain(p.id);
    expect(ids).toContain(k.id);
  });

  it('een subtaak terugzetten zet de ouder ook terug', async () => {
    const p = await createTask({ title: 'Los-ouder' });
    const k = await createTask({ title: 'Los-kind', parent_id: p.id });
    await del(k.id);
    await del(p.id);
    expect((await trash()).map((t) => t.id)).toEqual(expect.arrayContaining([p.id, k.id]));
    expect((await restore(k.id)).status).toBe(200);
    const ids = (await openTasks()).map((t) => t.id);
    expect(ids).toContain(p.id);
    expect(ids).toContain(k.id);
  });

  it('terugzetten met een verlopen herinnering telt als gemeld', async () => {
    const t = await createTask({ title: 'Verlopen', remind_at: new Date(Date.now() + 3_600_000).toISOString() });
    await del(t.id);
    await env.DB.prepare('UPDATE tasks SET remind_at = ? WHERE id = ?').bind(new Date(Date.now() - 60_000).toISOString(), t.id).run();
    await restore(t.id);
    expect((await row(t.id))!.notified).toBe(1);
  });

  it('op een taak in de prullenbak geven wijzigen, afvinken, snoozen en opnieuw verwijderen een 404', async () => {
    const t = await createTask({ title: 'Weg' });
    await del(t.id);
    for (const [m, p, body] of [['PATCH', `/api/tasks/${t.id}`, { title: 'x' }], ['POST', `/api/tasks/${t.id}/done`, {}],
      ['POST', `/api/tasks/${t.id}/snooze`, { minutes: 5 }], ['DELETE', `/api/tasks/${t.id}`, undefined]] as const)
      expect((await call(p, { method: m, json: body })).status).toBe(404);
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'kind', parent_id: t.id } })).status).toBe(400);
    expect((await restore(crypto.randomUUID())).status).toBe(404);
  });

  it('een subtaak in de prullenbak wordt niet mee afgevinkt of heropend met haar ouder', async () => {
    const p = await createTask({ title: 'Ouder met weggegooide subtaak' });
    const k = await createTask({ title: 'weggegooid', parent_id: p.id });
    await del(k.id);
    await call(`/api/tasks/${p.id}/done`, { method: 'POST', json: {} });
    expect((await row(k.id))!.done).toBe(0);
    // en na terugzetten is hij gewoon nog open
    await restore(k.id);
    expect((await row(k.id))!).toMatchObject({ done: 0, deleted_at: null });
  });

  it('definitief verwijderen wist echt, alleen vanuit de prullenbak', async () => {
    const t = await createTask({ title: 'Definitief' });
    const k = await createTask({ title: 'Definitief-kind', parent_id: t.id });
    expect((await del(t.id, true)).status).toBe(404);
    await del(t.id);
    expect((await del(t.id, true)).status).toBe(200);
    expect(await row(t.id)).toBeNull();
    expect(await row(k.id)).toBeNull();
  });

  it('prullenbak legen wist je eigen verwijderde taken', async () => {
    const t = await createTask({ title: 'Legen' });
    const open = await createTask({ title: 'Blijft' });
    await del(t.id);
    const res = await call('/api/trash/empty', { method: 'POST', json: {} });
    expect((await json<{ deleted: number }>(res)).deleted).toBeGreaterThanOrEqual(1);
    expect(await row(t.id)).toBeNull();
    expect(await row(open.id)).not.toBeNull();
    expect(await trash()).toEqual([]);
  });

  it('purgeTrash wist na 30 dagen', async () => {
    const oud = await createTask({ title: 'Oud' });
    const jong = await createTask({ title: 'Jong' });
    await del(oud.id);
    await del(jong.id);
    const day = 86_400_000;
    await env.DB.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').bind(new Date(Date.now() - 31 * day).toISOString(), oud.id).run();
    await env.DB.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').bind(new Date(Date.now() - 29 * day).toISOString(), jong.id).run();
    await purgeTrash(env.DB, Date.now());
    expect(await row(oud.id)).toBeNull();
    expect(await row(jong.id)).not.toBeNull();
  });

  it('een lijst verwijderen met tasks: delete zet de taken in de prullenbak', async () => {
    const t = await createTask({ title: 'In lijst', list: 'Weglijst' });
    const res = await call('/api/lists/delete', { method: 'POST', json: { name: 'Weglijst', tasks: 'delete' } });
    expect(await json(res)).toEqual({ deleted: 1 });
    expect((await trash()).map((x) => x.id)).toContain(t.id);
  });

  it('geen herinnering voor een taak in de prullenbak', async () => {
    const t = await createTask({ title: 'Stil', remind_at: new Date(Date.now() - 20 * 60_000).toISOString() });
    await del(t.id);
    await runReminders(env, await loadInstallPrefs(env));
    expect((await row(t.id))!.notified).toBe(0);
  });

  it('export laat verwijderde taken weg; import zet een verwijderde taak terug', async () => {
    const t = await createTask({ title: 'Back-up' });
    await del(t.id);
    const r = (await row(t.id))!;
    const backup = { app: 'tick', version: 1, tasks: [{ ...r, deleted_at: undefined, user_id: undefined }], places: [] };
    // export en import zijn alleen met een sessie
    const cookie = await session();
    const after = await json<{ tasks: { id: string }[] }>(await callAs(cookie, '/api/export'));
    expect(after.tasks.map((x) => x.id)).not.toContain(t.id);
    expect((await callAs(cookie, '/api/import/backup', { method: 'POST', json: backup })).status).toBe(200);
    expect((await row(t.id))!.deleted_at).toBeNull();
  });
});
