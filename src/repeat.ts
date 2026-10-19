import { badRequest, HttpError } from './errors';
import { getDefaultTime, zonedParts, zonedToUtc, nextOccurrence, normalizeRule } from '../public/repeat.js';
import { inZone, type Zone } from './time';

export type Repeat = { rule: string; start: string; at: string };

/** Vandaag op de standaardtijd in de zone van `z` als ISO UTC: de start van een ritme zonder reminder. */
export function todayDefaultIso(z: Zone, nowMs: number = Date.now()): string {
  return inZone(z, () => {
    const p = zonedParts(nowMs);
    const { h, mi } = getDefaultTime();
    return new Date(zonedToUtc(p.y, p.m, p.d, h, mi)).toISOString();
  });
}

/**
 * De repeat_*-kolommen voor een INSERT of UPDATE. Een regel zet het ritme (genormaliseerd, `at` = eerste keer
 * vanaf nu, in de zone van `z`; een einddatum die al voorbij is geeft een 400); null wist alles. repeat_prev gaat altijd leeg: een nieuw of gewist ritme heeft niets om terug te draaien.
 */
export function repeatColumns(rule: string | null, startIso: string | null, z: Zone): Record<string, unknown> {
  if (rule === null) return { repeat_rule: null, repeat_start: null, repeat_at: null, repeat_prev: null };
  if (typeof rule !== 'string') throw new HttpError(400, 'err.repeat_type');
  try {
    const normalized = normalizeRule(rule);
    const start = startIso ?? todayDefaultIso(z);
    const at = inZone(z, () => nextOccurrence(normalized, start, Date.now() - 1));
    if (at === null) throw new HttpError(400, 'err.repeat_ended');
    return { repeat_rule: normalized, repeat_start: start, repeat_at: at, repeat_prev: null };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest(e, 'err.invalid_rule', { value: rule });
  }
}

/** Bouwt het repeat-object uit een taakrij; null als er geen ritme is. */
export function repeatFromRow(row: { repeat_rule: string | null; repeat_start: string | null; repeat_at: string | null }): Repeat | null {
  if (row.repeat_rule === null || row.repeat_start === null || row.repeat_at === null) return null;
  return { rule: row.repeat_rule, start: row.repeat_start, at: row.repeat_at };
}
