import type { Env } from './index';
import { loadUserPrefs, userSettingStmt, type InstallPrefs } from './prefs';
import { overduePayload, postWebhook, sendToAll, type Sender } from './push';
import { inZone, type Zone } from './time';
import { zonedParts, zonedToUtc } from '../public/repeat.js';

/** Hoogstens zoveel meldingen per persoon per dag; de oudste verlopen taken eerst. */
export const MAX_OVERDUE = 10;

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
  const { results: users } = await env.DB.prepare('SELECT id, role FROM users').all<{ id: string; role: 'admin' | 'member' }>();
  for (const user of users) {
    const prefs = await loadUserPrefs(env, user);
    if (!prefs.overdueTime) continue;
    const local = localNow(prefs, now);
    if (local.clock < prefs.overdueTime || prefs.overdueDay === local.day) continue;
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
