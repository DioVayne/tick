import type { Env } from './index';
import type { Locale } from './push';
import { createLink } from './links';
import { hashKey, newKey } from './keys';
import { mailEnabled, mailLayout, sendMail, type Mail, type SendResult } from './mail';
import { adminAddresses, type ReportRow } from './reports';
import { tellOwner } from './telegram';
import { translate } from '../public/i18n.js';

/**
 * De mailwachtrij (tabel `mail_queue`): elke mail gaat hier eerst in en blijft staan tot hij verstuurd is, zodat er
 * nooit een mail stilletjes zoekraakt. Een rij bevat geen adres of inhoud: die worden pas bij het versturen opgebouwd
 * (`buildQueued`), dus met het adres en een verse link van dat moment. De `send…Mail`-functies zetten een rij klaar en
 * proberen hem meteen; lukt dat niet, dan pakt de cron (elke minuut) hem later weer op.
 */

export type QueueKind = 'verify' | 'reset' | 'invite' | 'report';

export type QueueRow = {
  id: string; kind: QueueKind; user_id: string | null; ref: string | null; lang: string; origin: string;
  created_at: string; next_try_at: string; attempts: number; last_status: string | null;
};

const MINUTE = 60_000;
/** Zolang is een rij geclaimd door de run die hem verstuurt; een andere run slaat hem over. */
const LEASE_MS = 5 * MINUTE;
/** Langste wachttijd tussen twee pogingen (minuten). */
const MAX_WAIT_MIN = 60;
/** Zoveel rijen per run (cron), oudste eerst: een grote wachtrij loopt zo niet vast en overspoelt de maildienst niet. */
export const QUEUE_BATCH = 50;

const iso = (ms: number) => new Date(ms).toISOString();

/** Wachttijd na de `attempts`-ste mislukte poging: 5, 10, 20, 40, daarna 60 minuten. */
export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_WAIT_MIN, 5 * 2 ** Math.max(0, attempts - 1)) * MINUTE;
}

/** Zet een mail in de wachtrij, meteen klaar om te versturen; geeft de id van de rij. */
export async function enqueueMail(env: Env, q: { kind: QueueKind; userId: string | null; ref: string | null; lang: Locale; origin: string }, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO mail_queue (id, kind, user_id, ref, lang, origin, created_at, next_try_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, q.kind, q.userId, q.ref, q.lang, q.origin, iso(now), iso(now)).run();
  return id;
}

/** Wachten er mails die al minstens één keer mislukten? */
export async function mailBacklog(db: D1Database): Promise<boolean> {
  const r = await db.prepare('SELECT EXISTS (SELECT 1 FROM mail_queue WHERE attempts > 0) AS b').first<{ b: number }>();
  return !!r?.b;
}

/**
 * Verstuurt de rijen die klaar zijn (`next_try_at <= now`): oudste eerst, hooguit `max` (standaard 50), of alleen rij
 * `id`. Elke rij wordt eerst geclaimd (één UPDATE die alleen slaagt als niemand anders hem net pakte), zodat de
 * directe poging en de cron samen nooit dezelfde mail twee keer versturen. `sent`: verstuurde mails in deze run;
 * `waiting`: rijen die daarna nog in de wachtrij staan.
 */
