// Verhuizen naar een andere Tick (ontwerp: docs/superpowers/specs/2026-11-10-verhuizen-design.md).
// De oude Tick maakt een verhuiscode: één URL `https://oud/api/move/out/<geheim>`, een uur geldig. De nieuwe Tick haalt
// daarmee het pakket op (taken, plekken, lijsten, instellingen, agenda's, bijlagen) en voegt het samen met het account
// van wie daar is ingelogd. De bijlagen haalt de browser één voor één binnen (`/file`), zodat elk verzoek klein blijft.
import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { hashKey, newKey } from './keys';
import { overlay, visibleTasks } from './access';
import { mergeTasks, ownersOf, PLACE_COLUMNS, TASK_COLUMNS, insertBatched } from './data';
import { cleanMime, cleanName, maxAccount, maxUpload, usedBytes } from './attachments';
import { backgroundKey } from './background';
import { calendarOn, cleanUrl, hashUrl, MAX_FEED_NAME, MAX_FEEDS, openUrl, sealUrl } from './calendar';
import { userSettingStmt, validTime, validZone } from './prefs';
import { validWebhook } from './settings-api';
import { getUser } from './users';

/** Zo lang is een verhuiscode geldig. */
export const CODE_TTL_MS = 60 * 60_000;
/** Grootste pakket dat de nieuwe Tick wil lezen. */
const MAX_BUNDLE = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_LIST = 100;
const OUT = '/api/move/out/';

/** Instellingen die meegaan, met hun controle; een ongeldige waarde blijft achter. */
const SETTINGS: Record<string, (v: string) => boolean> = {
  timezone: (v) => validZone(v),
  reminder_time: (v) => validTime(v),
  overdue_time: (v) => v === 'off' || validTime(v),
  week_start: (v) => v === 'mon' || v === 'sun',
  drive_mode: (v) => v === 'off',
  tickmanager: (v) => v === 'off',
  review_new_days: (v) => /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 365,
  review_seen_days: (v) => /^\d{1,3}$/.test(v) && +v >= 1 && +v <= 365,
  fallback_webhook: (v) => v === '' || validWebhook(v),
};

type Row = Record<string, unknown>;
type FileRef = { id: string; task_id: string; name: string; mime: string; size: number; width: number | null; height: number | null; created_at: string };
export type Bundle = {
  app: 'tick'; kind: 'move'; version: 1; exported_at: string; source: string; account: { name: string };
  tasks: Row[]; places: Row[]; lists: string[]; review_skip: string[]; settings: Record<string, string>;
  calendars: { name: string; url: string }[]; attachments: FileRef[]; background: boolean;
};

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();

// ---------- oude Tick: code maken en uitlezen ----------

/** Met inlog: een verhuiscode maken (de vorige vervalt) of intrekken. */
export const moveApi = new Hono<AppEnv>();
moveApi.use('*', sessionOnly);

/** Het adres van deze Tick. Let op: lokaal met `dev.host` in wrangler.jsonc geeft wrangler dev het zonder poort door. */
const ownOrigin = (c: Context<AppEnv>): string => new URL(c.req.url).origin;

moveApi.post('/code', async (c) => {
  const userId = c.get('auth').userId;
  const secret = newKey().slice('tick_'.length);
  const created = new Date();
  const expires_at = new Date(created.getTime() + CODE_TTL_MS).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM move_codes WHERE user_id = ? OR expires_at < ?').bind(userId, created.toISOString()),
    c.env.DB.prepare('INSERT INTO move_codes (id, user_id, hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, await hashKey(secret), created.toISOString(), expires_at),
  ]);
  return c.json({ code: ownOrigin(c) + OUT + secret, expires_at }, 201);
});

moveApi.delete('/code', async (c) => {
  await c.env.DB.prepare('DELETE FROM move_codes WHERE user_id = ?').bind(c.get('auth').userId).run();
  return c.json({ ok: true });
});

