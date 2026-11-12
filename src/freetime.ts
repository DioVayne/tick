// Testfeature "Tijd voor een taak?" (freetime, zie src/features.ts): elk uur kijken of iemands agenda vanaf nu ruim
// vrij is, en dan één melding met Ja/Nee. Ja opent het scherm met zes willekeurige taken (public/freetimeview.js).
// Per persoon standaard uit. Alles hiervan staat in dit bestand, public/freetime.js en public/freetimeview.js;
// de instellingen zijn rijen `freetime_*` in user_settings (geen eigen tabel).
import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { calendarOn } from './calendar';
import { HttpError } from './errors';
import { testFeature } from './features';
import { sessionOnly } from './guards';
import { loadUserPrefs, userSettingStmt, validTime, type InstallPrefs } from './prefs';
import { sendToAll, type Locale, type Payload, type Sender } from './push';
import { inZone, type Zone } from './time';
import { DEFAULTS, MINUTES, freeUntil } from '../public/freetime.js';
import { translate } from '../public/i18n.js';
import { zonedParts } from '../public/repeat.js';

/** De rijen in user_settings van deze functie; weghalen = `DELETE FROM user_settings WHERE key LIKE 'freetime_%'`. */
export const KEYS = {
  on: 'freetime_on', minutes: 'freetime_minutes', from: 'freetime_from', to: 'freetime_to',
  /** Het uur (UTC, `YYYY-MM-DDTHH`) waarin de check voor het laatst draaide. */
  hour: 'freetime_hour',
  /** Het einde van het vrije stuk waarvoor al een melding ging (ISO); tot dan geen nieuwe. */
  until: 'freetime_until',
} as const;

/** Een agenda die langer dan dit niet is opgehaald, kan afspraken missen: dan geen melding. */
export const STALE_MS = 2 * 60 * 60_000;

/** Hoogstens zoveel mensen per cron-ronde (elke minuut); de rest is de volgende minuut aan de beurt. */
export const MAX_USERS = 10;

export type FreeTimePrefs = { on: boolean; minutes: number; from: string; to: string };

type Row = { key: string; value: string };

/** De instellingen uit de rijen van één persoon; een kapotte rij geeft de standaard. */
export function prefsFrom(rows: Row[]): FreeTimePrefs {
  const row = new Map(rows.map((r) => [r.key, r.value]));
  const minutes = Number(row.get(KEYS.minutes));
  const from = row.get(KEYS.from);
  const to = row.get(KEYS.to);
  const window = validTime(from) && validTime(to) && from < to ? { from, to } : { from: DEFAULTS.from, to: DEFAULTS.to };
  return { on: row.get(KEYS.on) === 'on', minutes: MINUTES.includes(minutes) ? minutes : DEFAULTS.minutes, ...window };
}

const clock = (ms: number, z: Zone) => inZone(z, () => {
  const p = zonedParts(ms);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
});

/** De melding: vraag met Ja/Nee; Ja (of tikken) opent het scherm met taken. `until` = tot hoe laat je vrij bent (HH:MM). */
export function freeTimePayload(until: string | null, locale?: string): Payload {
  return {
    title: translate(locale, 'ftt.push_title'),
    body: until ? translate(locale, 'ftt.push_body', { time: until }) : translate(locale, 'ftt.push_body_test'),
    url: '/#/freetime', page: 'freetime', tag: 'freetime',
    actions: [{ action: 'yes', title: translate(locale, 'ftt.yes') }, { action: 'no', title: translate(locale, 'ftt.no') }],
  };
}

/**
 * Cron-stap (alleen met de testfeature aan): voor wie hem heeft aangezet, eens per uur. Vrij = geen afspraak vanaf nu
 * tot minstens `minutes` minuten later, binnen het venster; alle agenda's van die persoon moeten de laatste twee uur
 * gelukt zijn. Per vrij stuk één melding: `until` onthoudt tot wanneer.
 */
