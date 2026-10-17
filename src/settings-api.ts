import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { settingStmt, userSettingStmt, type Prefs } from './prefs';
import { postWebhook } from './push';
import { shiftWallClock } from './time';
import { setDefaultTime, setTimeZone } from '../public/repeat.js';
import { translate } from '../public/i18n.js';

export const settingsApi = new Hono<AppEnv>();
settingsApi.use('*', sessionOnly);

const MAX_WEBHOOK = 2000;

/** Het antwoord van de API; de URL uit FALLBACK_WEBHOOK is een secret en gaat nooit mee (alleen dat hij er is). */
function view(p: Prefs) {
  const { timeZone, reminderTime, weekStart, defaultLocale, fallbackFromEnv, fallbackOverride, fallbackEnvSet } = p;
  const fallbackWebhook = fallbackFromEnv ? null : p.fallbackWebhook;
  return { timeZone, reminderTime, weekStart, defaultLocale, fallbackWebhook, fallbackFromEnv, fallbackOverride, fallbackEnvSet };
}

const validZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

function validWebhook(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > MAX_WEBHOOK || !v.startsWith('https://')) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Statements die de open taken van één gebruiker omzetten naar een andere zone met dezelfde wandklok; afgeronde taken en taken zonder
 * moment blijven staan. Ze gaan in dezelfde batch als de instelling, zodat het alles of niets is.
 */
async function timeZoneShift(db: D1Database, userId: string, from: string, to: string): Promise<D1PreparedStatement[]> {
  const rows = (await db.prepare('SELECT id, remind_at, repeat_start, repeat_at FROM tasks WHERE done = 0 AND user_id = ?').bind(userId).all<{
    id: string; remind_at: string | null; repeat_start: string | null; repeat_at: string | null;
  }>()).results;
  const shift = (v: string | null) => (v === null ? null : shiftWallClock(v, from, to));
  return rows
    .filter((r) => r.remind_at !== null || r.repeat_start !== null || r.repeat_at !== null)
    .map((r) => db.prepare('UPDATE tasks SET remind_at = ?, repeat_start = ?, repeat_at = ?, repeat_prev = NULL WHERE id = ?')
      .bind(shift(r.remind_at), shift(r.repeat_start), shift(r.repeat_at), r.id));
}

settingsApi.get('/', (c) => c.json(view(c.get('prefs'))));

settingsApi.patch('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const prefs = c.get('prefs');
  const userId = c.get('auth').userId;
  const next = { ...prefs };
  // Instellingen van de gebruiker (user_settings) en van de installatie (settings, alleen de beheerder).
  const writes: [string, string | null][] = [];
  const installWrites: [string, string | null][] = [];

  if ('timeZone' in body) {
    if (!validZone(body.timeZone)) throw new HttpError(400, 'err.invalid_timezone');
    next.timeZone = body.timeZone;
    writes.push(['timezone', body.timeZone]);
  }
  if ('reminderTime' in body) {
    if (typeof body.reminderTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.reminderTime)) throw new HttpError(400, 'err.invalid_time');
    next.reminderTime = body.reminderTime;
    writes.push(['reminder_time', body.reminderTime]);
  }
  if ('weekStart' in body) {
    if (body.weekStart !== 'mon' && body.weekStart !== 'sun') throw new HttpError(400, 'err.invalid_week_start');
    next.weekStart = body.weekStart;
    writes.push(['week_start', body.weekStart]);
  }
  if ('defaultLocale' in body) {
    if (c.get('user').role !== 'admin') throw new HttpError(403, 'err.admin_only');
    if (body.defaultLocale !== 'en' && body.defaultLocale !== 'nl') throw new HttpError(400, 'err.invalid_locale');
    next.defaultLocale = body.defaultLocale;
    installWrites.push(['default_locale', body.defaultLocale]);
  }
  if ('fallbackWebhook' in body) {
    // Een geplakte URL kan witruimte of een BOM (U+FEFF, uit Windows) meekrijgen; trim() haalt beide weg.
    const v = typeof body.fallbackWebhook === 'string' ? body.fallbackWebhook.trim() : body.fallbackWebhook;
    if (v !== null && v !== '' && !validWebhook(v)) throw new HttpError(400, 'err.invalid_webhook');
    writes.push(['fallback_webhook', v as string | null]);
    // null wist de rij (de secret geldt weer); '' is een rij die hem uitzet.
    next.fallbackOverride = v !== null;
    next.fallbackFromEnv = v === null && next.fallbackEnvSet;
    // FALLBACK_WEBHOOK telt alleen voor de beheerder; voor een lid is fallbackEnvSet altijd false.
    next.fallbackWebhook = v === null ? (next.fallbackEnvSet && c.env.FALLBACK_WEBHOOK) || null : (v as string) || null;
  }

  // Taken omzetten en instellingen schrijven in één batch: alles of niets. Dezelfde zone nog eens kiezen verschuift niets.
  const db = c.env.DB;
  const stmts = next.timeZone !== prefs.timeZone ? await timeZoneShift(db, userId, prefs.timeZone, next.timeZone) : [];
  for (const [key, value] of writes) stmts.push(userSettingStmt(db, userId, key, value));
  for (const [key, value] of installWrites) stmts.push(settingStmt(db, key, value));
  if (stmts.length) await db.batch(stmts);
  setTimeZone(next.timeZone);
  setDefaultTime(next.reminderTime);
  c.set('prefs', next);
  return c.json(view(next));
});

settingsApi.post('/webhook-test', async (c) => {
  const url = c.get('prefs').fallbackWebhook;
  if (!url) throw new HttpError(400, 'err.no_webhook');
  const ok = await postWebhook(url, { title: 'Tick', body: translate(c.get('lang'), 'push.test_body'), url: '/' });
  return c.json({ ok });
});