/**
 * Zonder inlog, met het geheim in het pad: de eigenaar van een geldige code. Een onbekende of verlopen code telt mee
 * in de inlog-limiet (per IP) en geeft 410; een goede niet, want de nieuwe Tick doet een verzoek per bijlage.
 */
async function codeOwner(c: Context<AppEnv>): Promise<string> {
  const secret = c.req.param('secret') ?? '';
  const row = /^[A-Za-z0-9_-]{20,100}$/.test(secret)
    ? await c.env.DB.prepare('SELECT user_id FROM move_codes WHERE hash = ? AND expires_at > ?').bind(await hashKey(secret), now()).first<{ user_id: string }>()
    : null;
  const user = row ? await getUser(c.env.DB, row.user_id) : null;
  if (user && !user.suspended_at) return user.id;
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'move:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  throw new HttpError(410, 'err.move_code_invalid');
}

/** Alles wat iemand ziet en dat mee kan, als pakket. */
export async function buildBundle(env: Env, userId: string, source: string): Promise<Bundle> {
  const db = env.DB;
  const user = await getUser(db, userId);
  // Ook afgevinkt en in de prullenbak; gedeelde taken met jouw lijst, volgorde en pin.
  const visible = (await visibleTasks(db, userId, '1 = 1', [], 'ORDER BY t.parent_id IS NOT NULL, t.created_at, t.id')).map(overlay);
  const tasks = visible.map((t) => {
    const row: Row = {};
    for (const col of TASK_COLUMNS) row[col] = t[col];
    row.deleted_at = t.deleted_at;
    if (t.user_id !== userId) row.shared = 1;
    return row;
  });
  const [places, lists, skip, settings] = await Promise.all([
    db.prepare(`SELECT ${PLACE_COLUMNS.join(', ')} FROM places WHERE user_id = ? ORDER BY created_at, id`).bind(userId).all<Row>(),
    db.prepare('SELECT name FROM lists WHERE user_id = ? ORDER BY name').bind(userId).all<{ name: string }>(),
    db.prepare('SELECT l.name FROM review_skip_lists r JOIN list_ids l ON l.user_id = r.user_id AND l.id = r.list_id WHERE r.user_id = ?')
      .bind(userId).all<{ name: string }>(),
    db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').bind(userId).all<{ key: string; value: string }>(),
  ]);
  const calendars: Bundle['calendars'] = [];
  if (calendarOn(env)) {
    const { results } = await db.prepare('SELECT id, name, url_enc FROM calendar_feeds WHERE user_id = ? ORDER BY created_at')
      .bind(userId).all<{ id: string; name: string; url_enc: string }>();
    for (const f of results) {
      try { calendars.push({ name: f.name, url: await openUrl(env, f.id, f.url_enc) }); } catch { /* sleutel gewijzigd: kan niet mee */ }
    }
  }
  let attachments: FileRef[] = [];
  if (env.FILES && tasks.length) {
    attachments = (await db.prepare(
      'SELECT id, task_id, name, mime, size, width, height, created_at FROM attachments ' +
      "WHERE status = 'ready' AND task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id",
    ).bind(JSON.stringify(tasks.map((t) => t.id))).all<FileRef>()).results;
  }
  const setting = new Map(settings.results.map((r) => [r.key, r.value]));
  return {
    app: 'tick', kind: 'move', version: 1, exported_at: now(), source, account: { name: user?.name ?? '' },
    tasks, places: places.results, lists: lists.results.map((r) => r.name), review_skip: skip.results.map((r) => r.name),
    settings: Object.fromEntries([...setting].filter(([k]) => k in SETTINGS)),
    calendars, attachments, background: !!env.FILES && !!setting.get('background'),
  };
}

/** Zonder inlog (vóór de inlogcontrole gehangen): het pakket, één bijlage, of de achtergrondfoto. */
export const moveOut = new Hono<AppEnv>();

