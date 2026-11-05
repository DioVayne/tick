import type { Env } from './index';
import type { Locale } from './push';

/**
 * E-mail via Resend (https://resend.com). Alles wat mail verstuurt gaat hierlangs: de aan/uit-check, de opmaak en de
 * grenzen (tabel `mail_log`). Zonder `RESEND_API_KEY` of `MAIL_FROM` staat mailen uit en verandert er niets.
 */

export const DEFAULT_DAILY_LIMIT = 50;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** Per account en per soort mail: hooguit één per `ACCOUNT_GAP_MS` en `ACCOUNT_PER_DAY` per 24 uur. */
const ACCOUNT_GAP_MS = 5 * MINUTE;
const ACCOUNT_PER_DAY = 5;
const CAP_NOTICE = 'cap_notice';

export function mailEnabled(env: Env): boolean {
  return !!env.RESEND_API_KEY?.trim() && !!env.MAIL_FROM?.trim();
}

/** `MAIL_DAILY_LIMIT` als geheel getal vanaf 1, anders 50. */
export function dailyLimit(env: Env): number {
  const n = Number(env.MAIL_DAILY_LIMIT);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_DAILY_LIMIT;
}

export type Mail = { to: string; subject: string; text: string; html: string };

/** Verstuurt één mail; true bij succes. Een fout wordt gelogd zonder adres of sleutel. */
export async function sendMail(env: Env, m: Mail): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (res.ok) return true;
    console.error(`mail: resend ${res.status}`);
  } catch (e) {
    console.error(`mail: resend onbereikbaar (${(e as Error).name})`);
  }
  return false;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Eenvoudige mail met één knop: tekst- en HTML-versie (alleen inline-opmaak, geen plaatjes). */
export function mailLayout(lang: Locale, p: { heading: string; intro: string; button: { label: string; url: string }; outro: string }): { text: string; html: string } {
  const text = `${p.heading}\n\n${p.intro}\n\n${p.button.label}: ${p.button.url}\n\n${p.outro}\n`;
  const font = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2328';
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#f6f7f9">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;${font}">
<p style="margin:0 0 16px;font-size:20px;font-weight:700">Tick</p>
<h1 style="margin:0 0 12px;font-size:18px">${esc(p.heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${esc(p.intro)}</p>
<p style="margin:0 0 20px"><a href="${esc(p.button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">${esc(p.button.label)}</a></p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#57606a;word-break:break-all">${esc(p.button.url)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#57606a">${esc(p.outro)}</p>
</div></body></html>`;
  return { text, html };
}

const iso = (ms: number) => new Date(ms).toISOString();
const dayStart = (ms: number) => ms - (ms % DAY);

/** Grenzen voor één soort mail; zonder opgave gelden de standaardgrenzen (5 minuten, 5 per dag, de volle daggrens). */
export type MailLimits = {
  /** Wachttijd tussen twee mails van deze soort aan/voor hetzelfde account (standaard 5 minuten). */
  gapMs?: number;
  /** Hoeveel mails van deze soort per account per 24 uur (standaard 5). */
  perDay?: number;
  /** Deel (0–1) van `MAIL_DAILY_LIMIT` dat deze soort mag gebruiken (standaard 1). */
  dailyShare?: number;
  /** E-mailadres van de ontvanger: dan ook hooguit één mail van deze soort per adres per 24 uur. */
  recipient?: string;
};

/** Soorten rijen in `mail_log` die vlaggen zijn en niet als verstuurde mail tellen. */
export const SIGNUP_CAP = 'signup_cap';
const FLAG_KINDS = [CAP_NOTICE, SIGNUP_CAP];

/** SHA-256 (hex) van het getrimde, kleingeschreven adres; het adres zelf komt niet in `mail_log`. */
export async function recipientHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reserveert een plek voor een mail aan `userId`, binnen de grenzen per account (per soort), per ontvanger (als
 * opgegeven) en per UTC-dag (alle soorten samen). Eén INSERT … SELECT … WHERE, zodat twee gelijktijdige aanvragen niet
 * allebei slagen. Ruimt oude rijen op. Een volle ontvanger telt als `'account_limit'`.
 */
export async function reserveMail(db: D1Database, env: Env, kind: string, userId: string, now = Date.now(), o: MailLimits = {}):
  Promise<{ id: string } | 'account_limit' | 'daily_limit'> {
  const id = crypto.randomUUID();
  const start = dayStart(now);
  const gap = o.gapMs ?? ACCOUNT_GAP_MS;
  const perDay = o.perDay ?? ACCOUNT_PER_DAY;
  const daily = Math.floor(dailyLimit(env) * Math.min(1, Math.max(0, o.dailyShare ?? 1)));
  const hash = o.recipient ? await recipientHash(o.recipient) : null;
  const flags = FLAG_KINDS.map((k) => `'${k}'`).join(', ');
  const [, insert] = await db.batch([
    db.prepare('DELETE FROM mail_log WHERE sent_at < ?').bind(iso(now - 2 * DAY)),
    db.prepare(`INSERT INTO mail_log (id, kind, user_id, sent_at, recipient_hash) SELECT ?1, ?2, ?3, ?4, ?11
      WHERE (SELECT COUNT(*) FROM mail_log WHERE user_id = ?3 AND kind = ?2 AND sent_at > ?5) = 0
        AND (SELECT COUNT(*) FROM mail_log WHERE user_id = ?3 AND kind = ?2 AND sent_at > ?6) < ?7
        AND (SELECT COUNT(*) FROM mail_log WHERE kind NOT IN (${flags}) AND sent_at >= ?8 AND sent_at < ?9) < ?10
        AND (?11 IS NULL OR (SELECT COUNT(*) FROM mail_log WHERE kind = ?2 AND recipient_hash = ?11 AND sent_at > ?6) = 0)`)
      .bind(id, kind, userId, iso(now), iso(now - gap), iso(now - DAY), perDay, iso(start), iso(start + DAY), daily, hash),
  ]);
  if (insert.meta.changes === 1) return { id };
  const [recent, toRecipient] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM mail_log WHERE user_id = ? AND kind = ? AND sent_at > ?')
      .bind(userId, kind, iso(now - DAY)).first<{ n: number; last: string | null }>(),
    hash ? db.prepare('SELECT 1 AS x FROM mail_log WHERE kind = ? AND recipient_hash = ? AND sent_at > ?').bind(kind, hash, iso(now - DAY)).first() : null,
  ]);
  const accountFull = !!toRecipient || (!!recent && (recent.n >= perDay || (gap > 0 && !!recent.last && recent.last > iso(now - gap))));
  return accountFull ? 'account_limit' : 'daily_limit';
}

/** Geeft een gereserveerde plek terug (de mail is niet verstuurd), zodat hij niet meetelt. */
export async function releaseMail(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM mail_log WHERE id = ?').bind(id).run();
}

/** true bij de eerste aanroep op een UTC-dag: dan krijgt de beheerder een melding dat de daggrens bereikt is. */
export async function claimCapNotice(db: D1Database, now = Date.now(), kind = CAP_NOTICE): Promise<boolean> {
  const start = dayStart(now);
  const r = await db.prepare(`INSERT INTO mail_log (id, kind, user_id, sent_at) SELECT ?1, ?2, NULL, ?3
    WHERE NOT EXISTS (SELECT 1 FROM mail_log WHERE kind = ?2 AND sent_at >= ?4 AND sent_at < ?5)`)
    .bind(crypto.randomUUID(), kind, iso(now), iso(start), iso(start + DAY)).run();
  return r.meta.changes === 1;
}