export async function runFreeTime(env: Env, install: InstallPrefs, send: Sender = sendToAll, now = Date.now()): Promise<void> {
  const keys = Object.values(KEYS);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.role, s.key, s.value FROM users u JOIN user_settings s ON s.user_id = u.id
     WHERE u.id IN (SELECT user_id FROM user_settings WHERE key = ? AND value = 'on') AND s.key IN (${keys.map(() => '?').join(', ')})
     ORDER BY u.id`,
  ).bind(KEYS.on, ...keys).all<{ id: string; role: 'admin' | 'member'; key: string; value: string }>();
  const people = new Map<string, { user: { id: string; role: 'admin' | 'member' }; rows: Row[] }>();
  for (const r of results) {
    let p = people.get(r.id);
    if (!p) people.set(r.id, (p = { user: { id: r.id, role: r.role }, rows: [] }));
    p.rows.push({ key: r.key, value: r.value });
  }
  const hour = new Date(now).toISOString().slice(0, 13);
  let handled = 0;
  for (const { user, rows } of people.values()) {
    if (handled >= MAX_USERS) break;
    const row = new Map(rows.map((r) => [r.key, r.value]));
    if (row.get(KEYS.hour) === hour) continue;
    handled++;
    await userSettingStmt(env.DB, user.id, KEYS.hour, hour).run();
    const until = row.get(KEYS.until);
    if (until && now < Date.parse(until)) continue; // dit vrije stuk is al gemeld
    const { results: feeds } = await env.DB.prepare('SELECT status, fetched_at FROM calendar_feeds WHERE user_id = ?')
      .bind(user.id).all<{ status: string | null; fetched_at: string | null }>();
    if (!feeds.length || feeds.some((f) => f.status !== 'ok' || !f.fetched_at || Date.parse(f.fetched_at) < now - STALE_MS)) continue;
    const { results: events } = await env.DB.prepare(
      'SELECT start_at, end_at, all_day FROM calendar_events WHERE user_id = ? AND end_at > ? AND start_at < ?',
    ).bind(user.id, new Date(now).toISOString(), new Date(now + 86_400_000).toISOString())
      .all<{ start_at: string; end_at: string; all_day: number }>();
    const busy = events.map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at), allDay: !!e.all_day }));
    const prefs = await loadUserPrefs(env, user, Promise.resolve(rows));
    const free = inZone(prefs, () => freeUntil(busy, now, prefsFrom(rows)));
    if (free === null) continue;
    const time = clock(free, prefs);
    await send(env, user.id, (locale: Locale) => freeTimePayload(time, locale), install.defaultLocale);
    await userSettingStmt(env.DB, user.id, KEYS.until, new Date(free).toISOString()).run();
  }
}

// ---------- API (/api/freetime) ----------

export const freeTimeApi = new Hono<AppEnv>();
freeTimeApi.use('*', async (c, next) => {
  if (!testFeature(c.env, 'freetime')) throw new HttpError(404, 'err.not_found');
  await next();
});
freeTimeApi.use('*', sessionOnly);

async function view(env: Env, userId: string) {
  const { results } = await env.DB.prepare("SELECT key, value FROM user_settings WHERE user_id = ? AND key LIKE 'freetime_%'")
    .bind(userId).all<Row>();
  const feeds = calendarOn(env)
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_feeds WHERE user_id = ?').bind(userId).first<number>('n') : 0;
  return { ...prefsFrom(results), calendar: (feeds ?? 0) > 0 };
}

freeTimeApi.get('/', async (c) => c.json(await view(c.env, c.get('user').id)));

/** `{ on?, minutes?, from?, to? }`. Aanzetten kan alleen met een gekoppelde agenda. */
freeTimeApi.patch('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'err.invalid_json');
  const user = c.get('user');
  const now = await view(c.env, user.id);
  const next = { ...now };
  if ('on' in body) {
    if (typeof body.on !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'on' });
    next.on = body.on;
  }
  if ('minutes' in body) {
    if (typeof body.minutes !== 'number' || !MINUTES.includes(body.minutes)) throw new HttpError(400, 'err.ftt_minutes');
    next.minutes = body.minutes;
  }
  for (const k of ['from', 'to'] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (typeof v !== 'string' || !validTime(v)) throw new HttpError(400, 'err.ftt_window');
    next[k] = v;
  }
  if (next.from >= next.to) throw new HttpError(400, 'err.ftt_window');
  if (next.on && !now.on && !now.calendar) throw new HttpError(400, 'err.ftt_no_calendar');
  await c.env.DB.batch([
    userSettingStmt(c.env.DB, user.id, KEYS.on, next.on ? 'on' : null),
    userSettingStmt(c.env.DB, user.id, KEYS.minutes, String(next.minutes)),
    userSettingStmt(c.env.DB, user.id, KEYS.from, next.from),
    userSettingStmt(c.env.DB, user.id, KEYS.to, next.to),
    // Andere instellingen: het volgende uur opnieuw kijken, ook binnen een vrij stuk dat al gemeld was.
    userSettingStmt(c.env.DB, user.id, KEYS.hour, null),
    userSettingStmt(c.env.DB, user.id, KEYS.until, null),
  ]);
  return c.json(await view(c.env, c.get('user').id));
});

/** Proefmelding naar je eigen apparaten, los van je agenda. */
freeTimeApi.post('/test', async (c) => {
  const r = await sendToAll(c.env, c.get('user').id, (locale) => freeTimePayload(null, locale), c.get('prefs').defaultLocale);
  return c.json({ ok: r.ok > 0, total: r.total });
});
