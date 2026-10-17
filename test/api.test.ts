import { describe, expect, it } from 'vitest';
import { call, createTask, INBOX, json, openTasks, type Task } from './helpers';

describe('taken', () => {
  it('maakt een taak aan met standaardwaarden', async () => {
    const t = await createTask({ title: '  Boodschappen  ' });
    expect(t).toMatchObject({
      title: 'Boodschappen', description: '', list: 'Inbox', parent_id: null,
      remind_at: null, done: false, notified: false, source: 'app',
    });
  });

  it('weigert een taak zonder titel', async () => {
    const res = await call('/api/tasks', { method: 'POST', json: { title: '   ' } });
    expect(res.status).toBe(400);
  });

  it('zet een nieuwe taak bovenaan', async () => {
    const a = await createTask({ title: 'eerste' });
    const b = await createTask({ title: 'tweede' });
    expect(b.position).toBeLessThan(a.position);
    const ids = (await openTasks()).map((t) => t.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('slaat een reminder zonder zone op als Amsterdamse tijd', async () => {
    const t = await createTask({ title: 'tandarts', remind_at: '2026-11-03T14:30' });
    expect(t.remind_at).toBe('2026-11-03T13:30:00.000Z');
  });

  it('wijzigt velden met PATCH', async () => {
    const t = await createTask({ title: 'oud' });
    const res = await call(`/api/tasks/${t.id}`, {
      method: 'PATCH', json: { title: 'nieuw', description: 'details', list: 'Werk', position: 42 },
    });
    expect(res.status).toBe(200);
    expect(await json<Task>(res)).toMatchObject({ title: 'nieuw', description: 'details', list: 'Werk', position: 42 });
  });

  it('zet notified terug als de reminder verandert', async () => {
    const t = await createTask({ title: 'r', remind_at: '2026-01-01T09:00:00Z' });
    const { env } = await import('cloudflare:workers');
    await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ?').bind(t.id).run();
    const res = await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { remind_at: '2026-02-01T09:00:00Z' } });
    expect(await json<Task>(res)).toMatchObject({ remind_at: '2026-02-01T09:00:00.000Z', notified: false });
  });

  it('geeft 400 als er niets te wijzigen is en 404 voor een onbekende taak', async () => {
    const t = await createTask({ title: 'x' });
    expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: {} })).status).toBe(400);
    expect((await call('/api/tasks/bestaat-niet', { method: 'PATCH', json: { title: 'y' } })).status).toBe(404);
  });

  it('vinkt af en weer open via PATCH', async () => {
    const t = await createTask({ title: 'afvinken' });
    const done = await json<Task>(await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } }));
    expect(done.done).toBe(true);
    expect(done.done_at).not.toBeNull();
    const open = await json<Task>(await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: false } }));
    expect(open).toMatchObject({ done: false, done_at: null });
  });

  it('vinkt af en heropent via /done en /reopen', async () => {
    const t = await createTask({ title: 'widget' });
    expect((await call(`/api/tasks/${t.id}/done`, { method: 'POST' })).status).toBe(200);
    expect((await openTasks()).some((x) => x.id === t.id)).toBe(false);
    const finished = await json<Task[]>(await call('/api/tasks?done=1'));
    expect(finished.find((x) => x.id === t.id)?.done).toBe(true);

    expect((await call(`/api/tasks/${t.id}/reopen`, { method: 'POST' })).status).toBe(200);
    expect((await openTasks()).some((x) => x.id === t.id)).toBe(true);

    expect((await call('/api/tasks/bestaat-niet/done', { method: 'POST' })).status).toBe(404);
    expect((await call('/api/tasks/bestaat-niet/reopen', { method: 'POST' })).status).toBe(404);
  });

  it('pagineert afgeronde taken met limit en offset', async () => {
    for (const title of ['p1', 'p2', 'p3']) {
      const t = await createTask({ title });
      await call(`/api/tasks/${t.id}/done`, { method: 'POST' });
    }
    const page = await json<Task[]>(await call('/api/tasks?done=1&limit=2'));
    expect(page).toHaveLength(2);
    const next = await json<Task[]>(await call('/api/tasks?done=1&limit=2&offset=2'));
    expect(next.map((t) => t.id)).not.toContain(page[0].id);
  });

  it('snoozet een reminder', async () => {
    const t = await createTask({ title: 'snooze', remind_at: '2026-01-01T09:00:00Z' });
    const before = Date.now();
    const res = await json<{ ok: boolean; remind_at: string }>(
      await call(`/api/tasks/${t.id}/snooze`, { method: 'POST', json: { minutes: 30 } }),
    );
    const diff = Date.parse(res.remind_at) - before;
    expect(diff).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(diff).toBeLessThanOrEqual(30 * 60_000 + 5000);
  });

  it('snoozet standaard een uur', async () => {
    const t = await createTask({ title: 'snooze-standaard' });
    const before = Date.now();
    const res = await json<{ remind_at: string }>(await call(`/api/tasks/${t.id}/snooze`, { method: 'POST' }));
    expect(Date.parse(res.remind_at) - before).toBeGreaterThanOrEqual(60 * 60_000 - 1000);
  });

  it('verwijdert een taak met haar subtaken', async () => {
    const parent = await createTask({ title: 'ouder' });
    const child = await createTask({ title: 'kind', parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);
    expect((await call(`/api/tasks/${parent.id}`, { method: 'DELETE' })).status).toBe(200);
    const ids = (await openTasks()).map((t) => t.id);
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(child.id);
  });
});

