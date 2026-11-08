import { Hono } from 'hono';
import type { AppEnv, Env, TaskRow } from './index';
import { HttpError } from './errors';
import { getAccess } from './access';
import { blockStmts } from './blocks';
import { contactEmail } from './login';
import { mailEnabled, mailLayout, reserveMail, releaseMail, sendMail } from './mail';
import { inBackground, type Locale } from './push';
import { leaveShareStmts } from './shares';
import { leaveListStmts } from './sharedlists';
import { openSignup } from './signup';
import { translate } from '../public/i18n.js';

/**
 * Melden op een openbare Tick (OPEN_SIGNUP): een gedeelde taak, lijst, bijlage of openstaande uitnodiging van een
 * ander. De server bepaalt wie de gemelde persoon is, zegt het delen voor de melder op, bewaart de melding (voor de
 * beheerpagina, src/admin.ts) en mailt de beheerder. De gemelde inhoud blijft staan tot de beheerder beslist.
 */
export const reportsApi = new Hono<AppEnv>();

export const REASONS = ['spam', 'inappropriate', 'illegal', 'other'] as const;
export type Reason = typeof REASONS[number];
/** Zoveel meldingen per melder per 24 uur worden bewaard en gemaild; daarboven alleen het opzeggen. */
export const REPORTS_PER_DAY = 10;
const MAX_NOTE = 500;
const DAY = 86_400_000;

export type ReportRow = {
  id: string; reporter_id: string; reported_id: string; reason: Reason; note: string;
  task_id: string | null; list_id: string | null; attachment_id: string | null; title: string; attachment_name: string | null;
  status: 'open' | 'dismissed' | 'removed' | 'suspended'; created_at: string; handled_at: string | null;
};

/** Wat er gemeld wordt, wie, en wat er voor de melder gebeurt. */
type Found = {
  reported: string; title: string; task_id?: string; list_id?: string; attachment_id?: string; attachment_name?: string;
  action: D1PreparedStatement[];
};

const own = () => new HttpError(400, 'err.report_own');
const notFound = () => new HttpError(404, 'err.not_found');

/** De lijstnaam bij de eigenaar en de eigenaar van een gedeelde lijst, met jouw lidmaatschap (of null). */
async function listInfo(db: D1Database, listId: string, me: string) {
  return db.prepare('SELECT l.owner_id, o.name AS title, m.status, m.role FROM shared_lists l JOIN list_members o ON o.list_id = l.id AND o.user_id = l.owner_id ' +
    'LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = ?2 WHERE l.id = ?1').bind(listId, me)
    .first<{ owner_id: string; title: string; status: string | null; role: string | null }>();
}

/** Wat er in een gedeelde lijst gebeurt: een lid vertrekt, de eigenaar haalt de gemelde eruit. */
function listAction(db: D1Database, listId: string, me: string, ownerId: string, reported: string): D1PreparedStatement[] {
  return leaveListStmts(db, listId, me === ownerId ? reported : me);
}

/** Een hoofdtaak (of de ouder van een subtaak) waar je toegang toe hebt. */
async function headOf(db: D1Database, me: string, taskId: string): Promise<TaskRow | null> {
  const t = await getAccess(db, me, taskId);
  if (!t) return null;
  return t.parent_id ? getAccess(db, me, t.parent_id) : t;
}

/**
 * Een taak (eventueel via een bijlage van `uploader`): wie gemeld wordt en wat er voor de melder gebeurt. Zonder
 * `uploader` is de gemelde wie de taak deelde of in de gedeelde lijst zette.
 */
async function taskTarget(db: D1Database, me: string, head: TaskRow, uploader?: string): Promise<Found> {
  if (head.shared_list) {
    const list = await listInfo(db, head.shared_list, me);
    if (!list || list.status !== 'accepted') throw notFound();
    const reported = uploader ?? head.added_by ?? list.owner_id;
    if (reported === me) throw own();
    return { reported, title: head.title, task_id: head.id, action: listAction(db, head.shared_list, me, list.owner_id, reported) };
  }
  if (head.user_id !== me) {
    // Ontvanger: je stopt met deze taak.
    const s = await db.prepare("SELECT id FROM task_shares WHERE task_id = ? AND to_user = ? AND status = 'accepted'").bind(head.id, me).first<{ id: string }>();
    if (!s) throw notFound();
    return { reported: uploader ?? head.user_id, title: head.title, task_id: head.id, action: leaveShareStmts(db, s.id, head.id, me) };
  }
  // Eigenaar: alleen een bijlage van een deelnemer; die gaat eruit. Een taak die alleen van jou is, meld je niet.
  if (!uploader) throw own();
  const s = await db.prepare("SELECT id FROM task_shares WHERE task_id = ? AND to_user = ? AND mode = 'shared'").bind(head.id, uploader).first<{ id: string }>();
  if (!s) throw notFound();
  return { reported: uploader, title: head.title, task_id: head.id, action: leaveShareStmts(db, s.id, head.id, uploader) };
}

