// Gekoppelde agenda's: geheime iCal-adressen (Google, Outlook, iCloud) die Tick elk uur ophaalt, zodat de planner vrije
// momenten kan voorstellen. De URL is een geheim: versleuteld in D1 (AES-GCM, sleutel afgeleid van SESSION_SECRET),
// nooit in een antwoord of in de logs. Per afspraak alleen titel en tijden, voor 14 dagen vooruit, bij elke keer
// ophalen vervangen. Uit met CALENDAR_FEEDS = "false" (dan bestaat niets hiervan).
import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { futureBusy, notifyClashes } from './clash';
import { parseIcs } from './ics';
import { loadUserPrefs } from './prefs';
import { getUser } from './users';

export const WINDOW_DAYS = 14;
const DAY = 86_400_000;
/** Ophalen bij het openen van de app: alleen als het langer geleden is dan dit. */
export const OPEN_STALE_MS = 15 * 60_000;
/** De cron ververst een feed na een uur. */
export const CRON_STALE_MS = 60 * 60_000;
const CRON_BATCH = 5;
export const MAX_FEEDS = 10;
export const MAX_FEED_NAME = 60;
const MAX_URL = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 500;
const TIMEOUT_MS = 15_000;

export const calendarOn = (env: Pick<Env, 'CALENDAR_FEEDS'>) => (env.CALENDAR_FEEDS ?? '').trim().toLowerCase() !== 'false';

type FeedRow = {
  id: string; user_id: string; name: string; url_enc: string; url_hash: string; host: string; created_at: string;
  fetched_at: string | null; status: string | null; error: string | null; events: number;
  /** De laatste goede ophaalronde (migratie 0030); null = nog nooit. */
  ok_at?: string | null;
};

/** Wat de app van een feed ziet: nooit de URL. */
const view = (f: FeedRow) => ({
  id: f.id, name: f.name, host: f.host, created_at: f.created_at, fetched_at: f.fetched_at, status: f.status, error: f.error, events: f.events,
});

// ---------- versleuteling ----------

const enc = new TextEncoder();
const keys = new Map<string, Promise<{ aes: CryptoKey; mac: CryptoKey }>>();

function feedKeys(secret: string) {
  let k = keys.get(secret);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
      const salt = enc.encode('tick-calendar');
      const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('feed-url-aes') }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const mac = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('feed-url-hash') }, base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
      return { aes, mac };
    })();
    keys.set(secret, k);
  }
  return k;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealUrl(env: Env, feedId: string, url: string): Promise<string> {
  const { aes } = await feedKeys(env.SESSION_SECRET);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(feedId) }, aes, enc.encode(url));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openUrl(env: Env, feedId: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('onbekend formaat');
  const { aes } = await feedKeys(env.SESSION_SECRET);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(feedId) }, aes, unb64(ct));
  return new TextDecoder().decode(plain);
}

