import { Hono, type Context } from 'hono';
import { keysApi } from './keys';
import { pairApi, redeem } from './pair';
import { authorize, type Auth, clearCookie, COOKIE, dummyVerify, passwordOk, sessionCookie } from './auth';
import { assetLinks } from './assetlinks';
import { loginAssets, loginPage } from './login';
import { badRequest, HttpError } from './errors';
import { normLocale, translate } from '../public/i18n.js';
import { cleanLocation, cleanPlace, locColumns, locFromRow, type Place } from './location';
import { repeatColumns, repeatFromRow, todayDefaultIso } from './repeat';
import { nextOccurrence } from '../public/repeat.js';
import { loadInstallPrefs, loadUserPrefs, requestLocale, type InstallPrefs, type Prefs } from './prefs';
import { findLoginUser, getUser, touchLastSeen, type User } from './users';
import { inZone, localToUtcIso, type Zone } from './time';
import { runReminders, sendToAll } from './push';
import { settingsApi } from './settings-api';
import { accountApi } from './account';
import { usersApi } from './users-api';
import { linkPages } from './links';
import { deviceApi, devicesApi } from './devices';
import { exportApi, importApi } from './data';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  ADMIN_CONTACT: string;
  LOGIN_PASSWORD: string;
  SESSION_SECRET: string;
  API_TOKEN?: string;
  /** Alleen voor POST /api/inbox: een token dat niets anders mag dan taken aanmaken (voor automations). */
  INBOX_TOKEN?: string;
  LOGIN_LIMITER: RateLimit;
  GEOCODE_LIMITER: RateLimit;
  FALLBACK_WEBHOOK?: string;
  DEV_AUTH_BYPASS?: string;
  /** IANA-tijdzone voor reminders zonder zone en voor ritmes, bijvoorbeeld Europe/Amsterdam. Standaard UTC. */
  TIMEZONE?: string;
  /** Taal van de app: en (standaard) of nl. */
  LOCALE?: string;
  /** applicationId van een eigen Android-build; zonder deze waarde probeert de PWA de app niet te wekken. */
  ANDROID_PACKAGE?: string;
  /** SHA-256-vingerafdruk(ken) van de ondertekeningssleutel, gescheiden door komma's; nodig voor assetlinks.json. */
  ANDROID_CERT_SHA256?: string;
};

export type TaskRow = {
  id: string; user_id: string; title: string; description: string; list: string; parent_id: string | null;
  position: number; remind_at: string | null; notified: number; done: number; done_at: string | null;
  source: string; created_at: string; updated_at: string;
  loc_name: string | null; loc_lat: number | null; loc_lng: number | null; loc_radius: number | null;
  loc_trigger: string | null; loc_notified: number;
  repeat_rule: string | null; repeat_start: string | null; repeat_at: string | null; repeat_prev: string | null;
};

export type AppEnv = {
  Bindings: Env;
  /** `install` staat er altijd (vóór de auth); `prefs` (installatie plus de gebruiker) en `user` alleen na de auth. */
  Variables: { install: InstallPrefs; prefs: Prefs; lang: 'en' | 'nl'; auth: Auth; user: User };
};

const app = new Hono<AppEnv>();

// Eerst de instellingen van de installatie: de taal van het verzoek en de schakelaars van de oude secrets.
app.use('*', async (c, next) => {
  const install = await loadInstallPrefs(c.env);
  c.set('install', install);
  c.set('lang', requestLocale(c.req.raw, install.defaultLocale));
  await next();
});

// Strikte CSP: alleen eigen scripts en stijlen, geen inline code. Stijlen via element.style (CSSOM) blijven werken.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https://tile.openstreetmap.org", "connect-src 'self'",
    "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
};

app.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
});

/** Statisch bestand; als kopie, want headers van een fetch-response zijn onveranderbaar. */
async function asset(c: Context<AppEnv>) {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
}

app.get('/.well-known/assetlinks.json', (c) => c.json(assetLinks(c.env.ANDROID_PACKAGE, c.env.ANDROID_CERT_SHA256)));
app.get('/login', async (c) => {
  // De overgang: zolang de beheerder geen e-mailadres heeft, zegt de pagina dat het veld leeg mag (verraadt één bit).
  const hint = !!(await c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'admin' AND email IS NULL").first());
  return c.html(loginPage(c.get('lang'), hint));
});
app.route('/', linkPages);
for (const path of loginAssets) app.get(path, asset);

app.post('/login', async (c) => {
  // Per IP; de binding telt per Cloudflare-locatie, wat voor brute force ruim genoeg is.
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'onbekend' });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const user = await findLoginUser(c.env.DB, email);
  // Onbekend adres en fout wachtwoord geven dezelfde fout, en ook zonder gebruiker volgt één PBKDF2 (dummyVerify):
  // zo verraden melding noch responstijd welke adressen bestaan.
  const ok = user ? await passwordOk(c.env, user, password) : await dummyVerify(password);
  if (!user || !ok) {
    await new Promise((r) => setTimeout(r, 1500)); // rem op gokken
    throw new HttpError(401, 'err.login_failed');
  }
  await touchLastSeen(c.env.DB, user);
  c.header('Set-Cookie', await sessionCookie(c.env, user));
  return c.json({ ok: true });
});

