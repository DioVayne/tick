import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { setSetting } from './prefs';

const MAX_NAME = 60;

/** Nieuwe sleutel: `tick_` + 32 willekeurige bytes als base64url (43 tekens). */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'tick_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 als hex; alleen dit wordt bewaard, nooit de sleutel zelf. */
export async function hashKey(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Maakt een sleutel aan en geeft hem eenmalig terug; alleen de hash komt in de database. */
export async function createKey(db: D1Database, userId: string, name: string, kind: 'full' | 'inbox') {
  const key = newKey();
  const row = { id: crypto.randomUUID(), name, kind, hint: key.slice(-4), created_at: new Date().toISOString() };
  await db.prepare('INSERT INTO api_keys (id, name, kind, hash, hint, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.name, row.kind, await hashKey(key), row.hint, row.created_at, userId).run();
  return { ...row, key };
}

export const keysApi = new Hono<AppEnv>();
keysApi.use('*', sessionOnly);

// De oude secrets (API_TOKEN, INBOX_TOKEN) staan als vaste rijen in de lijst.
const ENV_KEYS = {
  'env-api': { kind: 'full', secret: 'API_TOKEN', off: 'env_api_token_off', used: 'env_api_token_used' },
  'env-inbox': { kind: 'inbox', secret: 'INBOX_TOKEN', off: 'env_inbox_token_off', used: 'env_inbox_token_used' },
} as const;
type EnvId = keyof typeof ENV_KEYS;
const isEnvId = (id: string): id is EnvId => Object.hasOwn(ENV_KEYS, id);

keysApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, kind, hint, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at, id').bind(c.get('auth').userId).all();
  const prefs = c.get('install');
  const off = { 'env-api': prefs.envApiTokenOff, 'env-inbox': prefs.envInboxTokenOff };
  const used = { 'env-api': prefs.envApiTokenUsed, 'env-inbox': prefs.envInboxTokenUsed };
  const envRows = (Object.keys(ENV_KEYS) as EnvId[])
    .filter((id) => c.get('user').role === 'admin' && !!c.env[ENV_KEYS[id].secret])
    .map((id) => ({ id, kind: ENV_KEYS[id].kind, off: off[id], last_used_at: used[id] }));
  return c.json({ keys: results, env: envRows });
});

keysApi.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME) throw new HttpError(400, 'err.invalid_key_name');
  if (body.kind !== 'full' && body.kind !== 'inbox') throw new HttpError(400, 'err.invalid_key_kind');
  return c.json(await createKey(c.env.DB, c.get('auth').userId, name, body.kind), 201);
});

keysApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isEnvId(id)) throw new HttpError(404, 'err.not_found');
  if (c.get('user').role !== 'admin') throw new HttpError(403, 'err.admin_only');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  if (typeof body.off !== 'boolean') throw new HttpError(400, 'err.invalid_off');
  await setSetting(c.env.DB, ENV_KEYS[id].off, body.off ? '1' : null);
  return c.json({ ok: true });
});

keysApi.delete('/:id', async (c) => {
  const id = c.req.param('id');
  // Alleen een eigen sleutel; het devices-rijtje gaat mee, maar alleen als de sleutel echt van deze gebruiker is.
  const own = await c.env.DB.prepare('SELECT id FROM api_keys WHERE id = ? AND user_id = ?').bind(id, c.get('auth').userId).first();
  if (!own) throw new HttpError(404, 'err.not_found');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').bind(id, c.get('auth').userId),
    c.env.DB.prepare('DELETE FROM devices WHERE key_id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});
