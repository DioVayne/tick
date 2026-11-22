import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail, cleanName } from './account';
import { authorize, bumpSessionVersionStmt, sessionCookie } from './auth';
import { HttpError } from './errors';
import { adminOnly } from './guards';
import { checkPassword } from './links';
import { mailEnabled, recordSignup, releaseMail } from './mail';
import { hashPassword } from './password';
import { loadInstallPrefs, loadUserPrefs, settingStmt, validZone } from './prefs';
import { inBackground, type Locale } from './push';
import { openSignup, sendVerifyMail, UNVERIFIED_TTL_MS } from './signup';
import { STEP, topMin } from './access';
import { getUser, type User } from './users';
import { deleteAccount } from './users-api';
import { addWelcomeTask } from './welcome';
import { normLocale, translate } from '../public/i18n.js';

/**
 * Demo zonder account. "Probeer de demo" (website → /demo) maakt een tijdelijk account met voorbeeldtaken en logt je in,
 * zonder e-mail of wachtwoord. Een demo duurt `minutes` (instelling van de beheerder) en schuift bij gebruik op, tot
 * hooguit DEMO_HARD_HOURS na het begin; daarna ruimt de cron hem op. Een demo mag alleen taken, lijsten en een paar
 * instellingen gebruiken (`demoMayDo`): geen mail, delen, push, sleutels, bijlagen, agenda of verhuizen. Op een openbare
 * Tick kan een demo een echt account worden (`/api/demo/keep`).
 *
 * Aan: `DEMO = "true"` in de config (anders bestaat niets hiervan). De beheerder zet hem daarnaast aan/uit en kiest de
 * duur in Instellingen (rijen `demo_on` en `demo_minutes` in `settings`).
 */

/** Keuzes voor de duur van een demo in minuten (de beheerder kiest er één in Instellingen). */
export const DEMO_MINUTES = [30, 60, 120] as const;
export const DEMO_DEFAULT_MINUTES = 60;
/** Een demo verdwijnt uiterlijk zoveel uur na het begin, hoe actief hij ook is. */
export const DEMO_HARD_HOURS = 3;
/** Hooguit zoveel demo's tegelijk (DEMO_MAX overschrijft). */
export const DEMO_DEFAULT_MAX = 200;
/** De demo schuift hoogstens eens per zoveel ms op (scheelt een schrijfactie per verzoek). */
const SLIDE_EVERY_MS = 5 * 60_000;

/** Staat de demo in de config aan (`DEMO = "true"`)? */
export const demoAllowed = (env: Pick<Env, 'DEMO'>): boolean => env.DEMO?.trim() === 'true';

export function demoMax(env: Pick<Env, 'DEMO_MAX'>): number {
  const n = Number(env.DEMO_MAX);
  return env.DEMO_MAX && Number.isInteger(n) && n >= 1 ? n : DEMO_DEFAULT_MAX;
}

export type DemoSettings = { on: boolean; minutes: number };

/** De instellingen van de beheerder; zonder rijen: aan, 60 minuten. */
export async function demoSettings(db: D1Database): Promise<DemoSettings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('demo_on', 'demo_minutes')").all<{ key: string; value: string }>();
  const row = new Map(results.map((r) => [r.key, r.value]));
  const m = Number(row.get('demo_minutes'));
  return { on: row.get('demo_on') !== '0', minutes: (DEMO_MINUTES as readonly number[]).includes(m) ? m : DEMO_DEFAULT_MINUTES };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Tot wanneer een demo loopt na activiteit op `now`: `minutes` verder, maar nooit na het harde einde. */
export function slideUntil(createdAt: string, minutes: number, now: number): string {
  return iso(Math.min(now + minutes * 60_000, Date.parse(createdAt) + DEMO_HARD_HOURS * 3_600_000));
}

/**
 * Wat een demo-account mag. Lezen mag (behalve de MCP-koppeling en het adres zoeken, dat naar een externe dienst gaat);
 * schrijven alleen aan taken, lijsten, de prullenbak, de Tickmanager, plekken, een uitnodiging van "Sam" en de demo
 * zelf. Een nieuwe route is voor een demo dus dicht tot hij hier bij komt.
 */
