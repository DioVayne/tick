// De planner: bedenkt momenten waarop een taak kan terugkomen. Elke bron is een eigen functie;
// een agenda-bron komt er later naast `fixedSlots`.
import { quickDays } from './calendar.js';
import { chipDays, getDefaultTime, zonedParts, zonedToUtc } from './repeat.js';
import { t } from './i18n.js';

/** @typedef {{ at: string, label: string, source: string }} Slot */

/** UTC-ISO van een dagsleutel `YYYY-MM-DD` op de standaardtijd, in de ingestelde zone. */
function atDefaultTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  const def = getDefaultTime();
  return new Date(zonedToUtc(y, m, d, def.h, def.mi)).toISOString();
}

/**
 * Vaste voorstellen: vandaag (alleen als de standaardtijd nog komt), morgen en volgende week.
 * @param {number} now
 * @returns {Slot[]}
 */
function fixedSlots(now) {
  const weekStart = chipDays()[0] === 6 ? 'sun' : 'mon';
  const days = quickDays(zonedParts(now), weekStart);
  const todayAt = atDefaultTime(days.today);
  /** @type {Slot[]} */
  const out = [];
  if (Date.parse(todayAt) > now) out.push({ at: todayAt, label: t('planner.today'), source: 'fixed' });
  out.push({ at: atDefaultTime(days.tomorrow), label: t('planner.tomorrow'), source: 'fixed' });
  out.push({ at: atDefaultTime(days.nextWeek), label: t('planner.next_week'), source: 'fixed' });
  return out;
}

/**
 * Voorstellen voor een taak, in volgorde van voorkeur. `task` is voor bronnen die de taak nodig hebben (agenda).
 * @param {object} task
 * @param {{ now?: number }} [ctx]
 * @returns {Promise<Slot[]>}
 */
export async function suggest(task, ctx = {}) {
  const now = ctx.now ?? Date.now();
  return fixedSlots(now);
}