moveOut.get('/:secret', async (c) => {
  const userId = await codeOwner(c);
  c.header('cache-control', 'no-store');
  return c.json(await buildBundle(c.env, userId, ownOrigin(c)));
});

moveOut.get('/:secret/file/:id', async (c) => {
  const userId = await codeOwner(c);
  if (!c.env.FILES) throw new HttpError(404, 'err.not_found');
  const row = await c.env.DB.prepare("SELECT task_id, r2_key, size FROM attachments WHERE id = ? AND status = 'ready'")
    .bind(c.req.param('id')).first<{ task_id: string; r2_key: string; size: number }>();
  // Alleen een bijlage bij een taak die je ziet (eigen of gedeeld, ook in de prullenbak).
  if (!row || !(await visibleTasks(c.env.DB, userId, 't.id = ?', [row.task_id])).length) throw new HttpError(404, 'err.not_found');
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) throw new HttpError(404, 'err.not_found');
  return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(obj.size), 'cache-control': 'no-store' } });
});

moveOut.get('/:secret/background', async (c) => {
  const userId = await codeOwner(c);
  const obj = c.env.FILES ? await c.env.FILES.get(backgroundKey(userId)) : null;
  if (!obj) throw new HttpError(404, 'err.not_found');
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'content-length': String(obj.size), 'cache-control': 'no-store' },
  });
});

// ---------- nieuwe Tick: binnenhalen ----------

/** De basis-URL (`https://oud/api/move/out/<geheim>`) uit een geplakte code, of 400. http alleen voor localhost. */
export function parseCode(v: unknown): string {
  const bad = () => new HttpError(400, 'err.move_code_format');
  if (!isStr(v)) throw bad();
  let u: URL;
  try { u = new URL(v.trim()); } catch { throw bad(); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw bad();
  if (u.username || u.password || u.search || u.hash) throw bad();
  const m = /^\/api\/move\/out\/([A-Za-z0-9_-]{20,100})$/.exec(u.pathname);
  if (!m) throw bad();
  return u.origin + OUT + m[1];
}

/** Een verzoek aan de oude Tick; netwerkfouten en antwoorden worden een HttpError met een eigen sleutel. */
async function fetchOld(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'Tick move', accept: 'application/json, */*' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'err.move_unreachable');
  }
  // Een doorverwijzing volgen we niet (redirect: 'manual'): dan zou de code naar een ander adres gaan.
  if (res.ok) return res;
  res.body?.cancel().catch(() => {});
  if (res.status === 410) throw new HttpError(400, 'err.move_code_invalid');
  if (res.status === 429) throw new HttpError(429, 'err.too_many_attempts');
  // Een Tick zonder verhuisfunctie geeft 401 (de route bestaat er niet, dus inloggen), iets anders vaak 404.
  if (res.status === 401 || res.status === 404) throw new HttpError(400, 'err.move_not_supported');
  throw new HttpError(502, 'err.move_failed', { status: res.status });
}

