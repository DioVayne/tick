import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { userSettingStmt } from './prefs';
import { inBackground, notifyUser, reminderPayload, sendToAll, type Locale } from './push';
import { translate } from '../public/i18n.js';

/**
 * Home Assistant-triggers (eerst testfeature "hatrigger", sinds 2026-11-24 voor iedereen). De HA-integratie (home-assistant/custom_components/tick) stuurt
 * het lijstje triggers ("Sam komt thuis", "Zon onder") met PUT /triggers en vuurt er een af met POST /fire. In het
 * taakpaneel kies je bij een taak een of meer triggers; de eerste die afgaat geeft één melding, net als een plek.
 * Daarna is de taak "gemeld" tot je op Opnieuw melden tikt, de triggers wijzigt, of een herhalende taak doorschuift.
 * Nam niemand de melding aan (alle push-abonnementen verlopen, webhook kapot), dan zet Tick de taak weer klaar.
 * De pushdienst bewaart een triggermelding HA_TTL lang voor een telefoon die offline is.
 * In Instellingen → Home Assistant deel je triggers met mensen met wie je al een lijst of taak deelt.
 *
 * Alles staat in rijen van `user_settings` (zo gebouwd als testfeature; geen tabel nodig, de lijsten zijn klein):
 * - `hatrigger:triggers`: [{ id, name, entity, last }] (HA schrijft het lijstje, `last` = laatst afgegaan);
 * - `hatrigger:tasks`: { taskId: { ids, fired, rep, by } } (`fired` = wanneer gemeld, `rep` = de keer van een herhalende taak,
 *   `by` = de trigger die meldde; het taakpaneel toont "Gemeld <tijd> · <trigger>");
 *   een gedeelde trigger staat erin als `<eigenaar>.<trigger>`;
 * - `hatrigger:share`: { all, per: { triggerId: [userId] } } met wie je je triggers deelt; de ontvanger ziet ze zonder
 *   "laatst afgegaan" (dat zou verraden wanneer iemand thuiskomt);
 * - `hatrigger:seen`: wanneer HA (een full-sleutel) laatst iets liet horen. De integratie meldt zich elke 6 uur. Is dat
 *   langer dan STALE_DAYS geleden (integratie weg, sleutel ingetrokken), dan toont Tick de triggers niet meer; de rijen
 *   blijven staan, dus komt HA terug, dan is alles er weer.
 */
const ROW_TRIGGERS = 'hatrigger:triggers';
const ROW_TASKS = 'hatrigger:tasks';
const ROW_SEEN = 'hatrigger:seen';
const ROW_SHARE = 'hatrigger:share';
export const STALE_DAYS = 21;
/** Zo vaak hoogstens `seen` bijwerken: elke aanroep schrijven is zonde. */
const SEEN_EVERY_MS = 60 * 60_000;
export const MAX_TRIGGERS = 50;
export const MAX_TASKS = 300;
/** Zo lang (seconden) bewaart de pushdienst een triggermelding voor een telefoon die offline is: 6 uur (gewone herinneringen 1 uur). */
export const HA_TTL = 6 * 3600;
const MAX_NAME = 60;

export type HaTrigger = { id: string; name: string; entity: string | null; last: string | null };
export type HaTaskLink = { ids: string[]; fired: string | null; rep: string | null; by?: string | null };
type Links = Record<string, HaTaskLink>;
/** Per trigger met wie hij gedeeld is, of alles met iedereen (`all`). Los van het lijstje, dat HA telkens overschrijft. */
export type HaShare = { all: boolean; per: Record<string, string[]> };
type Person = { id: string; name: string };

async function readRow<T>(env: Env, userId: string, key: string, empty: T): Promise<T> {
  const row = await env.DB.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').bind(userId, key).first<{ value: string }>();
  if (!row) return empty;
  try { return JSON.parse(row.value) as T; } catch { return empty; }
}
const readTriggers = (env: Env, userId: string) => readRow<HaTrigger[]>(env, userId, ROW_TRIGGERS, []);
const readLinks = (env: Env, userId: string) => readRow<Links>(env, userId, ROW_TASKS, {});
const readShare = (env: Env, userId: string) => readRow<HaShare>(env, userId, ROW_SHARE, { all: false, per: {} });
const writeTriggers = (env: Env, userId: string, list: HaTrigger[]) => userSettingStmt(env.DB, userId, ROW_TRIGGERS, list.length ? JSON.stringify(list) : null);
const writeLinks = (env: Env, userId: string, links: Links) => userSettingStmt(env.DB, userId, ROW_TASKS, Object.keys(links).length ? JSON.stringify(links) : null);

