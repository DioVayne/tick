import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { getAccess } from './access';

/**
 * Bijlagen: foto's en andere bestanden bij een taak. De bytes staan in R2 (`FILES`), de rest in D1 `attachments`.
 * Wie de taak ziet (eigenaar of geaccepteerde deelnemer) ziet ook de bijlagen, en mag ze toevoegen en verwijderen.
 * Zonder `FILES`-binding geven alle routes een 404.
 */
export const attachmentsApi = new Hono<AppEnv>();

export type Attachment = { id: string; name: string; mime: string; size: number; width: number | null; height: number | null; created_at: string };
type Row = Attachment & { task_id: string; user_id: string; r2_key: string; status: string };

/** Zoveel bijlagen mag één taak hebben (ook die nog uploaden). */
export const MAX_FILES = 20;
const MAX_NAME = 200;
/** Zo lang mag een upload duren; daarna ruimt de cron een rij die nog `pending` is op. */
const PENDING_MS = 60 * 60_000;
/** Beeldtypes die de browser inline mag tonen; al het andere gaat als download, zonder eigen type. */
const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const COLS = 'id, name, mime, size, width, height, created_at';

const now = () => new Date().toISOString();

/** Grootste bijlage in bytes: MAX_UPLOAD_MB (1 tot 100), standaard 10 MB. */
export function maxUpload(env: Pick<Env, 'MAX_UPLOAD_MB'>): number {
  const mb = Math.trunc(Number(env.MAX_UPLOAD_MB));
  return (Number.isFinite(mb) && mb > 0 ? Math.min(mb, 100) : 10) * 1024 * 1024;
}

/** Bestandsnaam zonder pad en stuurtekens, hoogstens MAX_NAME tekens; leeg wordt `file`. */
export function cleanName(v: string | undefined): string {
  const base = String(v ?? '').split(/[\\/]/).pop()!;
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME).trim();
  return name || 'file';
}