export async function deliverQueued(env: Env, now = Date.now(), opts: { id?: string; max?: number } = {}): Promise<{ sent: number; waiting: number }> {
  if (!mailEnabled(env)) return { sent: 0, waiting: 0 };
  const db = env.DB;
  const due = opts.id
    ? await db.prepare('SELECT id FROM mail_queue WHERE id = ? AND next_try_at <= ?').bind(opts.id, iso(now)).all<{ id: string }>()
    : await db.prepare('SELECT id FROM mail_queue WHERE next_try_at <= ? ORDER BY created_at, id LIMIT ?').bind(iso(now), opts.max ?? QUEUE_BATCH).all<{ id: string }>();
  let sent = 0;
  for (const { id } of due.results) {
    const row = await db.prepare('UPDATE mail_queue SET next_try_at = ? WHERE id = ? AND next_try_at <= ? RETURNING *')
      .bind(iso(now + LEASE_MS), id, iso(now)).first<QueueRow>();
    if (!row) continue; // een andere run is ermee bezig
    try {
      sent += await deliverOne(env, row, now);
    } catch (e) {
      // Opbouwen of versturen gooide: telt als een mislukte poging, zodat de rij terugloopt (5, 10, … minuten) en in
      // `mailBacklog` meetelt, in plaats van elke 5 minuten dezelfde fout te herhalen.
      console.error(`mail: wachtrij ${row.kind} mislukt (${(e as Error)?.name ?? 'fout'})`);
      const attempts = row.attempts + 1;
      await db.prepare("UPDATE mail_queue SET attempts = ?, last_status = 'error', next_try_at = ? WHERE id = ?")
        .bind(attempts, iso(now + retryDelayMs(attempts)), row.id).run().catch(() => {});
    }
  }
  const left = await db.prepare('SELECT COUNT(*) AS n FROM mail_queue').first<{ n: number }>();
  return { sent, waiting: left?.n ?? 0 };
}

type Failed = Extract<SendResult, { ok: false }>;

/** Eén geclaimde rij: opbouwen en versturen; geeft het aantal verstuurde mails. */
async function deliverOne(env: Env, row: QueueRow, now: number): Promise<number> {
  const db = env.DB;
  const mails = await buildQueued(env, row, now);
  let ok = 0;
  let retry: Failed | null = null;
  let failed: Failed | null = null;
  for (const m of mails ?? []) {
    const r = await sendMail(env, m);
    if (r.ok) ok++;
    else if (r.retry) retry ??= r;
    else failed ??= r;
  }
  if (retry) {
    // Later opnieuw (ook wat al wel lukte: bij een melding aan meerdere beheerders krijgt dat adres hem dan nog eens).
    const attempts = row.attempts + 1;
    await db.prepare('UPDATE mail_queue SET attempts = ?, last_status = ?, next_try_at = ? WHERE id = ?')
      .bind(attempts, retry.status, iso(now + retryDelayMs(attempts)), row.id).run();
    // Een fout van de maildienst: hooguit één bericht per uur aan de eigenaar, met het aantal wachtende mails.
    const left = await db.prepare('SELECT COUNT(*) AS n FROM mail_queue').first<{ n: number }>();
    await tellOwner(env, 'mail_failing', { status: String(retry.status), waiting: String(left?.n ?? 1) }, 'hour', now);
    return ok;
  }
  await db.prepare('DELETE FROM mail_queue WHERE id = ?').bind(row.id).run();
  if (failed) {
    console.error(`mail: ${row.kind} definitief niet bezorgd (${failed.status})`);
    await tellOwner(env, 'mail_dropped', { kind: row.kind }, 'hour', now);
  }
  return ok;
}

/**
 * De mail(s) voor een rij, opgebouwd op het moment van versturen (adres van nu, verse link). null als hij niet meer
 * hoeft: account weg, adres al bevestigd (verify), geen gewoon account meer (reset), uitnodiging weg of verlopen
 * (invite), melding of melder weg (report). Een melding geeft één mail per beheerdersadres.
 */