export function demoMayDo(method: string, path: string, body?: unknown): boolean {
  if (path.startsWith('/mcp') || path === '/api/geocode') return false;
  if (method === 'GET' || method === 'HEAD') return true;
  // Bijlagen (opslag in R2) horen onder /api/tasks/:id/attachments: dicht.
  if (/^\/api\/tasks\/[^/]+\/attachments/.test(path)) return false;
  if (/^\/api\/(tasks|lists|trash|review|places|demo)(\/|$)/.test(path)) return true;
  if (/^\/api\/shared-lists\/[^/]+\/(accept|decline)$/.test(path)) return true;
  // Instellingen wel, maar geen webhook (dat zou een externe URL laten aanroepen).
  if (path === '/api/settings' && method === 'PATCH') {
    return !!body && typeof body === 'object' && !Array.isArray(body) && !('fallbackWebhook' in body);
  }
  return false;
}

/**
 * Na de inlogcontrole, voor een demo-account: verlopen = uitgelogd, Sam logt nooit in, alleen wat `demoMayDo` toelaat,
 * en elk toegestaan verzoek schuift de demo op.
 */
export async function demoGate(c: Context<AppEnv>, user: User): Promise<void> {
  const now = Date.now();
  if (user.demo_of || !user.demo_until || Date.parse(user.demo_until) <= now) throw new HttpError(401, 'err.unauthorized');
  const kind = c.get('auth').kind;
  if (kind !== 'session') throw new HttpError(403, 'err.demo_blocked');
  const method = c.req.method;
  const body = method === 'PATCH' && c.req.path === '/api/settings' ? await c.req.raw.clone().json().catch(() => null) : undefined;
  if (!demoMayDo(method, c.req.path, body)) throw new HttpError(403, 'err.demo_blocked');
  if (c.get('asset')) return;
  const { minutes } = await demoSettings(c.env.DB);
  const next = slideUntil(user.created_at, minutes, now);
  if (Date.parse(next) - Date.parse(user.demo_until) < SLIDE_EVERY_MS) return;
  await c.env.DB.prepare('UPDATE users SET demo_until = ? WHERE id = ? AND demo_until IS NOT NULL').bind(next, user.id).run();
  user.demo_until = next;
}

