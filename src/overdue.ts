import type { Env } from './index';
import { loadUserPrefs, userSettingStmt, type InstallPrefs } from './prefs';
import { overduePayload, postWebhook, pushRound, type Sender } from './push';
import { inZone, type Zone } from './time';
import { zonedParts, zonedToUtc } from '../public/repeat.js';

/** Hoogstens zoveel meldingen per persoon per dag; de oudste verlopen taken eerst. */
export const MAX_OVERDUE = 10;

/**
 * Hoogstens zoveel mensen per ronde (elke minuut). Per persoon kost een ronde een paar D1-queries per melding; wie
 * niet past, is de volgende minuut aan de beurt.
 */
export const MAX_OVERDUE_USERS = 10;

/** De rijen van `user_settings` die deze ronde uit `loadUserPrefs` gebruikt (zone en standaardtijd, tijd, dag, webhook). */
const OVERDUE_KEYS = ['timezone', 'reminder_time', 'overdue_time', 'overdue_day', 'fallback_webhook'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d)); // rekent een dag over de maandgrens goed door
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** De lokale datum, de klok (HH:MM) en het begin van vandaag (UTC) in de zone van `z`. */
export function localNow(z: Zone, ms: number): { day: string; tomorrow: string; clock: string; startOfDay: string } {
  return inZone(z, () => {
    const p = zonedParts(ms);
    return {
      day: ymd(p.y, p.m, p.d),
      tomorrow: ymd(p.y, p.m, p.d + 1),
      clock: `${pad(p.h)}:${pad(p.mi)}`,
      startOfDay: new Date(zonedToUtc(p.y, p.m, p.d, 0, 0)).toISOString(),
    };
  });
}

type Row = { id: string; title: string; description: string; repeat_at: string | null };

/** Waarde van `overdue_next` voor iemand die de ronde uit heeft: komt nooit aan de beurt (tot hij hem weer aanzet). */
export const NEVER = '9999';
/** Hoeveel mensen met een bereikt `overdue_next` één ronde hoogstens bekijkt (de meesten krijgen alleen een nieuw moment). */
const MAX_CANDIDATES = 100;

/** Het UTC-moment (ISO) van `clock` (HH:MM) op dag `day` (YYYY-MM-DD) in de zone van `z`. */
function momentOn(z: Zone, day: string, clock: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = clock.split(':').map(Number);
  return inZone(z, () => new Date(zonedToUtc(y, m, d, h, mi)).toISOString());
}

/**
 * Dagelijkse ronde: wie zijn tijd (`overdue_time`, standaard 09:00) vandaag gepasseerd heeft en nog niet aan de beurt
 * was, krijgt per verlopen taak een melding (eigen taken en geaccepteerde gedeelde). Verlopen = een moment vóór het
 * begin van vandaag in zijn zone. `overdue_day` onthoudt de dag; ook zonder verlopen taken. Er is geen tweede poging:
 * morgen komt de volgende ronde.
 *
 * Wie aan de beurt is, staat in `overdue_next` (migratie 0037): het volgende moment in UTC. De ronde draait elke minuut
 * maar leest via de index alleen wie dat moment bereikt heeft; meestal niemand, en dan is het één query die niets
 * leest. Een nieuw account of een andere tijd of tijdzone zet hem (via triggers) op '' = meteen kijken; deze ronde
 * rekent het moment dan uit.
 */
export async function runOverdue(env: Env, install: InstallPrefs, send: Sender = pushRound(), now = Date.now()): Promise<void> {
  const { results: due } = await env.DB.prepare(
    "SELECT user_id FROM user_settings WHERE key = 'overdue_next' AND value <= ? ORDER BY value, user_id LIMIT ?",
  ).bind(new Date(now).toISOString(), MAX_CANDIDATES).all<{ user_id: string }>();
  if (!due.length) return;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.role, s.key, s.value FROM users u LEFT JOIN user_settings s ON s.user_id = u.id AND s.key IN (${OVERDUE_KEYS.map(() => '?').join(', ')}) ` +
    'WHERE u.id IN (SELECT value FROM json_each(?))',
  ).bind(...OVERDUE_KEYS, JSON.stringify(due.map((r) => r.user_id))).all<{ id: string; role: 'admin' | 'member'; key: string | null; value: string | null }>();
  const byUser = new Map<string, { user: { id: string; role: 'admin' | 'member' }; rows: { key: string; value: string }[] }>();
  for (const r of results) {
    let entry = byUser.get(r.id);
    if (!entry) byUser.set(r.id, (entry = { user: { id: r.id, role: r.role }, rows: [] }));
    if (r.key !== null && r.value !== null) entry.rows.push({ key: r.key, value: r.value });
  }
  let handled = 0;
  // In de volgorde van overdue_next: wie het langst wacht eerst.
  for (const { user_id: id } of due) {
    const entry = byUser.get(id);
    if (!entry) continue; // de rij hoort bij een account dat net verdwijnt
    const { user, rows } = entry;
    const prefs = await loadUserPrefs(env, user, Promise.resolve(rows));
    if (!prefs.overdueTime) {
      await userSettingStmt(env.DB, user.id, 'overdue_next', NEVER).run();
      continue;
    }
    const local = localNow(prefs, now);
    if (local.clock < prefs.overdueTime || prefs.overdueDay === local.day) {
      // Nog niet (vandaag later), of vandaag al geweest (dan morgen): alleen het moment onthouden.
      const day = prefs.overdueDay === local.day ? local.tomorrow : local.day;
      await userSettingStmt(env.DB, user.id, 'overdue_next', momentOn(prefs, day, prefs.overdueTime)).run();
      continue;
    }
    // Hoogstens zoveel mensen per ronde (de limiet van D1 per aanroep); de rest blijft aan de beurt voor de volgende minuut.
    if (handled >= MAX_OVERDUE_USERS) break;
    handled++;
    const { results: tasks } = await env.DB.prepare(
      'SELECT id, title, description, repeat_at FROM tasks WHERE done = 0 AND deleted_at IS NULL AND remind_at IS NOT NULL AND remind_at < ? ' +
      "AND (user_id = ? OR COALESCE(parent_id, id) IN (SELECT task_id FROM task_shares WHERE to_user = ? AND status = 'accepted')) " +
      'ORDER BY remind_at LIMIT ?',
    ).bind(local.startOfDay, user.id, user.id, MAX_OVERDUE).all<Row>();
    for (const t of tasks) {
      const { ok } = await send(env, user.id, (locale) => overduePayload(t, locale), install.defaultLocale);
      if (!ok && prefs.fallbackWebhook) await postWebhook(prefs.fallbackWebhook, overduePayload(t, install.defaultLocale));
    }
    await env.DB.batch([
      userSettingStmt(env.DB, user.id, 'overdue_day', local.day),
      userSettingStmt(env.DB, user.id, 'overdue_next', momentOn(prefs, local.tomorrow, prefs.overdueTime)),
    ]);
  }
}
