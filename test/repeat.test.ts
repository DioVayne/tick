import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ordinal, setLocale } from '../public/i18n.js';
import { describeRule, isSubDay, nextOccurrence, normalizeRule, occurrencesBetween, parseRule, quickRules, setTimeZone, untilOf, withUntil, zonedToUtc } from '../public/repeat.js';

const ZO_10 = '2026-10-18T08:00:00.000Z'; // zondag 18 okt 2026 10:00 CEST
const ms = (s: string) => Date.parse(s);

describe('parseRule', () => {
  it('normaliseert en weigert onzin', () => {
    expect(normalizeRule('freq=weekly;byday=su,mo;interval=2')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU');
    expect(normalizeRule('FREQ=DAILY;INTERVAL=1')).toBe('FREQ=DAILY');
    for (const bad of ['', 'FREQ=SECONDLY', 'FREQ=HOURLY;INTERVAL=0', 'FREQ=MINUTELY;INTERVAL=100', 'FREQ=HOURLY;BYDAY=MO', 'FREQ=MINUTELY;BYMONTHDAY=3', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=100', 'FREQ=WEEKLY;BYDAY=3SU',
      'FREQ=MONTHLY;BYDAY=SU', 'FREQ=MONTHLY;BYDAY=1SU,-1SU', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=YEARLY;BYDAY=SU', 'FREQ=DAILY;COUNT=3'])
      expect(() => parseRule(bad), bad).toThrow(/invalid repeat rule/);
  });
});

describe('nextOccurrence', () => {
  it('per uur en per minuut: vaste stappen vanaf de start, ook als er keren gemist zijn', () => {
    expect(normalizeRule('freq=hourly;interval=1')).toBe('FREQ=HOURLY');
    expect(nextOccurrence('FREQ=HOURLY', ZO_10, ms(ZO_10) - 1)).toBe(ZO_10);
    expect(nextOccurrence('FREQ=HOURLY', ZO_10, ms(ZO_10))).toBe('2026-10-18T09:00:00.000Z');
    expect(nextOccurrence('FREQ=HOURLY;INTERVAL=3', ZO_10, ms('2026-10-18T13:30:00Z'))).toBe('2026-10-18T14:00:00.000Z');
    expect(nextOccurrence('FREQ=MINUTELY;INTERVAL=15', ZO_10, ms('2026-10-18T08:15:00Z'))).toBe('2026-10-18T08:30:00.000Z');
    expect(nextOccurrence('FREQ=MINUTELY', ZO_10, ms('2026-10-18T08:00:30Z'))).toBe('2026-10-18T08:01:00.000Z');
    expect(nextOccurrence('FREQ=MINUTELY;INTERVAL=5', ZO_10, ms('2026-10-17T00:00:00Z'))).toBe(ZO_10); // niet vóór de start
  });
  it('einde met tijd: t/m die minuut, ook bij ritmes per dag', () => {
    expect(normalizeRule('FREQ=HOURLY;UNTIL=20261018T143000')).toBe('FREQ=HOURLY;UNTIL=20261018T143000');
    for (const bad of ['FREQ=HOURLY;UNTIL=20261018T2400', 'FREQ=HOURLY;UNTIL=20261018T246000', 'FREQ=HOURLY;UNTIL=20261018T143015', 'FREQ=HOURLY;UNTIL=20261018T1430'])
      expect(() => parseRule(bad), bad).toThrow(/invalid repeat rule/);
    const rule = 'FREQ=HOURLY;UNTIL=20261018T120000'; // t/m 12:00 Amsterdam = 10:00 UTC
    expect(nextOccurrence(rule, ZO_10, ms(ZO_10))).toBe('2026-10-18T09:00:00.000Z');
    expect(nextOccurrence(rule, ZO_10, ms('2026-10-18T09:00:00Z'))).toBe('2026-10-18T10:00:00.000Z'); // 12:00 telt nog mee
    expect(nextOccurrence(rule, ZO_10, ms('2026-10-18T10:00:00Z'))).toBeNull();
    expect(nextOccurrence('FREQ=MINUTELY;INTERVAL=20;UNTIL=20261018T105900', ZO_10, ms('2026-10-18T08:40:00Z'))).toBeNull(); // 11:00 is te laat
    // Per dag om 10:00 t/m 19 okt 09:00: de 19e valt al af.
    expect(nextOccurrence('FREQ=DAILY;UNTIL=20261019T090000', ZO_10, ms(ZO_10))).toBeNull();
    expect(nextOccurrence('FREQ=DAILY;UNTIL=20261019T100000', ZO_10, ms(ZO_10))).toBe('2026-10-19T08:00:00.000Z');
  });
  it('een start met seconden of milliseconden telt vanaf de hele minuut', () => {
    expect(nextOccurrence('FREQ=DAILY', '2026-10-18T08:00:00.312Z', ms('2026-10-18T07:00:00Z'))).toBe('2026-10-18T08:00:00.000Z');
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=SU', '2026-10-18T08:00:42Z', ms('2026-10-18T07:00:00Z'))).toBe('2026-10-18T08:00:00.000Z');
    expect(nextOccurrence('FREQ=HOURLY', '2026-10-18T08:00:14.428Z', ms('2026-10-18T08:30:00Z'))).toBe('2026-10-18T09:00:00.000Z');
  });
  it('per uur: over de wintertijd heen in echte uren, en stopt na de einddatum (wandklok)', () => {
    // 25 okt 2026 02:00 CEST → 02:00 CET: elk uur blijft 60 minuten.
    expect(nextOccurrence('FREQ=HOURLY', '2026-10-24T23:00:00.000Z', ms('2026-10-25T00:00:00Z'))).toBe('2026-10-25T01:00:00.000Z');
    const rule = 'FREQ=HOURLY;INTERVAL=6;UNTIL=20261018';
    expect(nextOccurrence(rule, ZO_10, ms(ZO_10))).toBe('2026-10-18T14:00:00.000Z'); // 16:00
    expect(nextOccurrence(rule, ZO_10, ms('2026-10-18T14:00:00Z'))).toBe('2026-10-18T20:00:00.000Z'); // 22:00
    expect(nextOccurrence(rule, ZO_10, ms('2026-10-18T20:00:00Z'))).toBeNull(); // 04:00 de dag erna
  });
  it('elke zondag 10:00, ook over de overgang naar wintertijd', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=SU', ZO_10, ms(ZO_10))).toBe('2026-10-25T09:00:00.000Z');
  });
  it('start telt zelf mee als hij na "after" ligt', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=SU', ZO_10, ms(ZO_10) - 1)).toBe(ZO_10);
  });
  it('elke 2 weken houdt de fase van de start vast, ook bij laat afvinken', () => {
    // woensdag 28 okt: de 25e was een tussenweek, dus 1 nov
    expect(nextOccurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', ZO_10, ms('2026-10-28T12:00:00Z'))).toBe('2026-11-01T09:00:00.000Z');
  });
  it('meerdere weekdagen', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-10-19T07:00:00.000Z', ms('2026-10-19T07:00:00Z'))).toBe('2026-10-21T07:00:00.000Z');
  });
  it('elke 3 dagen', () => {
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=3', ZO_10, ms(ZO_10))).toBe('2026-10-21T08:00:00.000Z');
  });
  it('de 31e valt in een korte maand op de laatste dag', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31T08:00:00.000Z', ms('2026-10-31T09:00:00Z'))).toBe('2026-11-30T08:00:00.000Z');
  });
  it('laatste zondag van de maand', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYDAY=-1SU', '2026-10-25T09:00:00.000Z', ms('2026-10-25T10:00:00Z'))).toBe('2026-11-29T09:00:00.000Z');
  });
  it('29 februari valt in een gewoon jaar op 28 februari', () => {
    expect(nextOccurrence('FREQ=YEARLY', '2028-02-29T08:00:00.000Z', ms('2028-03-01T00:00:00Z'))).toBe('2029-02-28T08:00:00.000Z');
  });
});