app.post('/api/pair/redeem', redeem);

app.post('/logout', (c) => {
  c.header('Set-Cookie', clearCookie);
  return c.json({ ok: true });
});

app.use('*', async (c, next) => {
  const found = await authorize(c.req.raw, c.env, c.get('install'));
  if (found) {
    const { user: known, ...auth } = found;
    // Een sleutel van een verwijderd account (of een cookie van een verdwenen gebruiker) geeft geen toegang.
    const user = known ?? await getUser(c.env.DB, auth.userId);
    if (!user) return c.text('Unauthorized', 401);
    const isInbox = c.req.path === '/api/inbox';
    // Het inbox-token mag alleen taken in de inbox zetten, en de inbox is alleen voor het inbox-token.
    if (auth.kind === 'inbox' && !(isInbox && c.req.method === 'POST')) return c.text('Forbidden', 403);
    if (auth.kind === 'token' && isInbox) return c.text('Forbidden', 403);
    await touchLastSeen(c.env.DB, user);
    c.set('auth', auth);
    c.set('user', user);
    const prefs: Prefs = { ...c.get('install'), ...await loadUserPrefs(c.env, user) };
    // Tijdberekeningen krijgen prefs (timeZone, reminderTime) per aanroep mee; geen globale zone over een await.
    c.set('prefs', prefs);
    await next();
    // Geen verlenging als de route zelf al een sessiecookie zet (wachtwoord wijzigen, elders uitloggen): die heeft
    // de nieuwe versie, en een verlenging met de oude gebruiker zou hem overschrijven.
    const fresh = c.res.headers.getSetCookie().some((h) => h.startsWith(`${COOKIE}=`));
    if (auth.kind === 'session' && auth.renew && !fresh) c.res.headers.append('Set-Cookie', await sessionCookie(c.env, user));
    return;
  }
  const wantsPage = c.req.method === 'GET' && !c.req.path.startsWith('/api/') && c.req.header('accept')?.includes('text/html');
  if (!wantsPage) return c.text('Unauthorized', 401);
  // Na het inloggen terug naar de opgevraagde pagina, met query (de Android-app opent /?app=android&pair=1).
  const target = new URL(c.req.url);
  const back = target.pathname + target.search;
  return c.redirect(back === '/' ? '/login' : '/login?next=' + encodeURIComponent(back));
});

app.route('/api/settings', settingsApi);
app.route('/api/keys', keysApi);
app.route('/api/pair', pairApi);
app.route('/api/account', accountApi);
app.route('/api/users', usersApi);
app.route('/api/device', deviceApi);
app.route('/api/devices', devicesApi);
app.route('/api/export', exportApi);
app.route('/api/import', importApi);

const now = () => new Date().toISOString();
/** Taak als JSON voor de client: 0/1 wordt boolean, de loc_*-kolommen worden één location-object en de repeat_*-kolommen één repeat-object (repeat_prev blijft op de server). */
function asBool(t: TaskRow) {
  const { loc_name, loc_lat, loc_lng, loc_radius, loc_trigger, loc_notified, repeat_rule, repeat_start, repeat_at, repeat_prev, ...rest } = t;
  return {
    ...rest,
    done: !!t.done,
    notified: !!t.notified,
    location: locFromRow(t),
    location_notified: !!loc_notified,
    repeat: repeatFromRow(t),
  };
}

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 10_000;
const MAX_QUERY = 200;
const MAX_LIST = 100;
/** Afstand tussen posities na aanmaken of herverdelen; slepen halveert het gat. */
const STEP = 1_000_000;
/** Kleiner gat tussen buren: dan raken de float-posities op en verdelen we de groep opnieuw. */
const MIN_GAP = 1e-6;
const MAX_SNOOZE_MIN = 30 * 24 * 60;

async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new HttpError(400, 'err.invalid_json');
  }
}

function cleanTitle(v: unknown): string {
  const title = String(v ?? '').trim();
  if (!title) throw new HttpError(400, 'err.required', { field: 'title' });
  if (title.length > MAX_TITLE) throw new HttpError(400, 'err.too_long', { field: 'title', max: MAX_TITLE });
  return title;
}

function cleanDescription(v: unknown): string {
  const description = String(v ?? '');
  if (description.length > MAX_DESCRIPTION) throw new HttpError(400, 'err.too_long', { field: 'description', max: MAX_DESCRIPTION });
  return description;
}

/** Lijstnaam: getrimd, leeg wordt Inbox. */
function cleanList(v: unknown): string {
  const list = String(v ?? '').trim();
  if (list.length > MAX_LIST) throw new HttpError(400, 'err.too_long', { field: 'list', max: MAX_LIST });
  return list || 'Inbox';
}

