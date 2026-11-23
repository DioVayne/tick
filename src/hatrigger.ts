import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { testFeature } from './features';
import { userSettingStmt } from './prefs';
import { inBackground, notifyUser, reminderPayload, type Locale } from './push';
import { translate } from '../public/i18n.js';

/**
 * Testfeature "hatrigger": triggers uit Home Assistant. De HA-integratie (home-assistant/custom_components/tick) stuurt
 * het lijstje triggers ("Sam komt thuis", "Zon onder") met PUT /triggers en vuurt er een af met POST /fire. In het
 * taakpaneel kies je bij een taak een of meer triggers; de eerste die afgaat geeft één melding, net als een plek.
 * Daarna is de taak "gemeld" tot je op Opnieuw melden tikt, de triggers wijzigt, of een herhalende taak doorschuift.
 *
 * Geen migratie (regel voor testfeatures): alles staat in twee rijen van `user_settings`:
 * - `hatrigger:triggers`: [{ id, name, entity, last }] (HA schrijft het lijstje, `last` = laatst afgegaan);
 * - `hatrigger:tasks`: { taskId: { ids, fired, rep } } (`fired` = wanneer gemeld, `rep` = de keer van een herhalende taak);
 * - `hatrigger:seen`: wanneer HA (een full-sleutel) laatst iets liet horen. De integratie meldt zich elke 6 uur. Is dat
 *   langer dan STALE_DAYS geleden (integratie weg, sleutel ingetrokken), dan toont Tick de triggers niet meer; de rijen
 *   blijven staan, dus komt HA terug, dan is alles er weer.
 */
export const HATRIGGER = 'hatrigger';
const ROW_TRIGGERS = 'hatrigger:triggers';
const ROW_TASKS = 'hatrigger:tasks';
const ROW_SEEN = 'hatrigger:seen';
export const STALE_DAYS = 21;
/** Zo vaak hoogstens `seen` bijwerken: elke aanroep schrijven is zonde. */
const SEEN_EVERY_MS = 60 * 60_000;
export const MAX_TRIGGERS = 50;
export const MAX_TASKS = 300;
const MAX_NAME = 60;

export type HaTrigger = { id: string; name: string; entity: string | null; last: string | null };
export type HaTaskLink = { ids: string[]; fired: string | null; rep: string | null };
type Links = Record<string, HaTaskLink>;

async function readRow<T>(env: Env, userId: string, key: string, empty: T): Promise<T> {
  const row = await env.DB.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').bind(userId, key).first<{ value: string }>();
  if (!row) return empty;
  try { return JSON.parse(row.value) as T; } catch { return empty; }
}
const readTriggers = (env: Env, userId: string) => readRow<HaTrigger[]>(env, userId, ROW_TRIGGERS, []);
const readLinks = (env: Env, userId: string) => readRow<Links>(env, userId, ROW_TASKS, {});
const writeTriggers = (env: Env, userId: string, list: HaTrigger[]) => userSettingStmt(env.DB, userId, ROW_TRIGGERS, list.length ? JSON.stringify(list) : null);
const writeLinks = (env: Env, userId: string, links: Links) => userSettingStmt(env.DB, userId, ROW_TASKS, Object.keys(links).length ? JSON.stringify(links) : null);

const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/** Het lijstje van HA, schoon: geldige id's, een naam van 1 tot 60 tekens, elke id één keer, hoogstens 50. */
export function cleanTriggers(raw: unknown, old: HaTrigger[]): HaTrigger[] {
  if (!Array.isArray(raw) || raw.length > MAX_TRIGGERS) throw new HttpError(400, 'err.hatrigger_invalid');
  const seen = new Set<string>();
  const out: HaTrigger[] = [];
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim() : '';
    if (!validId(r.id) || !name || name.length > MAX_NAME) throw new HttpError(400, 'err.hatrigger_invalid');
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const entity = typeof r.entity === 'string' && r.entity.length <= 255 ? r.entity : null;
    out.push({ id: r.id, name, entity, last: old.find((o) => o.id === r.id)?.last ?? null });
  }
  return out;
}

/** Staat de taak klaar om te melden? Nog niet gemeld, of een herhalende taak die sindsdien doorschoof. */
export const armed = (link: HaTaskLink, repeatAt: string | null) => !link.fired || (!!repeatAt && repeatAt !== link.rep);

export const haTriggerApi = new Hono<AppEnv>();

// Zonder de testfeature bestaat dit niet. Een sessie of een full-sleutel (de HA-integratie); inbox-sleutels komen hier
// niet (de auth laat die alleen bij POST /api/inbox).
haTriggerApi.use('*', async (c, next) => {
  if (!testFeature(c.env, HATRIGGER)) throw new HttpError(404, 'err.not_found');
  await next();
});

/** Is HA te lang stil? Zonder `seen` (nog nooit met een sleutel, zoals lokaal testen) niet. */
export const stale = (seen: string | null, now = Date.now()) => !!seen && now - Date.parse(seen) > STALE_DAYS * 86_400_000;

// Een request met een full-sleutel is HA (of een ander script met die sleutel): onthoud dat hij er nog is.
haTriggerApi.use('*', async (c, next) => {
  const auth = c.get('auth');
  if (auth.kind === 'token') {
    const seen = await readRow<string | null>(c.env, auth.userId, ROW_SEEN, null);
    if (!seen || Date.now() - Date.parse(seen) > SEEN_EVERY_MS) await userSettingStmt(c.env.DB, auth.userId, ROW_SEEN, JSON.stringify(new Date().toISOString())).run();
  }
  await next();
});

