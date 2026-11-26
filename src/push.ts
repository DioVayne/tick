import { buildPushHTTPRequest } from '@pushforge/builder';
import type { Env } from './index';
import { loadUserPrefs, type InstallPrefs, type UserPrefs } from './prefs';
import { getUser } from './users';
import { translate } from '../public/i18n.js';

type Sub = { endpoint: string; p256dh: string; auth: string; locale: string | null };
export type Locale = 'en' | 'nl';
export type Payload = {
  title: string; body: string; url?: string; taskId?: string; occurrence?: string;
  /** Uitnodiging om een taak te delen: de knoppen accept/decline gaan naar /api/shares/<shareId>. */
  shareId?: string;
  /** Uitnodiging voor een gedeelde lijst: de knoppen accept/decline gaan naar /api/shared-lists/<listInviteId>. */
  listInviteId?: string;
  /** Vervangt de tag van de melding (zelfde tag = vervangt de vorige); zonder tag de taak of uitnodiging. */
  tag?: string;
  /** Knoppen in de melding, al vertaald: de service worker kent de taal niet. */
  actions?: { action: 'done' | 'snooze' | 'tomorrow' | 'accept' | 'decline' | 'reschedule' | 'free'; title: string }[];
  /** Na "Naar vrij moment" (botsing met de agenda): de tekst met `{when}`, en de taal en zone om de tijd te tonen. */
  moved?: { text: string; locale: string; timeZone: string };
  /** Tekst voor als een knop mislukt (de service worker zet de melding dan terug); `{status}` vult hij zelf in. */
  failed?: { offline: string; auth: string; server: string };
};

/** `ttl`: zo lang (seconden) bewaart de pushdienst de melding voor een telefoon die offline is; standaard 1 uur. */
export type SendOptions = { ttl?: number };
/** Standaard bewaartijd bij de pushdienst: een herinnering die uren te laat komt, heeft geen zin meer. */
export const DEFAULT_TTL = 3600;

/** Hoogstens zoveel push-abonnementen per persoon (de oudste vervallen); een mens heeft er een paar. */
export const MAX_PUSH_SUBS = 20;
/** Wachttijd per push of webhook: de cron loopt ze na elkaar af, dus één trage ontvanger mag hem niet ophouden. */
const SEND_TIMEOUT_MS = 10_000;

/** Een push-adres: https, zonder inloggegevens, niet te lang. De pushdienst van de browser kiest het adres. */
export function validPushEndpoint(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 1000) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** De vertaalde teksten voor een mislukte knop. */
export function failedTexts(locale?: string): NonNullable<Payload['failed']> {
  return {
    offline: translate(locale, 'push.failed_offline'),
    auth: translate(locale, 'push.failed_auth'),
    server: translate(locale, 'push.failed_server', { status: '{status}' }),
  };
}

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
 * Zoveel verzendingen tegelijk (abonnementen van één persoon, of taken in een ronde). Een Worker heeft er hoogstens zes
 * tegelijk open; meer wachten alleen. Zo kost een onbereikbare pushdienst niet de wachttijd keer het aantal.
 */
export const SEND_CONCURRENCY = 6;

/** Voert `fn` uit voor elk item, hoogstens `limit` tegelijk; de volgorde van de uitkomsten is die van `items`. */
export async function inParallel<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

const subsOf = async (env: Env, userId: string) => (await env.DB.prepare('SELECT endpoint,p256dh,auth,locale FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
  .bind(userId, MAX_PUSH_SUBS).all<Sub>()).results;

/**
 * Verstuurt naar alle abonnementen van één gebruiker, elk in zijn eigen taal (zonder taal: defaultLocale), tot
 * SEND_CONCURRENCY tegelijk. Geeft het aantal geslaagd en het aantal abonnementen terug. `subs` (van pushRound): de
 * abonnementen al gelezen; een verlopen abonnement gaat er dan ook uit.
 */
export async function sendToAll(env: Env, userId: string, make: (locale: Locale) => Payload, defaultLocale: Locale, opts: SendOptions = {}, subs?: Sub[]): Promise<{ ok: number; total: number }> {
  const list = subs ?? await subsOf(env, userId);
  if (!list.length) return { ok: 0, total: 0 };
  const total = list.length;
  const privateJWK = parseVapidKey(env.VAPID_PRIVATE_KEY);
  if (!privateJWK) {
    // Eén duidelijke melding in plaats van een JSON-fout per abonnement.
    console.error('push: VAPID_PRIVATE_KEY is geen geldige JWK (JSON-object); er gaat geen push uit');
    return { ok: 0, total };
  }
  const sent = await inParallel([...list], SEND_CONCURRENCY, async (s) => {
    const locale = s.locale === 'nl' || s.locale === 'en' ? s.locale : defaultLocale;
    const made = make(locale);
    // Met knoppen ook de tekst voor als zo'n knop mislukt, in dezelfde taal.
    const payload = made.actions?.length ? { ...made, failed: failedTexts(locale) } : made;
    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK,
        subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message: { payload, adminContact: env.ADMIN_CONTACT, options: { urgency: 'high', ttl: opts.ttl ?? DEFAULT_TTL } },
      });
      const res = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      // Het antwoord zelf lezen we niet: een ontvanger kan er van alles in zetten.
      await res.body?.cancel().catch(() => {});
      if (res.ok) return true;
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
        // De rest van de ronde niet meer naar dit adres (een tweede melding tegelijk kan hem al weggehaald hebben).
        const i = subs ? subs.indexOf(s) : -1;
        if (i >= 0) subs!.splice(i, 1);
      } else console.warn('push', res.status);
    } catch (e) {
      console.warn('push error', (e as Error).message);
    }
    return false;
  });
  return { ok: sent.filter(Boolean).length, total };
}

