import { KeyedError } from '../public/i18n.js';
import { getDefaultTime, getTimeZone, setTimeZone, zonedParts, zonedToUtc } from '../public/repeat.js';

/** ISO met tijdzone (Z of +hh:mm) blijft staan; zonder tijdzone geldt de ingestelde tijdzone (TIMEZONE). Een kale datum krijgt de ingestelde standaardtijd. */
export function localToUtcIso(s: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (isNaN(+d)) throw new KeyedError('err.invalid_date', { value: s });
    return d.toISOString();
  }
  const def = getDefaultTime();
  const bare = `${s}T${String(def.h).padStart(2, '0')}:${String(def.mi).padStart(2, '0')}:00Z`;
  const guess = new Date(Date.parse(s.length === 10 ? bare : `${s}Z`));
  if (isNaN(+guess)) throw new KeyedError('err.invalid_date', { value: s });
  const ms = zonedToUtc(guess.getUTCFullYear(), guess.getUTCMonth() + 1, guess.getUTCDate(), guess.getUTCHours(), guess.getUTCMinutes())
    + guess.getUTCSeconds() * 1000 + guess.getUTCMilliseconds();
  return new Date(ms).toISOString();
}

/**
 * Verschuift een UTC-moment naar de zone `toTz`, met dezelfde wandklok als in `fromTz`. De rekenmodule kent één
 * globale zone: die gaat tijdelijk om en daarna terug. Bestaat de wandklok niet in `toTz` (DST-gat), dan geeft
 * `zonedToUtc` het moment; seconden en milliseconden blijven staan.
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