/** Leest hooguit `max` bytes; meer is een fout (`err.move_too_big`). */
async function readBytes(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw new HttpError(400, 'err.move_too_big'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return all;
}

/** Het pakket van de oude Tick, gecontroleerd op de vorm. */
async function fetchBundle(base: string): Promise<Bundle> {
  let b: unknown;
  try { b = JSON.parse(new TextDecoder().decode(await readBytes(await fetchOld(base), MAX_BUNDLE))); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'err.move_not_supported');
  }
  if (!isObj(b) || b.app !== 'tick' || b.kind !== 'move') throw new HttpError(400, 'err.move_not_supported');
  if (b.version !== 1) throw new HttpError(400, 'err.move_version');
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  // Alles hier gecontroleerd, vóór de import iets schrijft: taken en plekken moeten objecten zijn (de velden zelf
  // controleert mergeTasks), de rest valt weg als hij niet klopt.
  const tasks = arr(b.tasks);
  const places = arr(b.places);
  if (!tasks.every(isObj) || !places.every(isObj)) throw new HttpError(400, 'err.backup_invalid');
  return {
    app: 'tick', kind: 'move', version: 1, exported_at: isStr(b.exported_at) ? b.exported_at : '', source: new URL(base).origin,
    account: { name: isObj(b.account) && isStr(b.account.name) ? b.account.name : '' },
    tasks, places,
    lists: arr(b.lists).filter(isStr), review_skip: arr(b.review_skip).filter(isStr),
    settings: isObj(b.settings) ? Object.fromEntries(Object.entries(b.settings).filter(([, v]) => isStr(v))) as Record<string, string> : {},
    calendars: arr(b.calendars).filter((x): x is { name: string; url: string } => isObj(x) && isStr(x.url) && isStr(x.name)),
    attachments: arr(b.attachments).filter((a): a is FileRef => isObj(a) && isStr(a.id) && isStr(a.task_id) && typeof a.size === 'number'),
    background: b.background === true,
  };
}

/** Wat er in het pakket zit, voor het venster vooraf. */
function summary(env: Env, b: Bundle) {
  const max = maxUpload(env);
  return {
    source: b.source, account: b.account.name,
    tasks: b.tasks.filter((t) => !t.deleted_at).length, trash: b.tasks.filter((t) => !!t.deleted_at).length,
    shared: b.tasks.filter((t) => t.shared && !t.parent_id).length, places: b.places.length,
    lists: b.lists.length, settings: Object.keys(b.settings).length, calendars: b.calendars.length,
    files: b.attachments.length, bytes: b.attachments.reduce((n, a) => n + a.size, 0),
    // Wat hier niet kan: geen bestandsopslag, te groot, of agenda's uit.
    files_blocked: env.FILES ? b.attachments.filter((a) => a.size > max).length : b.attachments.length,
    calendars_blocked: calendarOn(env) ? 0 : b.calendars.length,
    background: b.background && !!env.FILES,
  };
}