/** Bestaande lijstnaam voor de lijstroutes: onveranderd, want oude data kan ongetrimde namen bevatten. */
function existingListName(v: unknown, field: string): string {
  const name = String(v ?? '');
  if (!name.trim()) throw new HttpError(400, 'err.required', { field });
  return name;
}

/** Nieuwe lijstnaam voor de lijstroutes: verplicht, getrimd en niet te lang. */
function listName(v: unknown, field: string): string {
  const name = String(v ?? '').trim();
  if (!name) throw new HttpError(400, 'err.required', { field });
  if (name.length > MAX_LIST) throw new HttpError(400, 'err.too_long', { field, max: MAX_LIST });
  return name;
}

/** Geheel getal uit de query, binnen [min, max]; leeg of ongeldig geeft de standaardwaarde. */
function intParam(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v === undefined || v === '' ? NaN : Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

const getTask = (db: D1Database, userId: string, id: string) =>
  db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId).first<TaskRow>();

/** Controleert een parent_id: bestaat bij deze gebruiker (een parent van een ander telt als niet bestaand), is niet de taak zelf en is zelf geen subtaak (één niveau). */
async function checkParent(db: D1Database, userId: string, v: unknown, self?: TaskRow): Promise<TaskRow | null> {
  if (v === null || v === undefined || v === '') return null;
  const id = String(v);
  if (self && id === self.id) throw new HttpError(400, 'err.own_parent');
  const parent = await getTask(db, userId, id);
  if (!parent) throw new HttpError(400, 'err.parent_missing');
  if (parent.parent_id) throw new HttpError(400, 'err.subtask_no_children');
  if (self) {
    const kids = await db.prepare('SELECT 1 FROM tasks WHERE parent_id = ? AND user_id = ? LIMIT 1').bind(self.id, userId).first();
    if (kids) throw new HttpError(400, 'err.has_children');
  }
  return parent;
}

/** Nieuwe taak bovenaan; nieuwe subtaak onderaan bij haar broers en zussen. */
async function newPosition(db: D1Database, userId: string, parentId: string | null): Promise<number> {
  if (parentId) {
    const r = await db.prepare('SELECT MAX(position) AS p FROM tasks WHERE parent_id = ? AND user_id = ? AND done = 0')
      .bind(parentId, userId).first<{ p: number | null }>();
    return r?.p == null ? 0 : r.p + STEP;
  }
  const r = await db.prepare('SELECT MIN(position) AS p FROM tasks WHERE user_id = ? AND done = 0').bind(userId).first<{ p: number | null }>();
  return (r?.p ?? 0) - STEP;
}

/** Verdeelt de open taken naast `t` opnieuw zodra twee buren dichter dan MIN_GAP bij elkaar liggen. */
async function rebalanceIfNeeded(db: D1Database, t: TaskRow): Promise<void> {
  const rows = (t.parent_id
    ? await db.prepare('SELECT id, position FROM tasks WHERE parent_id = ? AND user_id = ? AND done = 0 ORDER BY position').bind(t.parent_id, t.user_id).all<{ id: string; position: number }>()
    : await db.prepare('SELECT id, position FROM tasks WHERE parent_id IS NULL AND user_id = ? AND done = 0 ORDER BY position').bind(t.user_id).all<{ id: string; position: number }>()
  ).results;
  if (!rows.some((r, i) => i > 0 && r.position - rows[i - 1].position < MIN_GAP)) return;
  const stmt = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
  await db.batch(rows.map((r, i) => stmt.bind((i + 1) * STEP, r.id)));
}

/** Zo lang na het doorschuiven kan een herhalende taak nog terug naar de vorige keer. */
const UNDO_LIMIT_MS = 15 * 60_000;
type RepeatPrev = {
  remind_at: string | null; repeat_at: string; next: string; kids: { id: string; done_at: string | null }[]; at: string;
  notified: number; loc_notified: number;
};

/** Open hoofdtaak met ritme: afvinken schuift door in plaats van af te ronden. */
const rolls = (t: TaskRow) => !!t.repeat_rule && !t.parent_id && !t.done;

/** De ongedaan-maakstand, alleen als die nog bij de huidige keer hoort en binnen het venster valt. */
function undoable(t: TaskRow): RepeatPrev | null {
  if (!t.repeat_prev) return null;
  const prev = JSON.parse(t.repeat_prev) as RepeatPrev;
  return prev.next === t.repeat_at && Date.now() - Date.parse(prev.at) <= UNDO_LIMIT_MS ? prev : null;
}

/**
 * Herhalende taak afvinken: naar de volgende keer na nu én na de huidige keer, met de afgevinkte subtaken weer open.
 * Heropenen draait dat terug zolang undoable() het toestaat. Beide in één batch; de WHERE op repeat_at/repeat_prev
 * zorgt dat een gelijktijdig verzoek niets half of dubbel doet.
 */
