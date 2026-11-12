import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, callAs, callWith, createUser, json } from './helpers';
import { cronSteps } from '../src/index';
import { testFeature, testFeatures } from '../src/features';
import { KEYS, runFreeTime } from '../src/freetime';
import { installPrefsFrom, loadInstallPrefs, userSettingStmt } from '../src/prefs';
import type { Payload, Sender } from '../src/push';
import { inZone } from '../src/time';
import { candidates, freeUntil, shuffle } from '../public/freetime.js';

// Testfeature "Tijd voor een taak?" (freetime). Vaste klok: 15 juni 2030, 10:00 in Amsterdam (zomertijd, UTC+2).
const NOW = Date.parse('2030-06-15T08:00:00Z');
const H = 3_600_000;
const AMS = { timeZone: 'Europe/Amsterdam', reminderTime: '09:00' };
const PREFS = { minutes: 90, from: '09:00', to: '21:00' };

type User = Awaited<ReturnType<typeof createUser>>;
type View = { on: boolean; minutes: number; from: string; to: string; calendar: boolean };

const free = (busy: { start: number; end: number; allDay?: boolean }[], now = NOW, prefs = PREFS) =>
  inZone(AMS, () => freeUntil(busy, now, prefs));

describe('testfeatures (TEST_FEATURES)', () => {
  it('alleen bekende namen, komma\'s en spaties mogen', () => {
    expect(testFeatures({ TEST_FEATURES: '' })).toEqual([]);
    expect(testFeatures({})).toEqual([]);
    expect(testFeatures({ TEST_FEATURES: ' Freetime , onbekend' })).toEqual(['freetime']);
    expect(testFeature({ TEST_FEATURES: 'iets-anders' }, 'freetime')).toBe(false);
  });

  it('uit: geen API, niet in /config.js en geen cron-stap', async () => {
    const u = await createUser();
    const off = { ...env, TEST_FEATURES: '' };
    expect((await callWith(off, '/api/freetime', { cookie: u.cookie })).status).toBe(404);
    expect(await (await callWith(off, '/config.js', { cookie: u.cookie })).text()).toContain('"testFeatures":[]');
    expect(cronSteps(off, installPrefsFrom(off), NOW).map(([n]) => n)).not.toContain('tijd voor een taak');
    expect(await (await callWith(env, '/config.js', { cookie: u.cookie })).text()).toContain('"testFeatures":["freetime"]');
    expect(cronSteps(env, installPrefsFrom(env), NOW).map(([n]) => n)).toContain('tijd voor een taak');
    // Zonder agenda's heeft de functie niets om naar te kijken.
    const noCal = { ...env, CALENDAR_FEEDS: 'false' };
    expect(cronSteps(noCal, installPrefsFrom(noCal), NOW).map(([n]) => n)).not.toContain('tijd voor een taak');
  });
});

describe('freeUntil: is de agenda vanaf nu ruim vrij?', () => {
  it('lege agenda: vrij tot het einde van het venster', () => {
    expect(free([])).toBe(Date.parse('2030-06-15T19:00:00Z')); // 21:00 lokaal
  });
  it('tot de volgende afspraak, als die ver genoeg weg is', () => {
    expect(free([{ start: NOW + 2 * H, end: NOW + 3 * H }])).toBe(NOW + 2 * H);
  });
  it('te kort vrij, of nu bezig: niet vrij', () => {
    expect(free([{ start: NOW + H, end: NOW + 2 * H }])).toBeNull();
    expect(free([{ start: NOW - H, end: NOW + 10 * 60_000 }])).toBeNull();
  });
  it('een afspraak die al voorbij is of de hele dag duurt, telt niet', () => {
    expect(free([{ start: NOW - 2 * H, end: NOW - H }, { start: NOW - 10 * H, end: NOW + 20 * H, allDay: true }]))
      .toBe(Date.parse('2030-06-15T19:00:00Z'));
  });
  it('buiten het venster niets, en niet als het venster te vroeg dichtgaat', () => {
    expect(free([], Date.parse('2030-06-15T06:30:00Z'))).toBeNull(); // 08:30 lokaal
    expect(free([], Date.parse('2030-06-15T19:00:00Z'))).toBeNull(); // 21:00 lokaal
    expect(free([], Date.parse('2030-06-15T18:00:00Z'))).toBeNull(); // 20:00: nog maar 60 minuten
    expect(free([], Date.parse('2030-06-15T18:00:00Z'), { ...PREFS, minutes: 60 })).toBe(Date.parse('2030-06-15T19:00:00Z'));
  });
});

