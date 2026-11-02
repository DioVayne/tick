// Rijmodus: herkennen dat je rijdt uit de snelheid van GPS-locaties, en welke taken dan groot in beeld komen.
// Zonder DOM, zodat het te testen is; driveview.js doet het kijken naar de locatie en het scherm.
import { startOfDay } from './calendar.js';
import { zonedParts } from './repeat.js';

/** Vanaf deze snelheid (m/s, ongeveer 25 km/u) rijd je. */
export const DRIVE_SPEED = 7;
/** Hieronder (m/s, ongeveer 15 km/u) sta je stil of loop je; daarboven rij je nog (file, stoplicht dat op groen springt). */
export const MOVING_SPEED = 4;
/** Zo lang (ms) achter elkaar snel voordat de rijmodus aangaat. */
export const ENTER_MS = 30_000;
/** Zo lang (ms) niet meer bewogen en de rit is voorbij. */
export const EXIT_MS = 3 * 60_000;
/** Locaties die onnauwkeuriger zijn dan dit (m) tellen niet mee. */
export const MAX_ACCURACY = 100;
/** Taken met een plek binnen deze afstand (m) staan onder "Hier vlakbij". */
export const NEAR_M = 3000;

/** Afstand in meters tussen twee punten ({ lat, lng }), over de aardbol. */
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Houdt bij of je rijdt. `update` krijgt elke locatie ({ lat, lng, accuracy, speed, at }; speed in m/s of null),
 * `tick` het tijdstip als er even geen locatie komt (stilstaan geeft vaak geen nieuwe). Beide geven true als de stand wisselde.
 */
export function createDetector() {
  let prev = /** @type {{ lat: number, lng: number, at: number } | null} */ (null);
  let fastSince = /** @type {number | null} */ (null);
  let lastMoving = 0;
  let driving = false;

  const tick = (now) => {
    if (!driving || now - lastMoving < EXIT_MS) return false;
    driving = false;
    fastSince = null;
    return true;
  };

  return {
    get driving() { return driving; },
    tick,
    update({ lat, lng, accuracy, speed, at }) {
      if (!(accuracy <= MAX_ACCURACY)) return tick(at);
      // De snelheid van de telefoon zelf als die er is, anders uit de vorige locatie (minstens een seconde ertussen).
      let v = typeof speed === 'number' && speed >= 0 ? speed : null;
      if (v === null && prev && at - prev.at >= 1000) v = distance(prev, { lat, lng }) / ((at - prev.at) / 1000);
      prev = { lat, lng, at };
      if (v === null) return tick(at);
      if (v >= MOVING_SPEED) lastMoving = at;
      if (v >= DRIVE_SPEED) {
        fastSince ??= at;
        if (!driving && at - fastSince >= ENTER_MS) {
          driving = true;
          return true;
        }
        return false;
      }
      if (!driving) fastSince = null; // nog niet aan: het moet een halve minuut achter elkaar snel zijn
      return tick(at);
    },
  };
}

/** "Nu niet" geldt voor deze rit: tot de rit voorbij is, ook na herladen. `lastDriving` is het laatste moment van rijden met de melding weg. */
export const snoozeValid = (lastDriving, now) => typeof lastDriving === 'number' && now - lastDriving < EXIT_MS;

/**
 * De taken voor het scherm in de rijmodus: open hoofdtaken met een plek vlakbij (dichtstbij eerst) en die van
 * vandaag of te laat (vroegste eerst). `rest` telt de andere open hoofdtaken.
 * @param {any[]} tasks
 * @param {number} nowMs
 * @param {{ lat: number, lng: number } | null} pos
 */
export function driveTasks(tasks, nowMs, pos) {
  const p = zonedParts(nowMs);
  const end = startOfDay(p.y, p.m, p.d + 1);
  const open = tasks.filter((t) => !t.done && !t.deleted_at && !t.parent_id);
  const near = pos
    ? open.filter((t) => t.location && !t.location_notified)
      .map((t) => ({ t, d: distance(pos, t.location) }))
      .filter((x) => x.d <= NEAR_M)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.t)
    : [];
  const today = open
    .filter((t) => t.remind_at && Date.parse(t.remind_at) < end && !near.includes(t))
    .sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at));
  return { near, today, rest: open.length - near.length - today.length };
}