async function rollRepeat(db: D1Database, t: TaskRow, done: boolean, z: Zone): Promise<void> {
  const ts = now();
  if (done) {
    const next = inZone(z, () => nextOccurrence(t.repeat_rule!, t.repeat_start!, Math.max(Date.now(), Date.parse(t.repeat_at!))));
    const { results: kids } = await db.prepare('SELECT id, done_at FROM tasks WHERE parent_id = ? AND user_id = ? AND done = 1')
      .bind(t.id, t.user_id).all<{ id: string; done_at: string | null }>();
    // Elke stap overschrijft de stand: ongedaan maken draait altijd de laatste stap terug.
    const prev = JSON.stringify({
      remind_at: t.remind_at, repeat_at: t.repeat_at!, next, kids, at: ts, notified: t.notified, loc_notified: t.loc_notified,
    } satisfies RepeatPrev);
    await db.batch([
      db.prepare('UPDATE tasks SET remind_at = ?, repeat_at = ?, notified = 0, loc_notified = CASE WHEN loc_lat IS NULL THEN loc_notified ELSE 0 END, ' +
        'repeat_prev = ?, updated_at = ? WHERE id = ? AND done = 0 AND repeat_at = ?').bind(next, next, prev, ts, t.id, t.repeat_at),
      // Alleen als de parent hierboven echt is doorgeschoven (repeat_at en updated_at van deze stap).
      db.prepare('UPDATE tasks SET done = 0, done_at = NULL, updated_at = ? WHERE parent_id = ? AND user_id = ? AND done = 1 AND id IN (SELECT value FROM json_each(?)) ' +
        'AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND repeat_at = ? AND updated_at = ?)').bind(ts, t.id, t.user_id, JSON.stringify(kids.map((k) => k.id)), t.id, next, ts),
    ]);
    return;
  }
  const prev = undoable(t);
  if (!prev) return;
  await db.batch([
    // Eerst de subtaken, zolang repeat_prev nog als bewijs in de parent staat.
    ...prev.kids.map((k) => db.prepare('UPDATE tasks SET done = 1, done_at = ?, updated_at = ? WHERE id = ? AND parent_id = ? AND user_id = ? AND done = 0 ' +
      'AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND repeat_prev = ?)').bind(k.done_at, ts, k.id, t.id, t.user_id, t.id, t.repeat_prev)),
    db.prepare('UPDATE tasks SET remind_at = ?, repeat_at = ?, notified = ?, loc_notified = ?, repeat_prev = NULL, updated_at = ? WHERE id = ? AND repeat_prev = ?')
      .bind(prev.remind_at, prev.repeat_at, prev.notified, prev.loc_notified, ts, t.id, t.repeat_prev),
  ]);
}

/**
 * Vinkt een taak af of heropent haar. Afvinken neemt open subtaken mee (met hetzelfde done_at);
 * heropenen zet precies die subtaken weer open, en een heropende subtaak opent ook haar parent.
 * Een open herhalende hoofdtaak gaat via rollRepeat.
 */
async function setDone(db: D1Database, t: TaskRow, done: boolean, z: Zone): Promise<void> {
  if (rolls(t)) return rollRepeat(db, t, done, z);
  const ts = now();
  const stmts = [db.prepare('UPDATE tasks SET done = ?, done_at = ?, updated_at = ? WHERE id = ?').bind(done ? 1 : 0, done ? ts : null, ts, t.id)];
  if (done) {
    stmts.push(db.prepare('UPDATE tasks SET done = 1, done_at = ?, updated_at = ? WHERE parent_id = ? AND done = 0 AND user_id = ?').bind(ts, ts, t.id, t.user_id));
  } else {
    if (t.done && t.done_at) {
      stmts.push(db.prepare('UPDATE tasks SET done = 0, done_at = NULL, updated_at = ? WHERE parent_id = ? AND done = 1 AND done_at = ? AND user_id = ?')
        .bind(ts, t.id, t.done_at, t.user_id));
    }
    if (t.parent_id) {
      stmts.push(db.prepare('UPDATE tasks SET done = 0, done_at = NULL, updated_at = ? WHERE id = ? AND done = 1 AND user_id = ?').bind(ts, t.parent_id, t.user_id));
    }
  }
  await db.batch(stmts);
}

function normRemind(v: unknown, z: Zone): string | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return localToUtcIso(String(v), z);
  } catch (e) {
    throw badRequest(e, 'err.invalid_date', { value: String(v) });
  }
}

app.get('/api/config', (c) => c.json({ vapidPublicKey: c.env.VAPID_PUBLIC_KEY }));

