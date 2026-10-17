import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';

const MAX_NAME = 100;
const MAX_VERSION = 50;
const LOCATIONS = ['always', 'foreground', 'off'];

/** Apparaten die zich melden: alleen een volledige sleutel (de Android-app), geen sessie en geen inbox-sleutel. */
export const deviceApi = new Hono<AppEnv>();

deviceApi.post('/', async (c) => {
  const auth = c.get('auth');
  if (auth?.kind !== 'token') return c.text('Forbidden', 403);
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'err.invalid_json');
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const version = b.app_version === undefined || b.app_version === null ? null : b.app_version;
  if (!name || name.length > MAX_NAME || typeof b.notifications !== 'boolean' || typeof b.location !== 'string' || !LOCATIONS.includes(b.location)
    || (version !== null && (typeof version !== 'string' || version.length > MAX_VERSION))) {
    throw new HttpError(400, 'err.invalid_device');
  }
  await c.env.DB.prepare(
    'INSERT INTO devices (key_id, name, notifications, location, app_version, seen_at) VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(key_id) DO UPDATE SET name=excluded.name, notifications=excluded.notifications, location=excluded.location, ' +
    'app_version=excluded.app_version, seen_at=excluded.seen_at',
  ).bind(auth.keyId, name, b.notifications ? 1 : 0, b.location, version, new Date().toISOString()).run();
  return c.json({ ok: true });
});

/** Overzicht voor de instellingen: browsers met een push-abonnement en telefoons (alle volledige sleutels) met hun laatst gemelde status. */
export const devicesApi = new Hono<AppEnv>();
devicesApi.use('*', sessionOnly);

type Status = { name: string; notifications: number; location: string; app_version: string | null; seen_at: string };

devicesApi.get('/', async (c) => {
  const db = c.env.DB;
  const prefs = c.get('prefs');
  const [browsers, keys, devices] = await Promise.all([
    db.prepare('SELECT endpoint, user_agent, created_at, locale FROM push_subscriptions ORDER BY created_at, endpoint').all(),
    db.prepare("SELECT id, name, last_used_at FROM api_keys WHERE kind = 'full' ORDER BY created_at, id").all<{ id: string; name: string; last_used_at: string | null }>(),
    db.prepare('SELECT key_id, name, notifications, location, app_version, seen_at FROM devices').all<Status & { key_id: string }>(),
  ]);
  const status = new Map(devices.results.map((d) => [d.key_id, d]));
  const phones = keys.results.map((k) => ({ key_id: k.id, name: k.name as string | null, last_used_at: k.last_used_at }));
  if (c.env.API_TOKEN && !prefs.envApiTokenOff) phones.push({ key_id: 'env-api', name: null, last_used_at: prefs.envApiTokenUsed });
  return c.json({
    browsers: browsers.results,
    phones: phones.map((p) => {
      const d = status.get(p.key_id);
      return { ...p, status: d ? { name: d.name, notifications: !!d.notifications, location: d.location, app_version: d.app_version, seen_at: d.seen_at } : null };
    }),
  });
});
