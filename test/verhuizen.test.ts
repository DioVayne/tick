import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE, call, callAs, createTask, createUser, json, type Task } from './helpers';
import { derivedId, parseCode } from '../src/move';

type User = Awaited<ReturnType<typeof createUser>>;
type FileRef = { id: string; from: string; task_id: string; name: string; mime: string; size: number };
type Imported = {
  source: string; tasks: number; places: number; skipped: number; lists: number; settings: number;
  calendars: number; calendars_skipped: number; files: FileRef[]; files_skipped: number; background: boolean;
};

// De "oude Tick" is hier dezelfde Worker onder een ander adres: verzoeken naar OLD gaan naar de Worker zelf.
// Zo zitten oud en nieuw account in één database, en krijgen de verhuisde taken dus een nieuw id.
const OLD = 'https://old.example.test';
const CAL = 'https://calendar.example.test/ical/geheim/basic.ics';
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
let oldUp = true;
const realFetch = globalThis.fetch;
beforeEach(() => {
  oldUp = true;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === CAL) return new Response(ICS, { headers: { 'content-type': 'text/calendar' } });
    if (url.startsWith(OLD + '/')) {
      if (!oldUp) throw new TypeError('network');
      return exports.default.fetch(new Request(BASE + url.slice(OLD.length), { method: init?.method ?? 'GET', headers: { 'cf-connecting-ip': '10.9.9.9' } }));
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const post = (u: User, path: string, body: unknown = {}) => callAs(u.cookie, path, { method: 'POST', json: body });
/** Code van `u` op de "oude Tick" (OLD in plaats van het testadres). */
async function codeOf(u: User): Promise<string> {
  const res = await post(u, '/api/move/code');
  expect(res.status).toBe(201);
  const { code } = await json<{ code: string }>(res);
  expect(code.startsWith(BASE + '/api/move/out/')).toBe(true);
  return OLD + code.slice(BASE.length);
}
const task = async (u: User, body: Record<string, unknown>) => json<Task>(await post(u, '/api/tasks', body));
const tasksOf = async (u: User, q = '') => json<Task[]>(await callAs(u.cookie, '/api/tasks' + q));
const uploadAs = (u: User, taskId: string, bytes: Uint8Array, name = 'foto.png') =>
  callAs(u.cookie, `/api/tasks/${taskId}/attachments?name=${name}&w=2&h=3`, { method: 'POST', body: bytes, headers: { 'content-type': 'image/png' } });

describe('verhuiscode', () => {
  it('alleen met een sessie, en een nieuwe code maakt de vorige ongeldig', async () => {
    expect((await call('/api/move/code', { method: 'POST' })).status).toBe(403);
    const a = await createUser();
    const first = await codeOf(a);
    const second = await codeOf(a);
    expect((await exports.default.fetch(BASE + first.slice(OLD.length))).status).toBe(410);
    expect((await exports.default.fetch(BASE + second.slice(OLD.length))).status).toBe(200);
    // Intrekken.
    expect((await callAs(a.cookie, '/api/move/code', { method: 'DELETE' })).status).toBe(200);
    expect((await exports.default.fetch(BASE + second.slice(OLD.length))).status).toBe(410);
  });

  it('een verlopen of verzonnen code geeft 410 en verraadt niets', async () => {
    const a = await createUser();
    const code = await codeOf(a);
    await env.DB.prepare('UPDATE move_codes SET expires_at = ? WHERE user_id = ?').bind('2000-01-01T00:00:00.000Z', a.id).run();
    const res = await exports.default.fetch(BASE + code.slice(OLD.length));
    expect(res.status).toBe(410);
    expect((await exports.default.fetch(`${BASE}/api/move/out/${'x'.repeat(43)}`)).status).toBe(410);
  });

  it('parseCode accepteert alleen een verhuis-URL over https (http alleen localhost)', () => {
    expect(parseCode(' https://tick.example/api/move/out/abcdefghijklmnopqrstuvwxyz ')).toBe('https://tick.example/api/move/out/abcdefghijklmnopqrstuvwxyz');
    expect(parseCode('http://localhost:8787/api/move/out/abcdefghijklmnopqrstuvwxyz')).toBe('http://localhost:8787/api/move/out/abcdefghijklmnopqrstuvwxyz');
    for (const bad of ['', 'abc', 'http://tick.example/api/move/out/abcdefghijklmnopqrstuvwxyz', 'https://tick.example/api/tasks',
      'https://tick.example/api/move/out/abcdefghijklmnopqrstuvwxyz?x=1', 'ftp://tick.example/api/move/out/abcdefghijklmnopqrstuvwxyz']) {
      expect(() => parseCode(bad), bad).toThrow();
    }
  });
});

describe('verhuizen', () => {
  it('neemt alles mee: taken, subtaken, prullenbak, plekken, lijsten, instellingen, agenda, bijlagen, achtergrond', async () => {
    const a = await createUser({ name: 'Oud' });
    const b = await createUser({ name: 'Nieuw' });
    // Taken van A.
    const parent = await task(a, { title: 'Verbouwing', description: 'met **notitie**', list: 'Huis', remind_at: '2099-01-01T09:00:00.000Z' });
    const sub = await task(a, { title: 'Verf kopen', parent_id: parent.id });
    const doneTask = await task(a, { title: 'Klaar', list: 'Huis' });
    await post(a, `/api/tasks/${doneTask.id}/done`);
    const trashed = await task(a, { title: 'Weg', list: 'Inbox' });
    expect((await callAs(a.cookie, `/api/tasks/${trashed.id}`, { method: 'DELETE' })).status).toBe(200);
    const daily = await task(a, { title: 'Vuilnis', repeat: 'FREQ=DAILY', remind_at: '2099-01-05T07:00:00.000Z' });
    // Een gedeelde taak van iemand anders (de beheerder), in A's lijst Samen.
    const theirs = await createTask({ title: 'Samen boodschappen' });
    const share = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: theirs.id, to: a.email, mode: 'shared' } }));
    expect((await callAs(a.cookie, `/api/shares/${share.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await callAs(a.cookie, `/api/tasks/${theirs.id}`, { method: 'PATCH', json: { list: 'Samen' } })).status).toBe(200);
    // Plek, lege lijst, instellingen, lijst overslaan in de Tickmanager, agenda, bijlage, achtergrond.
    expect((await post(a, '/api/places', { name: 'Thuis', lat: 52.1, lng: 5.1, radius: 300 })).status).toBe(201);
    expect((await post(a, '/api/lists', { name: 'Leeg' })).status).toBeLessThan(300);
    expect((await callAs(a.cookie, '/api/settings', { method: 'PATCH', json: { weekStart: 'sun', reminderTime: '07:30', reviewNewDays: 21 } })).status).toBe(200);
    const huisId = (await json<{ name: string; id: string }[]>(await callAs(a.cookie, '/api/lists'))).find((l) => l.name === 'Huis')!.id;
    await env.DB.prepare('INSERT INTO review_skip_lists (user_id, list_id) VALUES (?, ?)').bind(a.id, huisId).run();
    expect((await post(a, '/api/calendar/feeds', { url: CAL, name: 'Werk' })).status).toBe(201);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
    expect((await uploadAs(a, parent.id, bytes)).status).toBe(201);
    expect((await callAs(a.cookie, '/api/background', { method: 'PUT', body: new Uint8Array([255, 216, 255, 1]), headers: { 'content-type': 'image/jpeg' } })).status).toBe(200);

    const code = await codeOf(a);
    // Vooraf: wat er meekomt.
    const preview = await json<Record<string, unknown>>(await post(b, '/api/move/preview', { code }));
    expect(preview).toMatchObject({
      source: OLD, account: 'Oud', tasks: 5, trash: 1, shared: 1, places: 1, lists: 1, calendars: 1, files: 1, bytes: bytes.length,
      files_blocked: 0, calendars_blocked: 0, background: true,
    });
    expect(preview.settings).toBe(3);

    const r = await json<Imported>(await post(b, '/api/move/import', { code }));
    expect(r).toMatchObject({ source: OLD, tasks: 6, places: 1, skipped: 0, lists: 1, settings: 3, calendars: 1, calendars_skipped: 0, files_skipped: 0, background: true });
    expect(r.files).toHaveLength(1);
    // Bijlage en achtergrond, zoals de app ze één voor één ophaalt.
    for (const f of r.files) expect(await json(await post(b, '/api/move/file', { code, ...f }))).toEqual({ ok: true, existed: false });
    expect((await post(b, '/api/move/background', { code })).status).toBe(200);

    // De taken bij B: dezelfde inhoud, nieuwe (vaste) ids want de oude zijn hier van A.
    const open = await tasksOf(b);
    const p = open.find((t) => t.title === 'Verbouwing')!;
    expect(p.id).toBe(await derivedId(b.id, parent.id));
    expect(p).toMatchObject({ list: 'Huis', description: 'met **notitie**', remind_at: '2099-01-01T09:00:00.000Z' });
    expect(open.find((t) => t.title === 'Verf kopen')!.parent_id).toBe(p.id);
    expect(open.find((t) => t.title === 'Verf kopen')!.id).toBe(await derivedId(b.id, sub.id));
    expect(open.find((t) => t.title === 'Vuilnis')!.repeat).toEqual(daily.repeat);
    // De gedeelde taak is nu van B zelf, in de lijst die A ervoor had.
    const samen = open.find((t) => t.title === 'Samen boodschappen')!;
    expect(samen).toMatchObject({ list: 'Samen', share: null });
    expect((await tasksOf(b, '?done=1')).map((t) => t.title)).toContain('Klaar');
    expect((await tasksOf(b, '?deleted=1')).map((t) => t.title)).toEqual(['Weg']);
    // Plekken, lijsten, instellingen, Tickmanager.
    expect((await json<{ name: string }[]>(await callAs(b.cookie, '/api/places'))).map((x) => x.name)).toEqual(['Thuis']);
    const lists = await json<{ name: string; review: boolean }[]>(await callAs(b.cookie, '/api/lists'));
    expect(lists.map((l) => l.name)).toEqual(expect.arrayContaining(['Huis', 'Leeg', 'Samen']));
    expect(lists.find((l) => l.name === 'Huis')!.review).toBe(false);
    expect(await json(await callAs(b.cookie, '/api/settings'))).toMatchObject({ weekStart: 'sun', reminderTime: '07:30', reviewNewDays: 21 });
    // Agenda: opnieuw versleuteld, het adres staat nergens leesbaar.
    const feeds = await json<{ name: string; host: string }[]>(await callAs(b.cookie, '/api/calendar/feeds'));
    expect(feeds).toEqual([expect.objectContaining({ name: 'Werk', host: 'calendar.example.test' })]);
    const feedRow = await env.DB.prepare('SELECT url_enc FROM calendar_feeds WHERE user_id = ?').bind(b.id).first<{ url_enc: string }>();
    expect(feedRow!.url_enc).not.toContain('geheim');
    // Bijlage: dezelfde bytes, in een eigen R2-object.
    const atts = await json<{ id: string; name: string; width: number }[]>(await callAs(b.cookie, `/api/tasks/${p.id}/attachments`));
    expect(atts).toEqual([expect.objectContaining({ name: 'foto.png', width: 2 })]);
    expect(new Uint8Array(await (await callAs(b.cookie, `/api/attachments/${atts[0].id}`)).arrayBuffer())).toEqual(bytes);
    expect(new Uint8Array(await (await callAs(b.cookie, '/api/background')).arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 1]));
    // Bij A is niets veranderd of verdwenen.
    expect((await tasksOf(a)).map((t) => t.id)).toContain(parent.id);
    expect((await json<unknown[]>(await callAs(a.cookie, `/api/tasks/${parent.id}/attachments`)))).toHaveLength(1);

    // Opnieuw verhuizen (bijvoorbeeld na een onderbreking): niets dubbel.
    const again = await json<Imported>(await post(b, '/api/move/import', { code }));
    expect(again.files).toHaveLength(0);
    expect(again.calendars).toBe(0);
    expect(await tasksOf(b)).toHaveLength(open.length);
    expect(await json<unknown[]>(await callAs(b.cookie, `/api/tasks/${p.id}/attachments`))).toHaveLength(1);
    expect(await json(await post(b, '/api/move/file', { code, ...r.files[0] }))).toEqual({ ok: true, existed: true });
  });

  it('voegt samen met wat er al staat en wist niets', async () => {
    const a = await createUser();
    const b = await createUser();
    await task(a, { title: 'Van A' });
    await task(b, { title: 'Al bij B' });
    await post(b, '/api/move/import', { code: await codeOf(a) });
    expect((await tasksOf(b)).map((t) => t.title).sort()).toEqual(['Al bij B', 'Van A']);
  });

  it('een bijlage bij een taak die niet van jou is, haal je niet op', async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const t = await task(a, { title: 'Met foto' });
    await uploadAs(a, t.id, new Uint8Array([1, 2, 3]));
    const code = await codeOf(a);
    const r = await json<Imported>(await post(b, '/api/move/import', { code }));
    // C probeert de bijlage aan B's taak te hangen, en aan een eigen taak met B's code: geen toegang tot B's taak.
    expect((await post(c, '/api/move/file', { code, ...r.files[0] })).status).toBe(404);
    // De oude Tick geeft alleen bijlagen van taken die bij de code horen.
    const other = await task(c, { title: 'Van C' });
    await uploadAs(c, other.id, new Uint8Array([9]));
    const cAtt = await env.DB.prepare('SELECT id FROM attachments WHERE task_id = ?').bind(other.id).first<{ id: string }>();
    expect((await exports.default.fetch(`${BASE}${code.slice(OLD.length)}/file/${cAtt!.id}`)).status).toBe(404);
  });

  it('nette fouten: geen code, verkeerde code, oude Tick onbereikbaar of te oud', async () => {
    const a = await createUser();
    const b = await createUser();
    const err = async (res: Response) => ({ status: res.status, error: (await json<{ error: string }>(res)).error });
    expect(await err(await post(b, '/api/move/preview', { code: 'hallo' }))).toMatchObject({ status: 400 });
    const code = await codeOf(a);
    await callAs(a.cookie, '/api/move/code', { method: 'DELETE' });
    const gone = await post(b, '/api/move/preview', { code });
    expect(gone.status).toBe(400);
    expect((await json<{ key?: string; error: string }>(gone)).error).toMatch(/expired|verlopen/);
    oldUp = false;
    expect((await post(b, '/api/move/preview', { code: await codeOf(a) })).status).toBe(502);
    oldUp = true;
    // Een Tick zonder verhuisfunctie: daar bestaat /api/move/out niet, dus 401 (inloggen).
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    const old = await post(b, '/api/move/preview', { code: await codeOf(a) });
    expect(old.status).toBe(400);
    expect((await json<{ error: string }>(old)).error).toMatch(/updated|bijgewerkt/);
  });
});