/** Een vast id voor `id` bij dit account (als het oude id hier al van een ander is): opnieuw verhuizen geeft hetzelfde. */
export async function derivedId(userId: string, id: string): Promise<string> {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tick-move:${userId}:${id}`)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Nieuwe ids voor wat hier al van een ander account is; de rest houdt zijn id. */
async function remap(db: D1Database, userId: string, table: 'tasks' | 'places', ids: string[]): Promise<Map<string, string>> {
  const owners = await ownersOf(db, table, ids);
  const map = new Map<string, string>();
  for (const id of ids) {
    const o = owners.get(id);
    map.set(id, o !== undefined && o !== userId ? await derivedId(userId, id) : id);
  }
  return map;
}

export const moveInApi = new Hono<AppEnv>();
moveInApi.use('*', sessionOnly);

async function codeFrom(c: Context<AppEnv>): Promise<{ base: string; body: Row }> {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isObj(body)) throw new HttpError(400, 'err.invalid_json');
  return { base: parseCode(body.code), body };
}

moveInApi.post('/preview', async (c) => {
  const { base } = await codeFrom(c);
  return c.json(summary(c.env, await fetchBundle(base)));
});

moveInApi.post('/import', async (c) => {
  const { base } = await codeFrom(c);
  const b = await fetchBundle(base);
  const env = c.env;
  const db = env.DB;
  const userId = c.get('auth').userId;

  // Ids: wat hier van een ander is, krijgt een vast nieuw id; subtaken en bijlagen volgen hun ouder.
  const taskIds = b.tasks.map((t) => t.id).filter(isStr);
  const tmap = await remap(db, userId, 'tasks', [...new Set(taskIds)]);
  const pmap = await remap(db, userId, 'places', [...new Set(b.places.map((p) => p.id).filter(isStr))]);
  const tasks = b.tasks.map((t) => ({
    ...t, id: isStr(t.id) ? tmap.get(t.id) : t.id, parent_id: isStr(t.parent_id) ? tmap.get(t.parent_id) ?? t.parent_id : t.parent_id,
  }));
  const places = b.places.map((p) => ({ ...p, id: isStr(p.id) ? pmap.get(p.id) : p.id }));
  const merged = await mergeTasks(db, userId, tasks, places, { keepDeleted: true });

  // Lege lijsten, en welke lijsten de Tickmanager overslaat.
  const listName = (v: string) => v.trim().slice(0, MAX_LIST);
  const lists = [...new Set(b.lists.map(listName).filter(Boolean))];
  const created = now();
  const listStmts = lists.map((n) => db.prepare('INSERT OR IGNORE INTO lists (user_id, name, created_at) VALUES (?, ?, ?)').bind(userId, n, created));
  const skip = [...new Set(b.review_skip.map(listName).filter(Boolean))];
  const newListId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((x) => x.toString(16).padStart(2, '0')).join('');
  for (const n of skip) {
    listStmts.push(db.prepare('INSERT OR IGNORE INTO list_ids (user_id, name, id) VALUES (?, ?, ?)').bind(userId, n, newListId()));
    listStmts.push(db.prepare('INSERT OR IGNORE INTO review_skip_lists (user_id, list_id) SELECT user_id, id FROM list_ids WHERE user_id = ? AND name = ?').bind(userId, n));
  }
  // Instellingen: alleen bekende sleutels met een geldige waarde.
  const settings = Object.entries(b.settings).filter(([k, v]) => SETTINGS[k]?.(v));
  await insertBatched(db, [...listStmts, ...settings.map(([k, v]) => userSettingStmt(db, userId, k, v))]);

  // Agenda's: opnieuw versleuteld met de sleutel van deze Tick; een adres dat je al hebt slaan we over.
  let calendarsAdded = 0;
  if (calendarOn(env) && b.calendars.length) {
    let count = (await db.prepare('SELECT COUNT(*) AS n FROM calendar_feeds WHERE user_id = ?').bind(userId).first<number>('n')) ?? 0;
    for (const f of b.calendars) {
      const url = cleanUrl(f.url);
      if (!url || count >= MAX_FEEDS) continue;
      const id = crypto.randomUUID();
      const res = await db.prepare('INSERT OR IGNORE INTO calendar_feeds (id, user_id, name, url_enc, url_hash, host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, f.name.trim().slice(0, MAX_FEED_NAME), await sealUrl(env, id, url.href), await hashUrl(env, userId, url.href), url.hostname, created).run();
      if (res.meta.changes) { calendarsAdded++; count++; }
    }
  }

  // Bijlagen: alleen bij taken die nu van jou zijn, en nog niet hier. De browser haalt ze daarna één voor één op.
  const files: (FileRef & { from: string })[] = [];
  let filesSkipped = 0;
  if (b.attachments.length) {
    const mine = new Set<string>();
    const ids = [...new Set(b.attachments.map((a) => tmap.get(a.task_id) ?? a.task_id))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { results } = await db.prepare(`SELECT id FROM tasks WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(userId, ...chunk).all<{ id: string }>();
      for (const r of results) mine.add(r.id);
    }
    const max = maxUpload(env);
    for (const a of b.attachments) {
      const taskId = tmap.get(a.task_id) ?? a.task_id;
      if (!env.FILES || !mine.has(taskId) || a.size > max) { filesSkipped++; continue; }
      const existing = await db.prepare('SELECT task_id FROM attachments WHERE id = ?').bind(a.id).first<{ task_id: string }>();
      if (existing?.task_id === taskId) continue; // al eerder verhuisd
      const id = existing ? await derivedId(userId, a.id) : a.id;
      if (existing && await db.prepare('SELECT 1 FROM attachments WHERE id = ?').bind(id).first()) continue;
      files.push({ ...a, from: a.id, id, task_id: taskId });
    }
  }
  return c.json({
    source: b.source, tasks: merged.tasks, places: merged.places, skipped: merged.skipped, lists: lists.length, settings: settings.length,
    calendars: calendarsAdded, calendars_skipped: b.calendars.length - calendarsAdded,
    files, files_skipped: filesSkipped, background: b.background && !!env.FILES,
  });
});