describe('einddatum (UNTIL)', () => {
  it('normaliseert en valideert', () => {
    expect(normalizeRule('until=20261101;freq=weekly;byday=su')).toBe('FREQ=WEEKLY;BYDAY=SU;UNTIL=20261101');
    expect(() => parseRule('FREQ=DAILY;UNTIL=20260231')).toThrow();
    expect(() => parseRule('FREQ=DAILY;UNTIL=2026-11-01')).toThrow();
  });
  it('de einddag telt mee, daarna is er geen volgende keer', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=SU;UNTIL=20261101';
    expect(nextOccurrence(rule, ZO_10, ms(ZO_10))).toBe('2026-10-25T09:00:00.000Z');
    expect(nextOccurrence(rule, ZO_10, ms('2026-10-25T09:00:00Z'))).toBe('2026-11-01T09:00:00.000Z');
    expect(nextOccurrence(rule, ZO_10, ms('2026-11-01T09:00:00Z'))).toBeNull();
    expect(occurrencesBetween(rule, ZO_10, ms(ZO_10), ms('2027-01-01T00:00:00Z'))).toHaveLength(3);
  });
  it('withUntil en untilOf', () => {
    expect(withUntil('FREQ=DAILY', '2026-12-31')).toBe('FREQ=DAILY;UNTIL=20261231');
    expect(withUntil('FREQ=HOURLY', '2026-12-31T17:30')).toBe('FREQ=HOURLY;UNTIL=20261231T173000');
    expect(untilOf('FREQ=HOURLY;UNTIL=20261231T173000')).toBe('2026-12-31T17:30');
    expect(withUntil('FREQ=HOURLY;UNTIL=20261231T173000', '')).toBe('FREQ=HOURLY');
    expect([isSubDay('FREQ=HOURLY'), isSubDay('FREQ=MINUTELY;INTERVAL=5'), isSubDay('FREQ=DAILY'), isSubDay(null), isSubDay('onzin')]).toEqual([true, true, false, false, false]);
    expect(withUntil('FREQ=DAILY;UNTIL=20261231', '')).toBe('FREQ=DAILY');
    expect(untilOf('FREQ=DAILY;UNTIL=20261231')).toBe('2026-12-31');
    expect(untilOf('FREQ=DAILY')).toBe('');
  });
  it('tekst noemt de einddatum', () => {
    setLocale('nl');
    expect(describeRule('FREQ=DAILY;UNTIL=20261231', ZO_10)).toBe('Elke dag, t/m 31 dec 2026');
    setLocale('en');
  });
});

