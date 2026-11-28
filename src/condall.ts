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
 * - Plek + trigger (met of zonder tijd; Q-9, app ≥ MIN_APP_BOTH) beslist de telefoon, want alleen die weet waar je
 *   bent. De server onthoudt de trigger (`condall:held`, elke keer, ook na de tijd) en stuurt zelf niets; in
 *   GET /api/tasks krijgt de taak `conditions: "all"` en `trigger_at` (wanneer de trigger afging, of null). De app
 *   bewaakt de plek pas vanaf de laatste van tijd en trigger (aankomen: "je bent er al" telt; vertrekken: alleen een
 *   echt vertrek daarna). De server kan de app niet wekken (er is geen stille push): de app hoort van de trigger bij de
 *   volgende sync (elke ~15 minuten, of meteen als je de app opent).
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
/** Vanaf deze versie kent de app `trigger_at` (plek + trigger samen); een oudere app zou de trigger negeren. */
export const MIN_APP_BOTH = '1.15.8';

/** De soort combinatie: tijd + plek, tijd + trigger, of plek + trigger (met of zonder tijd). */
export type Kind = 'place' | 'ha' | 'both';

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
 * Mag deze taak "alles" zijn, en welke combinatie is het? Tijd + plek ('place'), tijd + trigger ('ha'), of plek +
 * trigger, met of zonder tijd ('both'). Eén soort alleen: null.
 */
export function combo(t: { remind_at: string | null; loc_lat?: number | null; location?: unknown }, hasHa: boolean): Kind | null {
  const place = t.location !== undefined ? !!t.location : t.loc_lat != null;
  if (place && hasHa) return 'both';
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
  const out = new Map<string, Kind>();
  const top = tasks.filter((t) => !t.parent_id && (t.remind_at || (t.location !== undefined ? !!t.location : t.loc_lat != null)));
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

/** De onthouden trigger van deze keer van de taak (`rep` = repeat_at), of null: een vorige keer telt niet meer. */
const heldNow = (h: Held | undefined, rep: string | null | undefined) => (h && (h.rep ?? null) === (rep ?? null) ? h : null);

/**
 * GET /api/tasks (marked "condall" in src/index.ts): `conditions: "all"` bij taken met een plek in de stand "alles",
 * zodat de Android-app de plek pas na de tijd bewaakt; met een trigger erbij ook `trigger_at` (wanneer hij deze keer
 * afging, of null), zodat de app de plek pas daarna bewaakt.
 */
export async function markConditions<T extends { id: string; user_id: string; parent_id: string | null; remind_at: string | null; location: unknown; repeat?: { at: string } | null }>(env: Env, tasks: T[]): Promise<void> {
  const eff = await effective(env, tasks);
  const both = tasks.filter((t) => eff.get(t.id) === 'both');
  const held = both.length ? await rowsOf<Held>(env, ROW_HELD, both.map((t) => t.user_id)) : new Map<string, Record<string, Held>>();
  for (const t of tasks) {
    const kind = eff.get(t.id);
    if (kind !== 'place' && kind !== 'both') continue;
    const out = t as T & { conditions?: string; trigger_at?: string | null };
    out.conditions = 'all';
    if (kind === 'both') out.trigger_at = heldNow(held.get(t.user_id)?.[t.id], t.repeat?.at)?.at ?? null;
  }
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
    const h = heldNow(held.get(t.user_id)?.[t.id], t.repeat_at);
    if (eff.get(t.id) === 'ha' && h) {
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
    // Met een plek erbij ('both') blijft de trigger onthouden: de telefoon wacht er nog op.
    await env.DB.batch([
      env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ? AND remind_at = ?').bind(t.id, t.remind_at),
      ...(eff.get(t.id) === 'both' ? [] : [clearHeldStmt(env, t.user_id, t.id)]),
    ]);
  }
  return new Set(eff.keys());
}

/**
 * POST /api/hatrigger/fire (marked "condall" in src/hatrigger.ts): taken in de stand "alles" onthouden de trigger in
 * plaats van te melden: tijd + trigger als de tijd nog niet daar is (de cron meldt op de tijd), plek + trigger altijd
 * (de telefoon meldt, zie markConditions). De eerste keer telt; een onthouden trigger van een vorige keer van een
 * herhalende taak (andere `rep`) wordt overschreven. Geeft hun id's; die slaat fire over.
 */
export async function holdEarly(env: Env, userId: string, rows: { id: string; remind_at?: string | null; loc_lat?: number | null; repeat_at: string | null }[],
  linkId: string, name: string, now: string): Promise<Set<string>> {
  if (!rows.length) return new Set();
  const eff = await effective(env, rows.map((r) => ({ ...r, user_id: userId, parent_id: null, remind_at: r.remind_at ?? null })));
  const hold = rows.filter((r) => eff.get(r.id) === 'both' || (eff.get(r.id) === 'ha' && !!r.remind_at && r.remind_at > now));
  if (!hold.length) return new Set();
  await env.DB.batch(hold.map((r) => env.DB.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?1, ?2, json_object(?3, json(?4)))
     ON CONFLICT(user_id, key) DO UPDATE SET value = CASE
       WHEN json_valid(value) AND json_type(value, '$."' || ?3 || '"') IS NOT NULL AND json_extract(value, '$."' || ?3 || '".rep') IS ?5 THEN value
       ELSE json_set(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$."' || ?3 || '"', json(?4)) END`,
  ).bind(userId, ROW_HELD, r.id, JSON.stringify({ by: linkId, name, rep: r.repeat_at, at: now } satisfies Held), r.repeat_at)));
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

/** De laatst gemelde app-versies van de Android-telefoons van deze persoon. */
async function appVersions(env: Env, userId: string): Promise<(string | null)[]> {
  const { results } = await env.DB.prepare(
    "SELECT d.app_version FROM devices d JOIN api_keys k ON k.id = d.key_id WHERE k.kind = 'full' AND k.user_id = ?",
  ).bind(userId).all<{ app_version: string | null }>();
  return results.map((r) => r.app_version);
}

/**
 * De taken in de stand "alles" (van mij), wat Tick onthield (met `rep`: de PWA toont een vorige keer niet), en of mijn
 * telefoon het kan: `app` voor tijd + plek, `appBoth` voor plek + trigger.
 */
condAllApi.get('/', async (c) => {
  const userId = c.get('auth').userId;
  const [flags, held, versions] = await Promise.all([rowsOf<boolean>(c.env, ROW_TASKS, [userId]), rowsOf<Held>(c.env, ROW_HELD, [userId]), appVersions(c.env, userId)]);
  const tasks = Object.entries(flags.get(userId) ?? {}).filter(([, v]) => v === true).map(([id]) => id);
  const waiting = Object.fromEntries(Object.entries(held.get(userId) ?? {}).map(([id, h]) => [id, { name: h.name, at: h.at, rep: h.rep ?? null }]));
  return c.json({
    tasks, held: waiting,
    app: versions.some((v) => versionAtLeast(v, MIN_APP)), appBoth: versions.some((v) => versionAtLeast(v, MIN_APP_BOTH)),
    minApp: MIN_APP, minAppBoth: MIN_APP_BOTH,
  });
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
