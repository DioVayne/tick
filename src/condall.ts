import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { testFeature } from './features';
import { userSettingStmt } from './prefs';
import { notifyUser, reminderPayload, type Locale, type Sender } from './push';
import { HA_TTL } from './hatrigger';
import { translate } from '../public/i18n.js';

/**
 * Testfeature "condall": condities bij een taak combineren (plan: docs/superpowers/specs/2026-11-28-condities-en-of.md,
 * stap 1). Heeft een taak een tijd én een plek, of een tijd én een Home Assistant-trigger, dan kiest de eigenaar
 * "Elke apart" (zoals altijd: elke soort meldt los) of "Pas als alles klopt": één melding, op het moment dat het
 * laatste gebeurt terwijl de rest klopt. De tijd wordt dan "vanaf".
 * - Tijd + plek beslist de Android-telefoon (CondAll.java): vóór de tijd zet hij geen geofence; op de tijd zet hij er
 *   een (bij aankomst met initial trigger, zodat "je bent er al" ook meldt; bij vertrek alleen een echt vertrek).
 *   De server stuurt de telefoon `conditions: "all"` in GET /api/tasks, en stuurt zelf geen tijdmelding.
 * - Tijd + trigger beslist de server: een trigger vóór de tijd wordt onthouden (`condall:held`) en op de tijd gestuurd
 *   door de cron; een trigger na de tijd meldt meteen (gewoon hatrigger).
 * - Plek + trigger samen kan niet (Tick weet niet waar je bent): dan geldt "Elke apart", ook als de keuze er nog staat.
 *
 * Opslag zonder migratie, in `user_settings` van de eigenaar van de taak:
 * - `condall:tasks`: { taskId: true } voor de taken met "Pas als alles klopt";
 * - `condall:held`: { taskId: { by, name, rep, at } }, een trigger die vóór de tijd afging en op de tijd moet melden.
 */
export const ROW_TASKS = 'condall:tasks';
export const ROW_HELD = 'condall:held';
export const MAX_TASKS = 300;
/**
 * Vanaf deze versie kent de Android-app `conditions: "all"`. Een oudere app meldt de plek meteen (te vroeg), dus met
 * een plek is "Pas als alles klopt" pas te kiezen met zo'n telefoon.
 */
export const MIN_APP = '1.15.7';

type Held = { by: string; name: string; rep: string | null; at: string };

export const on = (env: Pick<Env, 'TEST_FEATURES'>) => testFeature(env, 'condall');

/** "1.15.7" ≥ "1.15.6"? Per getal vergeleken; iets dat geen versie is, telt als te oud. */
export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*/.exec(v.trim())?.[0] ?? '').split('.').filter(Boolean).map(Number);
  const a = parse(version ?? '');
  if (!a.length) return false;
  const b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Mag deze taak "alles" zijn? Alleen tijd + plek of tijd + trigger (niet plek + trigger, ook niet met een tijd erbij).
 * Geeft de soort die met de tijd samengaat, of null.
 */
export function combo(t: { remind_at: string | null; loc_lat?: number | null; location?: unknown }, hasHa: boolean): 'place' | 'ha' | null {
  const place = t.location !== undefined ? !!t.location : t.loc_lat != null;
  if (!t.remind_at || place === hasHa) return null;
  return place ? 'place' : 'ha';
}

/** De rijen `key` van deze gebruikers: userId -> object (kapotte JSON telt als leeg). */
async function rowsOf<T>(env: Env, key: string, userIds: string[]): Promise<Map<string, Record<string, T>>> {
  const out = new Map<string, Record<string, T>>();
  if (!userIds.length) return out;
  const { results } = await env.DB.prepare('SELECT user_id, value FROM user_settings WHERE key = ? AND user_id IN (SELECT value FROM json_each(?))')
    .bind(key, JSON.stringify([...new Set(userIds)])).all<{ user_id: string; value: string }>();
  for (const r of results) {
    try {
      const v = JSON.parse(r.value);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.set(r.user_id, v as Record<string, T>);
    } catch { /* leeg */ }
  }
  return out;
}

/** Heeft de taak Home Assistant-triggers (de keuze van de eigenaar in `hatrigger:tasks`)? */
const haOf = (links: Map<string, Record<string, { ids?: unknown }>>, owner: string, taskId: string) => {
  const ids = links.get(owner)?.[taskId]?.ids;
  return Array.isArray(ids) && ids.length > 0;
};