describe('welke taken het scherm laat zien', () => {
  it('open hoofdtaken zonder geplande tijd; een verlopen herinnering mag', () => {
    const tasks = [
      { id: 'a' },
      { id: 'verlopen', remind_at: new Date(NOW - H).toISOString() },
      { id: 'later', remind_at: new Date(NOW + H).toISOString() },
      { id: 'sub', parent_id: 'a' },
      { id: 'ritme', repeat: { rule: 'FREQ=DAILY' } },
      { id: 'klaar', done: 1 },
      { id: 'weg', deleted_at: '2030-01-01T00:00:00Z' },
    ];
    expect(candidates(tasks, NOW).map((x) => x.id)).toEqual(['a', 'verlopen']);
  });
  it('schudden houdt dezelfde taken', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const out = shuffle(list);
    expect([...out].sort()).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']); // het origineel blijft
  });
});

/** Een gekoppelde agenda rechtstreeks in D1 (ophalen zelf testen de agenda-tests). */
async function addFeed(u: User, fetchedAt = new Date(NOW - 10 * 60_000).toISOString(), status = 'ok') {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO calendar_feeds (id, user_id, name, url_enc, url_hash, host, created_at, fetched_at, status)
    VALUES (?, ?, 'Werk', 'v1.x.y', ?, 'example.test', ?, ?, ?)`).bind(id, u.id, crypto.randomUUID(), fetchedAt, fetchedAt, status).run();
  return id;
}
async function addEvent(u: User, feedId: string, start: number, end: number, allDay = false) {
  await env.DB.prepare('INSERT INTO calendar_events (feed_id, user_id, title, start_at, end_at, all_day) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(feedId, u.id, 'Afspraak', new Date(start).toISOString(), new Date(end).toISOString(), allDay ? 1 : 0).run();
}

const patch = (u: User, body: unknown) => callAs(u.cookie, '/api/freetime', { method: 'PATCH', json: body });

describe('instellingen (/api/freetime)', () => {
  it('standaard uit, 90 minuten, 09:00–21:00', async () => {
    const u = await createUser();
    expect(await json<View>(await callAs(u.cookie, '/api/freetime')))
      .toEqual({ on: false, minutes: 90, from: '09:00', to: '21:00', calendar: false });
  });

  it('aanzetten kan alleen met een gekoppelde agenda', async () => {
    const u = await createUser();
    expect((await patch(u, { on: true })).status).toBe(400);
    await addFeed(u);
    const v = await json<View>(await patch(u, { on: true, minutes: 60, from: '08:00', to: '18:00' }));
    expect(v).toEqual({ on: true, minutes: 60, from: '08:00', to: '18:00', calendar: true });
    expect((await json<View>(await patch(u, { on: false }))).on).toBe(false);
  });

  it('ongeldige waarden geven 400', async () => {
    const u = await createUser();
    expect((await patch(u, { minutes: 50 })).status).toBe(400);
    expect((await patch(u, { from: '25:00' })).status).toBe(400);
    expect((await patch(u, { from: '18:00', to: '09:00' })).status).toBe(400);
    expect((await patch(u, { on: 'ja' })).status).toBe(400);
  });

  it('alleen met een sessie', async () => {
    expect((await call('/api/freetime')).status).toBe(403);
  });
});

/** Sender die bijhoudt wie welke melding kreeg (in het Nederlands). */
function fakeSender() {
  const calls: { userId: string; payload: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, payload: make('nl') });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}
async function run(now: number) {
  const { send, calls } = fakeSender();
  await runFreeTime(env, await loadInstallPrefs(env), send, now);
  return calls;
}
const callsFor = (calls: Awaited<ReturnType<typeof run>>, u: User) => calls.filter((c) => c.userId === u.id);

/** Iemand met de functie aan en een verse, lege agenda. */
async function person() {
  const u = await createUser();
  const feed = await addFeed(u);
  await userSettingStmt(env.DB, u.id, KEYS.on, 'on').run();
  return { u, feed };
}

describe('de uurcheck', () => {
  it('vrij: één melding met Ja en Nee die het scherm opent', async () => {
    const { u } = await person();
    const mine = callsFor(await run(NOW), u);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({
      title: 'Tijd voor een taak?', body: 'Je agenda is vrij tot 21:00.', url: '/#/freetime', page: 'freetime',
      actions: [{ action: 'yes', title: 'Ja' }, { action: 'no', title: 'Nee' }],
    });
  });

  it('eens per uur, en per vrij stuk maar één melding', async () => {
    const { u, feed } = await person();
    expect(callsFor(await run(NOW), u)).toHaveLength(1);
    expect(callsFor(await run(NOW + 60_000), u)).toHaveLength(0); // zelfde uur
    expect(callsFor(await run(NOW + H), u)).toHaveLength(0); // zelfde vrije stuk
    // Morgen is een nieuw vrij stuk.
    await env.DB.prepare('UPDATE calendar_feeds SET fetched_at = ? WHERE id = ?').bind(new Date(NOW + 24 * H).toISOString(), feed).run();
    expect(callsFor(await run(NOW + 24 * H), u)).toHaveLength(1);
  });

  it('na een afspraak opnieuw', async () => {
    const { u, feed } = await person();
    await addEvent(u, feed, NOW + 2 * H, NOW + 3 * H); // 12:00–13:00
    const first = callsFor(await run(NOW), u);
    expect(first[0].payload.body).toBe('Je agenda is vrij tot 12:00.');
    await env.DB.prepare('UPDATE calendar_feeds SET fetched_at = ? WHERE id = ?').bind(new Date(NOW + 3 * H).toISOString(), feed).run();
    expect(callsFor(await run(NOW + 3 * H), u)).toHaveLength(1); // 13:00: nieuw stuk
  });

  it('niets bij een afspraak binnen de tijd, een oude agenda, een fout of de functie uit', async () => {
    const { u, feed } = await person();
    await addEvent(u, feed, NOW + H, NOW + 2 * H);
    expect(callsFor(await run(NOW), u)).toHaveLength(0);

    const old = await createUser();
    await addFeed(old, new Date(NOW - 3 * H).toISOString());
    await userSettingStmt(env.DB, old.id, KEYS.on, 'on').run();
    expect(callsFor(await run(NOW), old)).toHaveLength(0);

    const broken = await person();
    await addFeed(broken.u, new Date(NOW).toISOString(), 'error');
    expect(callsFor(await run(NOW), broken.u)).toHaveLength(0);

    const offUser = await createUser();
    await addFeed(offUser);
    expect(callsFor(await run(NOW), offUser)).toHaveLength(0);
  });

  it('een gewijzigde instelling telt meteen bij de volgende check', async () => {
    const { u } = await person();
    expect(callsFor(await run(NOW), u)).toHaveLength(1);
    await patch(u, { minutes: 120 });
    // Dezelfde check-uur en hetzelfde vrije stuk zijn vergeten: het volgende uur weer.
    expect(callsFor(await run(NOW + H), u)).toHaveLength(1);
  });
});

describe('swclick.js: Ja in de melding opent het scherm', () => {
  it('een open venster krijgt het scherm, anders opent /#/freetime', async () => {
    const fake: Record<string, any> = {};
    new Function('self', await (await call('/swclick.js')).text())(fake);
    const win = { focus: () => {} };
    expect(fake.tickClickTarget({ page: 'freetime', url: '/#/freetime' }, [win])).toEqual({ focus: win, message: { type: 'open-page', page: 'freetime' } });
    expect(fake.tickClickTarget({ page: 'freetime', url: '/#/freetime' }, [])).toEqual({ open: '/#/freetime' });
  });
});