/**
 * Een Sender voor één ronde (de cron): leest de abonnementen van elke persoon maar één keer, ook als hij meer meldingen
 * krijgt, en tegelijk vragen geeft één query. Alleen voor binnen één ronde: een nieuw abonnement telt pas de volgende.
 */
export function pushRound(): Sender {
  const cache = new Map<string, Promise<Sub[]>>();
  return (env, userId, make, defaultLocale, opts = {}) => {
    let subs = cache.get(userId);
    if (!subs) cache.set(userId, (subs = subsOf(env, userId)));
    return subs.then((list) => sendToAll(env, userId, make, defaultLocale, opts, list));
  };
}

/** Post de melding als JSON naar een webhook; true bij een 2xx-antwoord. */
export async function postWebhook(url: string, payload: Payload): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch { return false; }
}

/**
 * Push naar één persoon in de taal van elk abonnement; zonder abonnement via zijn fallback-webhook. Voor meldingen
 * aan anderen (uitnodigingen, afvinken, een plek); `send` is te vervangen in tests.
 */
export async function notifyUser(env: Env, userId: string, make: (locale: Locale) => Payload, defaultLocale: Locale, send: Sender = sendToAll, opts: SendOptions = {}): Promise<Delivery> {
  const { ok, total } = await send(env, userId, make, defaultLocale, opts);
  if (total) return ok ? 'ok' : 'failed';
  const user = await getUser(env.DB, userId);
  const hook = user && (await loadUserPrefs(env, user)).fallbackWebhook;
  if (!hook) return 'none';
  return (await postWebhook(hook, { ...make(defaultLocale), actions: undefined })) ? 'ok' : 'failed';
}

/**
 * Hoe een melding afliep: `ok` = minstens één apparaat (de pushdienst) of de webhook nam hem aan; `failed` = er was een
 * adres maar niemand nam hem aan (abonnementen verlopen, webhook kapot); `none` = deze persoon heeft nergens meldingen aan.
 */
export type Delivery = 'ok' | 'failed' | 'none';

/**
 * Een melding die het antwoord niet ophoudt: met waitUntil op de achtergrond (zonder executionCtx, zoals in sommige
 * tests, wachten we erop). Mislukt hij, dan wordt dat gelogd en blijft de wijziging staan.
 */
export async function inBackground(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, sending: Promise<unknown>, what: string): Promise<void> {
  const p = sending.catch((e) => console.warn(`${what} melden mislukt`, (e as Error).message));
  try { c.executionCtx.waitUntil(p); } catch { await p; }
}

/** Pushbericht voor een taak. Bij een herhalende taak gaat de keer (repeat_at) mee, zodat 'Klaar' niet dubbel doorschuift. */
export function reminderPayload(t: { id: string; title: string; description: string; repeat_at?: string | null }, locale?: string): Payload {
  const actions: Payload['actions'] = [
    { action: 'done', title: translate(locale, 'push.done') },
    { action: 'snooze', title: translate(locale, 'push.snooze') },
  ];
  return { title: t.title, body: t.description.slice(0, 140), taskId: t.id, url: '/', actions, ...(t.repeat_at ? { occurrence: t.repeat_at } : {}) };
}

