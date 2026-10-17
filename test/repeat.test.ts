import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ordinal, setLocale } from '../public/i18n.js';
import { describeRule, nextOccurrence, normalizeRule, parseRule, quickRules, setTimeZone, zonedToUtc } from '../public/repeat.js';

const ZO_10 = '2026-10-18T08:00:00.000Z'; // zondag 18 okt 2026 10:00 CEST
const ms = (s: string) => Date.parse(s);

describe('parseRule', () => {
  it('normaliseert en weigert onzin', () => {
    expect(normalizeRule('freq=weekly;byday=su,mo;interval=2')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU');
    expect(normalizeRule('FREQ=DAILY;INTERVAL=1')).toBe('FREQ=DAILY');
    for (const bad of ['', 'FREQ=HOURLY', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=100', 'FREQ=WEEKLY;BYDAY=3SU',
      'FREQ=MONTHLY;BYDAY=SU', 'FREQ=MONTHLY;BYDAY=1SU,-1SU', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=YEARLY;BYDAY=SU', 'FREQ=DAILY;COUNT=3'])
      expect(() => parseRule(bad), bad).toThrow(/invalid repeat rule/);
  });
});

describe('nextOccurrence', () => {
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