haTriggerApi.get('/', async (c) => {
  const userId = c.get('auth').userId;
  const [triggers, tasks, seen] = await Promise.all([readTriggers(c.env, userId), readLinks(c.env, userId), readRow<string | null>(c.env, userId, ROW_SEEN, null)]);
  // HA is al weken stil: in de app geen triggers meer tonen (ze gaan toch niet af). HA zelf krijgt alles.
  if (c.get('auth').kind !== 'token' && stale(seen)) return c.json({ triggers: [], tasks: {}, seen, stale: true });
  return c.json({ triggers, tasks, seen, stale: false });
});

/**
 * HA stuurt het hele lijstje (na koppelen en na elke wijziging). De keuzes bij taken blijven staan, ook voor een
 * trigger die (even) niet in het lijstje staat: een onbekende id toont de app niet en gaat nooit af, en komt hij terug,
 * dan werkt hij weer. Zo kan een lijstje dat te laat binnenkomt nooit keuzes wissen.
 */
haTriggerApi.put('/triggers', async (c) => {
  const userId = c.get('auth').userId;
  const body = await c.req.json<{ triggers?: unknown }>().catch(() => ({} as { triggers?: unknown }));
  const triggers = cleanTriggers(body.triggers, await readTriggers(c.env, userId));
  await writeTriggers(c.env, userId, triggers).run();
  return c.json({ triggers });
});

/** Triggers bij een eigen taak kiezen (een lege lijst haalt ze weg). Zet de taak altijd weer klaar ("Opnieuw melden"). */
haTriggerApi.put('/tasks/:id', async (c) => {
  const userId = c.get('auth').userId;
  const taskId = c.req.param('id');
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({} as { ids?: unknown }));
  if (!Array.isArray(body.ids) || !body.ids.every(validId)) throw new HttpError(400, 'err.hatrigger_invalid');
  // Alleen je eigen hoofdtaak: van een ander zijn taak (of een subtaak) kun je de melding niet regelen.
  const task = await c.env.DB.prepare('SELECT id, repeat_at FROM tasks WHERE id = ? AND user_id = ? AND parent_id IS NULL AND deleted_at IS NULL')
    .bind(taskId, userId).first<{ id: string; repeat_at: string | null }>();
  if (!task) throw new HttpError(404, 'err.not_found');
  const [triggers, links] = await Promise.all([readTriggers(c.env, userId), readLinks(c.env, userId)]);
  const known = new Set(triggers.map((t) => t.id));
  const ids = [...new Set(body.ids as string[])].filter((id) => known.has(id));
  if (ids.length) {
    if (!links[taskId] && Object.keys(links).length >= MAX_TASKS) throw new HttpError(400, 'err.hatrigger_too_many', { max: MAX_TASKS });
    links[taskId] = { ids, fired: null, rep: null };
  } else delete links[taskId];
  await writeLinks(c.env, userId, links).run();
  return c.json({ task: taskId, link: links[taskId] ?? null });
});

/**
 * HA meldt dat een trigger afging. Elke open taak met die trigger die nog klaarstaat, krijgt één melding (de eigenaar en
 * wie de taak gedeeld kreeg), en is daarna gemeld. Taken die weg zijn, gaan uit de lijst.
 */
haTriggerApi.post('/fire', async (c) => {
  const userId = c.get('auth').userId;
  const body = await c.req.json<{ id?: unknown }>().catch(() => ({} as { id?: unknown }));
  if (!validId(body.id)) throw new HttpError(400, 'err.hatrigger_invalid');
  const id = body.id;
  const [triggers, links] = await Promise.all([readTriggers(c.env, userId), readLinks(c.env, userId)]);
  const trigger = triggers.find((t) => t.id === id);
  if (!trigger) throw new HttpError(404, 'err.hatrigger_unknown');
  const now = new Date().toISOString();
  trigger.last = now;

  const candidates = Object.entries(links).filter(([, l]) => l.ids.includes(id)).map(([taskId]) => taskId);
  const rows = candidates.length
    ? (await c.env.DB.prepare('SELECT id, title, description, done, deleted_at, repeat_at FROM tasks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(userId, JSON.stringify(candidates))
      .all<{ id: string; title: string; description: string; done: number; deleted_at: string | null; repeat_at: string | null }>()).results
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fire: typeof rows = [];
  for (const taskId of candidates) {
    const t = byId.get(taskId);
    if (!t) { delete links[taskId]; continue; } // definitief weg
    if (t.done || t.deleted_at) continue;
    const link = links[taskId];
    if (!armed(link, t.repeat_at)) continue;
    link.fired = now;
    link.rep = t.repeat_at;
    fire.push(t);
  }
  await c.env.DB.batch([writeTriggers(c.env, userId, triggers), writeLinks(c.env, userId, links)]);

  if (fire.length) {
    const prefs = c.get('prefs');
    const shares = (await c.env.DB.prepare(
      "SELECT task_id, to_user FROM task_shares WHERE status = 'accepted' AND mode = 'shared' AND task_id IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(fire.map((t) => t.id))).all<{ task_id: string; to_user: string }>()).results;
    const make = (t: (typeof fire)[number]) => (locale: Locale) => ({
      ...reminderPayload(t, locale),
      body: translate(locale, 'hatrigger.push_body', { name: trigger.name }),
      tag: `hatrigger-${t.id}`,
    });
    const sends = fire.flatMap((t) => [userId, ...shares.filter((s) => s.task_id === t.id).map((s) => s.to_user)]
      .map((who) => notifyUser(c.env, who, make(t), prefs.defaultLocale)));
    await inBackground(c, Promise.all(sends), 'hatrigger');
  }
  return c.json({ trigger: trigger.name, notified: fire.map((t) => t.id) });
});