/** Pushbericht voor een verlopen taak (dagelijkse ronde): afvinken of naar morgen; tikken opent de taak om zelf te plannen. */
export function overduePayload(t: { id: string; title: string; description: string; repeat_at?: string | null }, locale?: string): Payload {
  const actions: Payload['actions'] = [
    { action: 'done', title: translate(locale, 'push.done') },
    { action: 'tomorrow', title: translate(locale, 'push.tomorrow') },
  ];
  return {
    title: translate(locale, 'push.overdue', { title: t.title }), body: t.description.slice(0, 140), taskId: t.id, url: '/', actions,
    // Eigen tag: gaat ook af als de oude melding van deze taak er nog staat.
    tag: `overdue-${t.id}`,
    ...(t.repeat_at ? { occurrence: t.repeat_at } : {}),
  };
}

const RETRY_WINDOW_MS = 15 * 60_000;

/** Verstuurt naar de abonnementen van één gebruiker; in de tests te vervangen. */
export type Sender = typeof sendToAll;

/**
 * Stuurt de verlopen herinneringen. Per taak naar de eigenaar en iedereen die de taak gedeeld kreeg, ieder naar zijn
 * eigen abonnementen en (als er bij hem niets aankwam) zijn eigen fallback-webhook. `reminder_sent` onthoudt per
 * persoon voor welke remind_at hij klaar is (bezorgd, of opgegeven na het retry-venster); `notified` gaat pas op 1
 * als iedereen klaar is. Een nieuwe remind_at (snoozen, doorschuiven, wijzigen) telt vanzelf als nog niet gemeld.
 */
export async function runReminders(env: Env, install: InstallPrefs, send: Sender = pushRound()): Promise<void> {
  const due = (await env.DB.prepare(
    'SELECT id,user_id,parent_id,title,description,remind_at,repeat_at FROM tasks WHERE done = 0 AND notified = 0 AND deleted_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ?',
  ).bind(new Date().toISOString()).all<{ id: string; user_id: string; parent_id: string | null; title: string; description: string; remind_at: string; repeat_at: string | null }>()).results;

  // Per gebruiker één keer lezen per run (ook als twee taken tegelijk naar hem vragen); null = de gebruiker bestaat niet meer.
  const people = new Map<string, Promise<UserPrefs | null>>();
  const prefsOf = (userId: string) => {
    let p = people.get(userId);
    if (!p) {
      p = getUser(env.DB, userId).then((user) => (user ? loadUserPrefs(env, user) : null));
      people.set(userId, p);
    }
    return p;
  };
  // Taken tegelijk (elke taak is van zichzelf: eigen rijen in reminder_sent, eigen notified), zodat één trage
  // ontvanger de rest niet ophoudt. Per taak gaan de ontvangers wel na elkaar.
  await inParallel(due, SEND_CONCURRENCY, async (t) => {
    const { results: rows } = await env.DB.prepare(
      "SELECT ? AS user_id UNION SELECT to_user FROM task_shares WHERE task_id = ? AND status = 'accepted'",
    ).bind(t.user_id, t.parent_id ?? t.id).all<{ user_id: string }>(); // deelrijen hangen aan de hoofdtaak
    const { results: sent } = await env.DB.prepare('SELECT user_id FROM reminder_sent WHERE task_id = ? AND remind_at = ?')
      .bind(t.id, t.remind_at).all<{ user_id: string }>();
    const done = new Set(sent.map((r) => r.user_id));
    const overdue = Date.now() - Date.parse(t.remind_at) > RETRY_WINDOW_MS;
    let pending = 0;
    for (const { user_id: userId } of rows) {
      if (done.has(userId)) continue;
      const prefs = await prefsOf(userId);
      if (!prefs) continue; // een verdwenen account: niets te sturen, en niet elke minuut opnieuw proberen
      let delivered = false;
      {
        const { ok, total } = await send(env, userId, (locale) => reminderPayload(t, locale), install.defaultLocale);
        delivered = ok > 0;
        // Geen abonnement of na 15 minuten nog niets aangekomen: via de fallback-webhook van deze persoon (instelling, of
        // FALLBACK_WEBHOOK voor de beheerder), een generieke webhook die {title, body, taskId, url} als JSON krijgt, in de standaardtaal.
        if (!delivered && (total === 0 || overdue) && prefs.fallbackWebhook) {
          delivered = await postWebhook(prefs.fallbackWebhook, reminderPayload(t, install.defaultLocale));
        }
      }
      // Bezorgd, of na het retry-venster nog onbezorgd: niet eindeloos blijven proberen.
      if (delivered || overdue) {
        await env.DB.prepare('INSERT INTO reminder_sent (task_id, user_id, remind_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT (task_id, user_id) DO UPDATE SET remind_at = excluded.remind_at').bind(t.id, userId, t.remind_at).run();
      } else pending++;
    }
    if (!pending) await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ? AND remind_at = ?').bind(t.id, t.remind_at).run();
  });
}