// Instellingen voor de PWA als module, zodat de service worker ze met de shell cachet (offline de juiste taal en zone).
app.get('/config.js', (c) => {
  const { timeZone, reminderTime, weekStart, defaultLocale } = c.get('prefs');
  const user = c.get('user');
  const config = {
    locale: c.get('lang'), defaultLocale, timeZone, reminderTime, weekStart, androidPackage: c.env.ANDROID_PACKAGE || null,
    userId: user.id, userName: user.name, isAdmin: user.role === 'admin',
  };
  return c.body(`export default ${JSON.stringify(config)};
`, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
});

/**
 * Statisch bestand dat de Worker bewerkt: zonder de conditionele headers van de browser (anders een 304 op het
 * onbewerkte bestand) en zonder diens ETag, die na een andere taal of vertaling nog steeds zou passen.
 */
async function rawAsset(c: Context<AppEnv>): Promise<Response> {
  return c.env.ASSETS.fetch(new Request(c.req.url));
}

function editedHeaders(res: Response): Headers {
  const headers = new Headers(res.headers);
  for (const h of ['etag', 'last-modified', 'content-length']) headers.delete(h);
  headers.set('cache-control', 'no-cache');
  return headers;
}

// De shell wordt in de taal van het apparaat geserveerd: data-i18n zet de tekst, data-i18n-attr (attr:sleutel;…)
// de attributen. De attributen blijven staan zodat de client de taal opnieuw kan toepassen; de vertaalde versie
// staat in de cache van de service worker.
app.get('/', async (c) => {
  const res = await rawAsset(c);
  if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return new Response(res.body, res);
  const lang = c.get('lang');
  const out = new HTMLRewriter()
    .on('html', { element: (e) => { e.setAttribute('lang', lang); } })
    .on('[data-i18n]', { element: (e) => { e.setInnerContent(translate(lang, e.getAttribute('data-i18n')!)); } })
    .on('[data-i18n-attr]', {
      element: (e) => {
        for (const pair of e.getAttribute('data-i18n-attr')!.split(';')) {
          const [attr, key] = pair.split(':');
          e.setAttribute(attr, translate(lang, key));
        }
      },
    })
    .transform(res);
  return new Response(out.body, { status: 200, headers: editedHeaders(res) });
});

app.get('/manifest.webmanifest', async (c) => {
  const res = await rawAsset(c);
  if (!res.ok) return new Response(res.body, res);
  const lang = c.get('lang');
  const manifest = await res.json<{ lang: string; shortcuts?: { name: string }[] }>();
  manifest.lang = lang;
  for (const s of manifest.shortcuts ?? []) s.name = translate(lang, 'ui.new_task');
  const headers = editedHeaders(res);
  headers.set('content-type', 'application/manifest+json');
  return new Response(JSON.stringify(manifest), { status: 200, headers });
});

/** Zoekfilter op titel en omschrijving (LIKE, hoofdletterongevoelig voor ASCII); % en _ tellen letterlijk. */
function searchFilter(q: string | undefined): { sql: string; binds: string[] } {
  const term = q?.trim();
  if (!term) return { sql: '', binds: [] };
  if (term.length > MAX_QUERY) throw new HttpError(400, 'err.too_long', { field: 'q', max: MAX_QUERY });
  const pattern = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  return { sql: " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')", binds: [pattern, pattern] };
}

app.get('/api/tasks', async (c) => {
  const userId = c.get('auth').userId;
  const done = c.req.query('done');
  const search = searchFilter(c.req.query('q'));
  if (done) {
    const limit = intParam(c.req.query('limit'), 100, 1, 500);
    const offset = intParam(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const rows = await c.env.DB.prepare(`SELECT * FROM tasks WHERE user_id = ? AND done = 1${search.sql} ORDER BY done_at DESC LIMIT ? OFFSET ?`)
      .bind(userId, ...search.binds, limit, offset).all<TaskRow>();
    return c.json(rows.results.map(asBool));
  }
  const rows = await c.env.DB.prepare(`SELECT * FROM tasks WHERE user_id = ? AND done = 0${search.sql} ORDER BY position`).bind(userId, ...search.binds).all<TaskRow>();
  return c.json(rows.results.map(asBool));
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optioneel id van de client (offline aangemaakt); anders een nieuw id. */
function clientId(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'err.id_uuid');
  return v.toLowerCase();
}

// Idempotent: een id dat al bestaat geeft de bestaande taak terug (200), zodat de offline-wachtrij veilig opnieuw kan sturen.
app.post('/api/tasks', async (c) => {
  const b = await body(c);
  const id = clientId(b.id);
  const userId = c.get('auth').userId;
  const existing = id && await getTask(c.env.DB, userId, id);
  if (existing) return c.json(asBool(existing), 200);
  // Een id dat bij een ander account hoort mag niets overschrijven en lekt niets.
  if (id && await c.env.DB.prepare('SELECT 1 FROM tasks WHERE id = ?').bind(id).first()) throw new HttpError(409, 'err.id_taken');
  return c.json(await createTask(c.env, userId, c.get('prefs'), b, 'app', id ?? undefined), 201);
});

async function createTask(env: Env, userId: string, z: Zone, b: Record<string, unknown>, source: string, id: string = crypto.randomUUID()) {
  const title = cleanTitle(b.title);
  const description = cleanDescription(b.description);
  const parent = await checkParent(env.DB, userId, b.parent_id);
  const loc = locColumns('location' in b ? cleanLocation(b.location) : null);
  // Een ritme bepaalt de eerste reminder: die wordt `at`, ook als de body een andere remind_at had.
  const rule = typeof b.repeat === 'string' && !b.repeat.trim() ? null : b.repeat ?? null; // leeg = geen ritme
  if (rule !== null && parent) throw new HttpError(400, 'err.only_parents_repeat');
  const remindIso = normRemind(b.remind_at, z);
  const rep = repeatColumns(rule as string | null, remindIso, z);
  const remindAt = (rep.repeat_at as string | null) ?? remindIso;
  const ts = now();
  const position = typeof b.position === 'number' && Number.isFinite(b.position) ? b.position : await newPosition(env.DB, userId, parent?.id ?? null);
  // Een subtaak hoort altijd in de lijst van haar parent.
  const list = parent ? parent.list : cleanList(b.list);
  await env.DB.prepare(
    // ON CONFLICT: twee gelijktijdige pogingen met hetzelfde client-id geven geen fout.
    'INSERT INTO tasks (id,user_id,title,description,list,parent_id,position,remind_at,source,created_at,updated_at,loc_name,loc_lat,loc_lng,loc_radius,loc_trigger,repeat_rule,repeat_start,repeat_at,repeat_prev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
  ).bind(id, userId, title, description, list, parent?.id ?? null, position, remindAt, source, ts, ts,
    loc.loc_name, loc.loc_lat, loc.loc_lng, loc.loc_radius, loc.loc_trigger,
    rep.repeat_rule, rep.repeat_start, rep.repeat_at, rep.repeat_prev).run();
  // Alleen null als een ander account dit id net gelijktijdig kreeg (ON CONFLICT DO NOTHING).
  const created = await getTask(env.DB, userId, id);
  if (!created) throw new HttpError(409, 'err.id_taken');
  return asBool(created);
}

app.patch('/api/tasks/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = c.get('auth').userId;
  const z = c.get('prefs');
  const b = await body(c);
  const t = await getTask(db, userId, id);
  if (!t) throw new HttpError(404, 'err.not_found');
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if ('title' in b) set('title', cleanTitle(b.title));
  if ('description' in b) set('description', cleanDescription(b.description));
  let list = 'list' in b ? cleanList(b.list) : null;
  let parentId = t.parent_id;
  if ('parent_id' in b) {
    const parent = await checkParent(db, userId, b.parent_id, t);
    set('parent_id', parent?.id ?? null);
    parentId = parent?.id ?? null;
    if (parent) list = parent.list;
  }
  if (list !== null) set('list', list);
  if ('position' in b) {
    const p = Number(b.position);
    if (!Number.isFinite(p)) throw new HttpError(400, 'err.must_be_number', { field: 'position' });
    set('position', p);
  }
  // Ritme: instellen zet remind_at op de eerste keer; uitzetten, de reminder wissen of een subtaak worden wist het.
  // Alleen de reminder verzetten laat repeat_* staan. Elke wijziging van remind_at of repeat wist repeat_prev.
  const newRemind = 'remind_at' in b ? normRemind(b.remind_at, z) : undefined;
  const noRepeat = b.repeat === null || b.repeat === undefined || (typeof b.repeat === 'string' && !b.repeat.trim());
  const setRepeat = 'repeat' in b && !noRepeat && newRemind !== null;
  if (setRepeat && parentId) throw new HttpError(400, 'err.only_parents_repeat');
  if (setRepeat) {
    const rep = repeatColumns(b.repeat as string, newRemind ?? t.remind_at ?? todayDefaultIso(z), z);
    for (const [col, v] of Object.entries(rep)) set(col, v);
    set('remind_at', rep.repeat_at);
    set('notified', 0);
  } else {
    if (newRemind !== undefined) { set('remind_at', newRemind); set('notified', 0); }
    const clear = ('repeat' in b && noRepeat) || newRemind === null || ('parent_id' in b && parentId !== null);
    if (clear) for (const [col, v] of Object.entries(repeatColumns(null, null, z))) set(col, v);
    else if (newRemind !== undefined) set('repeat_prev', null);
  }
  // Elke nieuwe locatie telt weer als nog niet gemeld.
  if ('location' in b) {
    for (const [col, v] of Object.entries(locColumns(cleanLocation(b.location)))) set(col, v);
    set('loc_notified', 0);
  }
  if ('location_notified' in b) {
    if (typeof b.location_notified !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'location_notified' });
    set('loc_notified', b.location_notified ? 1 : 0);
  }
  if (!sets.length && !('done' in b)) throw new HttpError(400, 'err.nothing_to_change');
  if (sets.length) {
    set('updated_at', now());
    await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals, id, userId).run();
  }
  // Subtaken verhuizen mee naar de nieuwe lijst van hun parent.
  if (list !== null && list !== t.list) {
    await db.prepare('UPDATE tasks SET list = ?, updated_at = ? WHERE parent_id = ? AND user_id = ?').bind(list, now(), id, userId).run();
  }
  if ('done' in b) {
    // Opnieuw lezen: dezelfde PATCH kan net remind_at of repeat gezet hebben.
    const cur = sets.length ? (await getTask(db, userId, id))! : t;
    // Een herhalende taak staat altijd open. `occurrence` (indien meegestuurd) moet de huidige keer zijn: bij done:true
    // schuift een herhaald verzoek uit de outbox zo niet nog een keer door, bij done:false draait een vertraagd
    // ongedaan maken (dat een eerdere stap bedoelde) de nieuwste stap niet terug.
    const sameAt = !('occurrence' in b) || Date.parse(String(b.occurrence)) === Date.parse(cur.repeat_at!);
    const act = rolls(cur) ? sameAt && (!!b.done || !!undoable(cur)) : !!b.done !== !!cur.done;
    if (act) await setDone(db, cur, !!b.done, z);
  }
  const updated = (await getTask(db, userId, id))!;
  if ('position' in b) await rebalanceIfNeeded(db, updated);
  return c.json(asBool((await getTask(db, userId, id))!));
});