/** Ook voor blokkeren via wat er gedeeld is (src/blocks.ts). */
export async function findTarget(db: D1Database, me: string, b: Record<string, unknown>): Promise<Found> {
  const str = (k: string) => (typeof b[k] === 'string' && b[k] ? b[k] as string : null);
  const shareId = str('share_id');
  if (shareId) {
    // Een openstaande uitnodiging voor een taak: melden is ook weigeren.
    const s = await db.prepare("SELECT s.id, s.from_user, t.id AS task_id, t.title FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.id = ? AND s.to_user = ? AND s.status = 'pending'")
      .bind(shareId, me).first<{ id: string; from_user: string; task_id: string; title: string }>();
    if (!s) throw notFound();
    return { reported: s.from_user, title: s.title, task_id: s.task_id, action: [db.prepare("DELETE FROM task_shares WHERE id = ? AND status = 'pending'").bind(s.id)] };
  }
  const listId = str('list_id');
  if (listId) {
    const list = await listInfo(db, listId, me);
    if (!list?.status) throw notFound();
    if (list.owner_id === me) throw own();
    const action = list.status === 'pending'
      ? [db.prepare("DELETE FROM list_members WHERE list_id = ? AND user_id = ? AND status = 'pending'").bind(listId, me)]
      : leaveListStmts(db, listId, me);
    return { reported: list.owner_id, title: list.title, list_id: listId, action };
  }
  const attId = str('attachment_id');
  if (attId) {
    const a = await db.prepare("SELECT id, task_id, user_id, name FROM attachments WHERE id = ? AND status = 'ready'").bind(attId)
      .first<{ id: string; task_id: string; user_id: string; name: string }>();
    const head = a ? await headOf(db, me, a.task_id) : null;
    if (!a || !head) throw notFound();
    if (a.user_id === me) throw own();
    return { ...await taskTarget(db, me, head, a.user_id), attachment_id: a.id, attachment_name: a.name };
  }
  const taskId = str('task_id');
  const head = taskId ? await headOf(db, me, taskId) : null;
  if (!head) throw notFound();
  return taskTarget(db, me, head);
}

reportsApi.use('*', async (c, next) => {
  if (!openSignup(c.env)) throw new HttpError(404, 'err.not_found');
  await next();
});

reportsApi.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => { throw new HttpError(400, 'err.invalid_json'); });
  if (!REASONS.includes(b.reason as Reason)) throw new HttpError(400, 'err.report_reason');
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, MAX_NOTE) : '';
  const db = c.env.DB;
  const me = c.get('auth').userId;
  const found = await findTarget(db, me, b);
  const now = Date.now();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?')
    .bind(me, new Date(now - DAY).toISOString()).first<{ n: number }>();
  const keep = (recent?.n ?? 0) < REPORTS_PER_DAY;
  const id = crypto.randomUUID();
  await db.batch([
    ...(keep ? [db.prepare('INSERT INTO reports (id, reporter_id, reported_id, reason, note, task_id, list_id, attachment_id, title, attachment_name, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, me, found.reported, b.reason, note, found.task_id ?? null, found.list_id ?? null,
      found.attachment_id ?? null, found.title, found.attachment_name ?? null, new Date(now).toISOString())] : []),
    ...found.action,
    ...(b.block === true ? await blockStmts(db, me, found.reported) : []),
  ]);
  if (keep) await inBackground(c, sendReportMail(c.env, id, new URL(c.req.url).origin, c.get('install').defaultLocale), 'meldingsmail');
  return c.json({ ok: true }, 201);
});

/** De adressen die een melding krijgen: beheerders met een e-mailadres, anders `ADMIN_CONTACT`. */
async function adminAddresses(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''").all<{ email: string }>();
  if (results.length) return results.map((r) => r.email);
  const contact = contactEmail(env.ADMIN_CONTACT);
  return contact ? [contact] : [];
}

/**
 * Mail aan de beheerder: reden, toelichting, titel, de namen (geen adressen) en een link naar de beheerpagina. Nooit
 * een bestand of een link naar een bijlage. Binnen de grenzen van `reserveMail` (soort `report`, per melder).
 */
export async function sendReportMail(env: Env, reportId: string, origin: string, lang: Locale): Promise<void> {
  if (!mailEnabled(env)) return;
  const r = await env.DB.prepare('SELECT r.*, a.name AS reporter_name, b.name AS reported_name FROM reports r ' +
    'JOIN users a ON a.id = r.reporter_id JOIN users b ON b.id = r.reported_id WHERE r.id = ?').bind(reportId)
    .first<ReportRow & { reporter_name: string; reported_name: string }>();
  if (!r) return;
  const t = (key: string, vars: Record<string, string> = {}) => translate(lang, key, vars);
  const what = r.attachment_name ? `${r.title} — ${r.attachment_name}` : r.title;
  const intro = t('mail.report_intro', { reporter: r.reporter_name, reported: r.reported_name, reason: t(`report.reason_${r.reason}`), title: what }) +
    (r.note ? `\n\n${t('mail.report_note', { note: r.note })}` : '');
  const body = mailLayout(lang, {
    heading: t('mail.report_heading'), intro,
    button: { label: t('mail.report_button'), url: `${origin}/admin/reports/${r.id}` },
    outro: t('mail.report_outro'),
  });
  for (const to of await adminAddresses(env)) {
    const slot = await reserveMail(env.DB, env, 'report', r.reporter_id, Date.now(), { gapMs: 0, perDay: REPORTS_PER_DAY * 3 });
    if (typeof slot !== 'object') return;
    if (!(await sendMail(env, { to, subject: t('mail.report_subject', { title: r.title }), ...body }))) await releaseMail(env.DB, slot.id);
  }
}
