import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAs, createUser, json } from './helpers';
import { clashPayload, firstFree, newClashes, notifyClashes, type Busy } from '../src/clash';
import type { Payload } from '../src/push';

// Melding als er een nieuwe afspraak in een gekoppelde agenda op het moment van een taak verschijnt (src/clash.ts).

const SECRET = 'https://calendar.example.test/ical/botsing/basic.ics';
const H = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const icsTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const ics = (events: { title: string; start: number; end: number }[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
  ...events.flatMap((e, i) => ['BEGIN:VEVENT', `UID:${i}`, `SUMMARY:${e.title}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`, 'END:VEVENT']),
  'END:VCALENDAR'].join('\r\n');

let calendar: { title: string; start: number; end: number }[] = [];
beforeEach(() => {
  calendar = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url === SECRET ? new Response(ics(calendar)) : new Response('niet gevonden', { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

/** Een heel uur, `hours` uur vanaf nu (afgerond op het uur). */
const hourFromNow = (hours: number) => Math.ceil(Date.now() / H) * H + hours * H;
const busy = (start: number, end: number, title = 'Overleg'): Busy => ({ start, end, title, allDay: false });
const zone = { timeZone: 'UTC', reminderTime: '09:00' };

/** Opnieuw ophalen afdwingen: de feed is "lang geleden" opgehaald. */
async function refresh(cookie: string) {
  await env.DB.prepare("UPDATE calendar_feeds SET fetched_at = '2000-01-01T00:00:00.000Z'").run();
  expect((await callAs(cookie, '/api/calendar/refresh', { method: 'POST' })).status).toBe(200);
}
const clashRows = (userId: string) => env.DB.prepare('SELECT task_id, remind_at FROM calendar_clashes WHERE user_id = ?').bind(userId).all<{ task_id: string; remind_at: string }>()
  .then((r) => r.results);

describe('newClashes', () => {
  const now = Date.UTC(2030, 0, 7, 8);
  const at = Date.UTC(2030, 0, 7, 14);
  const task = { id: 't', remind_at: new Date(at).toISOString() };
  it('alleen een herinnering die nu in een nieuwe afspraak valt en eerst vrij was', () => {
    expect(newClashes([task], [], [busy(at - H, at + H)], now, now + 14 * 24 * H)).toHaveLength(1);
    expect(newClashes([task], [busy(at, at + H, 'Al bekend')], [busy(at - H, at + H)], now, now + 14 * 24 * H)).toEqual([]);
    // Einde is exclusief, een hele dag telt niet, een voorbije herinnering ook niet.
    expect(newClashes([task], [], [busy(at - H, at)], now, now + 14 * 24 * H)).toEqual([]);
    expect(newClashes([task], [], [{ ...busy(at - H, at + H), allDay: true }], now, now + 14 * 24 * H)).toEqual([]);
    expect(newClashes([task], [], [busy(at - H, at + H)], at + 1, at + 14 * 24 * H)).toEqual([]);
    // Een afspraak die pas na het vorige venster begint, is niet nieuw (het venster schoof op).
    expect(newClashes([task], [], [busy(at - H, at + H)], now, at - 2 * H)).toEqual([]);
  });
});

describe('firstFree', () => {
  const now = Date.UTC(2030, 0, 7, 8); // maandag 08:00 UTC
  it('het eerste vrije halfuur na de herinnering, tussen 08:00 en 22:00', () => {
    const at = Date.UTC(2030, 0, 7, 14);
    expect(firstFree([busy(at, at + H)], at, now, zone)).toBe(at + H);
    expect(firstFree([], at + 10 * 60_000, now, zone)).toBe(at + 30 * 60_000);
    // Om 21:45 past er niets meer: de volgende ochtend om 08:00.
    expect(firstFree([], Date.UTC(2030, 0, 7, 21, 45), now, zone)).toBe(Date.UTC(2030, 0, 8, 8));
    // Een herinnering in het verleden: vanaf nu plus een kwartier.
    expect(firstFree([], now - H, now + 60 * 60_000, zone)).toBe(Date.UTC(2030, 0, 7, 9, 30));
  });
});

describe('melding bij een nieuwe afspraak', () => {
  it('meldt één keer, alleen voor een afspraak die nieuw is', async () => {
    const u = await createUser();
    const at = hourFromNow(26);
    calendar = [{ title: 'Lunch', start: at + 3 * H, end: at + 4 * H }];
    expect((await callAs(u.cookie, '/api/calendar/feeds', { method: 'POST', json: { url: SECRET } })).status).toBe(201);
    const task = await json<{ id: string }>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: 'Bellen', remind_at: new Date(at).toISOString() } }));
    // Opnieuw ophalen zonder nieuwe afspraak: niets.
    await refresh(u.cookie);
    expect(await clashRows(u.id)).toEqual([]);
    // Nieuwe afspraak over de taak heen: één melding.
    calendar.push({ title: 'Tandarts', start: at - H, end: at + H });
    await refresh(u.cookie);
    expect(await clashRows(u.id)).toEqual([{ task_id: task.id, remind_at: new Date(at).toISOString() }]);
    // Weg en terug: niet nog een keer (de rij blijft).
    calendar.pop();
    await refresh(u.cookie);
    calendar.push({ title: 'Tandarts', start: at - H, end: at + H });
    await refresh(u.cookie);
    expect(await clashRows(u.id)).toHaveLength(1);
  });

  it('de eerste keer koppelen meldt niets, ook niet als een afspraak al op een taak valt', async () => {
    const u = await createUser();
    const at = hourFromNow(30);
    await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: 'Sporten', remind_at: new Date(at).toISOString() } });
    calendar = [{ title: 'Werk', start: at - H, end: at + H }];
    expect((await callAs(u.cookie, '/api/calendar/feeds', { method: 'POST', json: { url: SECRET } })).status).toBe(201);
    expect(await clashRows(u.id)).toEqual([]);
  });

  it('stuurt de melding met Opnieuw inplannen en Naar vrij moment', async () => {
    const u = await createUser();
    const at = hourFromNow(5);
    const task = await json<{ id: string }>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: 'Bellen', remind_at: new Date(at).toISOString() } }));
    const sent: Payload[] = [];
    const send = vi.fn(async (_e: unknown, _u: string, make: (l: 'en' | 'nl') => Payload) => { sent.push(make('nl')); return { ok: 1, total: 1 }; });
    const okAt = new Date(Date.now() - H).toISOString();
    const n = await notifyClashes(env, u.id, okAt, [], [busy(at - H, at + H, 'Tandarts')], 'Europe/Amsterdam', Date.now(), send);
    expect(n).toBe(1);
    expect(sent[0]).toMatchObject({
      title: 'Botst met je agenda: Bellen', taskId: task.id, url: `/?task=${task.id}&when=1`, tag: `clash-${task.id}`,
      actions: [{ action: 'reschedule', title: 'Opnieuw inplannen' }, { action: 'free', title: 'Naar vrij moment' }],
      moved: { text: 'Verzet naar {when}', locale: 'nl-NL', timeZone: 'Europe/Amsterdam' },
    });
    expect(sent[0].body).toContain('Tandarts');
    // Dezelfde herinnering nog eens: geen tweede melding. Zonder vorige ronde (okAt null): niets.
    expect(await notifyClashes(env, u.id, okAt, [], [busy(at - H, at + H, 'Ander')], 'UTC', Date.now(), send)).toBe(0);
    expect(await notifyClashes(env, u.id, null, [], [busy(at - 2 * H, at + 2 * H)], 'UTC', Date.now(), send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('een afspraak zonder titel heet Bezet', () => {
    expect(clashPayload({ id: 't', title: 'X' }, busy(0, H, ''), 'en', 'UTC').body).toContain('Busy');
  });
});

describe('POST /api/tasks/:id/free', () => {
  it('zet de herinnering op het eerste vrije halfuur na de afspraak', async () => {
    const u = await createUser();
    // Overdag in UTC (de test-zone van deze gebruiker is Europe/Amsterdam): morgen 12:00 UTC.
    const d = new Date(Date.now() + 24 * H);
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11);
    calendar = [{ title: 'Overleg', start: at - H, end: at + H }];
    expect((await callAs(u.cookie, '/api/calendar/feeds', { method: 'POST', json: { url: SECRET } })).status).toBe(201);
    const task = await json<{ id: string }>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: 'Bellen', remind_at: new Date(at).toISOString() } }));
    const res = await callAs(u.cookie, `/api/tasks/${task.id}/free`, { method: 'POST', json: {} });
    expect(res.status).toBe(200);
    expect((await json<{ remind_at: string }>(res)).remind_at).toBe(new Date(at + H).toISOString());
    expect((await callAs(u.cookie, '/api/tasks/bestaat-niet/free', { method: 'POST', json: {} })).status).toBe(404);
  });
});