app.delete('/api/tasks/:id', async (c) => {
  const userId = c.get('auth').userId;
  const id = c.req.param('id');
  const t = await getTask(c.env.DB, userId, id);
  if (!t) throw new HttpError(404, 'err.not_found');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tasks WHERE parent_id = ? AND user_id = ?').bind(id, userId),
    c.env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return c.json({ ok: true });
});

// Lijsten bestaan alleen als `list`-kolom van taken; er is geen aparte tabel.
app.get('/api/lists', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT list AS name, SUM(done = 0) AS open FROM tasks WHERE user_id = ? GROUP BY list')
    .bind(c.get('auth').userId).all<{ name: string; open: number }>();
  const lists = results.map((r) => ({ name: r.name, open: r.open }));
  // Inbox is vast en moet er ook zijn zonder taken.
  if (!lists.some((l) => l.name === 'Inbox')) lists.push({ name: 'Inbox', open: 0 });
  lists.sort((a, b) => a.name.localeCompare(b.name, c.get('lang'), { sensitivity: 'base' }));
  return c.json(lists);
});

app.post('/api/lists/rename', async (c) => {
  const b = await body(c);
  const from = existingListName(b.from, 'from');
  const to = listName(b.to, 'to');
  if (from === 'Inbox') throw new HttpError(400, 'err.inbox_rename');
  if (from === to) return c.json({ moved: 0 });
  // Subtaken staan in dezelfde lijst als hun parent, dus één UPDATE dekt alles.
  const res = await c.env.DB.prepare('UPDATE tasks SET list = ?, updated_at = ? WHERE list = ? AND user_id = ?').bind(to, now(), from, c.get('auth').userId).run();
  return c.json({ moved: res.meta.changes });
});

