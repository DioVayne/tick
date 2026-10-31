import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { call, createTask, INBOX, json, openTasks, type Task } from './helpers';

const patch = (id: string, body: unknown) => call(`/api/tasks/${id}`, { method: 'PATCH', json: body });
const row = (id: string) => env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<{ title: string; done: number; done_at: string | null; list: string; position: number }>();

describe('invoercontrole', () => {
  it('weigert een lege titel bij PATCH', async () => {
    const t = await createTask({ title: 'blijft' });
    expect((await patch(t.id, { title: '   ' })).status).toBe(400);
    expect((await row(t.id))!).toMatchObject({ title: 'blijft' });
  });

  it('begrenst de lengte van titel en omschrijving', async () => {
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'x'.repeat(501) } })).status).toBe(400);
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'ok', description: 'x'.repeat(10_001) } })).status).toBe(400);
    const t = await createTask({ title: 'x'.repeat(500), description: 'y'.repeat(10_000) });
    expect((await patch(t.id, { title: 'x'.repeat(501) })).status).toBe(400);
    expect((await patch(t.id, { description: 'y'.repeat(10_001) })).status).toBe(400);
    expect((await call('/api/inbox', { method: 'POST', json: { titel: 'x'.repeat(501) }, auth: INBOX })).status).toBe(400);
  });

  it('weigert een ongeldige positie', async () => {
    const t = await createTask({ title: 'pos' });
    expect((await patch(t.id, { position: 'abc' })).status).toBe(400);
  });

  it('geeft 400 bij ongeldige JSON', async () => {
    const res = await call('/api/tasks', { method: 'POST', body: '{kapot', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
  });
});

describe('parent_id', () => {
  it('moet bestaan', async () => {
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'wees', parent_id: 'bestaat-niet' } })).status).toBe(400);
    const t = await createTask({ title: 'los' });
    expect((await patch(t.id, { parent_id: 'bestaat-niet' })).status).toBe(400);
  });

  it('mag niet de taak zelf zijn', async () => {
    const t = await createTask({ title: 'zelf' });
    expect((await patch(t.id, { parent_id: t.id })).status).toBe(400);
  });

  it('blijft één niveau diep', async () => {
    const parent = await createTask({ title: 'ouder' });
    const child = await createTask({ title: 'kind', parent_id: parent.id });
    // geen kleinkind
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'kleinkind', parent_id: child.id } })).status).toBe(400);
    // een taak met subtaken wordt geen subtaak
    const other = await createTask({ title: 'ander' });
    expect((await patch(parent.id, { parent_id: other.id })).status).toBe(400);
    // loskoppelen mag wel
    expect(await json<Task>(await patch(child.id, { parent_id: null }))).toMatchObject({ parent_id: null });
  });

  it('neemt de lijst van de parent over', async () => {
    const parent = await createTask({ title: 'werk', list: 'Werk' });
    const child = await createTask({ title: 'kind', parent_id: parent.id, list: 'Inbox' });
    expect(child.list).toBe('Werk');
    const los = await createTask({ title: 'los' });
    expect(await json<Task>(await patch(los.id, { parent_id: parent.id }))).toMatchObject({ list: 'Werk' });
  });
});

describe('afgeronde taken pagineren', () => {
  it('klemt limit en offset op geldige gehele getallen', async () => {
    const t = await createTask({ title: 'klem' });
    await call(`/api/tasks/${t.id}/done`, { method: 'POST' });
    for (const q of ['limit=abc', 'limit=-5', 'limit=2.7', 'offset=abc', 'offset=-1', 'limit=&offset=', 'limit=99999']) {
      const res = await call(`/api/tasks?done=1&${q}`);
      expect(res.status, q).toBe(200);
      expect((await json<Task[]>(res)).length, q).toBeGreaterThan(0);
    }
  });
});

describe('snooze', () => {
  const snooze = async (id: string, minutes: unknown) => {
    const before = Date.now();
    const res = await call(`/api/tasks/${id}/snooze`, { method: 'POST', json: { minutes } });
    return { res, diff: res.ok ? Date.parse((await json<{ remind_at: string }>(res)).remind_at) - before : NaN };
  };

  it('begrenst op 1 minuut tot 30 dagen', async () => {
    const t = await createTask({ title: 'snooze' });
    expect((await snooze(t.id, 0)).diff).toBeGreaterThanOrEqual(60_000 - 1000);
    expect((await snooze(t.id, -100)).diff).toBeLessThanOrEqual(60_000 + 5000);
    const max = 30 * 24 * 60 * 60_000;
    const { diff } = await snooze(t.id, 1e9);
    expect(diff).toBeGreaterThanOrEqual(max - 1000);
    expect(diff).toBeLessThanOrEqual(max + 5000);
  });

  it('weigert iets dat geen getal is en een onbekende taak', async () => {
    const t = await createTask({ title: 'snooze2' });
    expect((await snooze(t.id, 'lang')).res.status).toBe(400);
    expect((await snooze('bestaat-niet', 10)).res.status).toBe(404);
  });
});