describe('teksten', () => {
  beforeEach(() => { setLocale('nl'); });
  afterEach(() => { setLocale('en'); });

  it('beschrijft kort', () => {
    expect(describeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', ZO_10)).toBe('Elke 2 weken op zo');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,WE,FR', ZO_10)).toBe('Elke week op ma, wo, vr');
    expect(describeRule('FREQ=DAILY', ZO_10)).toBe('Elke dag');
    expect(describeRule('FREQ=MONTHLY;BYMONTHDAY=19', ZO_10)).toBe('Elke maand op de 19e');
    expect(describeRule('FREQ=MONTHLY;BYDAY=-1SU', ZO_10)).toBe('Elke maand op de laatste zo');
    expect(describeRule('FREQ=YEARLY', ZO_10)).toBe('Elk jaar op 18 okt');
    expect(describeRule('FREQ=HOURLY', ZO_10)).toBe('Elk uur');
    expect(describeRule('FREQ=HOURLY;INTERVAL=2', ZO_10)).toBe('Elke 2 uur');
    expect(describeRule('FREQ=MINUTELY', ZO_10)).toBe('Elke minuut');
    expect(describeRule('FREQ=MINUTELY;INTERVAL=30;UNTIL=20261231', ZO_10)).toBe('Elke 30 minuten, t/m 31 dec 2026');
    expect(describeRule('FREQ=HOURLY;UNTIL=20261231T170500', ZO_10)).toBe('Elk uur, t/m 31 dec 2026 17:05');
  });
  it('snelkeuzes volgen de startdatum', () => {
    expect(quickRules(ZO_10).map((q) => q.label)).toEqual(
      ['Elke dag', 'Elke week op zondag', 'Elke 2 weken op zondag', 'Elke maand op de 18e', 'Elk jaar op 18 okt']);
  });

  it('in het Engels', () => {
    setLocale('en');
    expect(describeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', ZO_10)).toBe('Every 2 weeks on Sun');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,WE,FR', ZO_10)).toBe('Every week on Mon, Wed, Fri');
    expect(describeRule('FREQ=DAILY;INTERVAL=3', ZO_10)).toBe('Every 3 days');
    expect(describeRule('FREQ=MONTHLY;BYMONTHDAY=22', ZO_10)).toBe('Every month on the 22nd');
    expect(describeRule('FREQ=MONTHLY;BYDAY=-1SU', ZO_10)).toBe('Every month on the last Sun');
    expect(describeRule('FREQ=YEARLY;INTERVAL=2', ZO_10)).toBe('Every 2 years on 18 Oct');
    expect(describeRule('FREQ=HOURLY', ZO_10)).toBe('Every hour');
    expect(describeRule('FREQ=HOURLY;INTERVAL=4', ZO_10)).toBe('Every 4 hours');
    expect(describeRule('FREQ=MINUTELY', ZO_10)).toBe('Every minute');
    expect(describeRule('FREQ=MINUTELY;INTERVAL=10', ZO_10)).toBe('Every 10 minutes');
    expect(describeRule('FREQ=HOURLY;INTERVAL=2;UNTIL=20261018T220000', ZO_10)).toBe('Every 2 hours, until 18 Oct 2026 22:00');
    expect(quickRules(ZO_10).map((q) => q.label)).toEqual(
      ['Every day', 'Every week on Sunday', 'Every 2 weeks on Sunday', 'Every month on the 18th', 'Every year on 18 Oct']);
  });

  it('rangtelwoorden', () => {
    setLocale('en');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31, -1].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st', 'last']);
    setLocale('nl');
    expect([1, 19, -1].map(ordinal)).toEqual(['1e', '19e', 'laatste']);
  });
});

describe('tijdzone', () => {
  afterEach(() => { setTimeZone('Europe/Amsterdam'); });

  it('rekent in een ingestelde zone', () => {
    setTimeZone('America/New_York');
    expect(new Date(zonedToUtc(2026, 1, 15, 9, 0)).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    // 09:00 blijft 09:00 over de overgang naar zomertijd (8 maart 2026 in New York)
    expect(nextOccurrence('FREQ=DAILY', '2026-01-15T14:00:00.000Z', ms('2026-03-08T15:00:00Z'))).toBe('2026-03-09T13:00:00.000Z');
  });

  it('valt terug op UTC bij een ongeldige of lege zone', () => {
    expect(setTimeZone('Europe/Amsterdm')).toBe('UTC');
    expect(setTimeZone(undefined)).toBe('UTC');
    expect(setTimeZone('')).toBe('UTC');
    expect(new Date(zonedToUtc(2026, 1, 15, 9, 0)).toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(setTimeZone('Europe/Amsterdam')).toBe('Europe/Amsterdam');
  });
});