/** Eén bijlage van de oude Tick naar R2 hier. Bestaat hij al, dan niets (`existed`). */
moveInApi.post('/file', async (c) => {
  const { base, body } = await codeFrom(c);
  const env = c.env;
  if (!env.FILES) throw new HttpError(404, 'err.not_found');
  const db = env.DB;
  const userId = c.get('auth').userId;
  const { id, from, task_id: taskId, size } = body;
  if (!isStr(id) || !isStr(from) || !isStr(taskId) || typeof size !== 'number' || !Number.isInteger(size) || size < 0) throw new HttpError(400, 'err.invalid_json');
  if (!UUID.test(id)) throw new HttpError(400, 'err.id_uuid');
  if (!await db.prepare('SELECT 1 FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, userId).first()) throw new HttpError(404, 'err.not_found');
  // Alleen een bijlage bij deze (eigen) taak telt als al verhuisd; een id dat hier bij iets anders hoort, is bezet.
  const existing = await db.prepare('SELECT task_id FROM attachments WHERE id = ?').bind(id).first<{ task_id: string }>();
  if (existing) {
    if (existing.task_id === taskId) return c.json({ ok: true, existed: true });
    throw new HttpError(409, 'err.id_taken');
  }
  const max = maxUpload(env);
  if (size > max) throw new HttpError(413, 'err.file_too_big', { max: Math.round(max / 1024 / 1024) });
  const quota = maxAccount(env);
  if (quota !== null && await usedBytes(db, userId) + size > quota) throw new HttpError(413, 'err.storage_full', { max: quota / 1024 / 1024 });
  const res = await fetchOld(`${base}/file/${encodeURIComponent(from)}`);
  const mime = cleanMime(isStr(body.mime) ? body.mime : undefined);
  const image = mime.startsWith('image/');
  const dim = (v: unknown) => (image && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20000 ? v as number : null);
  const key = `a/${crypto.randomUUID()}`;
  const createdAt = isStr(body.created_at) && !Number.isNaN(Date.parse(body.created_at)) ? body.created_at : now();
  await db.prepare("INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, width, height, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(id, taskId, userId, cleanName(isStr(body.name) ? body.name : undefined), mime, size, key, dim(body.width), dim(body.height), createdAt).run();
  try {
    // Precies `size` bytes; wijkt het af, dan mislukt het en ruimt de cron de pending-rij op.
    const { readable, writable } = new FixedLengthStream(size);
    await Promise.all([res.body ? res.body.pipeTo(writable) : writable.close(), env.FILES.put(key, readable, { httpMetadata: { contentType: mime } })]);
  } catch {
    await db.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
    await env.FILES.delete(key).catch(() => {});
    throw new HttpError(502, 'err.move_file_failed');
  }
  await db.prepare("UPDATE attachments SET status = 'ready' WHERE id = ?").bind(id).run();
  return c.json({ ok: true, existed: false });
});

/** De achtergrondfoto van de oude Tick, als je er een had. */
moveInApi.post('/background', async (c) => {
  const { base } = await codeFrom(c);
  const env = c.env;
  if (!env.FILES) throw new HttpError(404, 'err.not_found');
  const res = await fetchOld(`${base}/background`);
  const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const bytes = await readBytes(res, maxUpload(env));
  const userId = c.get('auth').userId;
  await env.FILES.put(backgroundKey(userId), bytes, { httpMetadata: { contentType: type.startsWith('image/') ? type : 'image/jpeg' } });
  const version = String(Date.now());
  await userSettingStmt(env.DB, userId, 'background', version).run();
  return c.json({ version });
});