/** `type/subtype` in kleine letters, anders application/octet-stream. */
export function cleanMime(v: string | undefined): string {
  const m = String(v ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(m) ? m : 'application/octet-stream';
}

/** Breedte of hoogte van een afbeelding uit de query: een geheel getal van 1 tot 20000, anders null. */
function dimension(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 20000 ? n : null;
}

const meta = (r: Row | Attachment): Attachment =>
  ({ id: r.id, name: r.name, mime: r.mime, size: r.size, width: r.width, height: r.height, created_at: r.created_at });

/** De bijlagen (klaar met uploaden) per taak-id, in volgorde van toevoegen. Zonder `FILES` altijd leeg. */
export async function attachmentsFor(env: Env, ids: string[]): Promise<Map<string, Attachment[]>> {
  const out = new Map<string, Attachment[]>();
  if (!env.FILES || !ids.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT task_id, ${COLS} FROM attachments WHERE status = 'ready' AND task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id`,
  ).bind(JSON.stringify(ids)).all<Attachment & { task_id: string }>();
  for (const r of results) {
    const list = out.get(r.task_id) ?? [];
    list.push(meta(r));
    out.set(r.task_id, list);
  }
  return out;
}

/**
 * Statements die de bijlagen van taak `from` ook aan taak `to` hangen (een geaccepteerde kopie): nieuwe rijen met
 * hetzelfde R2-object, zodat er geen bytes gekopieerd worden.
 */
export function copyAttachmentStmt(db: D1Database, from: string, to: string): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, width, height, status, created_at) ' +
    "SELECT lower(hex(randomblob(16))), ?, user_id, name, mime, size, r2_key, width, height, 'ready', created_at " +
    "FROM attachments WHERE task_id = ? AND status = 'ready'",
  ).bind(to, from);
}

/**
 * Ruimt op: rijen waarvan de taak niet meer bestaat (definitief gewist, of het account verwijderd) en uploads die
 * na een uur nog `pending` zijn, per 100. Eerst de R2-objecten die daarna door geen rij meer gebruikt worden, dan de
 * rijen: mislukt R2, dan blijven de rijen staan en probeert de volgende run het opnieuw. Geeft het aantal rijen terug.
 */
export async function sweepAttachments(env: Env, nowMs: number): Promise<number> {
  if (!env.FILES) return 0;
  const db = env.DB;
  const { results } = await db.prepare(
    'SELECT id, r2_key FROM attachments a WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = a.task_id) ' +
    "OR (a.status = 'pending' AND a.created_at < ?) LIMIT 100",
  ).bind(new Date(nowMs - PENDING_MS).toISOString()).all<{ id: string; r2_key: string }>();
  if (!results.length) return 0;
  const ids = JSON.stringify(results.map((r) => r.id));
  const keys = [...new Set(results.map((r) => r.r2_key))];
  const { results: kept } = await db.prepare(
    'SELECT DISTINCT r2_key FROM attachments WHERE r2_key IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?))',
  ).bind(JSON.stringify(keys), ids).all<{ r2_key: string }>();
  const stay = new Set(kept.map((r) => r.r2_key));
  const gone = keys.filter((k) => !stay.has(k));
  if (gone.length) await env.FILES.delete(gone);
  await db.prepare('DELETE FROM attachments WHERE id IN (SELECT value FROM json_each(?))').bind(ids).run();
  return results.length;
}

// Alleen op de eigen paden: dit Hono-deel hangt aan /api, en '*' zou elke andere API-route ook raken.
for (const path of ['/tasks/:id/attachments', '/attachments/:id']) {
  attachmentsApi.use(path, async (c, next) => {
    if (!c.env.FILES) throw new HttpError(404, 'err.not_found');
    await next();
  });
}

/** De taak als je er toegang toe hebt, anders 404. */
async function taskFor(c: Context<AppEnv>, taskId: string) {
  const t = await getAccess(c.env.DB, c.get('auth').userId, taskId);
  if (!t) throw new HttpError(404, 'err.not_found');
  return t;
}

/** De bijlage als je toegang hebt tot zijn taak, anders 404 (ook voor een bijlage die nog uploadt). */
async function attachmentFor(c: Context<AppEnv>, id: string): Promise<Row> {
  const row = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ? AND status = 'ready'").bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'err.not_found');
  await taskFor(c, row.task_id);
  return row;
}

attachmentsApi.get('/tasks/:id/attachments', async (c) => {
  const t = await taskFor(c, c.req.param('id'));
  return c.json((await attachmentsFor(c.env, [t.id])).get(t.id) ?? []);
});

// Het bestand zelf is de body (geen multipart), zodat de Worker hem rechtstreeks naar R2 kan streamen.
attachmentsApi.post('/tasks/:id/attachments', async (c) => {
  const t = await taskFor(c, c.req.param('id'));
  const max = maxUpload(c.env);
  const length = Number(c.req.header('content-length'));
  if (!Number.isInteger(length) || length < 0 || !c.req.raw.body) throw new HttpError(411, 'err.length_required');
  if (length > max) throw new HttpError(413, 'err.file_too_big', { max: Math.round(max / 1024 / 1024) });
  const db = c.env.DB;
  const count = await db.prepare('SELECT count(*) AS n FROM attachments WHERE task_id = ?').bind(t.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FILES) throw new HttpError(400, 'err.too_many_files', { max: MAX_FILES });
  const mime = cleanMime(c.req.header('content-type'));
  const image = mime.startsWith('image/');
  const row: Row = {
    id: crypto.randomUUID(), task_id: t.id, user_id: c.get('auth').userId, name: cleanName(c.req.query('name')), mime, size: length,
    r2_key: `a/${crypto.randomUUID()}`, width: image ? dimension(c.req.query('w')) : null, height: image ? dimension(c.req.query('h')) : null,
    status: 'pending', created_at: now(),
  };
  // Eerst de rij (pending): mislukt de upload halverwege, dan vindt de cron hem en ruimt hij ook het object op.
  await db.prepare('INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, width, height, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.task_id, row.user_id, row.name, row.mime, row.size, row.r2_key, row.width, row.height, 'pending', row.created_at).run();
  try {
    await c.env.FILES!.put(row.r2_key, c.req.raw.body, { httpMetadata: { contentType: mime } });
  } catch (e) {
    await db.prepare('DELETE FROM attachments WHERE id = ?').bind(row.id).run();
    throw e;
  }
  await db.prepare("UPDATE attachments SET status = 'ready' WHERE id = ?").bind(row.id).run();
  return c.json(meta(row), 201);
});

/** `attachment` of `inline` met de bestandsnaam: ASCII als terugval, de echte naam als UTF-8 (RFC 6266). */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Eén bereik uit een Range-header (`bytes=a-b`, `bytes=a-` of `bytes=-n`); iets anders geeft null (dan het hele bestand). */
export function parseRange(v: string | undefined): R2Range | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(v?.trim() ?? '');
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return Number(m[2]) > 0 ? { suffix: Number(m[2]) } : null;
  const offset = Number(m[1]);
  if (!m[2]) return { offset };
  const last = Number(m[2]);
  return last >= offset ? { offset, length: last - offset + 1 } : null;
}

/** Eerste en laatste byte van `r` in een bestand van `size` bytes, voor Content-Range; null als er niets in valt. */
function byteRange(r: R2Range, size: number): { from: number; to: number } | null {
  const from = 'suffix' in r ? Math.max(0, size - r.suffix) : r.offset ?? 0;
  const to = 'suffix' in r ? size - 1 : Math.min(size, from + (r.length ?? size - from)) - 1;
  return from < size && to >= from ? { from, to } : null;
}

attachmentsApi.get('/attachments/:id', async (c) => {
  const row = await attachmentFor(c, c.req.param('id'));
  const headers = c.req.raw.headers;
  const want = parseRange(c.req.header('range'));
  // Bestaat het object niet meer of valt het bereik erbuiten, dan het hele bestand.
  const head = want ? await c.env.FILES!.head(row.r2_key) : null;
  const part = want && head ? byteRange(want, head.size) : null;
  const obj = await c.env.FILES!.get(row.r2_key, { onlyIf: headers, ...(part ? { range: { offset: part.from, length: part.to - part.from + 1 } } : {}) });
  if (!obj) throw new HttpError(404, 'err.not_found');
  const inline = INLINE.has(row.mime) && !c.req.query('download');
  const out = new Headers({
    'content-type': inline ? row.mime : 'application/octet-stream',
    'content-disposition': disposition(inline ? 'inline' : 'attachment', row.name),
    // Een bijlage verandert nooit: een nieuwe versie is een nieuwe bijlage met een nieuw id.
    'cache-control': 'private, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
    etag: obj.httpEtag,
    // Ook een als pagina geopend bestand (een html of svg met script) kan zo niets op deze site.
    'content-security-policy': 'sandbox',
  });
  if (!('body' in obj)) return new Response(null, { status: 304, headers: out });
  if (part) {
    out.set('content-range', `bytes ${part.from}-${part.to}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers: out });
  }
  return new Response(obj.body, { status: 200, headers: out });
});

attachmentsApi.delete('/attachments/:id', async (c) => {
  const row = await attachmentFor(c, c.req.param('id'));
  const db = c.env.DB;
  await db.prepare('DELETE FROM attachments WHERE id = ?').bind(row.id).run();
  // Een kopie kan hetzelfde object gebruiken; pas als niemand het meer heeft, gaat het uit R2.
  if (!await db.prepare('SELECT 1 FROM attachments WHERE r2_key = ? LIMIT 1').bind(row.r2_key).first()) await c.env.FILES!.delete(row.r2_key);
  return c.json({ ok: true });
});
