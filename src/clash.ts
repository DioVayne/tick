// Botsing met de agenda: verschijnt er in een gekoppelde agenda een nieuwe afspraak op het moment van een taak, dan
// krijgt de persoon één melding met "Opnieuw inplannen" (opent de taak met de herinneringskiezer) en "Naar vrij moment"
// (POST /api/tasks/:id/free: het eerste vrije halfuur na de herinnering). Nieuw = niet in de vorige goede ophaalronde
// van de agenda's, terwijl hij daar binnen het venster had moeten staan. calendar_clashes onthoudt per persoon, taak en
// herinneringstijd dat er al gemeld is, zodat een afspraak die verdwijnt en terugkomt niet nog eens meldt.
import type { Env } from './index';
import { loadInstallPrefs } from './prefs';
import { notifyUser, sendToAll, type Locale, type Payload, type Sender } from './push';
import { inZone, type Zone } from './time';
import { translate } from '../public/i18n.js';
import { zonedParts } from '../public/repeat.js';

/** Een afspraak in milliseconden; een afspraak van een hele dag blokkeert niets (zoals in de planner). */
export type Busy = { start: number; end: number; title: string; allDay: boolean };

const DAY = 86_400_000;
const WINDOW_MS = 14 * DAY;
/** Hooguit zoveel meldingen per keer ophalen van één agenda. */
export const MAX_CLASH_PUSH = 5;
const BLOCK_MS = 30 * 60_000;
const LEAD_MS = 15 * 60_000;
// Vrije momenten alleen tussen 08:00 en 22:00 in de zone van de persoon (zoals de planner in de app).
const DAY_START = 8 * 60;
const DAY_END = 22 * 60;

const covers = (e: Busy, at: number) => !e.allDay && e.start <= at && at < e.end;
const same = (a: Busy, b: Busy) => a.start === b.start && a.end === b.end && a.title === b.title && a.allDay === b.allDay;

type ClashTask = { id: string; title: string; remind_at: string };

/**
 * De taken die door de nieuwe afspraken gaan botsen: hun herinnering ligt na `now`, valt in een nieuwe afspraak
 * (`after`) die vóór `until` begint, en viel in geen enkele afspraak van eerst (`before`, alle agenda's van de persoon).
 */
export function newClashes<T extends { remind_at: string }>(tasks: T[], before: Busy[], after: Busy[], now: number, until: number): { task: T; event: Busy }[] {
  const out: { task: T; event: Busy }[] = [];
  for (const task of tasks) {
    const at = Date.parse(task.remind_at);
    if (!(at > now)) continue;
    if (before.some((e) => covers(e, at))) continue;
    const event = after.find((e) => e.start < until && covers(e, at));
    if (event) out.push({ task, event });
  }
  return out;
}

const dateLocale = (locale: Locale) => (locale === 'nl' ? 'nl-NL' : 'en-GB');

/** De melding: de taak, de nieuwe afspraak met dag en tijd, en de twee knoppen. Tikken is Opnieuw inplannen. */
export function clashPayload(task: { id: string; title: string }, event: Busy, locale: Locale, timeZone: string): Payload {
  const when = new Intl.DateTimeFormat(dateLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })
    .format(event.start);
  return {
    title: translate(locale, 'clash.push_title', { title: task.title }),
    body: translate(locale, 'clash.push_body', { event: event.title || translate(locale, 'cal.busy'), when }),
    taskId: task.id,
    url: `/?task=${encodeURIComponent(task.id)}&when=1`,
    tag: `clash-${task.id}`,
    actions: [
      { action: 'reschedule', title: translate(locale, 'clash.reschedule') },
      { action: 'free', title: translate(locale, 'clash.free') },
    ],
    // Na "Naar vrij moment" zegt de service worker waarheen; hij kent taal en zone niet zelf.
    moved: { text: translate(locale, 'clash.moved'), locale: dateLocale(locale), timeZone },
  };
}

const toBusy = (r: { title: string; start_at: string; end_at: string; all_day: number }): Busy =>
  ({ title: r.title, start: Date.parse(r.start_at), end: Date.parse(r.end_at), allDay: !!r.all_day });

