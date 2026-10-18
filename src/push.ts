import { buildPushHTTPRequest } from '@pushforge/builder';
import type { Env } from './index';
import { loadUserPrefs, type InstallPrefs, type UserPrefs } from './prefs';
import { getUser } from './users';
import { translate } from '../public/i18n.js';

type Sub = { endpoint: string; p256dh: string; auth: string; locale: string | null };
type Locale = 'en' | 'nl';
export type Payload = {
  title: string; body: string; url?: string; taskId?: string; occurrence?: string;
  /** Uitnodiging om een taak te delen: de knoppen accept/decline gaan naar /api/shares/<shareId>. */
  shareId?: string;
  /** Knoppen in de melding, al vertaald: de service worker kent de taal niet. */
  actions?: { action: 'done' | 'snooze' | 'accept' | 'decline'; title: string }[];
};

/**
 * De VAPID-sleutel (JWK) uit het geheim. Een BOM of witruimte aan begin of eind gaat eraf: een geheim dat vanuit
 * Windows PowerShell 5.1 is gezet, begint vaak met U+FEFF. Geeft null als er geen geldig JSON-object overblijft.
 */
export function parseVapidKey(raw: string | undefined): JsonWebKey | null {
  const text = (raw ?? '').trim(); // trim() haalt ook U+FEFF (de BOM) weg
  try {
    const key: unknown = JSON.parse(text);
    return key && typeof key === 'object' && !Array.isArray(key) ? (key as JsonWebKey) : null;
  } catch {
    return null;
  }
}

/**
 * Verstuurt naar alle abonnementen van één gebruiker, elk in zijn eigen taal (zonder taal: defaultLocale).
 * Geeft het aantal geslaagd en het aantal abonnementen terug.
 */
export async function sendToAll(env: Env, userId: string, make: (locale: Locale) => Payload, defaultLocale: Locale): Promise<{ ok: number; total: number }> {
  const subs = (await env.DB.prepare('SELECT endpoint,p256dh,auth,locale FROM push_subscriptions WHERE user_id = ?').bind(userId).all<Sub>()).results;
  if (!subs.length) return { ok: 0, total: 0 };
  const privateJWK = parseVapidKey(env.VAPID_PRIVATE_KEY);
  if (!privateJWK) {
    // Eén duidelijke melding in plaats van een JSON-fout per abonnement.
    console.error('push: VAPID_PRIVATE_KEY is geen geldige JWK (JSON-object); er gaat geen push uit');
    return { ok: 0, total: subs.length };
  }
  let ok = 0;
  for (const s of subs) {
    const payload = make(s.locale === 'nl' || s.locale === 'en' ? s.locale : defaultLocale);
    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK,
        subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message: { payload, adminContact: env.ADMIN_CONTACT, options: { urgency: 'high', ttl: 3600 } },
      });
      const res = await fetch(endpoint, { method: 'POST', headers, body });
      if (res.ok) ok++;
      else if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
      } else console.warn('push', res.status, await res.text());
    } catch (e) {
      console.warn('push error', (e as Error).message);
    }
  }
  return { ok, total: subs.length };
}

/** Post de melding als JSON naar een webhook; true bij een 2xx-antwoord. */
export async function postWebhook(url: string, payload: Payload): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return res.ok;
  } catch { return false; }
}

/** Pushbericht voor een taak. Bij een herhalende taak gaat de keer (repeat_at) mee, zodat 'Klaar' niet dubbel doorschuift. */
export function reminderPayload(t: { id: string; title: string; description: string; repeat_at?: string | null }, locale?: string): Payload {
  const actions: Payload['actions'] = [
    { action: 'done', title: translate(locale, 'push.done') },
    { action: 'snooze', title: translate(locale, 'push.snooze') },
  ];
  return { title: t.title, body: t.description.slice(0, 140), taskId: t.id, url: '/', actions, ...(t.repeat_at ? { occurrence: t.repeat_at } : {}) };
}

const RETRY_WINDOW_MS = 15 * 60_000;

/** Stuurt de verlopen herinneringen; per taak naar de abonnementen van de eigenaar, de terugval naar diens webhook. */
export async function runReminders(env: Env, install: InstallPrefs): Promise<void> {
  const due = (await env.DB.prepare(
    'SELECT id,user_id,title,description,remind_at,repeat_at FROM tasks WHERE done = 0 AND notified = 0 AND deleted_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ?',
  ).bind(new Date().toISOString()).all<{ id: string; user_id: string; title: string; description: string; remind_at: string; repeat_at: string | null }>()).results;

  // Per gebruiker één keer lezen per run; null = de gebruiker bestaat niet meer.
  const people = new Map<string, UserPrefs | null>();
  for (const t of due) {
    if (!people.has(t.user_id)) {
      const user = await getUser(env.DB, t.user_id);
      people.set(t.user_id, user ? await loadUserPrefs(env, user) : null);
    }
    const prefs = people.get(t.user_id);
    if (!prefs) {
      // Een taak van een verdwenen account: niet elke minuut opnieuw proberen.
      await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ?').bind(t.id).run();
      continue;
    }
    const { ok, total } = await sendToAll(env, t.user_id, (locale) => reminderPayload(t, locale), install.defaultLocale);
    let delivered = ok > 0;
    const overdue = Date.now() - Date.parse(t.remind_at) > RETRY_WINDOW_MS;
    // Geen abonnement of na 15 minuten nog niets aangekomen: via de fallback-webhook van de eigenaar (instelling, of
    // FALLBACK_WEBHOOK voor de beheerder), een generieke webhook die {title, body, taskId, url} als JSON krijgt, in de standaardtaal.
    if (!delivered && (total === 0 || overdue) && prefs.fallbackWebhook) {
      delivered = await postWebhook(prefs.fallbackWebhook, reminderPayload(t, install.defaultLocale));
    }
    // Blijft het onbezorgd na het retry-venster, dan niet eindeloos blijven proberen.
    if (delivered || overdue) {
      await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ?').bind(t.id).run();
    }
  }
}
