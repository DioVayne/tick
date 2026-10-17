import { KeyedError } from '../public/i18n.js';
import { getDefaultTime, getTimeZone, setDefaultTime, setTimeZone, zonedParts, zonedToUtc } from '../public/repeat.js';

/** De zone en de standaardtijd van één gebruiker; elke tijdberekening in de Worker krijgt die mee. */
export type Zone = { timeZone: string; reminderTime: string };

const hhmm = (t: { h: number; mi: number }) => `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`;

/**
 * Voert `fn` uit met de zone en standaardtijd van `z` in de rekenmodule (`public/repeat.js`, gedeeld met de PWA, met één
 * globale zone) en zet daarna de vorige waarden terug. `fn` is synchroon: zonder `await` ertussen kan geen andere request
 * de globale waarde zien of veranderen.
 */
export function inZone<T>(z: Zone, fn: () => T): T {
  const prevZone = getTimeZone();
  const prevTime = hhmm(getDefaultTime());
  setTimeZone(z.timeZone);
  setDefaultTime(z.reminderTime);
  try {
    return fn();
  } finally {
    setTimeZone(prevZone);
    setDefaultTime(prevTime);
  }
}

/** ISO met tijdzone (Z of +hh:mm) blijft staan; zonder tijdzone geldt de zone van `z`. Een kale datum krijgt de standaardtijd van `z`. */
export function localToUtcIso(s: string, z: Zone): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (isNaN(+d)) throw new KeyedError('err.invalid_date', { value: s });
    return d.toISOString();
  }
  return inZone(z, () => {
    const def = getDefaultTime();
    const bare = `${s}T${hhmm(def)}:00Z`;
    const guess = new Date(Date.parse(s.length === 10 ? bare : `${s}Z`));
    if (isNaN(+guess)) throw new KeyedError('err.invalid_date', { value: s });
    const ms = zonedToUtc(guess.getUTCFullYear(), guess.getUTCMonth() + 1, guess.getUTCDate(), guess.getUTCHours(), guess.getUTCMinutes())
      + guess.getUTCSeconds() * 1000 + guess.getUTCMilliseconds();
    return new Date(ms).toISOString();
  });
}

/**
 * Verschuift een UTC-moment naar de zone `toTz`, met dezelfde wandklok als in `fromTz`. De rekenmodule kent één
 * globale zone: die gaat tijdelijk om (synchroon) en daarna terug. Bestaat de wandklok niet in `toTz` (DST-gat), dan
 * geeft `zonedToUtc` het moment; seconden en milliseconden blijven staan.
 */
export function shiftWallClock(iso: string, fromTz: string, toTz: string): string {
  const ms = Date.parse(iso);
  if (isNaN(ms)) throw new KeyedError('err.invalid_date', { value: iso });
  const prev = getTimeZone();
  try {
    setTimeZone(fromTz);
    const p = zonedParts(ms);
    setTimeZone(toTz);
    return new Date(zonedToUtc(p.y, p.m, p.d, p.h, p.mi) + (((ms % 60_000) + 60_000) % 60_000)).toISOString();
  } finally {
    setTimeZone(prev);
  }
}