/** Aantal lopende demo's (zonder de Sam-accounts). */
export async function activeDemos(db: D1Database, now = Date.now()): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE demo_until > ? AND demo_of IS NULL').bind(iso(now)).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Een dag `offset` dagen na vandaag in de zone, als YYYY-MM-DD. */
function localDay(timeZone: string, offset: number, now = Date.now()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * De voorbeeldtaken. Elke tekst is een sleutel `demo.*` in public/i18n.js, in de taal van de bezoeker. `day` is het
 * aantal dagen vanaf vandaag (met `time` erbij een herinnering), `repeat` een ritme, `done`/`pinned` een vinkje of pin.
 */
type Sample = { title: string; list?: string; day?: number; time?: string; repeat?: string; done?: boolean; pinned?: boolean; note?: string; subs?: string[] };

export const DEMO_TASKS: Sample[] = [
  { title: 'demo.t_dentist', day: 1, time: '10:00' },
  { title: 'demo.t_bins', day: 0, time: '19:00', repeat: 'FREQ=WEEKLY;BYDAY=TU' },
  { title: 'demo.t_rent', day: 0, time: '09:00', repeat: 'FREQ=MONTHLY;BYMONTHDAY=1' },
  { title: 'demo.t_gift', day: -1, time: '17:00' },
  { title: 'demo.t_passport', pinned: true, note: 'demo.t_passport_note' },
  { title: 'demo.t_groceries', list: 'demo.l_groceries', subs: ['demo.s_milk', 'demo.s_bread', 'demo.s_apples', 'demo.s_coffee'] },
  { title: 'demo.t_plants', list: 'demo.l_groceries', done: true },
  { title: 'demo.t_slides', list: 'demo.l_work', day: 1, time: '14:00', note: 'demo.t_slides_note' },
  { title: 'demo.t_quote', list: 'demo.l_work', done: true },
];

/** De taken van Sam in de gedeelde lijst (`demo.l_trip`). */
export const DEMO_SHARED: Sample[] = [
  { title: 'demo.t_cabin', done: true },
  { title: 'demo.t_tickets', day: 3, time: '20:00' },
  { title: 'demo.t_packing' },
];

/** Maakt de taken van één voorbeeldlijst aan via dezelfde code als de app (createTask), daarna vinkjes en pins. */
async function addSamples(env: Env, user: User, lang: Locale, samples: Sample[], list?: string): Promise<string[]> {
  // Dynamisch: src/index.ts laadt deze module zelf (geen kringverwijzing bij het laden).
  const { createTask } = await import('./index');
  const z = await loadUserPrefs(env, user);
  const tr = (key: string) => translate(lang, key);
  const ids: string[] = [];
  const done: string[] = [];
  const pinned: string[] = [];
  for (const s of samples) {
    const body: Record<string, unknown> = { title: tr(s.title), list: list ?? (s.list ? tr(s.list) : 'Inbox') };
    if (s.note) body.description = tr(s.note);
    if (s.day !== undefined) body.remind_at = `${localDay(z.timeZone, s.day)}T${s.time ?? z.reminderTime}`;
    if (s.repeat) body.repeat = s.repeat;
    const t = await createTask(env, user.id, z, body, 'app') as { id: string };
    ids.push(t.id);
    if (s.done) done.push(t.id);
    if (s.pinned) pinned.push(t.id);
    for (const sub of s.subs ?? []) await createTask(env, user.id, z, { title: tr(sub), parent_id: t.id }, 'app');
  }
  const ts = iso(Date.now());
  const db = env.DB;
  const stmts = [
    ...done.map((id) => db.prepare('UPDATE tasks SET done = 1, done_at = ?, done_by = ?, updated_at = ? WHERE id = ?').bind(ts, user.id, ts, id)),
    ...pinned.map((id) => db.prepare('UPDATE tasks SET pinned = 1 WHERE id = ?').bind(id)),
  ];
  if (stmts.length) await db.batch(stmts);
  return ids;
}

/**
 * Een gedeelde lijst van Sam waar de demo lid van is: dezelfde rijen als delen (POST /api/shared-lists) plus
 * accepteren (POST /api/shared-lists/:id/accept) in src/sharedlists.ts, maar zonder uitnodiging en push.
 */
async function shareSamList(db: D1Database, samId: string, demoId: string, name: string): Promise<void> {
  const listId = crypto.randomUUID();
  const ts = iso(Date.now());
  const top = (await topMin(db, demoId)) ?? 0;
  await db.batch([
    db.prepare("INSERT INTO shared_lists (id, owner_id, mode, created_at) VALUES (?, ?, 'shared', ?)").bind(listId, samId, ts),
    db.prepare("INSERT INTO list_members (list_id, user_id, role, status, name, created_at, responded_at) VALUES (?, ?, 'owner', 'accepted', ?, ?, ?)")
      .bind(listId, samId, name, ts, ts),
    db.prepare('UPDATE tasks SET shared_list = ?, updated_at = ? WHERE user_id = ? AND list = ? AND parent_id IS NULL AND deleted_at IS NULL')
      .bind(listId, ts, samId, name),
    db.prepare("INSERT INTO list_members (list_id, user_id, role, status, name, created_at, responded_at, by_email) VALUES (?, ?, 'member', 'accepted', ?, ?, ?, 0)")
      .bind(listId, demoId, name, ts, ts),
    db.prepare(
      'INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, list, position, created_at, responded_at) ' +
      "SELECT lower(hex(randomblob(16))), id, user_id, ?2, 'shared', 'accepted', ?3, ?4 - (n - rn + 1) * ?5, ?6, ?6 FROM (" +
      'SELECT id, user_id, row_number() OVER (ORDER BY position, id) AS rn, count(*) OVER () AS n FROM tasks ' +
      'WHERE shared_list = ?1 AND parent_id IS NULL AND deleted_at IS NULL)',
    ).bind(listId, demoId, name, top, STEP, ts),
  ]);
}

/** Maakt een demo (account, Sam, voorbeeldtaken) en geeft de gebruiker. Een fout ruimt op wat er al stond. */
export async function createDemo(env: Env, lang: Locale, timeZone: string | null, now = Date.now()): Promise<User> {
  const db = env.DB;
  const { minutes } = await demoSettings(db);
  const ts = iso(now);
  const until = iso(now + minutes * 60_000);
  const hard = iso(now + DEMO_HARD_HOURS * 3_600_000);
  const id = crypto.randomUUID();
  const samId = crypto.randomUUID();
  // Zonder e-mail en wachtwoord: inloggen kan alleen met de sessiecookie. "Bevestigd", zodat de bevestigingsbalk van een
  // openbare Tick wegblijft; delen is voor een demo toch dicht (demoMayDo).
  const insert = db.prepare("INSERT INTO users (id, name, email, password_hash, role, session_version, created_at, email_verified_at, demo_until, demo_of) VALUES (?, ?, NULL, NULL, 'member', 1, ?, ?, ?, ?)");
  const stmts = [
    insert.bind(id, translate(lang, 'demo.name'), ts, ts, until, null),
    insert.bind(samId, translate(lang, 'demo.sam'), ts, ts, hard, id),
  ];
  if (timeZone && validZone(timeZone)) {
    stmts.push(db.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?), (?, ?, ?)').bind(id, 'timezone', timeZone, samId, 'timezone', timeZone));
  }
  await db.batch(stmts);
  try {
    const user = (await getUser(db, id))!;
    const sam = (await getUser(db, samId))!;
    await addWelcomeTask(env, id, lang);
    await addSamples(env, user, lang, DEMO_TASKS);
    const trip = translate(lang, 'demo.l_trip');
    await addSamples(env, sam, lang, DEMO_SHARED, trip);
    await shareSamList(db, samId, id, trip);
    return user;
  } catch (e) {
    await deleteAccount(env, samId).catch(() => {});
    await deleteAccount(env, id).catch(() => {});
    throw e;
  }
}

/**
 * Elke 10 minuten (cron): verlopen demo's weg, met hun Sam; ook een Sam zonder demo. Via dezelfde code als "account
 * verwijderen" (taken, lijsten, deelrijen). Sam eerst, dan gaat zijn lijst over naar de demo en daarna met hem weg.
 */
export async function purgeDemos(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM users WHERE demo_until IS NOT NULL AND (demo_until < ?1 ' +
    'OR demo_of IN (SELECT id FROM users WHERE demo_until < ?1) ' +
    'OR (demo_of IS NOT NULL AND demo_of NOT IN (SELECT id FROM users WHERE demo_until IS NOT NULL))) ' +
    'ORDER BY demo_of IS NULL LIMIT 50',
  ).bind(iso(now)).all<{ id: string }>();
  for (const { id } of results) await deleteAccount(env, id);
  return results.length;
}

const ip = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'onbekend';

/** Kan op deze Tick nu een demo starten? (config aan én beheerder niet uit) */
async function demoOn(env: Env): Promise<boolean> {
  return demoAllowed(env) && (await demoSettings(env.DB)).on;
}

/** /demo (vóór de auth-middleware): de startpagina en het starten zelf. Uit → 404. */
export const demoPages = new Hono<AppEnv>();

demoPages.use('/demo', async (c, next) => {
  if (!(await demoOn(c.env))) return c.notFound();
  await next();
});

/**
 * De startpagina start de demo met een script (POST vanaf dezelfde site): een link-voorbeeld of zoekmachine maakt zo
 * geen account. Wie al ingelogd is, gaat gewoon naar de app.
 */
demoPages.get('/demo', async (c) => {
  if (await authorize(c.req.raw, c.env, await loadInstallPrefs(c.env))) return c.redirect('/', 302);
  return c.html(demoPage(c.get('lang')));
});

demoPages.post('/demo', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'demo:' + ip(c) });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  if (await activeDemos(c.env.DB) >= demoMax(c.env)) throw new HttpError(503, 'err.demo_full');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const tz = body && typeof body.timeZone === 'string' ? body.timeZone : null;
  const user = await createDemo(c.env, c.get('lang'), tz);
  c.header('Set-Cookie', await sessionCookie(c.env, user));
  return c.json({ ok: true }, 201);
});

