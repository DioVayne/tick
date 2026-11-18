import { waitUntil } from 'cloudflare:workers';
import type { Env } from './index';
import { MAIL_KINDS } from './mail';
import { loadInstallPrefs } from './prefs';
import { notifyUser, sendToAll, type Sender } from './push';
import { ADMIN_ID } from './users';
import { translate } from '../public/i18n.js';

/**
 * Berichten aan de eigenaar van deze Tick, als er met de mail iets mis dreigt te gaan: een fout van de maildienst, een
 * mail die definitief niet kan, veel mails op een dag, veel nieuwe accounts. Via Telegram (`TELEGRAM_BOT_TOKEN` +
 * `TELEGRAM_CHAT_ID`); zonder die instellingen een pushmelding aan de beheerder. Nooit een adres of sleutel in de tekst.
 */

export type OwnerKey = 'mail_failing' | 'mail_dropped' | 'mail_warn' | 'signups' | 'test';

/** Hoe een bericht aan de eigenaar ging: via Telegram, als pushmelding (geen Telegram ingesteld) of mislukt. */
export type OwnerResult = 'telegram' | 'push' | 'failed';

/** Of deze Tick berichten aan de eigenaar via Telegram stuurt (token en chat-id allebei ingesteld). */
export function telegramOn(env: Env): boolean {
  return !!env.TELEGRAM_BOT_TOKEN?.trim() && !!env.TELEGRAM_CHAT_ID?.trim();
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Standaard: bij zoveel mails op één dag een bericht (Resend gratis staat 100 per dag toe). */
const MAIL_WARN_DEFAULT = 70;

/** Drempel voor `mail_warn`: `MAIL_WARN_AT` als geheel getal van minstens 1, anders 70. */
export function mailWarnAt(env: Pick<Env, 'MAIL_WARN_AT'>): number {
  const raw = env.MAIL_WARN_AT?.trim() ?? '';
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : MAIL_WARN_DEFAULT;
}

/**
 * Legt vast dat dit bericht verstuurd wordt, tenzij het binnen de termijn al gebeurde: `hour` = hooguit één per uur,
 * `day` = één per UTC-dag, `once` = één per sleutel (`vars.count`). Een vlagrij in `mail_log` (soort `tg:…`, zonder
 * account); één INSERT … WHERE NOT EXISTS, zodat gelijktijdige aanroepen niet allebei slagen.
 */
async function claim(db: D1Database, key: OwnerKey, vars: Record<string, string>, throttle: 'hour' | 'day' | 'once', now: number): Promise<boolean> {
  const start = now - (now % DAY);
  const [kind, since] = throttle === 'once' ? [`tg:${key}:${new Date(now).toISOString().slice(0, 10)}:${vars.count ?? ''}`, 0]
    : throttle === 'day' ? [`tg:${key}`, start] : [`tg:${key}`, now - HOUR];
  const r = await db.prepare(`INSERT INTO mail_log (id, kind, user_id, sent_at) SELECT ?1, ?2, NULL, ?3
    WHERE NOT EXISTS (SELECT 1 FROM mail_log WHERE kind = ?2 AND sent_at > ?4)`)
    .bind(crypto.randomUUID(), kind, iso(now), iso(since - 1)).run();
  return r.meta.changes === 1;
}

/**
 * Meldt iets aan de eigenaar, met een grens op hoe vaak. Gooit nooit: een bericht dat niet aankomt mag de mail zelf niet
 * stoppen. `send` is te vervangen in tests (de push aan de beheerder).
 */
export async function tellOwner(env: Env, key: OwnerKey, vars: Record<string, string>, throttle: 'hour' | 'day' | 'once',
  now = Date.now(), send: Sender = sendToAll): Promise<void> {
  try {
    if (!(await claim(env.DB, key, vars, throttle, now))) return;
    await deliver(env, key, vars, send);
  } catch (e) {
    console.error(`telegram: bericht aan de eigenaar mislukt (${(e as Error)?.name ?? 'fout'})`);
  }
}

/** Testbericht van de knop op de beheerpagina: zonder grens, en met de uitkomst. Gooit nooit. */
export async function testOwner(env: Env, send: Sender = sendToAll): Promise<OwnerResult> {
  try {
    return await deliver(env, 'test', {}, send);
  } catch (e) {
    console.error(`telegram: testbericht mislukt (${(e as Error)?.name ?? 'fout'})`);
    return 'failed';
  }
}

/** Verstuurt één bericht aan de eigenaar: via Telegram als dat ingesteld is, anders als pushmelding aan de beheerder. */
async function deliver(env: Env, key: OwnerKey, vars: Record<string, string>, send: Sender): Promise<OwnerResult> {
  const { defaultLocale } = await loadInstallPrefs(env);
  if (telegramOn(env)) {
    const text = translate(defaultLocale, `owner.${key}`, vars);
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN!.trim()}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID!.trim(), text }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return 'telegram';
      console.error(`telegram: ${res.status}`);
    } catch {
      console.error('telegram: geen verbinding');
    }
    return 'failed';
  }
  await notifyUser(env, ADMIN_ID, (l) => ({ title: translate(l, 'owner.title'), body: translate(l, `owner.${key}`, vars) }), defaultLocale, send);
  return 'push';
}

/**
 * Na een gereserveerde mail: is het aantal mails van vandaag (UTC; alleen de soorten mail, geen aanmeldingen of vlagrijen) bij `MAIL_WARN_AT`
 * of erover, dan één bericht per dag. `>=` met de daggrens van `tellOwner`, zodat gelijktijdige mails hem niet missen.
 */
export async function warnMailCount(env: Env, now = Date.now()): Promise<void> {
  try {
    const start = now - (now % DAY);
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mail_log WHERE sent_at >= ? AND sent_at < ? AND kind IN (${MAIL_KINDS.map(() => '?').join(', ')})`)
      .bind(iso(start), iso(start + DAY), ...MAIL_KINDS).first<{ n: number }>();
    const count = r?.n ?? 0;
    if (count >= mailWarnAt(env)) await tellOwner(env, 'mail_warn', { count: String(count) }, 'day', now);
  } catch (e) {
    console.error(`telegram: telling mislukt (${(e as Error)?.name ?? 'fout'})`);
  }
}

const pending = new Set<Promise<unknown>>();

/**
 * Laat werk voor de eigenaar op de achtergrond lopen (waitUntil als er een verzoek is), zodat een traag of kapot
 * Telegram nooit het versturen of reserveren van een mail ophoudt. Gooit nooit.
 */
export function background(work: Promise<unknown>): void {
  const p = work.catch(() => {}).finally(() => pending.delete(p));
  pending.add(p);
  try { waitUntil(p); } catch { /* geen verzoek (bijv. in een test): het werk loopt gewoon door */ }
}

/** Wacht tot al het werk van `background` klaar is (voor tests). */
export async function flushBackground(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