/** Per taak de soort waarmee "alles" echt geldt (keuze aan, en een toegestane combinatie). */
async function effective(env: Env, tasks: { id: string; user_id: string; parent_id: string | null; remind_at: string | null; loc_lat?: number | null; location?: unknown }[]) {
  const out = new Map<string, 'place' | 'ha'>();
  const top = tasks.filter((t) => !t.parent_id && t.remind_at);
  if (!top.length) return out;
  const owners = top.map((t) => t.user_id);
  const [flags, links] = await Promise.all([rowsOf<boolean>(env, ROW_TASKS, owners), rowsOf<{ ids?: unknown }>(env, 'hatrigger:tasks', owners)]);
  for (const t of top) {
    if (flags.get(t.user_id)?.[t.id] !== true) continue;
    const kind = combo(t, haOf(links, t.user_id, t.id));
    if (kind) out.set(t.id, kind);
  }
  return out;
}

/**
 * GET /api/tasks (marked "condall" in src/index.ts): `conditions: "all"` bij taken met tijd + plek in de stand "alles",
 * zodat de Android-app de plek pas na de tijd bewaakt.
 */
export async function markConditions<T extends { id: string; user_id: string; parent_id: string | null; remind_at: string | null; location: unknown }>(env: Env, tasks: T[]): Promise<void> {
  const eff = await effective(env, tasks);
  for (const t of tasks) if (eff.get(t.id) === 'place') (t as T & { conditions?: string }).conditions = 'all';
}

/**
 * Cron (runReminders, marked "condall" in src/push.ts): taken in de stand "alles" krijgen op de tijd geen gewone
 * herinnering. Is er een trigger die vóór de tijd afging, dan nu zijn melding; de tijd telt daarna als gemeld
 * (`notified`), zodat een trigger na de tijd meteen meldt. Geeft de taken die de gewone ronde moet overslaan.
 */
export async function gateReminders(env: Env, due: { id: string; user_id: string; parent_id: string | null; title: string; description: string; remind_at: string; repeat_at: string | null }[],
  defaultLocale: Locale, send: Sender): Promise<Set<string>> {
  if (!due.length) return new Set();
  const ids = due.map((t) => t.id);
  const locs = new Map((await env.DB.prepare('SELECT id, loc_lat FROM tasks WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all<{ id: string; loc_lat: number | null }>()).results.map((r) => [r.id, r.loc_lat]));
  const eff = await effective(env, due.map((t) => ({ ...t, loc_lat: locs.get(t.id) ?? null })));
  if (!eff.size) return new Set();
  const held = await rowsOf<Held>(env, ROW_HELD, due.filter((t) => eff.has(t.id)).map((t) => t.user_id));
  const now = new Date().toISOString();
  for (const t of due) {
    if (!eff.has(t.id)) continue;
    const h = held.get(t.user_id)?.[t.id];
    if (eff.get(t.id) === 'ha' && h && (h.rep ?? null) === (t.repeat_at ?? null)) {
      // Claimen zoals hatrigger (één keer, ook als een tweede cron tegelijk loopt): wie de rij krijgt, stuurt.
      const claim = await env.DB.prepare(
        `INSERT INTO hatrigger_fired (task_id, user_id, fired, rep, fired_by) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(task_id) DO UPDATE SET user_id = excluded.user_id, fired = excluded.fired, rep = excluded.rep, fired_by = excluded.fired_by
         WHERE excluded.rep IS NOT NULL AND excluded.rep IS NOT hatrigger_fired.rep
         RETURNING task_id`,
      ).bind(t.id, t.user_id, now, t.repeat_at, h.by).all();
      if (claim.results.length) {
        const shares = (await env.DB.prepare("SELECT to_user FROM task_shares WHERE task_id = ? AND status = 'accepted' AND mode = 'shared'")
          .bind(t.id).all<{ to_user: string }>()).results;
        const make = (locale: Locale) => ({ ...reminderPayload(t, locale), body: translate(locale, 'hatrigger.push_body', { name: h.name }), tag: `hatrigger-${t.id}` });
        await Promise.all([...new Set([t.user_id, ...shares.map((s) => s.to_user)])]
          .map((who) => notifyUser(env, who, make, defaultLocale, send, { ttl: HA_TTL })));
      }
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ? AND remind_at = ?').bind(t.id, t.remind_at),
      clearHeldStmt(env, t.user_id, t.id),
    ]);
  }
  return new Set(eff.keys());
}

/**
 * POST /api/hatrigger/fire (marked "condall" in src/hatrigger.ts): taken in de stand "alles" waarvan de tijd nog niet
 * daar is, onthouden de trigger (de eerste telt) in plaats van te melden. Geeft hun id's; die slaat fire over.
 */
export async function holdEarly(env: Env, userId: string, rows: { id: string; remind_at?: string | null; loc_lat?: number | null; repeat_at: string | null }[],
  linkId: string, name: string, now: string): Promise<Set<string>> {
  const early = rows.filter((r) => r.remind_at && r.remind_at > now);
  if (!early.length) return new Set();
  const eff = await effective(env, early.map((r) => ({ ...r, user_id: userId, parent_id: null, remind_at: r.remind_at ?? null })));
  const hold = early.filter((r) => eff.get(r.id) === 'ha');
  if (!hold.length) return new Set();
  await env.DB.batch(hold.map((r) => env.DB.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?1, ?2, json_object(?3, json(?4)))
     ON CONFLICT(user_id, key) DO UPDATE SET value = json_insert(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$."' || ?3 || '"', json(?4))`,
  ).bind(userId, ROW_HELD, r.id, JSON.stringify({ by: linkId, name, rep: r.repeat_at, at: now } satisfies Held))));
  return new Set(hold.map((r) => r.id));
}

/** Een onthouden trigger van een taak vergeten (bij een andere keuze, Opnieuw melden of de cron). */
export const clearHeldStmt = (env: Env, userId: string, taskId: string) => env.DB.prepare(
  `UPDATE user_settings SET value = json_remove(value, '$."' || ?3 || '"') WHERE user_id = ?1 AND key = ?2 AND json_valid(value)`,
).bind(userId, ROW_HELD, taskId);

// ---------- routes (alleen met de testfeature aan) ----------

export const condAllApi = new Hono<AppEnv>();

condAllApi.use('*', async (c, next) => {
  if (!on(c.env)) throw new HttpError(404, 'err.not_found');
  await next();
});

/** Heeft deze persoon een Android-telefoon met een app die het kan (laatst gemelde versie)? */
async function appReady(env: Env, userId: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    "SELECT d.app_version FROM devices d JOIN api_keys k ON k.id = d.key_id WHERE k.kind = 'full' AND k.user_id = ?",
  ).bind(userId).all<{ app_version: string | null }>();
  return results.some((r) => versionAtLeast(r.app_version, MIN_APP));
}