export async function buildQueued(env: Env, row: QueueRow, now = Date.now()): Promise<Mail[] | null> {
  const db = env.DB;
  const lang = (row.lang === 'nl' ? 'nl' : 'en') as Locale;
  const t = (key: string, vars: Record<string, string> = {}) => translate(lang, key, vars);
  const origin = row.origin;
  switch (row.kind) {
    case 'verify': {
      if (!row.user_id) return null;
      const user = await db.prepare('SELECT email FROM users WHERE id = ? AND email IS NOT NULL AND email_verified_at IS NULL')
        .bind(row.user_id).first<{ email: string }>();
      if (!user) return null;
      const { code } = await createLink(db, 'verify', row.user_id, row.user_id);
      const body = mailLayout(lang, {
        heading: t('mail.verify_heading'), intro: t('mail.verify_intro'),
        button: { label: t('mail.verify_button'), url: `${origin}/verify/${code}` }, outro: t('mail.verify_outro'),
      });
      return [{ to: user.email, subject: t('mail.verify_subject'), ...body }];
    }
    case 'reset': {
      if (!row.user_id) return null;
      const user = await db.prepare("SELECT email FROM users WHERE id = ? AND role = 'member' AND email IS NOT NULL")
        .bind(row.user_id).first<{ email: string }>();
      if (!user) return null;
      const { code } = await createLink(db, 'reset', row.user_id, row.user_id);
      const body = mailLayout(lang, {
        heading: t('mail.reset_heading'), intro: t('mail.reset_intro'),
        button: { label: t('mail.reset_button'), url: `${origin}/reset/${code}` }, outro: t('mail.reset_outro'),
      });
      return [{ to: user.email, subject: t('mail.reset_subject'), ...body }];
    }
    case 'invite': {
      if (!row.ref) return null;
      const inv = await db.prepare('SELECT e.email, e.task_id, u.name AS from_name, COALESCE(tk.title, m.name) AS title FROM email_invites e ' +
        'JOIN users u ON u.id = e.from_user LEFT JOIN tasks tk ON tk.id = e.task_id ' +
        'LEFT JOIN shared_lists l ON l.id = e.list_id LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = l.owner_id ' +
        'WHERE e.id = ? AND e.expires_at > ?').bind(row.ref, iso(now))
        .first<{ email: string; task_id: string | null; from_name: string; title: string | null }>();
      if (!inv) return null;
      // Een unieke link voor deze uitnodiging; alleen de hash komt in de database (een nieuwe poging maakt een nieuwe).
      const code = newKey().slice('tick_'.length);
      await db.prepare('UPDATE email_invites SET join_hash = ? WHERE id = ?').bind(await hashKey(code), row.ref).run();
      const play = env.PLAY_STORE_URL?.trim();
      const body = mailLayout(lang, {
        heading: t(inv.task_id ? 'mail.invite_heading_task' : 'mail.invite_heading_list', { name: inv.from_name, title: inv.title ?? '' }),
        intro: t('mail.invite_intro'),
        button: { label: t('mail.invite_button'), url: `${origin}/join/${code}` },
        extra: play ? { label: t('mail.invite_play'), url: play } : undefined,
        outro: t('mail.invite_outro'),
      });
      return [{ to: inv.email, subject: t('mail.invite_subject', { name: inv.from_name }), ...body }];
    }
    case 'report': {
      if (!row.ref) return null;
      const r = await db.prepare('SELECT r.*, a.name AS reporter_name, b.name AS reported_name FROM reports r ' +
        'LEFT JOIN users a ON a.id = r.reporter_id LEFT JOIN users b ON b.id = r.reported_id WHERE r.id = ?').bind(row.ref)
        .first<ReportRow & { reporter_name: string | null; reported_name: string | null }>();
      // Melder weg (account verwijderd terwijl de mail wachtte): geen mail; de melding staat wel op de beheerpagina.
      if (!r?.reporter_id) return null;
      const title = r.title || t('admin.title_removed');
      const what = r.attachment_name ? `${title} — ${r.attachment_name}` : title;
      const intro = t('mail.report_intro', {
        reporter: r.reporter_name ?? t('admin.account_deleted'), reported: r.reported_name ?? t('admin.account_deleted'),
        reason: t(`report.reason_${r.reason}`), title: what,
      }) +
        (r.note ? `\n\n${t('mail.report_note', { note: r.note })}` : '');
      const body = mailLayout(lang, {
        heading: t('mail.report_heading'), intro,
        button: { label: t('mail.report_button'), url: `${origin}/admin/reports/${r.id}` },
        outro: t('mail.report_outro'),
      });
      return (await adminAddresses(env)).map((to) => ({ to, subject: t('mail.report_subject', { title }), ...body }));
    }
    default:
      return null;
  }
}