const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
/** Een eigen trigger, of een gedeelde als `<eigenaar>.<trigger>`. */
const validLinkId = (v: unknown): v is string => typeof v === 'string' && /^([0-9a-f-]{36}\.)?[A-Za-z0-9_-]{1,64}$/.test(v);
const sharedId = (owner: string, triggerId: string) => `${owner}.${triggerId}`;

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

/** Is HA te lang stil? Zonder `seen` (nog nooit met een sleutel, zoals lokaal testen) niet. */
export const stale = (seen: string | null, now = Date.now()) => !!seen && now - Date.parse(seen) > STALE_DAYS * 86_400_000;

// ---------- delen met huisgenoten ----------

/**
 * Met wie je mag delen: wie al een taak met je deelt (geaccepteerd, beide kanten op) of samen met jou in een gedeelde
 * lijst zit. Wie de een de ander blokkeerde, valt af. De relatie is wederzijds.
 */
export async function partners(env: Env, userId: string): Promise<Person[]> {
  return (await env.DB.prepare(
    `SELECT id, name FROM users WHERE id != ?1 AND id IN (
       SELECT to_user FROM task_shares WHERE from_user = ?1 AND status = 'accepted'
       UNION SELECT from_user FROM task_shares WHERE to_user = ?1 AND status = 'accepted'
       UNION SELECT m2.user_id FROM list_members m1 JOIN list_members m2 ON m2.list_id = m1.list_id
         WHERE m1.user_id = ?1 AND m1.status = 'accepted' AND m2.status = 'accepted')
     AND id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?1 UNION SELECT user_id FROM blocks WHERE blocked_id = ?1)
     ORDER BY name COLLATE NOCASE`,
  ).bind(userId).all<Person>()).results;
}

/** Wie deze trigger krijgt: iedereen (alles gedeeld) of de gekozen mensen, altijd binnen de huidige partners. */
const recipients = (share: HaShare, triggerId: string, ok: Set<string>) =>
  (share.all ? [...ok] : (share.per[triggerId] ?? []).filter((id) => ok.has(id)));

export type SharedTrigger = { id: string; name: string; entity: null; last: null; owner: Person };

/** Triggers die anderen met mij delen, zonder "laatst afgegaan"; niet van iemand wiens HA al weken stil is. */
async function sharedWithMe(env: Env, me: string): Promise<SharedTrigger[]> {
  const mine = await partners(env, me);
  if (!mine.length) return [];
  const rows = (await env.DB.prepare(
    'SELECT user_id, key, value FROM user_settings WHERE key IN (?, ?, ?) AND user_id IN (SELECT value FROM json_each(?))',
  ).bind(ROW_TRIGGERS, ROW_SHARE, ROW_SEEN, JSON.stringify(mine.map((p) => p.id))).all<{ user_id: string; key: string; value: string }>()).results;
  const out: SharedTrigger[] = [];
  for (const owner of mine) {
    const get = <T>(key: string, empty: T): T => {
      const r = rows.find((x) => x.user_id === owner.id && x.key === key);
      try { return r ? JSON.parse(r.value) as T : empty; } catch { return empty; }
    };
    const share = get<HaShare>(ROW_SHARE, { all: false, per: {} });
    if (!share.all && !Object.values(share.per).some((ids) => ids.includes(me))) continue;
    if (stale(get<string | null>(ROW_SEEN, null))) continue;
    for (const t of get<HaTrigger[]>(ROW_TRIGGERS, [])) {
      if (share.all || share.per[t.id]?.includes(me)) out.push({ id: sharedId(owner.id, t.id), name: t.name, entity: null, last: null, owner });
    }
  }
  return out;
}

// ---------- routes ----------

export const haTriggerApi = new Hono<AppEnv>();