describe('foutafhandeling', () => {
  it('geeft 500 bij een onverwachte fout', async () => {
    const t = await createTask({ title: 'kapot' });
    await env.DB.exec('ALTER TABLE tasks RENAME TO tasks_weg');
    try {
      const res = await patch(t.id, { title: 'x' });
      expect(res.status).toBe(500);
      expect(await json(res)).toEqual({ error: 'server error' });
    } finally {
      await env.DB.exec('ALTER TABLE tasks_weg RENAME TO tasks');
    }
  });
});

describe('subtaken volgen hun parent', () => {
  async function family() {
    const parent = await createTask({ title: 'ouder', list: 'Thuis' });
    const a = await createTask({ title: 'a', parent_id: parent.id });
    const b = await createTask({ title: 'b', parent_id: parent.id });
    return { parent, a, b };
  }

  it('afvinken met PATCH vinkt de subtaken mee af, heropenen zet ze terug', async () => {
    const { parent, a, b } = await family();
    expect((await patch(parent.id, { done: true })).status).toBe(200);
    expect((await openTasks()).map((t) => t.id)).not.toContain(a.id);
    expect((await row(b.id))!.done).toBe(1);

    await patch(parent.id, { done: false });
    const open = (await openTasks()).map((t) => t.id);
    expect(open).toEqual(expect.arrayContaining([parent.id, a.id, b.id]));
  });

  it('/done en /reopen doen hetzelfde', async () => {
    const { parent, a } = await family();
    await call(`/api/tasks/${parent.id}/done`, { method: 'POST' });
    expect((await row(a.id))!.done).toBe(1);
    await call(`/api/tasks/${parent.id}/reopen`, { method: 'POST' });
    expect((await row(a.id))!.done).toBe(0);
  });

  it('heropenen laat eerder afgevinkte subtaken afgevinkt', async () => {
    const { parent, a, b } = await family();
    await patch(a.id, { done: true });
    await new Promise((r) => setTimeout(r, 5)); // ander done_at
    await patch(parent.id, { done: true });
    await patch(parent.id, { done: false });
    expect((await row(a.id))!.done).toBe(1);
    expect((await row(b.id))!.done).toBe(0);
  });

  it('een heropende subtaak heropent ook haar parent', async () => {
    const { parent, a } = await family();
    await patch(parent.id, { done: true });
    await call(`/api/tasks/${a.id}/reopen`, { method: 'POST' });
    expect((await row(parent.id))!.done).toBe(0);
  });

  it('een andere lijst voor de parent geldt ook voor de subtaken', async () => {
    const { parent, a, b } = await family();
    await patch(parent.id, { list: 'Werk' });
    expect((await row(a.id))!.list).toBe('Werk');
    expect((await row(b.id))!.list).toBe('Werk');
  });
});

describe('posities', () => {
  it('zet een nieuwe subtaak onderaan, met dezelfde stappen als taken', async () => {
    const parent = await createTask({ title: 'ouder' });
    const a = await createTask({ title: 'a', parent_id: parent.id });
    const b = await createTask({ title: 'b', parent_id: parent.id });
    expect(b.position - a.position).toBe(1_000_000);
    expect(Math.abs(a.position)).toBeLessThan(1e9); // niet meer Date.now()
  });

  it('verdeelt de posities opnieuw als het gat te klein wordt', async () => {
    const parent = await createTask({ title: 'ouder' });
    const a = await createTask({ title: 'a', parent_id: parent.id });
    const b = await createTask({ title: 'b', parent_id: parent.id });
    const c = await createTask({ title: 'c', parent_id: parent.id });
    // b vlak achter a (nog ruim genoeg), dan c ertussen met een gat kleiner dan 1e-6
    expect((await json<Task>(await patch(b.id, { position: a.position + 1e-5 }))).position).toBe(a.position + 1e-5);
    const res = await json<Task>(await patch(c.id, { position: a.position + 5e-7 }));
    expect(res.position).toBe(2_000_000);
    const kids = (await openTasks()).filter((t) => t.parent_id === parent.id);
    expect(kids.map((t) => t.title)).toEqual(['a', 'c', 'b']);
    expect(kids.map((t) => t.position)).toEqual([1_000_000, 2_000_000, 3_000_000]);
  });

  it('laat posities met voldoende ruimte met rust', async () => {
    const parent = await createTask({ title: 'ouder' });
    const a = await createTask({ title: 'a', parent_id: parent.id });
    const b = await createTask({ title: 'b', parent_id: parent.id });
    const mid = (a.position + b.position) / 2;
    const c = await createTask({ title: 'c', parent_id: parent.id });
    expect((await json<Task>(await patch(c.id, { position: mid }))).position).toBe(mid);
  });
});

describe('cron', () => {
  it('een stap die faalt, houdt de volgende stappen niet tegen', async () => {
    const { runEach } = await import('../src/index');
    const ran: string[] = [];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runEach([
        ['a', async () => { ran.push('a'); throw new Error('kapot'); }],
        ['b', async () => { ran.push('b'); }],
      ]);
    } finally { quiet.mockRestore(); }
    expect(ran).toEqual(['a', 'b']);
  });
});