app.post('/api/lists/delete', async (c) => {
  const b = await body(c);
  const name = existingListName(b.name, 'name');
  if (name === 'Inbox') throw new HttpError(400, 'err.inbox_delete');
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  if (b.tasks === 'inbox') {
    const res = await db.prepare("UPDATE tasks SET list = 'Inbox', updated_at = ? WHERE list = ? AND user_id = ?").bind(now(), name, userId).run();
    return c.json({ moved: res.meta.changes });
  }
  if (b.tasks === 'delete') {
    // Eerst de subtaken, dan de taken zelf, zoals bij het verwijderen van één taak.
    const res = await db.batch([
      db.prepare('DELETE FROM tasks WHERE user_id = ? AND parent_id IN (SELECT id FROM tasks WHERE list = ? AND user_id = ?)').bind(userId, name, userId),
      db.prepare('DELETE FROM tasks WHERE list = ? AND user_id = ?').bind(name, userId),
    ]);
    return c.json({ deleted: res.reduce((n, r) => n + r.meta.changes, 0) });
  }
  throw new HttpError(400, 'err.tasks_option');
});

// Simpele variant voor clients zonder PATCH (Android-widget); werkt net als PATCH {done}.
for (const [action, done] of [['done', true], ['reopen', false]] as const) {
  app.post(`/api/tasks/:id/${action}`, async (c) => {
    const t = await getTask(c.env.DB, c.get('auth').userId, c.req.param('id'));
    if (!t) throw new HttpError(404, 'err.not_found');
    // Een herhalende taak staat altijd open: /done schuift altijd door, /reopen draait terug als dat nog mag (setDone beslist).
    if (rolls(t) || !!t.done !== done) await setDone(c.env.DB, t, done, c.get('prefs'));
    return c.json({ ok: true });
  });
}

