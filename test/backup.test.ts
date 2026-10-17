import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { call, callAs, createTask, createUser, json, openTasks, session } from './helpers';

type Backup = { app: string; version: number; exported_at: string; tasks: any[]; places: any[] };

const asSession = async (path: string, init: RequestInit & { json?: unknown } = {}) =>
  call(path, { ...init, auth: null, headers: { cookie: await session() } });
const exportBackup = async () => json<Backup>(await asSession('/api/export'));
const importBackup = (b: unknown) => asSession('/api/import/backup', { method: 'POST', json: b });

const created: string[] = [];
const placeIds: string[] = [];
afterEach(async () => {
  for (const id of created.splice(0)) await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  for (const id of placeIds.splice(0)) await env.DB.prepare('DELETE FROM places WHERE id = ?').bind(id).run();
  await env.DB.prepare("DELETE FROM tasks WHERE id LIKE 'bulk-%' OR id LIKE 'orphan-%'").run();
});
const track = async (body: Record<string, unknown>) => { const t = await createTask(body); created.push(t.id); return t; };

describe('backup', () => {
  it('export → wijzigen → terugzetten herstelt; nieuwere taken blijven; subtaken blijven bestaan', async () => {
    const p = await track({ title: 'Ouder' });
    const s = await track({ title: 'Kind', parent_id: p.id });
    const backup = await exportBackup();
    await call(`/api/tasks/${p.id}`, { method: 'PATCH', json: { title: 'Gewijzigd' } });
    await call(`/api/tasks/${s.id}`, { method: 'DELETE' });
    const n = await track({ title: 'Nieuw' });
    const s2 = await track({ title: 'Extra kind', parent_id: p.id });
    const res = await importBackup(backup);
    expect(res.status).toBe(200);
    const all = await openTasks();
    const byId = new Map(all.map((t) => [t.id, t]));
    expect(byId.get(p.id)!.title).toBe('Ouder');
    expect(byId.get(s.id)!.parent_id).toBe(p.id);
    expect(byId.has(n.id)).toBe(true);
    expect(byId.has(s2.id)).toBe(true);
  });

  it('een subtaak waarvan de ouder ontbreekt wordt een gewone taak', async () => {
    const now = new Date().toISOString();
    const row = { id: 'orphan-1', title: 'Wees', position: 1, created_at: now, updated_at: now, parent_id: 'bestaat-niet' };
    const res = await importBackup({ app: 'tick', version: 1, tasks: [row], places: [] });
    expect(res.status).toBe(200);
    const r = await env.DB.prepare('SELECT parent_id FROM tasks WHERE id = ?').bind('orphan-1').first<{ parent_id: string | null }>();
    expect(r!.parent_id).toBeNull();
  });

  it('een plek met een bestaande naam onder een ander id wordt overgeslagen en geteld', async () => {
    const now = new Date().toISOString();
    placeIds.push('pl-a', 'pl-b');
    await env.DB.prepare('INSERT INTO places (id, name, lat, lng, radius, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind('pl-a', 'Thuis-backup', 1, 2, 100, now, now).run();
    const places = [
      { id: 'pl-b', name: 'THUIS-BACKUP', lat: 3, lng: 4, radius: 50, created_at: now, updated_at: now },
      { id: 'pl-a', name: 'Thuis-backup', lat: 5, lng: 6, radius: 70, created_at: now, updated_at: now },
    ];
    const out = await json<any>(await importBackup({ app: 'tick', version: 1, tasks: [], places }));
    expect(out).toEqual({ tasks: 0, places: 1, skipped: 1 });
    const a = await env.DB.prepare('SELECT lat FROM places WHERE id = ?').bind('pl-a').first<{ lat: number }>();
    expect(a!.lat).toBe(5);
  });

  it('weigert een ongeldig bestand', async () => {
    const bad = [{}, { app: 'x', version: 1 }, { app: 'tick', version: 2 }, { app: 'tick', version: 1, tasks: [{ id: 1 }] }];
    for (const b of bad) {
      const res = await importBackup(b);
      expect(res.status).toBe(400);
      expect((await json<any>(res)).error).toContain('backup');
    }
  });

  it('de export bevat geen instellingen, sleutels of wachtwoord', async () => {
    const res = await asSession('/api/export');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="tick-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await json<Backup>(res);
    expect(Object.keys(body).sort()).toEqual(['app', 'exported_at', 'places', 'tasks', 'version']);
  });

  it('is alleen voor een sessie, niet voor het API-token', async () => {
    expect((await call('/api/export')).status).toBe(403);
    expect((await call('/api/import/backup', { method: 'POST', json: {} })).status).toBe(403);
  });

  it('een backup van 1.200 taken lukt', async () => {
    const now = new Date().toISOString();
    const tasks = Array.from({ length: 1200 }, (_, i) => ({ id: `bulk-${i}`, title: `Taak ${i}`, position: i, created_at: now, updated_at: now }));
    const out = await json<any>(await importBackup({ app: 'tick', version: 1, tasks, places: [] }));
    expect(out.tasks).toBe(1200);
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id LIKE 'bulk-%'").first<{ n: number }>();
    expect(c!.n).toBe(1200);
  });

  it('een ongeldige rij laat de database ongewijzigd', async () => {
    const now = new Date().toISOString();
    const mk = (i: number, extra: Record<string, unknown> = {}) => ({ id: `bulk-${i}`, title: `T${i}`, position: i, created_at: now, updated_at: now, ...extra });
    const tasks = [...Array.from({ length: 120 }, (_, i) => mk(i)), mk(120, { description: { x: 1 } })];
    expect((await importBackup({ app: 'tick', version: 1, tasks, places: [] })).status).toBe(400);
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id LIKE 'bulk-%'").first<{ n: number }>();
    expect(c!.n).toBe(0);
    const bad = [{ id: 'pl-x', name: 'X', lat: 1, lng: 2, radius: 3 }];
    expect((await importBackup({ app: 'tick', version: 1, tasks: [mk(1)], places: bad })).status).toBe(400);
  });

  it('null in een NOT NULL-kolom neemt de standaardwaarde', async () => {
    const now = new Date().toISOString();
    const row = { id: 'bulk-null', title: 'N', position: 1, created_at: now, updated_at: now, done: null, description: null, list: null };
    expect((await importBackup({ app: 'tick', version: 1, tasks: [row] })).status).toBe(200);
    const r = await env.DB.prepare("SELECT done, description, list FROM tasks WHERE id = 'bulk-null'").first<any>();
    expect(r).toEqual({ done: 0, description: '', list: 'Inbox' });
  });

  it('terugzetten zet een reminder die al voorbij is op gemeld; een toekomstige blijft staan', async () => {
    const now = new Date().toISOString();
    const base = { position: 1, created_at: now, updated_at: now, notified: 0, loc_notified: 0 };
    const tasks = [
      { ...base, id: 'bulk-past', title: 'voorbij', remind_at: new Date(Date.now() - 86_400_000).toISOString() },
      { ...base, id: 'bulk-future', title: 'later', remind_at: '2099-01-01T09:00:00.000Z' },
    ];
    expect((await importBackup({ app: 'tick', version: 1, tasks })).status).toBe(200);
    const r = (id: string) => env.DB.prepare('SELECT notified, loc_notified FROM tasks WHERE id = ?').bind(id).first<any>();
    expect(await r('bulk-past')).toEqual({ notified: 1, loc_notified: 0 });
    expect(await r('bulk-future')).toEqual({ notified: 0, loc_notified: 0 });
  });
});

describe('backup per gebruiker', () => {
  it('de export van B bevat niets van A', async () => {
    const a = await track({ title: 'van A' }); const b = await createUser();
    const backup = await json<Backup>(await callAs(b.cookie, '/api/export'));
    expect(backup.tasks.map((t) => t.id)).not.toContain(a.id);
  });
  it('een backup van A, teruggezet door B, overschrijft niets van A', async () => {
    const a = await track({ title: 'Origineel A' }); const b = await createUser();
    const backup = await exportBackup();
    backup.tasks = backup.tasks.map((t) => (t.id === a.id ? { ...t, title: 'Overschreven' } : t));
    const r = await json<{ tasks: number; skipped: number }>(await callAs(b.cookie, '/api/import/backup', { method: 'POST', json: backup }));
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect((await openTasks()).find((t) => t.id === a.id)!.title).toBe('Origineel A');
    expect(await json<unknown[]>(await callAs(b.cookie, '/api/tasks'))).toEqual([]);
  });
  it('een subtaak die naar een taak van A wijst, wordt bij B een gewone taak', async () => {
    const a = await track({ title: 'ouder van A' }); const b = await createUser();
    const file = { app: 'tick', version: 1, exported_at: 'x', places: [], tasks: [{ id: 'orphan-b1', title: 'kind', position: 1, created_at: 'x', updated_at: 'x', parent_id: a.id }] };
    await callAs(b.cookie, '/api/import/backup', { method: 'POST', json: file });
    expect(await env.DB.prepare("SELECT parent_id, user_id FROM tasks WHERE id = 'orphan-b1'").first()).toEqual({ parent_id: null, user_id: b.id });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?').bind(a.id).first()).toEqual({ n: 0 });
  });
});
