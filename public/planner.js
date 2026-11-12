// De planner: bedenkt momenten waarop een taak kan terugkomen. Elke bron is een eigen functie: `fixedSlots` (vandaag,
// morgen, volgende week op de standaardtijd) en `calendarSlots` (vrije momenten tussen de afspraken uit gekoppelde
// agenda's, ook 's avonds en in het weekend). De afspraken komen van agenda.js via `setBusySource`, zodat deze module
// puur blijft (de tests geven `busy` zelf mee).
import { quickDays } from './calendar.js';
import { chipDays, getDefaultTime, getTimeZone, zonedParts, zonedToUtc } from './repeat.js';
import { dateLocale, t } from './i18n.js';

/** @typedef {{ at: string, label: string, source: string, busy?: string | null }} Slot */
/** @typedef {{ start: number, end: number, title: string, allDay: boolean }} Busy */

/** Een voorstel uit de agenda duurt een halfuur. */
export const BLOCK_MS = 30 * 60_000;
const HORIZON_MS = 14 * 86_400_000;
// Geen werktijden, wel geen nacht: vrije momenten tussen 08:00 en 22:00 in je eigen zone.
const DAY_START = 8 * 60;
const DAY_END = 22 * 60;
const LEAD_MS = 15 * 60_000;

/** @type {(() => Promise<Busy[] | null>) | null} */
let busySource = null;
/**
 * Waar suggest de afspraken vandaan haalt als de aanroeper ze niet meegeeft (agenda.js).
 * @param {(() => Promise<Busy[] | null>) | null} fn
 */
export function setBusySource(fn) { busySource = fn; }

/** UTC-ISO van een dagsleutel `YYYY-MM-DD` op de standaardtijd, in de ingestelde zone. */
function atDefaultTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  const def = getDefaultTime();
  return new Date(zonedToUtc(y, m, d, def.h, def.mi)).toISOString();
}

const p2 = (n) => String(n).padStart(2, '0');

/**
 * De snelkeuzes van het herinneringsmenu (steps.js) als wandklok 'YYYY-MM-DDTHH:MM' in de ingestelde zone: vandaag op
 * het volgende hele uur (null vanaf 23:00), morgen en het begin van volgende week op de standaardtijd (`def`).
 * @param {number} nowMs
 * @param {'mon' | 'sun'} [weekStart] standaard de ingestelde weekstart
 * @returns {{ today: string | null, tomorrow: string, nextWeek: string, def: string }}
 */
