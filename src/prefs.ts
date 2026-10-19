import type { Env } from './index';
import type { User } from './users';
import { normLocale, parseAcceptLanguage, pickLocale } from '../public/i18n.js';

/** Instellingen van de hele installatie: een rij in `settings` gaat voor de config (wrangler.jsonc), die dient als terugval. */
export type InstallPrefs = {
  defaultLocale: 'en' | 'nl';
  envApiTokenOff: boolean;
  envInboxTokenOff: boolean;
  /** Wanneer de oude secrets voor het laatst werden gebruikt (hoogstens eens per uur bijgewerkt). */
  envApiTokenUsed: string | null;
  envInboxTokenUsed: string | null;
};

/** Instellingen van één persoon: een rij in `user_settings` gaat voor de config, die dient als terugval. */
export type UserPrefs = {
  timeZone: string;
  reminderTime: string;
  /** Tijd (HH:MM) voor de dagelijkse melding van verlopen taken; null = uit. */
  overdueTime: string | null;
  /** Lokale datum (YYYY-MM-DD) waarop de verlopen taken voor het laatst zijn gemeld. */
  overdueDay: string | null;
  weekStart: 'mon' | 'sun';
  fallbackWebhook: string | null;
  fallbackFromEnv: boolean;
  /** Er staat een rij `fallback_webhook` (ook '' = uit): die gaat voor FALLBACK_WEBHOOK. */
  fallbackOverride: boolean;
  /** FALLBACK_WEBHOOK is gezet en geldt voor deze persoon (alleen de beheerder; alleen ja/nee, de URL is een secret). */
  fallbackEnvSet: boolean;
  /** Versie van de achtergrondfoto (zie background.ts), null als er geen is. */
  background: string | null;
};

export type Prefs = InstallPrefs & UserPrefs;

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

/** Leest de instellingen van de installatie met één query en valideert wat er staat. */
export async function loadInstallPrefs(env: Env): Promise<InstallPrefs> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const row = new Map(results.map((r) => [r.key, r.value]));
  return {
    defaultLocale: normLocale(row.get('default_locale') || env.LOCALE),
    envApiTokenOff: row.get('env_api_token_off') === '1',
    envInboxTokenOff: row.get('env_inbox_token_off') === '1',
    envApiTokenUsed: row.get('env_api_token_used') || null,
    envInboxTokenUsed: row.get('env_inbox_token_used') || null,
  };
}

type SettingRow = { key: string; value: string };

/** De rijen van `user_settings` van één persoon; los te starten, zodat de auth ze al kan ophalen terwijl hij de sessie controleert. */
export async function userSettingRows(db: D1Database, userId: string): Promise<SettingRow[]> {
  return (await db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').bind(userId).all<SettingRow>()).results;
}

/**
 * Leest de instellingen van één persoon met één query (of met `rows` als die al onderweg zijn). Volgorde: rij, dan config, dan de ingebouwde standaard.
 * FALLBACK_WEBHOOK hoort bij de beheerder: voor een lid telt hij nooit.
 */
export async function loadUserPrefs(env: Env, user: Pick<User, 'id' | 'role'>, rows?: Promise<SettingRow[]>): Promise<UserPrefs> {
  const results = await (rows ?? userSettingRows(env.DB, user.id));
  const row = new Map(results.map((r) => [r.key, r.value]));
  const zone = row.get('timezone');
  const time = row.get('reminder_time');
  const overdue = row.get('overdue_time');
  const envHook = user.role === 'admin' ? env.FALLBACK_WEBHOOK || null : null;
  // Een rij gaat voor de secret, ook een lege (= uit); zonder rij geldt FALLBACK_WEBHOOK (alleen voor de beheerder).
  const override = row.has('fallback_webhook');
  return {
    timeZone: validZone(zone) ? zone : validZone(env.TIMEZONE) ? env.TIMEZONE : 'UTC',
    reminderTime: validTime(time) ? time : '09:00',
    overdueTime: overdue === 'off' ? null : validTime(overdue) ? overdue : '09:00',
    overdueDay: row.get('overdue_day') || null,
    weekStart: row.get('week_start') === 'sun' ? 'sun' : 'mon',
    fallbackWebhook: (override ? row.get('fallback_webhook') : envHook) || null,
    fallbackFromEnv: !override && !!envHook,
    fallbackOverride: override,
    fallbackEnvSet: !!envHook,
    background: env.FILES ? row.get('background') || null : null,
  };
}

/** Statement voor een instelling van een persoon (voor een batch); `null` verwijdert de rij, zodat de config weer geldt. */
export function userSettingStmt(db: D1Database, userId: string, key: string, value: string | null): D1PreparedStatement {
  if (value === null) return db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').bind(userId, key);
  return db.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .bind(userId, key, value);
}

/** Statement voor een instelling van de installatie (voor een batch); `null` verwijdert de rij, zodat de config weer geldt. */
export function settingStmt(db: D1Database, key: string, value: string | null): D1PreparedStatement {
  if (value === null) return db.prepare('DELETE FROM settings WHERE key = ?').bind(key);
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
}

/** Zet een instelling van de installatie; `null` verwijdert de rij, zodat de config weer geldt. */
export async function setSetting(db: D1Database, key: string, value: string | null): Promise<void> {
  await settingStmt(db, key, value).run();
}

/** Taal van een request: cookie `tick_lang` (en|nl), dan Accept-Language, dan de standaardtaal van de installatie. */
export function requestLocale(req: Request, defaultLocale: 'en' | 'nl'): 'en' | 'nl' {
  const cookie = /(?:^|;\s*)tick_lang=([^;]*)/.exec(req.headers.get('cookie') ?? '')?.[1];
  if (cookie === 'en' || cookie === 'nl') return cookie;
  return pickLocale(parseAcceptLanguage(req.headers.get('accept-language'))) ?? defaultLocale;
}