// Een sessie of een full-sleutel (de HA-integratie); inbox-sleutels komen hier niet (de auth laat die alleen bij
// POST /api/inbox).

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
  const auth = c.get('auth');
  const userId = auth.userId;
  const [triggers, tasks, seen] = await Promise.all([readTriggers(c.env, userId), readLinks(c.env, userId), readRow<string | null>(c.env, userId, ROW_SEEN, null)]);
  // HA zelf krijgt alleen zijn eigen lijstje.
  if (auth.kind === 'token') return c.json({ triggers, tasks, seen, stale: false });
  // Mijn HA is al weken stil: mijn eigen triggers niet meer tonen (ze gaan toch niet af). Gedeelde wel.
  const own = stale(seen) ? [] : triggers;
  return c.json({ triggers: [...own, ...await sharedWithMe(c.env, userId)], tasks, seen, stale: stale(seen) });
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
  if (!Array.isArray(body.ids) || !body.ids.every(validLinkId)) throw new HttpError(400, 'err.hatrigger_invalid');
  // Alleen je eigen hoofdtaak: van een ander zijn taak (of een subtaak) kun je de melding niet regelen.
  const task = await c.env.DB.prepare('SELECT id, repeat_at FROM tasks WHERE id = ? AND user_id = ? AND parent_id IS NULL AND deleted_at IS NULL')
    .bind(taskId, userId).first<{ id: string; repeat_at: string | null }>();
  if (!task) throw new HttpError(404, 'err.not_found');
  const [triggers, shared, links] = await Promise.all([readTriggers(c.env, userId), sharedWithMe(c.env, userId), readLinks(c.env, userId)]);
  const known = new Set([...triggers.map((t) => t.id), ...shared.map((t) => t.id)]);
  const ids = [...new Set(body.ids as string[])].filter((id) => known.has(id));
  if (ids.length) {
    if (!links[taskId] && Object.keys(links).length >= MAX_TASKS) throw new HttpError(400, 'err.hatrigger_too_many', { max: MAX_TASKS });
    links[taskId] = { ids, fired: null, rep: null };
  } else delete links[taskId];
  await writeLinks(c.env, userId, links).run();
  return c.json({ task: taskId, link: links[taskId] ?? null });
});

type FireRow = { id: string; title: string; description: string; done: number; deleted_at: string | null; repeat_at: string | null };

