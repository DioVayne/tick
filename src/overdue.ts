import type { Env } from './index';
import { loadUserPrefs, userSettingStmt, type InstallPrefs } from './prefs';
import { overduePayload, postWebhook, sendToAll, type Sender } from './push';
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

/**
 * Dagelijkse ronde: wie zijn tijd (`overdue_time`, standaard 09:00) vandaag gepasseerd heeft en nog niet aan de beurt
 * was, krijgt per verlopen taak een melding (eigen taken en geaccepteerde gedeelde). Verlopen = een moment vóór het
 * begin van vandaag in zijn zone. `overdue_day` onthoudt de dag; ook zonder verlopen taken, zodat de query eens per
 * dag draait. Er is geen tweede poging: morgen komt de volgende ronde.
 */
export async function runOverdue(env: Env, install: InstallPrefs, send: Sender = sendToAll, now = Date.now()): Promise<void> {
  // Eén query voor iedereen (draait elke minuut); wie aan de beurt is, bepalen we hier in het geheugen.
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.role, s.key, s.value FROM users u LEFT JOIN user_settings s ON s.user_id = u.id AND s.key IN (${OVERDUE_KEYS.map(() => '?').join(', ')}) ORDER BY u.id`,
  ).bind(...OVERDUE_KEYS).all<{ id: string; role: 'admin' | 'member'; key: string | null; value: string | null }>();
  const byUser = new Map<string, { user: { id: string; role: 'admin' | 'member' }; rows: { key: string; value: string }[] }>();
  for (const r of results) {
    let entry = byUser.get(r.id);
    if (!entry) byUser.set(r.id, (entry = { user: { id: r.id, role: r.role }, rows: [] }));
    if (r.key !== null && r.value !== null) entry.rows.push({ key: r.key, value: r.value });
  }
  let handled = 0;
  for (const { user, rows } of byUser.values()) {
    // Hoogstens zoveel mensen per ronde (de limiet van D1 per aanroep); de rest is de volgende minuut aan de beurt.
    if (handled >= MAX_OVERDUE_USERS) break;
    const prefs = await loadUserPrefs(env, user, Promise.resolve(rows));
    if (!prefs.overdueTime) continue;
    const local = localNow(prefs, now);
    if (local.clock < prefs.overdueTime || prefs.overdueDay === local.day) continue;
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
    await userSettingStmt(env.DB, user.id, 'overdue_day', local.day).run();
  }
}
