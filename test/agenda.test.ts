import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, callAs, callWith, createUser, json } from './helpers';
import { cronSteps } from '../src/index';
import { installPrefsFrom } from '../src/prefs';
import { translate } from '../public/i18n.js';

const SECRET = 'https://calendar.example.test/ical/geheim-token-123/basic.ics';
const SECRET2 = 'webcal://outlook.example.test/owa/calendar/abc/reachcalendar.ics';

const pad = (n: number) => String(n).padStart(2, '0');
/** UTC-tijd als ICS-waarde, `days` dagen na nu, op uur `h`. */
function at(days: number, h: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(h)}0000Z`;
}
const ics = (title: string) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:1', `SUMMARY:${title}`,
  `DTSTART:${at(1, 10)}`, `DTEND:${at(1, 11)}`, 'DESCRIPTION:niet bewaren', 'LOCATION:ook niet', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

/** Nagebootste agenda's: per URL een antwoord. */
let feeds: Record<string, () => Response> = {};
beforeEach(() => {
  feeds = {
    [SECRET]: () => new Response(ics('Overleg'), { headers: { 'content-type': 'text/calendar' } }),
    [SECRET2.replace('webcal://', 'https://')]: () => new Response(ics('Tandarts')),
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return feeds[url]?.() ?? new Response('niet gevonden', { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

const add = (cookie: string, body: unknown) => callAs(cookie, '/api/calendar/feeds', { method: 'POST', json: body });
type Feed = { id: string; name: string; host: string; status: string | null; error: string | null; events: number; fetched_at: string | null };
type Events = { feeds: { id: string; name: string }[]; events: { feed: string; title: string; start: string; end: string; allDay: boolean }[] };

describe('agenda koppelen', () => {
  it('koppelt een feed, haalt hem meteen op en geeft de URL nooit terug', async () => {
    const u = await createUser();
    const res = await add(u.cookie, { url: SECRET, name: 'Werk' });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('geheim-token');
    const feed = JSON.parse(text) as Feed;
    expect(feed).toMatchObject({ name: 'Werk', host: 'calendar.example.test', status: 'ok', error: null, events: 1 });
    const list = await callAs(u.cookie, '/api/calendar/feeds');
    expect(await list.text()).not.toContain('geheim-token');
    // Ook niet leesbaar in de database.
    const row = await env.DB.prepare('SELECT * FROM calendar_feeds WHERE id = ?').bind(feed.id).first();
    expect(JSON.stringify(row)).not.toContain('geheim-token');
    const ev = await json<Events>(await callAs(u.cookie, '/api/calendar/events'));
    expect(ev.feeds).toEqual([{ id: feed.id, name: 'Werk' }]);
    expect(ev.events).toEqual([expect.objectContaining({ feed: feed.id, title: 'Overleg', allDay: false })]);
    // Alleen titel en tijden staan in D1.
    const stored = await env.DB.prepare('SELECT * FROM calendar_events WHERE feed_id = ?').bind(feed.id).all();
    expect(JSON.stringify(stored.results)).not.toMatch(/bewaren|ook niet/);
  });

  it('twee feeds (webcal wordt https), dezelfde URL twee keer niet', async () => {
    const u = await createUser();
    expect((await add(u.cookie, { url: SECRET, name: 'Werk' })).status).toBe(201);
    const second = await add(u.cookie, { url: SECRET2 });
    expect(second.status).toBe(201);
    expect((await json<Feed>(second)).name).toBe('');
    expect((await add(u.cookie, { url: SECRET })).status).toBe(409);
    const ev = await json<Events>(await callAs(u.cookie, '/api/calendar/events'));
    expect(ev.events.map((e) => e.title).sort()).toEqual(['Overleg', 'Tandarts']);
  });

  it('weigert een ongeldige URL en een te lange naam', async () => {
    const u = await createUser();
    for (const url of ['', 'ftp://x/y.ics', 'niet een url', 'http://calendar.example.test/x.ics', 42]) {
      const res = await add(u.cookie, { url });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: translate('en', 'err.calendar_url') });
    }
    expect((await add(u.cookie, { url: SECRET, name: 'x'.repeat(61) })).status).toBe(400);
  });

  it('een feed die niet werkt: gekoppeld, met de fout erbij', async () => {
    const u = await createUser();
    const res = await add(u.cookie, { url: 'https://calendar.example.test/kapot.ics' });
    expect(res.status).toBe(201);
    expect(await json<Feed>(res)).toMatchObject({ status: 'error', error: 'http:404', events: 0 });
    feeds['https://calendar.example.test/html.ics'] = () => new Response('<html>inloggen</html>');
    expect(await json<Feed>(await add(u.cookie, { url: 'https://calendar.example.test/html.ics' }))).toMatchObject({ status: 'error', error: 'not_ics' });
  });

  it('een mislukte verversing laat de oude afspraken staan', async () => {
    const u = await createUser();
    const feed = await json<Feed>(await add(u.cookie, { url: SECRET }));
    feeds[SECRET] = () => new Response('weg', { status: 500 });
    await env.DB.prepare("UPDATE calendar_feeds SET fetched_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(feed.id).run();
    const r = await json<Events & { list: Feed[] }>(await callAs(u.cookie, '/api/calendar/refresh', { method: 'POST' }));
    expect(r.list[0]).toMatchObject({ status: 'error', error: 'http:500' });
    expect(r.events.map((e) => e.title)).toEqual(['Overleg']);
  });

  it('hooguit 10 feeds', async () => {
    const u = await createUser();
    for (let i = 0; i < 10; i++) {
      feeds[`https://calendar.example.test/${i}.ics`] = () => new Response(ics(`F${i}`));
      expect((await add(u.cookie, { url: `https://calendar.example.test/${i}.ics` })).status).toBe(201);
    }
    expect((await add(u.cookie, { url: SECRET })).status).toBe(400);
  });

  it('ontkoppelen wist de feed en zijn afspraken; een ander account kan dat niet', async () => {
    const u = await createUser();
    const other = await createUser();
    const feed = await json<Feed>(await add(u.cookie, { url: SECRET }));
    expect((await callAs(other.cookie, `/api/calendar/feeds/${feed.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await json<Events>(await callAs(other.cookie, '/api/calendar/events'))).events).toEqual([]);
    expect((await callAs(u.cookie, `/api/calendar/feeds/${feed.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE feed_id = ?').bind(feed.id).first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_feeds WHERE id = ?').bind(feed.id).first('n')).toBe(0);
  });

  it('account verwijderen wist alles van de agenda', async () => {
    const u = await createUser();
    await add(u.cookie, { url: SECRET });
    expect((await callAs(u.cookie, '/api/account/delete', { method: 'POST', json: { password: u.password } })).status).toBe(200);
    for (const t of ['calendar_feeds', 'calendar_events']) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(u.id).first('n')).toBe(0);
    }
  });

  it('alleen met een sessie, niet met een sleutel', async () => {
    expect((await call('/api/calendar/feeds')).status).toBe(403);
  });

  it('niet in de export', async () => {
    const u = await createUser();
    await add(u.cookie, { url: SECRET });
    const text = await (await callAs(u.cookie, '/api/export')).text();
    expect(text).not.toMatch(/Overleg|calendar|geheim/);
  });

  it('met CALENDAR_FEEDS=false bestaat het niet', async () => {
    const u = await createUser();
    const off = { ...env, CALENDAR_FEEDS: 'false' };
    expect((await callWith(off, '/api/calendar/feeds', { cookie: u.cookie })).status).toBe(404);
    expect(await (await callWith(off, '/config.js', { cookie: u.cookie })).text()).toContain('"calendarFeeds":false');
    expect(await (await callWith(env, '/config.js', { cookie: u.cookie })).text()).toContain('"calendarFeeds":true');
    expect(cronSteps(off, installPrefsFrom(off), Date.parse('2031-01-01T10:05:00Z')).map(([n]) => n)).not.toContain('agenda');
  });

  it('de cron ververst feeds die ouder zijn dan een uur', async () => {
    const u = await createUser();
    const feed = await json<Feed>(await add(u.cookie, { url: SECRET }));
    feeds[SECRET] = () => new Response(ics('Nieuw'));
    await env.DB.prepare("UPDATE calendar_feeds SET fetched_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(feed.id).run();
    const step = cronSteps(env, installPrefsFrom(env), Date.parse('2031-01-01T10:05:00Z')).find(([n]) => n === 'agenda');
    expect(step).toBeDefined();
    await step![1]();
    const ev = await json<Events>(await callAs(u.cookie, '/api/calendar/events'));
    expect(ev.events.map((e) => e.title)).toEqual(['Nieuw']);
  });
});
