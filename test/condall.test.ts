import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { callWith, createUser } from './helpers';
import { loadInstallPrefs } from '../src/prefs';
import { runReminders, type Sender } from '../src/push';
import { combo, MIN_APP, MIN_APP_BOTH, versionAtLeast } from '../src/condall';

// Testfeature "condall" (src/condall.ts): "Pas als alles klopt" voor tijd + plek en tijd + Home Assistant-trigger.
type User = Awaited<ReturnType<typeof createUser>>;
const off = { ...env, TEST_FEATURES: '' };
const req = (u: User, path: string, method = 'GET', json?: unknown) => callWith(env, path, { method, json, cookie: u.cookie });
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const PLACE = { name: 'AH Centrum', lat: 52.09, lng: 5.12, radius: 500 };

async function task(u: User, extra: Record<string, unknown>) {
  return ((await (await req(u, '/api/tasks', 'POST', { title: 'Boodschappen', ...extra })).json()) as { id: string }).id;
}
const setAll = (u: User, id: string, all: boolean) => req(u, `/api/condall/tasks/${id}`, 'PUT', { all });
const listed = async (u: User, id: string) =>
  ((await (await req(u, '/api/tasks')).json()) as { id: string; conditions?: string; trigger_at?: string | null }[]).find((t) => t.id === id)!;
const row = (id: string) => env.DB.prepare('SELECT notified, loc_notified FROM tasks WHERE id = ?').bind(id).first<{ notified: number; loc_notified: number }>();
/** De herinnering laten verlopen (de API weigert een tijd in het verleden niet, maar zo is het duidelijk). */
const due = (id: string) => env.DB.prepare('UPDATE tasks SET remind_at = ?, notified = 0 WHERE id = ?').bind(minutes(-1), id).run();