function demoPage(locale: string | undefined): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t('demo.page_title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body data-offline="${t('app.you_are_offline')}"><div id="f"><img class="logo" src="/icon.svg" alt="" width="64" height="64"><h1>${t('demo.page_title')}</h1>
<p class="intro" id="demo-status" role="status">${t('demo.starting')}</p>
<p class="error" id="err" role="alert"></p>
<button type="button" id="demo-start" hidden>${t('demo.start_again')}</button>
<noscript><p class="intro">${t('demo.noscript')}</p></noscript>
<p class="link"><a href="/login">${t('demo.have_account')}</a></p></div>
<script type="module" src="/demo.js"></script></body></html>`;
}

/** /api/demo (na de auth): de stand van je eigen demo, omzetten naar een echt account, en de instellingen van de beheerder. */
export const demoApi = new Hono<AppEnv>();

demoApi.use('*', async (c, next) => {
  if (!demoAllowed(c.env)) return c.notFound();
  await next();
});

/** Je eigen demo: tot wanneer (met het harde einde), en of hij een echt account kan worden. Geen demo → 404. */
demoApi.get('/', (c) => {
  const user = c.get('user');
  if (!user.demo_until) throw new HttpError(404, 'err.not_found');
  const hard = iso(Date.parse(user.created_at) + DEMO_HARD_HOURS * 3_600_000);
  return c.json({ until: user.demo_until, hardEnd: hard, canKeep: openSignup(c.env) });
});

/**
 * Een demo wordt een echt account (alleen op een openbare Tick): naam, adres en wachtwoord zoals bij /signup, de taken
 * blijven, Sam verdwijnt (zijn gedeelde lijst wordt van jou). Daarna gelden de gewone regels (adres bevestigen).
 */
demoApi.post('/keep', async (c) => {
  const user = c.get('user');
  if (!user.demo_until || !openSignup(c.env)) throw new HttpError(404, 'err.not_found');
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'signup:' + ip(c) });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const db = c.env.DB;
  const now = Date.now();
  const slot = await recordSignup(db, now);
  try {
    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'err.email_taken');
    const deadline = mailEnabled(c.env) ? iso(now + UNVERIFIED_TTL_MS) : null;
    const res = await db.batch([
      db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, email_verified_at = NULL, verify_deadline = ?, demo_until = NULL, created_at = ? ' +
        'WHERE id = ? AND demo_until IS NOT NULL').bind(name, email, await hashPassword(password), deadline, iso(now), user.id),
      bumpSessionVersionStmt(db, user.id),
    ]);
    if (!res[0].meta.changes) throw new HttpError(404, 'err.not_found');
  } catch (e) {
    await releaseMail(db, slot.id);
    if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.email_taken');
    throw e;
  }
  const { results } = await db.prepare('SELECT id FROM users WHERE demo_of = ?').bind(user.id).all<{ id: string }>();
  for (const sam of results) await deleteAccount(c.env, sam.id);
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, user.id))!));
  await inBackground(c, sendVerifyMail(c.env, user.id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  return c.json({ ok: true });
});

/** Instellingen van de beheerder: aan/uit, de duur en hoeveel demo's er nu lopen. */
demoApi.get('/admin', adminOnly, async (c) => {
  const s = await demoSettings(c.env.DB);
  return c.json({ ...s, choices: DEMO_MINUTES, active: await activeDemos(c.env.DB), max: demoMax(c.env), hardHours: DEMO_HARD_HOURS });
});

demoApi.patch('/admin', adminOnly, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const stmts: D1PreparedStatement[] = [];
  if ('on' in body) {
    if (typeof body.on !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'on' });
    stmts.push(settingStmt(c.env.DB, 'demo_on', body.on ? null : '0'));
  }
  if ('minutes' in body) {
    if (!(DEMO_MINUTES as readonly unknown[]).includes(body.minutes)) throw new HttpError(400, 'err.demo_minutes');
    stmts.push(settingStmt(c.env.DB, 'demo_minutes', String(body.minutes)));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await demoSettings(c.env.DB));
});