describe('inbox (automations)', () => {
  it('accepteert de Nederlandse velden en maakt van een kale datum 09:00', async () => {
    const res = await call('/api/inbox', {
      method: 'POST', json: { titel: 'Bel de garage', omschrijving: 'APK', datum: '2026-11-03' }, auth: INBOX,
    });
    expect(res.status).toBe(201);
    expect(await json<Task>(res)).toMatchObject({
      title: 'Bel de garage', description: 'APK', remind_at: '2026-11-03T08:00:00.000Z', source: 'api', list: 'Inbox',
    });
  });

  it('accepteert ook de Engelse velden', async () => {
    const res = await call('/api/inbox', {
      method: 'POST', json: { title: 'Engels', description: 'd', remind_at: '2026-07-01T10:00:00Z', list: 'Werk' }, auth: INBOX,
    });
    expect(await json<Task>(res)).toMatchObject({ title: 'Engels', remind_at: '2026-07-01T10:00:00.000Z', list: 'Werk' });
  });

  it('accepteert de velden title, notes en due', async () => {
    const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'Tandarts', notes: 'controle', due: '2026-11-03' } });
    expect(res.status).toBe(201);
    expect(await json<Task>(res)).toMatchObject({ title: 'Tandarts', description: 'controle', source: 'api', remind_at: '2026-11-03T08:00:00.000Z' });
  });

  it('geeft 400 zonder titel of met een ongeldige datum', async () => {
    expect((await call('/api/inbox', { method: 'POST', json: { omschrijving: 'x' }, auth: INBOX })).status).toBe(400);
    expect((await call('/api/inbox', { method: 'POST', json: { titel: 'x', datum: 'morgen' }, auth: INBOX })).status).toBe(400);
  });

  it('vereist het inbox-token', async () => {
    expect((await call('/api/inbox', { method: 'POST', json: { titel: 'x' }, auth: null })).status).toBe(401);
  });
});

describe('push-abonnementen', () => {
  it('slaat een abonnement op en verwijdert het weer', async () => {
    const endpoint = 'https://push.example/abc';
    const sub = { endpoint, keys: { p256dh: 'p', auth: 'a' } };
    expect((await call('/api/push/subscribe', { method: 'POST', json: sub })).status).toBe(200);
    expect((await call('/api/push/subscribe', { method: 'POST', json: sub })).status).toBe(200); // upsert
    expect((await call('/api/push/subscribe', { method: 'DELETE', json: { endpoint } })).status).toBe(200);
  });

  it('weigert een onvolledig abonnement', async () => {
    const res = await call('/api/push/subscribe', { method: 'POST', json: { endpoint: 'x' } });
    expect(res.status).toBe(400);
  });

  it('geeft de publieke VAPID-sleutel', async () => {
    const res = await json<{ vapidPublicKey: string }>(await call('/api/config'));
    expect(res.vapidPublicKey).toMatch(/^B/);
  });
});