/** De taken in de stand "alles" (van mij), wat Tick onthield, en of mijn telefoon het kan. */
condAllApi.get('/', async (c) => {
  const userId = c.get('auth').userId;
  const [flags, held, app] = await Promise.all([rowsOf<boolean>(c.env, ROW_TASKS, [userId]), rowsOf<Held>(c.env, ROW_HELD, [userId]), appReady(c.env, userId)]);
  const tasks = Object.entries(flags.get(userId) ?? {}).filter(([, v]) => v === true).map(([id]) => id);
  const waiting = Object.fromEntries(Object.entries(held.get(userId) ?? {}).map(([id, h]) => [id, { name: h.name, at: h.at }]));
  return c.json({ tasks, held: waiting, app, minApp: MIN_APP });
});

/**
 * De keuze bij een eigen hoofdtaak: `{ all: true }` of `{ all: false }`. Zet de taak altijd weer klaar (plek en trigger
 * opnieuw meldbaar, onthouden trigger weg), net als een andere plek of trigger.
 */
condAllApi.put('/tasks/:id', async (c) => {
  const userId = c.get('auth').userId;
  const taskId = c.req.param('id');
  const body = await c.req.json<{ all?: unknown }>().catch(() => ({} as { all?: unknown }));
  if (typeof body.all !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'all' });
  const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ? AND parent_id IS NULL AND deleted_at IS NULL')
    .bind(taskId, userId).first<{ id: string }>();
  if (!task) throw new HttpError(404, 'err.not_found');
  const flags = (await rowsOf<boolean>(c.env, ROW_TASKS, [userId])).get(userId) ?? {};
  // Opruimen: taken die er niet meer zijn (definitief weg) hoeven niet te blijven staan.
  const alive = new Set((await c.env.DB.prepare('SELECT id FROM tasks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(userId, JSON.stringify(Object.keys(flags))).all<{ id: string }>()).results.map((r) => r.id));
  const next: Record<string, true> = {};
  for (const id of Object.keys(flags)) if (alive.has(id) && flags[id] === true) next[id] = true;
  if (body.all) next[taskId] = true; else delete next[taskId];
  if (body.all && Object.keys(next).length > MAX_TASKS) throw new HttpError(400, 'err.condall_too_many', { max: MAX_TASKS });
  await c.env.DB.batch([
    userSettingStmt(c.env.DB, userId, ROW_TASKS, Object.keys(next).length ? JSON.stringify(next) : null),
    clearHeldStmt(c.env, userId, taskId),
    c.env.DB.prepare('DELETE FROM hatrigger_fired WHERE task_id = ?').bind(taskId),
    c.env.DB.prepare('UPDATE tasks SET loc_notified = 0 WHERE id = ?').bind(taskId),
    c.env.DB.prepare('UPDATE task_shares SET loc_notified = 0 WHERE task_id = ?').bind(taskId),
  ]);
  return c.json({ task: taskId, all: body.all });
});