export function quickWhen(nowMs, weekStart = chipDays()[0] === 6 ? 'sun' : 'mon') {
  const now = zonedParts(nowMs);
  const days = quickDays(now, weekStart);
  const def = `${p2(getDefaultTime().h)}:${p2(getDefaultTime().mi)}`;
  return {
    today: now.h < 23 ? `${days.today}T${p2(now.h + 1)}:00` : null,
    tomorrow: `${days.tomorrow}T${def}`,
    nextWeek: `${days.nextWeek}T${def}`,
    def,
  };
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
 * De afspraak (geen hele dag) die het blok vanaf `at` raakt, of null.
 * @param {number} at
 * @param {Busy[] | null | undefined} busy
 * @param {number} [len]
 * @returns {Busy | null}
 */
export function busyAt(at, busy, len = BLOCK_MS) {
  return (busy ?? []).find((b) => !b.allDay && b.start < at + len && b.end > at) ?? null;
}

/**
 * Het eerste vrije halfuur vanaf `at` op dezelfde dag (in de ingestelde zone), uiterlijk tot 22:00; null als die dag
 * vol zit. Valt `at` op een afspraak, dan schuift hij naar het einde ervan (op een kwartier naar boven).
 * Voor de snelkeuzes van het herinneringsmenu: een voorstel valt nooit op een afspraak.
 * @param {number} at
 * @param {Busy[] | null | undefined} busy
 * @returns {number | null}
 */
export function freeFrom(at, busy) {
  const day = (/** @type {number} */ ms) => { const p = zonedParts(ms); return `${p.y}-${p.m}-${p.d}`; };
  const start = day(at);
  const latest = Math.max(DAY_END - 30, 0);
  for (let guard = 0; guard < 96; guard++) {
    const hit = busyAt(at, busy);
    if (!hit) return at;
    at = Math.ceil(hit.end / (15 * 60_000)) * 15 * 60_000;
    const p = zonedParts(at);
    if (day(at) !== start || p.h * 60 + p.mi > latest) return null;
  }
  return null;
}

/**
 * "vandaag 14:30", "morgen 09:00" of "za 14 nov. 10:00", in de ingestelde zone.
 * @param {number} ms
 * @param {number} now
 * @returns {string}
 */
export function whenText(ms, now) {
  const tz = getTimeZone();
  const time = new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const dayNo = (/** @type {{ y: number, m: number, d: number }} */ x) => Date.UTC(x.y, x.m - 1, x.d) / 86_400_000;
  const diff = dayNo(zonedParts(ms)) - dayNo(zonedParts(now));
  if (diff === 0) return t('planner.when_today', { time });
  if (diff === 1) return t('planner.when_tomorrow', { time });
  const day = new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  return t('planner.when_day', { day, time });
}

/**
 * Vrije halve uren uit de agenda: het eerstvolgende, het eerste op een doordeweekse avond (vanaf 18:00) en het eerste in
 * het weekend, elk één keer, op volgorde van tijd. Alleen tussen 08:00 en 22:00; een afspraak van een hele dag blokkeert
 * niets.
 * @param {Busy[]} busy
 * @param {number} now
 * @returns {Slot[]}
 */
export function calendarSlots(busy, now) {
  const timed = busy.filter((b) => !b.allDay).sort((a, b) => a.start - b.start);
  const first = Math.ceil((now + LEAD_MS) / BLOCK_MS) * BLOCK_MS;
  /** @type {Map<string, number>} */
  const picks = new Map();
  let j = 0;
  for (let at = first; at < now + HORIZON_MS && picks.size < 3; at += BLOCK_MS) {
    const p = zonedParts(at);
    const min = p.h * 60 + p.mi;
    if (min < DAY_START || min + 30 > DAY_END) continue;
    while (j < timed.length && timed[j].end <= at) j++;
    let free = true;
    for (let k = j; k < timed.length && timed[k].start < at + BLOCK_MS; k++) if (timed[k].end > at) { free = false; break; }
    if (!free) continue;
    if (!picks.has('soon')) picks.set('soon', at);
    else if (!picks.has('evening') && min >= 18 * 60 && p.wd < 5) picks.set('evening', at);
    else if (!picks.has('weekend') && p.wd >= 5) picks.set('weekend', at);
  }
  return [...picks.values()].sort((a, b) => a - b)
    .map((at) => ({ at: new Date(at).toISOString(), label: t('planner.free', { when: whenText(at, now) }), source: 'calendar' }));
}

/**
 * Voorstellen voor een taak, in volgorde van voorkeur: eerst vrije momenten uit de agenda (als er een gekoppeld is),
 * dan de vaste. Een vast voorstel dat op een afspraak valt, krijgt `busy` met de titel.
 * `ctx.busy`: de afspraken, of null zonder agenda; weggelaten = de bron van agenda.js.
 * @param {object} task
 * @param {{ now?: number, busy?: Busy[] | null }} [ctx]
 * @returns {Promise<Slot[]>}
 */
export async function suggest(task, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const busy = ctx.busy !== undefined ? ctx.busy : busySource ? await busySource().catch(() => null) : null;
  const fixed = fixedSlots(now);
  if (!busy) return fixed;
  const cal = calendarSlots(busy, now);
  const seen = new Set(cal.map((s) => s.at));
  return [...cal, ...fixed.filter((s) => !seen.has(s.at)).map((s) => {
    const hit = busyAt(Date.parse(s.at), busy);
    return { ...s, busy: hit ? hit.title || t('cal.busy') : null };
  })];
}