/** Alle afspraken van een persoon die nog niet voorbij zijn (tot het eind van het venster). */
export async function futureBusy(db: D1Database, userId: string, now: number): Promise<Busy[]> {
  const { results } = await db.prepare(`SELECT title, start_at, end_at, all_day FROM calendar_events
    WHERE user_id = ? AND end_at > ? AND start_at < ? ORDER BY start_at LIMIT 5000`)
    .bind(userId, new Date(now).toISOString(), new Date(now + WINDOW_MS + DAY).toISOString())
    .all<{ title: string; start_at: string; end_at: string; all_day: number }>();
  return results.map(toBusy);
}

/**
 * Na een goede ophaalronde van één agenda: meldt de taken die door een nieuwe afspraak botsen. `before`: de afspraken
 * van de persoon vóór het vervangen (futureBusy), `events` de nieuwe van deze agenda, `okAt` de vorige goede ronde
 * (null: de eerste keer, dan is alles nieuw en meldt hij niets). Geeft het aantal meldingen terug.
 */
export async function notifyClashes(env: Env, userId: string, okAt: string | null, before: Busy[], events: Busy[], timeZone: string,
  now = Date.now(), send: Sender = sendToAll): Promise<number> {
  if (!okAt) return 0;
  const until = Date.parse(okAt) + WINDOW_MS;
  // Alleen afspraken die er de vorige keer niet waren; meestal is er niets nieuws en blijft het bij geen query.
  const fresh = events.filter((e) => !e.allDay && e.end > now && e.start < until && !before.some((b) => same(b, e)));
  if (!fresh.length) return 0;
  const nowIso = new Date(now).toISOString();
  const { results: tasks } = await env.DB.prepare(
    'SELECT id, title, remind_at FROM tasks WHERE done = 0 AND deleted_at IS NULL AND remind_at > ? AND remind_at < ? ' +
    "AND (user_id = ? OR COALESCE(parent_id, id) IN (SELECT task_id FROM task_shares WHERE to_user = ? AND status = 'accepted')) " +
    'ORDER BY remind_at LIMIT 500',
  ).bind(nowIso, new Date(until + DAY).toISOString(), userId, userId).all<ClashTask>();
  const found = newClashes(tasks, before, fresh, now, until);
  if (!found.length) return 0;
  // Voorbije herinneringen hoeven niet meer onthouden te worden.
  await env.DB.prepare('DELETE FROM calendar_clashes WHERE user_id = ? AND remind_at <= ?').bind(userId, nowIso).run();
  const install = await loadInstallPrefs(env);
  let sent = 0;
  for (const { task, event } of found) {
    if (sent >= MAX_CLASH_PUSH) break;
    const res = await env.DB.prepare('INSERT OR IGNORE INTO calendar_clashes (user_id, task_id, remind_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(userId, task.id, task.remind_at, nowIso).run();
    if (!res.meta.changes) continue; // al gemeld voor deze herinnering
    await notifyUser(env, userId, (locale) => clashPayload(task, event, locale, timeZone), install.defaultLocale, send);
    sent++;
  }
  return sent;
}

/**
 * Het eerste vrije halfuur (08:00-22:00 in de zone `z`) vanaf de herinnering, en minstens een kwartier vanaf nu; null
 * als er binnen 14 dagen geen is.
 */
export function firstFree(busy: Busy[], from: number, now: number, z: Zone): number | null {
  const timed = busy.filter((b) => !b.allDay).sort((a, b) => a.start - b.start);
  const first = Math.ceil(Math.max(from, now + LEAD_MS) / BLOCK_MS) * BLOCK_MS;
  return inZone(z, () => {
    let j = 0;
    for (let at = first; at < first + WINDOW_MS; at += BLOCK_MS) {
      const p = zonedParts(at);
      const min = p.h * 60 + p.mi;
      if (min < DAY_START || min + 30 > DAY_END) continue;
      while (j < timed.length && timed[j].end <= at) j++;
      let free = true;
      for (let k = j; k < timed.length && timed[k].start < at + BLOCK_MS; k++) if (timed[k].end > at) { free = false; break; }
      if (free) return at;
    }
    return null;
  });
}