function fakeSender() {
  const calls: { userId: string; taskId?: string; body: string }[] = [];
  const send: Sender = async (_env, userId, make) => {
    const p = make('nl');
    calls.push({ userId, taskId: p.taskId, body: p.body });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}

describe('condall: regels', () => {
  it('versies vergelijken', () => {
    expect(versionAtLeast('1.15.7', '1.15.7')).toBe(true);
    expect(versionAtLeast('1.16.0', '1.15.7')).toBe(true);
    expect(versionAtLeast('1.15.6', '1.15.7')).toBe(false);
    expect(versionAtLeast('1.15', '1.15.7')).toBe(false);
    expect(versionAtLeast(null, '1.15.7')).toBe(false);
    expect(versionAtLeast('onzin', '1.15.7')).toBe(false);
  });

  it('tijd + plek, tijd + trigger, en plek + trigger (met of zonder tijd)', () => {
    expect(combo({ remind_at: 'x', loc_lat: 1 }, false)).toBe('place');
    expect(combo({ remind_at: 'x', loc_lat: null }, true)).toBe('ha');
    expect(combo({ remind_at: 'x', loc_lat: 1 }, true)).toBe('both');
    expect(combo({ remind_at: null, loc_lat: 1 }, true)).toBe('both');
    expect(combo({ remind_at: 'x', loc_lat: null }, false)).toBeNull();
    expect(combo({ remind_at: null, loc_lat: 1 }, false)).toBeNull();
    expect(combo({ remind_at: null, loc_lat: null }, true)).toBeNull();
  });
});

describe('condall: API en meldingen', () => {
  let a: User;
  let b: User;
  beforeAll(async () => {
    a = await createUser({ name: 'Ada' });
    b = await createUser({ name: 'Bo' });
  });

  it('bestaat niet zonder de testfeature', async () => {
    expect((await callWith(off, '/api/condall', { cookie: a.cookie })).status).toBe(404);
  });

  it('keuze opslaan, alleen bij je eigen hoofdtaak', async () => {
    const id = await task(a, { remind_at: minutes(60), location: PLACE });
    expect((await setAll(a, id, true)).status).toBe(200);
    expect(((await (await req(a, '/api/condall')).json()) as { tasks: string[] }).tasks).toContain(id);
    expect((await setAll(b, id, true)).status).toBe(404);
    expect((await req(a, `/api/condall/tasks/${id}`, 'PUT', { all: 'ja' })).status).toBe(400);
    await setAll(a, id, false);
    expect(((await (await req(a, '/api/condall')).json()) as { tasks: string[] }).tasks).not.toContain(id);
  });

  it('zegt of de telefoon het kan (app-versie)', async () => {
    const app = async () => ((await (await req(a, '/api/condall')).json()) as { app: boolean }).app;
    expect(await app()).toBe(false);
    const key = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO api_keys (id, name, kind, hash, hint, created_at, user_id) VALUES (?, 'Telefoon', 'full', ?, 'x', ?, ?)")
      .bind(key, crypto.randomUUID(), new Date().toISOString(), a.id).run();
    await env.DB.prepare("INSERT INTO devices (key_id, name, notifications, location, app_version, seen_at) VALUES (?, 'Pixel', 1, 'always', '1.15.6', ?)")
      .bind(key, new Date().toISOString()).run();
    expect(await app()).toBe(false);
    await env.DB.prepare('UPDATE devices SET app_version = ? WHERE key_id = ?').bind(MIN_APP, key).run();
    expect(await app()).toBe(true);
    // Plek + trigger vraagt 1.15.8.
    const both = async () => ((await (await req(a, '/api/condall')).json()) as { appBoth: boolean }).appBoth;
    expect(await both()).toBe(false);
    await env.DB.prepare('UPDATE devices SET app_version = ? WHERE key_id = ?').bind(MIN_APP_BOTH, key).run();
    expect(await both()).toBe(true);
    expect(await app()).toBe(true);
  });

  it('GET /api/tasks: conditions "all" alleen bij tijd + plek in de stand alles', async () => {
    const id = await task(a, { remind_at: minutes(60), location: PLACE });
    expect((await listed(a, id)).conditions).toBeUndefined();
    await setAll(a, id, true);
    expect((await listed(a, id)).conditions).toBe('all');
    // Zonder tijd geen combinatie meer: de keuze blijft staan, maar geldt niet.
    await req(a, `/api/tasks/${id}`, 'PATCH', { remind_at: null });
    expect((await listed(a, id)).conditions).toBeUndefined();
    // Uit: niets.
    await req(a, `/api/tasks/${id}`, 'PATCH', { remind_at: minutes(60) });
    expect((await callWith(off, '/api/tasks', { cookie: a.cookie }).then((r) => r.json()) as { id: string; conditions?: string }[])
      .find((t) => t.id === id)!.conditions).toBeUndefined();
  });

  it('cron: tijd + plek in de stand alles stuurt geen tijdmelding (de telefoon beslist)', async () => {
    const id = await task(a, { remind_at: minutes(60), location: PLACE });
    await setAll(a, id, true);
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id)).toEqual([]);
    expect((await row(id))!.notified).toBe(1); // de poort is open, niet elke minuut opnieuw
  });

  it('cron: "Elke apart" werkt zoals altijd', async () => {
    const id = await task(a, { remind_at: minutes(60), location: PLACE });
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id).map((c) => c.userId)).toEqual([a.id]);
  });

  it('tijd + plek + trigger, "Elke apart": zoals altijd (tijdmelding, trigger meldt)', async () => {
    await req(a, '/api/hatrigger/triggers', 'PUT', { triggers: [{ id: 'post', name: 'Post bezorgd' }, { id: 'was', name: 'Wasmachine klaar' }] });
    const id = await task(a, { remind_at: minutes(60), location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    const t = await listed(a, id);
    expect(t.conditions).toBeUndefined();
    expect('trigger_at' in t).toBe(false);
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' })).json()) as { notified: string[] }).notified).toContain(id);
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id)).toHaveLength(1);
  });

  it('tijd + plek + trigger, "alles": de server onthoudt de trigger en meldt niets; de telefoon krijgt trigger_at', async () => {
    const id = await task(a, { title: 'Bij iGene', remind_at: minutes(60), location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    await setAll(a, id, true);
    let t = await listed(a, id);
    expect(t.conditions).toBe('all');
    expect(t.trigger_at).toBeNull();
    // Trigger vóór de tijd: onthouden, geen melding.
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' })).json()) as { notified: string[] }).notified).not.toContain(id);
    t = await listed(a, id);
    const first = t.trigger_at;
    expect(typeof first).toBe('string');
    // Nog een keer afgaan: de eerste telt.
    await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' });
    expect((await listed(a, id)).trigger_at).toBe(first);
    // Op de tijd: geen tijdmelding en geen triggermelding; de trigger blijft onthouden voor de telefoon.
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id)).toEqual([]);
    expect((await row(id))!.notified).toBe(1);
    expect((await listed(a, id)).trigger_at).toBe(first);
    // Na de tijd afgaan: ook niets (de telefoon meldt bij de plek).
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' })).json()) as { notified: string[] }).notified).not.toContain(id);
  });

  it('tijd + plek + trigger, "alles": trigger pas na de tijd wordt ook onthouden', async () => {
    const id = await task(a, { title: 'Bij iGene 2', remind_at: minutes(60), location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    await setAll(a, id, true);
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id)).toEqual([]);
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' })).json()) as { notified: string[] }).notified).not.toContain(id);
    expect(typeof (await listed(a, id)).trigger_at).toBe('string');
  });

  it('plek + trigger zonder tijd, "alles": werkt ook', async () => {
    const id = await task(a, { title: 'Pakketje', location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    await setAll(a, id, true);
    expect((await listed(a, id)).trigger_at).toBeNull();
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' })).json()) as { notified: string[] }).notified).not.toContain(id);
    expect(typeof (await listed(a, id)).trigger_at).toBe('string');
  });

  it('plek + trigger: een trigger van een vorige keer (herhalen) telt niet en wordt overschreven', async () => {
    const id = await task(a, { title: 'Wekelijks', location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    await setAll(a, id, true);
    // Een onthouden trigger van een andere keer (andere rep) dan de huidige (geen herhaling: rep null).
    const old = { by: 'post', name: 'Post bezorgd', rep: '2026-01-01T00:00:00.000Z', at: '2026-01-01T08:00:00.000Z' };
    await env.DB.prepare('UPDATE user_settings SET value = json_set(value, ?, json(?)) WHERE user_id = ? AND key = ?')
      .bind(`$."${id}"`, JSON.stringify(old), a.id, 'condall:held').run();
    if (!(await env.DB.prepare("SELECT 1 FROM user_settings WHERE user_id = ? AND key = 'condall:held'").bind(a.id).first())) {
      await env.DB.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'condall:held', json_object(?, json(?)))").bind(a.id, id, JSON.stringify(old)).run();
    }
    expect((await listed(a, id)).trigger_at).toBeNull();
    await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' });
    const at = (await listed(a, id)).trigger_at;
    expect(typeof at).toBe('string');
    expect(at).not.toBe(old.at);
  });

  it('plek + trigger: de keuze wijzigen of de triggers wijzigen vergeet de trigger', async () => {
    const id = await task(a, { title: 'Opnieuw', remind_at: minutes(60), location: PLACE });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    await setAll(a, id, true);
    await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['post'] });
    expect((await listed(a, id)).trigger_at).toBeNull();
    await req(a, '/api/hatrigger/fire', 'POST', { id: 'post' });
    await setAll(a, id, false);
    expect('trigger_at' in (await listed(a, id))).toBe(false);
  });

  it('tijd + trigger: een trigger vóór de tijd wacht, en meldt op de tijd', async () => {
    const id = await task(a, { title: 'Was ophangen', remind_at: minutes(60) });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['was'] });
    await setAll(a, id, true);
    const fired = (await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'was' })).json()) as { notified: string[] };
    expect(fired.notified).not.toContain(id);
    const state = (await (await req(a, '/api/condall')).json()) as { held: Record<string, { name: string }> };
    expect(state.held[id]?.name).toBe('Wasmachine klaar');
    // Nog een keer afgaan: de eerste telt, nog steeds geen melding.
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'was' })).json()) as { notified: string[] }).notified).not.toContain(id);

    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    const mine = calls.filter((c) => c.taskId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toContain('Wasmachine klaar'); // de triggermelding, niet een gewone herinnering
    expect((await row(id))!.notified).toBe(1);
    const ha = (await (await req(a, '/api/hatrigger')).json()) as { tasks: Record<string, { fired: string | null; by?: string }> };
    expect(ha.tasks[id]).toMatchObject({ by: 'was' });
    expect(((await (await req(a, '/api/condall')).json()) as { held: Record<string, unknown> }).held[id]).toBeUndefined();
    // Een tweede cron-ronde stuurt niets meer.
    const again = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), again.send);
    expect(again.calls.filter((c) => c.taskId === id)).toEqual([]);
  });

  it('tijd + trigger: zonder trigger vóór de tijd geen melding op de tijd; een trigger daarna meldt meteen', async () => {
    const id = await task(a, { title: 'Was ophangen 2', remind_at: minutes(60) });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['was'] });
    await setAll(a, id, true);
    await due(id);
    const { send, calls } = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(calls.filter((c) => c.taskId === id)).toEqual([]);
    const fired = (await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'was' })).json()) as { notified: string[] };
    expect(fired.notified).toContain(id);
  });

  it('de keuze wijzigen zet alles weer klaar en vergeet een wachtende trigger', async () => {
    const id = await task(a, { title: 'Was ophangen 3', remind_at: minutes(60) });
    await req(a, `/api/hatrigger/tasks/${id}`, 'PUT', { ids: ['was'] });
    await setAll(a, id, true);
    await req(a, '/api/hatrigger/fire', 'POST', { id: 'was' });
    await setAll(a, id, false);
    expect(((await (await req(a, '/api/condall')).json()) as { held: Record<string, unknown> }).held[id]).toBeUndefined();
    // "Elke apart": de trigger meldt meteen, ook vóór de tijd.
    expect(((await (await req(a, '/api/hatrigger/fire', 'POST', { id: 'was' })).json()) as { notified: string[] }).notified).toContain(id);
    // Een plek die al gemeld was, is na een wijziging weer meldbaar.
    const p = await task(a, { remind_at: minutes(60), location: PLACE });
    await req(a, `/api/tasks/${p}`, 'PATCH', { location_notified: true });
    await setAll(a, p, true);
    expect((await row(p))!.loc_notified).toBe(0);
  });
});