app.post('/api/tasks/:id/snooze', async (c) => {
  const { minutes } = await c.req.json<{ minutes?: unknown }>().catch(() => ({ minutes: undefined }));
  const m = minutes === undefined || minutes === null ? 60 : Number(minutes);
  if (!Number.isFinite(m)) throw new HttpError(400, 'err.must_be_number', { field: 'minutes' });
  const at = new Date(Date.now() + Math.min(Math.max(m, 1), MAX_SNOOZE_MIN) * 60_000).toISOString();
  // Het ritme (repeat_at) blijft staan; zoals elke schrijver van remind_at wist snoozen de ongedaan-maakstand.
  const res = await c.env.DB.prepare('UPDATE tasks SET remind_at = ?, notified = 0, repeat_prev = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(at, now(), c.req.param('id'), c.get('auth').userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true, remind_at: at });
});

// Endpoint voor automations (INBOX_TOKEN): title, notes, due, list en repeat. De Nederlandse velden
// titel/omschrijving/datum blijven werken voor bestaande koppelingen.
app.post('/api/inbox', async (c) => {
  const b = await body(c);
  const title = b.title ?? b.titel;
  const description = b.notes ?? b.description ?? b.omschrijving ?? '';
  const remind = b.due ?? b.remind_at ?? b.datum ?? b.date ?? null; // een kale datum krijgt de reminder-tijd in localToUtcIso
  return c.json(await createTask(c.env, c.get('auth').userId, c.get('prefs'), { title, description, remind_at: remind, repeat: b.repeat, list: String(b.list ?? '').slice(0, MAX_LIST).trim() || 'Inbox' }, 'api'), 201);
});

app.post('/api/push/subscribe', async (c) => {
  const s = await body<{ endpoint: string; keys: { p256dh: string; auth: string }; locale?: string }>(c);
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, 'err.invalid_subscription');
  await c.env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at,locale,user_id) VALUES (?,?,?,?,?,?,?) ' +
    'ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent, ' +
    'locale=COALESCE(excluded.locale, locale), user_id = excluded.user_id',
  ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, c.req.header('user-agent') ?? '', now(), s.locale === 'en' || s.locale === 'nl' ? s.locale : null, c.get('auth').userId).run();
  return c.json({ ok: true });
});

app.delete('/api/push/subscribe', async (c) => {
  const { endpoint } = await body<{ endpoint: string }>(c);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, c.get('auth').userId).run();
  return c.json({ ok: true });
});

app.post('/api/push/test', async (c) => {
  const r = await sendToAll(c.env, c.get('auth').userId, (locale) => ({ title: 'Tick', body: translate(locale, 'push.test_body'), url: '/' }), c.get('prefs').defaultLocale);
  return c.json(r);
});

// Favoriete plekken: losse lijst; taken bewaren een kopie van de locatie, dus wijzigen of verwijderen raakt ze niet.
const PLACE_COLS = 'id, name, lat, lng, radius';

/** De UNIQUE-fout van D1 op places.name wordt een nette 409. */
async function placeWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.place_exists');
    throw e;
  }
}

app.get('/api/places', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${PLACE_COLS} FROM places WHERE user_id = ? ORDER BY name COLLATE NOCASE, id`).bind(c.get('auth').userId).all<Place>();
  return c.json(results);
});

app.post('/api/places', async (c) => {
  const p = cleanPlace(await body(c), false) as Omit<Place, 'id'>;
  const id = crypto.randomUUID();
  const ts = now();
  await placeWrite(() => c.env.DB.prepare('INSERT INTO places (id, user_id, name, lat, lng, radius, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.get('auth').userId, p.name, p.lat, p.lng, p.radius, ts, ts).run());
  return c.json({ id, ...p } satisfies Place, 201);
});

app.patch('/api/places/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('auth').userId;
  const p = cleanPlace(await body(c), true);
  const cols = Object.keys(p);
  if (cols.length) {
    await placeWrite(() => c.env.DB.prepare(`UPDATE places SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(...Object.values(p), now(), id, userId).run());
  }
  const row = await c.env.DB.prepare(`SELECT ${PLACE_COLS} FROM places WHERE id = ? AND user_id = ?`).bind(id, userId).first<Place>();
  if (!row) throw new HttpError(404, 'err.not_found');
  return c.json(row);
});

app.delete('/api/places/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM places WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('auth').userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true });
});

// Adres zoeken via Nominatim. Server-side, zodat de gebruiker zijn zoekterm niet rechtstreeks aan OSM geeft
// en we het gebruiksbeleid (User-Agent met contact, laag volume) kunnen afdwingen.
app.get('/api/geocode', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2 || q.length > 200) throw new HttpError(400, 'err.query_length');
  const { success } = await c.env.GEOCODE_LIMITER.limit({ key: 'geocode' });
  if (!success) throw new HttpError(429, 'err.geocode_busy');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${c.get('lang')}&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': `Tick/1.0 (+${new URL(c.req.url).origin}; ${c.env.ADMIN_CONTACT})` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim gaf status ${res.status}`);
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    // Rijen zonder bruikbare coördinaten weglaten: die zouden als null in de kaart belanden.
    const places = rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return c.json(places.slice(0, 5));
  } catch (e) {
    console.error('geocode mislukt', e);
    return c.json({ error: translate(c.get('lang'), 'err.geocode_failed') }, 502);
  }
});

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: translate(c.get('lang') ?? normLocale(c.env.LOCALE), e.key, e.vars) }, e.status);
  console.error(e);
  return c.json({ error: translate(c.get('lang') ?? normLocale(c.env.LOCALE), 'err.server') }, 500);
});

// Alles wat geen API is: statische bestanden (alleen na auth).
app.all('*', asset);

export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil((async () => {
      // runReminders leest per taak de instellingen van de eigenaar; er zit geen globale zone tussen.
      await runReminders(env, await loadInstallPrefs(env));
    })());
  },
};