/** Eén persoon: elke open taak die op `linkId` wacht en nog klaarstaat, wordt gemeld. Geeft het opslaan en die taken. */
async function fireFor(env: Env, userId: string, linkId: string, now: string): Promise<{ save: D1PreparedStatement | null; fire: FireRow[] }> {
  const links = await readLinks(env, userId);
  const candidates = Object.entries(links).filter(([, l]) => l.ids.includes(linkId)).map(([taskId]) => taskId);
  if (!candidates.length) return { save: null, fire: [] };
  const rows = (await env.DB.prepare('SELECT id, title, description, done, deleted_at, repeat_at FROM tasks WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(userId, JSON.stringify(candidates)).all<FireRow>()).results;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fire: FireRow[] = [];
  for (const taskId of candidates) {
    const t = byId.get(taskId);
    if (!t) { delete links[taskId]; continue; } // definitief weg
    if (t.done || t.deleted_at) continue;
    const link = links[taskId];
    if (!armed(link, t.repeat_at)) continue;
    link.fired = now;
    link.rep = t.repeat_at;
    link.by = linkId;
    fire.push(t);
  }
  return { save: writeLinks(env, userId, links), fire };
}

/** De melding kwam bij niemand aan: de taak staat weer klaar (alleen als hij nog op deze keer staat). */
async function unfire(env: Env, userId: string, taskIds: string[], at: string): Promise<void> {
  const links = await readLinks(env, userId);
  let changed = false;
  for (const id of taskIds) {
    const l = links[id];
    if (l?.fired === at) { l.fired = null; l.rep = null; l.by = null; changed = true; }
  }
  if (changed) await writeLinks(env, userId, links).run();
}

/**
 * HA meldt dat een trigger afging. Mijn taken die erop wachten, en die van wie ik hem deel, krijgen elk één melding
 * (aan de eigenaar van de taak en wie die taak gedeeld kreeg); daarna zijn ze gemeld.
 */
haTriggerApi.post('/fire', async (c) => {
  const userId = c.get('auth').userId;
  const body = await c.req.json<{ id?: unknown }>().catch(() => ({} as { id?: unknown }));
  if (!validId(body.id)) throw new HttpError(400, 'err.hatrigger_invalid');
  const id = body.id;
  const [triggers, share] = await Promise.all([readTriggers(c.env, userId), readShare(c.env, userId)]);
  const trigger = triggers.find((t) => t.id === id);
  if (!trigger) throw new HttpError(404, 'err.hatrigger_unknown');
  const now = new Date().toISOString();
  trigger.last = now;

  const others = share.all || Object.keys(share.per).length
    ? recipients(share, id, new Set((await partners(c.env, userId)).map((p) => p.id))) : [];
  const results = await Promise.all([
    fireFor(c.env, userId, id, now).then((r) => ({ who: userId, ...r })),
    ...others.map((who) => fireFor(c.env, who, sharedId(userId, id), now).then((r) => ({ who, ...r }))),
  ]);
  await c.env.DB.batch([writeTriggers(c.env, userId, triggers), ...results.flatMap((r) => (r.save ? [r.save] : []))]);

  const fired = results.flatMap((r) => r.fire);
  if (fired.length) {
    const prefs = c.get('prefs');
    const shares = (await c.env.DB.prepare(
      "SELECT task_id, to_user FROM task_shares WHERE status = 'accepted' AND mode = 'shared' AND task_id IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(fired.map((t) => t.id))).all<{ task_id: string; to_user: string }>()).results;
    const make = (t: FireRow) => (locale: Locale) => ({
      ...reminderPayload(t, locale),
      body: translate(locale, 'hatrigger.push_body', { name: trigger.name }),
      tag: `hatrigger-${t.id}`,
    });
    // Per taak iedereen die hem krijgt. Nam niemand hem aan terwijl er wel een adres was, dan weer klaarzetten.
    const sending = Promise.all(results.flatMap((r) => r.fire.map(async (t) => {
      const to = [...new Set([r.who, ...shares.filter((s) => s.task_id === t.id).map((s) => s.to_user)])];
      const got = await Promise.all(to.map((who) => notifyUser(c.env, who, make(t), prefs.defaultLocale, sendToAll, { ttl: HA_TTL })));
      return { owner: r.who, taskId: t.id, lost: !got.includes('ok') && got.includes('failed') };
    }))).then(async (done) => {
      const lost = done.filter((x) => x.lost);
      for (const owner of new Set(lost.map((x) => x.owner))) await unfire(c.env, owner, lost.filter((x) => x.owner === owner).map((x) => x.taskId), now);
    });
    await inBackground(c, sending, 'hatrigger');
  }
  return c.json({ trigger: trigger.name, notified: results[0].fire.map((t) => t.id), shared: fired.length - results[0].fire.length });
});

// ---------- instellingen (alleen met een sessie) ----------

async function settingsOf(env: Env, userId: string) {
  const [triggers, share, seen, people] = await Promise.all([
    readTriggers(env, userId), readShare(env, userId), readRow<string | null>(env, userId, ROW_SEEN, null), partners(env, userId),
  ]);
  const ok = new Set(people.map((p) => p.id));
  return {
    seen, stale: stale(seen), all: share.all, partners: people,
    triggers: triggers.map((t) => ({ ...t, share: (share.per[t.id] ?? []).filter((who) => ok.has(who)) })),
  };
}

haTriggerApi.get('/settings', sessionOnly, async (c) => c.json(await settingsOf(c.env, c.get('auth').userId)));

/**
 * Delen instellen: `all` (alles met iedereen) en/of `per` (per trigger de gekozen mensen; een lege lijst = niet gedeeld).
 * Wie hierdoor voor het eerst triggers van mij krijgt, hoort dat één keer met een melding.
 */
haTriggerApi.put('/share', sessionOnly, async (c) => {
  const userId = c.get('auth').userId;
  const body = await c.req.json<{ all?: unknown; per?: unknown }>().catch(() => ({} as { all?: unknown; per?: unknown }));
  const [triggers, old, people] = await Promise.all([readTriggers(c.env, userId), readShare(c.env, userId), partners(c.env, userId)]);
  const ok = new Set(people.map((p) => p.id));
  const known = new Set(triggers.map((t) => t.id));
  const next: HaShare = { all: old.all, per: { ...old.per } };
  if (body.all !== undefined) {
    if (typeof body.all !== 'boolean') throw new HttpError(400, 'err.hatrigger_invalid');
    next.all = body.all;
  }
  if (body.per !== undefined) {
    if (!body.per || typeof body.per !== 'object' || Array.isArray(body.per)) throw new HttpError(400, 'err.hatrigger_invalid');
    for (const [tid, who] of Object.entries(body.per as Record<string, unknown>)) {
      if (!known.has(tid) || !Array.isArray(who) || !who.every((w) => typeof w === 'string' && ok.has(w))) throw new HttpError(400, 'err.hatrigger_invalid');
      if (who.length) next.per[tid] = [...new Set(who as string[])]; else delete next.per[tid];
    }
  }
  // Triggers die uit HA verdwenen: hun keuze hoeft niet te blijven.
  for (const tid of Object.keys(next.per)) if (!known.has(tid)) delete next.per[tid];
  await userSettingStmt(c.env.DB, userId, ROW_SHARE, next.all || Object.keys(next.per).length ? JSON.stringify(next) : null).run();

  const count = (s: HaShare, who: string) => triggers.filter((t) => recipients(s, t.id, ok).includes(who)).length;
  const fresh = people.filter((p) => count(old, p.id) === 0 && count(next, p.id) > 0);
  if (fresh.length) {
    const me = c.get('user').name;
    const prefs = c.get('prefs');
    await inBackground(c, Promise.all(fresh.map((p) => notifyUser(c.env, p.id, (locale) => ({
      title: 'Tick', body: translate(locale, 'hatrigger.shared_push', { name: me, n: count(next, p.id) }), url: '/', tag: `hatrigger-share-${userId}`,
    }), prefs.defaultLocale))), 'hatrigger delen');
  }
  return c.json(await settingsOf(c.env, userId));
});