export async function hashUrl(env: Env, userId: string, url: string): Promise<string> {
  const { mac } = await feedKeys(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign('HMAC', mac, enc.encode(`${userId}\n${url}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Een geldig agenda-adres (webcal wordt https), of null. http alleen voor localhost (lokaal testen). */
export function cleanUrl(v: unknown): URL | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^webcals?:\/\//i, 'https://');
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u;
    return null;
  } catch {
    return null;
  }
}

// ---------- ophalen ----------

class FetchError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** De tekst van een agenda, hooguit 5 MB; anders een FetchError met een code (nooit de URL). */
async function download(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1', 'user-agent': 'Tick calendar (self-hosted to-do app)' },
      redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new FetchError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!res.ok) { res.body?.cancel().catch(() => {}); throw new FetchError(`http:${res.status}`); }
  const reader = res.body?.getReader();
  if (!reader) throw new FetchError('not_ics');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new FetchError('too_big'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  const text = new TextDecoder().decode(all);
  if (!text.includes('BEGIN:VCALENDAR')) throw new FetchError('not_ics');
  return text;
}

/**
 * Haalt één feed op en vervangt zijn afspraken (één batch: wissen, invoegen, status). Mislukt het, dan blijven de oude
 * afspraken staan en komt alleen de fout in de status. Geeft de nieuwe rij terug.
 */
export async function refreshFeed(env: Env, feed: FeedRow, timeZone: string, now = Date.now()): Promise<FeedRow> {
  const at = new Date(now).toISOString();
  try {
    const url = await openUrl(env, feed.id, feed.url_enc).catch(() => { throw new FetchError('secret'); });
    const text = await download(url);
    const from = now - DAY;
    const events = parseIcs(text, { from, to: now + WINDOW_DAYS * DAY, zone: timeZone, max: MAX_EVENTS });
    const rows = JSON.stringify(events.map((e) => [e.title, new Date(e.start).toISOString(), new Date(e.end).toISOString(), e.allDay ? 1 : 0]));
    // Voor de melding bij een nieuwe afspraak op het moment van een taak: wat er eerst stond (alle agenda's van deze persoon).
    const before = feed.ok_at ? await futureBusy(env.DB, feed.user_id, now) : [];
    await env.DB.batch([
      env.DB.prepare('DELETE FROM calendar_events WHERE feed_id = ?').bind(feed.id),
      // Alleen als de feed er nog is (tegelijk ontkoppeld: niets achterlaten).
      env.DB.prepare(`INSERT INTO calendar_events (feed_id, user_id, title, start_at, end_at, all_day)
        SELECT ?1, ?2, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
        FROM json_each(?3) WHERE EXISTS (SELECT 1 FROM calendar_feeds WHERE id = ?1)`).bind(feed.id, feed.user_id, rows),
      env.DB.prepare("UPDATE calendar_feeds SET fetched_at = ?, ok_at = ?, status = 'ok', error = NULL, events = ? WHERE id = ?").bind(at, at, events.length, feed.id),
    ]);
    // Een mislukte melding laat de nieuwe afspraken staan.
    await notifyClashes(env, feed.user_id, feed.ok_at ?? null, before, events.map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: !!e.allDay })), timeZone, now)
      .catch((e) => console.warn(`agenda ${feed.id}: botsing melden mislukt`, (e as Error).message));
    return { ...feed, fetched_at: at, ok_at: at, status: 'ok', error: null, events: events.length };
  } catch (e) {
    const code = e instanceof FetchError ? e.code : 'parse';
    // Geen URL in de log, alleen welke feed en wat er misging.
    console.warn(`agenda ${feed.id}: ophalen mislukt (${code})`);
    await env.DB.prepare("UPDATE calendar_feeds SET fetched_at = ?, status = 'error', error = ? WHERE id = ?").bind(at, code, feed.id).run();
    return { ...feed, fetched_at: at, status: 'error', error: code };
  }
}

const feedsOf = async (db: D1Database, userId: string) =>
  (await db.prepare('SELECT * FROM calendar_feeds WHERE user_id = ? ORDER BY created_at, id').bind(userId).all<FeedRow>()).results;

/** De afspraken van vandaag (in UTC min een dag) tot 14 dagen vooruit, met de namen van de feeds. */
async function eventsOf(db: D1Database, userId: string, feeds: FeedRow[], now = Date.now()) {
  const from = new Date(now - DAY).toISOString();
  const to = new Date(now + WINDOW_DAYS * DAY).toISOString();
  const { results } = await db.prepare(`SELECT feed_id, title, start_at, end_at, all_day FROM calendar_events
    WHERE user_id = ? AND end_at > ? AND start_at < ? ORDER BY start_at LIMIT 2000`).bind(userId, from, to)
    .all<{ feed_id: string; title: string; start_at: string; end_at: string; all_day: number }>();
  return {
    feeds: feeds.map((f) => ({ id: f.id, name: f.name })),
    events: results.map((r) => ({ feed: r.feed_id, title: r.title, start: r.start_at, end: r.end_at, allDay: !!r.all_day })),
  };
}

/** Cron-stap: hooguit een paar feeds die langer dan een uur niet opgehaald zijn. */
export async function refreshStaleFeeds(env: Env, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - CRON_STALE_MS).toISOString();
  const { results } = await env.DB.prepare('SELECT * FROM calendar_feeds WHERE fetched_at IS NULL OR fetched_at < ? ORDER BY fetched_at LIMIT ?')
    .bind(cutoff, CRON_BATCH).all<FeedRow>();
  const zones = new Map<string, string>();
  for (const f of results) {
    let zone = zones.get(f.user_id);
    if (!zone) {
      const user = await getUser(env.DB, f.user_id);
      zone = user ? (await loadUserPrefs(env, user)).timeZone : env.TIMEZONE || 'UTC';
      zones.set(f.user_id, zone);
    }
    await refreshFeed(env, f, zone, now);
  }
  return results.length;
}

// ---------- API ----------

export const calendarApi = new Hono<AppEnv>();
calendarApi.use('*', async (c, next) => {
  if (!calendarOn(c.env)) throw new HttpError(404, 'err.not_found');
  await next();
});
calendarApi.use('*', sessionOnly);

calendarApi.get('/feeds', async (c) => c.json((await feedsOf(c.env.DB, c.get('user').id)).map(view)));

calendarApi.post('/feeds', async (c) => {
  const body = await c.req.json<{ url?: unknown; name?: unknown }>().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'err.invalid_json');
  const url = cleanUrl(body.url);
  if (!url) throw new HttpError(400, 'err.calendar_url');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > MAX_FEED_NAME) throw new HttpError(400, 'err.too_long', { field: 'name', max: MAX_FEED_NAME });
  const user = c.get('user');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_feeds WHERE user_id = ?').bind(user.id).first<number>('n');
  if ((count ?? 0) >= MAX_FEEDS) throw new HttpError(400, 'err.calendar_too_many', { max: MAX_FEEDS });
  const id = crypto.randomUUID();
  const hash = await hashUrl(c.env, user.id, url.href);
  const row: FeedRow = {
    id, user_id: user.id, name, url_enc: await sealUrl(c.env, id, url.href), url_hash: hash, host: url.hostname,
    created_at: new Date().toISOString(), fetched_at: null, status: null, error: null, events: 0, ok_at: null,
  };
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO calendar_feeds (id, user_id, name, url_enc, url_hash, host, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.user_id, row.name, row.url_enc, row.url_hash, row.host, row.created_at).run();
  if (!res.meta.changes) throw new HttpError(409, 'err.calendar_exists');
  // Meteen ophalen, zodat je ziet of het adres werkt.
  return c.json(view(await refreshFeed(c.env, row, c.get('prefs').timeZone)), 201);
});

calendarApi.delete('/feeds/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const [, del] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM calendar_events WHERE feed_id = ? AND user_id = ?').bind(id, user.id),
    c.env.DB.prepare('DELETE FROM calendar_feeds WHERE id = ? AND user_id = ?').bind(id, user.id),
  ]);
  if (!del.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true });
});

/** Bij het openen van de app: feeds die langer dan 15 minuten niet opgehaald zijn eerst verversen. */
calendarApi.post('/refresh', async (c) => {
  const user = c.get('user');
  const now = Date.now();
  const feeds = await feedsOf(c.env.DB, user.id);
  const fresh = await Promise.all(feeds.map((f) => (!f.fetched_at || Date.parse(f.fetched_at) < now - OPEN_STALE_MS
    ? refreshFeed(c.env, f, c.get('prefs').timeZone, now) : f)));
  return c.json({ list: fresh.map(view), ...await eventsOf(c.env.DB, user.id, fresh, now) });
});

calendarApi.get('/events', async (c) => {
  const user = c.get('user');
  return c.json(await eventsOf(c.env.DB, user.id, await feedsOf(c.env.DB, user.id)));
});
