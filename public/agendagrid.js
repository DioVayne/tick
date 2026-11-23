// Het rekenwerk van de agenda-kiezer (agendapick.js), zonder DOM: welke dagen, welke halve uren per dag, welke
// afspraken waar staan en welke halve uren de planner voorstelt. Alles in de ingestelde zone (repeat.js). Een afspraak
// blokkeert niets: je mag ook tijdens een afspraak iets plannen; de kiezer laat alleen zien wat er staat.
import { BLOCK_MS, busyAt, calendarSlots } from './planner.js';
import { zonedParts, zonedToUtc } from './repeat.js';

/** @typedef {import('./planner.js').Busy} Busy */
/** @typedef {{ key: string, y: number, m: number, d: number, wd: number, start: number, end: number }} GridDay */
/** @typedef {{ at: number, h: number, mi: number, past: boolean, busy: Busy | null, tip: boolean, task: string | null }} GridSlot */
/** @typedef {{ title: string, start: number, end: number, top: number, len: number, lane: number, lanes: number }} GridEvent */

/** Halve uren per dag: de hele dag, 00:00 tot 24:00 (ook voor wie 's nachts leeft). */
export const SLOTS_PER_DAY = 48;
/** Zoveel dagen tegelijk, en zoveel erbij met "Meer dagen". */
export const PAGE_DAYS = 14;
/** Zover kijkt de kiezer hooguit vooruit: zo ver bewaart de server de afspraken (WINDOW_DAYS in src/calendar.ts). */
export const MAX_DAYS = 42;
/** Zonder keuze opent de kiezer hier (of een uur voor nu, als dat later is). */
export const OPEN_HOUR = 6;

const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * `count` dagen vanaf vandaag (in de ingestelde zone), elk met begin en eind als UTC-moment.
 * @param {number} now
 * @param {number} count
 * @returns {GridDay[]}
 */
export function gridDays(now, count) {
  const p = zonedParts(now);
  /** @type {GridDay[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    const y = c.getUTCFullYear(), m = c.getUTCMonth() + 1, d = c.getUTCDate();
    out.push({ key: `${y}-${p2(m)}-${p2(d)}`, y, m, d, wd: (c.getUTCDay() + 6) % 7, start: zonedToUtc(y, m, d, 0, 0), end: zonedToUtc(y, m, d + 1, 0, 0) });
  }
  return out;
}

/**
 * De halve uren van een dag. `past`: begonnen of voorbij (niet meer te kiezen: een herinnering in het verleden gaat meteen af). `busy`: de afspraak op dat moment (alleen
 * ter informatie). `tip`: een voorstel van de planner. `task`: de titel van een taak met een herinnering in dat halfuur.
 * Op de dag van een zomertijdwissel volgt de rij de wandklok (een uur dubbel of een uur weg, zoals de klok zelf).
 * @param {GridDay} day
 * @param {{ busy?: Busy[] | null, tasks?: { at: number, title: string }[], now: number, tips?: Set<number> }} ctx
 * @returns {GridSlot[]}
 */
export function daySlots(day, { busy, tasks = [], now, tips = new Set() }) {
  /** @type {GridSlot[]} */
  const out = [];
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    const h = Math.floor(i / 2), mi = (i % 2) * 30;
    const at = zonedToUtc(day.y, day.m, day.d, h, mi);
    const task = tasks.find((x) => x.at >= at && x.at < at + BLOCK_MS);
    out.push({ at, h, mi, past: at <= now, busy: busyAt(at, busy), tip: tips.has(at), task: task ? task.title : null });
  }
  return out;
}

/**
 * De afspraken (geen hele dag) die op deze dag vallen, afgekapt op de dag, met hun plek in halve uren (`top`, `len`).
 * Afspraken die elkaar overlappen staan naast elkaar: `lane` van `lanes`.
 * @param {GridDay} day
 * @param {Busy[] | null | undefined} busy
 * @returns {GridEvent[]}
 */
export function dayEvents(day, busy) {
  const evs = (busy ?? []).filter((b) => !b.allDay && b.start < day.end && b.end > day.start)
    .map((b) => ({ title: b.title, start: b.start, end: b.end, s: Math.max(b.start, day.start), e: Math.min(b.end, day.end) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  /** @type {GridEvent[]} */
  const out = [];
  // Groepen die aan elkaar hangen; binnen een groep krijgt elke afspraak de eerste vrije baan.
  let group = /** @type {GridEvent[]} */ ([]);
  let groupEnd = -Infinity;
  /** @type {number[]} */
  let laneEnds = [];
  const flush = () => { for (const g of group) g.lanes = laneEnds.length; group = []; laneEnds = []; };
  for (const ev of evs) {
    if (ev.s >= groupEnd) { flush(); groupEnd = -Infinity; }
    let lane = laneEnds.findIndex((end) => end <= ev.s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(ev.e); } else laneEnds[lane] = ev.e;
    const g = { title: ev.title, start: ev.start, end: ev.end, top: (ev.s - day.start) / BLOCK_MS, len: Math.max((ev.e - ev.s) / BLOCK_MS, 0.5), lane, lanes: 1 };
    group.push(g);
    out.push(g);
    groupEnd = Math.max(groupEnd, ev.e);
  }
  flush();
  return out;
}

/**
 * Titels van afspraken van een hele dag op deze dag (die blokkeren niets; ze staan als strookje boven de dag).
 * @param {GridDay} day
 * @param {Busy[] | null | undefined} busy
 * @returns {string[]}
 */
export function allDayTitles(day, busy) {
  return (busy ?? []).filter((b) => b.allDay && b.start < day.end && b.end > day.start).map((b) => b.title);
}

/**
 * De voorstellen van de planner (vrije halve uren uit calendarSlots) als set van UTC-momenten.
 * @param {Busy[] | null | undefined} busy
 * @param {number} now
 * @returns {Set<number>}
 */
export function tipSet(busy, now) {
  return busy ? new Set(calendarSlots(busy, now).map((s) => Date.parse(s.at))) : new Set();
}

/**
 * Op welk uur de kiezer opent: een uur voor de keuze; zonder keuze een uur voor nu, maar niet vóór 06:00 (behalve
 * 's nachts zelf: dan het uur van nu).
 * @param {number | null} picked
 * @param {number} now
 * @returns {number}
 */
export function openHour(picked, now) {
  if (picked != null) return Math.max(zonedParts(picked).h - 1, 0);
  const h = zonedParts(now).h;
  return h < OPEN_HOUR ? h : Math.max(h - 1, OPEN_HOUR);
}
