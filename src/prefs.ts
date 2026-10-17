import type { Env } from './index';
import { normLocale, parseAcceptLanguage, pickLocale } from '../public/i18n.js';

/** Instellingen van de installatie: een rij in `settings` gaat voor de config (wrangler.jsonc), die dient als terugval. */
export type Prefs = {
  timeZone: string;
  reminderTime: string;
  weekStart: 'mon' | 'sun';
  defaultLocale: 'en' | 'nl';
  fallbackWebhook: string | null;
  fallbackFromEnv: boolean;
  /** Er staat een rij `fallback_webhook` (ook '' = uit): die gaat voor FALLBACK_WEBHOOK. */
  fallbackOverride: boolean;
  /** FALLBACK_WEBHOOK is gezet (alleen ja/nee; de URL is een secret). */
  fallbackEnvSet: boolean;
  envApiTokenOff: boolean;
  envInboxTokenOff: boolean;
  /** Wanneer de oude secrets voor het laatst werden gebruikt (hoogstens eens per uur bijgewerkt). */
  envApiTokenUsed: string | null;
  envInboxTokenUsed: string | null;
};

const validZone = (tz: string | undefined | null): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const validTime = (s: string | undefined | null): s is string => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Leest alle instellingen met één query en valideert wat er staat. */
export async function loadPrefs(env: Env): Promise<Prefs> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const row = new Map(results.map((r) => [r.key, r.value]));
  const zone = row.get('timezone');
  const time = row.get('reminder_time');
  // Een rij gaat voor de secret, ook een lege (= uit); zonder rij geldt FALLBACK_WEBHOOK.
  const override = row.has('fallback_webhook');
  return {
    timeZone: validZone(zone) ? zone : validZone(env.TIMEZONE) ? env.TIMEZONE : 'UTC',
    reminderTime: validTime(time) ? time : '09:00',
    weekStart: row.get('week_start') === 'sun' ? 'sun' : 'mon',
    defaultLocale: normLocale(row.get('default_locale') || env.LOCALE),
    fallbackWebhook: (override ? row.get('fallback_webhook') : env.FALLBACK_WEBHOOK) || null,
    fallbackFromEnv: !override && !!env.FALLBACK_WEBHOOK,
    fallbackOverride: override,
    fallbackEnvSet: !!env.FALLBACK_WEBHOOK,
    envApiTokenOff: row.get('env_api_token_off') === '1',
    envInboxTokenOff: row.get('env_inbox_token_off') === '1',
    envApiTokenUsed: row.get('env_api_token_used') || null,
    envInboxTokenUsed: row.get('env_inbox_token_used') || null,
  };
}

/** Statement voor een instelling (voor een batch); `null` verwijdert de rij, zodat de config weer geldt. */
export function settingStmt(db: D1Database, key: string, value: string | null): D1PreparedStatement {
  if (value === null) return db.prepare('DELETE FROM settings WHERE key = ?').bind(key);
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
}

/** Zet een instelling; `null` verwijdert de rij, zodat de config weer geldt. */
export async function setSetting(db: D1Database, key: string, value: string | null): Promise<void> {
  await settingStmt(db, key, value).run();
}

/** Taal van een request: cookie `tick_lang` (en|nl), dan Accept-Language, dan de standaardtaal van de installatie. */
export function requestLocale(req: Request, defaultLocale: 'en' | 'nl'): 'en' | 'nl' {
  const cookie = /(?:^|;\s*)tick_lang=([^;]*)/.exec(req.headers.get('cookie') ?? '')?.[1];
  if (cookie === 'en' || cookie === 'nl') return cookie;
  return pickLocale(parseAcceptLanguage(req.headers.get('accept-language'))) ?? defaultLocale;
}
