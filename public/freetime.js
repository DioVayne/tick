// Testfeature "Tijd voor een taak?" (freetime): de rekenregels, zonder DOM. De Worker (src/freetime.ts) gebruikt
// freeUntil voor de uurcheck; de pagina (freetimeview.js) gebruikt candidates en shuffle. Pure functies, ook in vitest.
import { zonedParts, zonedToUtc } from './repeat.js';

/** Hoeveel taken het scherm per keer laat zien. */
export const BATCH = 6;

/** Standaardwaarden: minstens zoveel minuten vrij, alleen tussen deze tijden (lokaal). */
export const DEFAULTS = { minutes: 90, from: '09:00', to: '21:00' };

/** Toegestane waarden voor het aantal vrije minuten. */
export const MINUTES = [30, 45, 60, 90, 120, 180];

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Is de agenda vanaf `now` minstens `minutes` minuten vrij, binnen het venster van vandaag (in de tijdzone die
 * repeat.js nu gebruikt)? Geeft dan het einde van dat vrije stuk (ms): de volgende afspraak, of het einde van het
 * venster als dat eerder is. Anders null. Een afspraak van een hele dag telt niet als bezet.
 * @param {{ start: number, end: number, allDay?: boolean }[]} busy
 * @param {number} now
 * @param {{ minutes: number, from: string, to: string }} prefs
 * @returns {number | null}
 */
export function freeUntil(busy, now, prefs) {
  const p = zonedParts(now);
  const clock = p.h * 60 + p.mi;
  const from = toMin(prefs.from);
  const to = toMin(prefs.to);
  if (clock < from || clock >= to) return null;
  const windowEnd = zonedToUtc(p.y, p.m, p.d, Math.floor(to / 60), to % 60);
  let until = windowEnd;
  for (const b of busy) {
    if (b.allDay || b.end <= now) continue;
    if (b.start <= now) return null; // nu bezig
    if (b.start < until) until = b.start;
  }
  return until - now >= prefs.minutes * 60_000 ? until : null;
}

/**
 * De taken waaruit het scherm kiest: open hoofdtaken zonder geplande tijd. Geen subtaken, geen herhalende taken en
 * geen herinnering in de toekomst; een verlopen herinnering mag wel.
 * @template {{ done?: unknown, deleted_at?: unknown, parent_id?: unknown, repeat?: unknown, remind_at?: string | null }} T
 * @param {T[]} tasks
 * @param {number} now
 * @returns {T[]}
 */
export function candidates(tasks, now) {
  return tasks.filter((t) => !t.done && !t.deleted_at && !t.parent_id && !t.repeat
    && !(t.remind_at && Date.parse(t.remind_at) > now));
}

/**
 * Een geschudde kopie (Fisher-Yates).
 * @template T
 * @param {T[]} list
 * @param {() => number} [rand]
 * @returns {T[]}
 */
export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
