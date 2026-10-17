import { describe, expect, it } from 'vitest';
import { getTimeZone } from '../public/repeat.js';
import { inZone, localToUtcIso } from '../src/time';

const AMS = { timeZone: 'Europe/Amsterdam', reminderTime: '09:00' };
const NY = { timeZone: 'America/New_York', reminderTime: '09:00' };

describe('localToUtcIso', () => {
  it('volgt de meegegeven tijdzone', () => {
    expect(localToUtcIso('2026-11-03', NY)).toBe('2026-11-03T14:00:00.000Z');
  });

  it('rekent wintertijd (CET, UTC+1) om', () => {
    expect(localToUtcIso('2026-01-15T09:00:00', AMS)).toBe('2026-01-15T08:00:00.000Z');
  });

  it('rekent zomertijd (CEST, UTC+2) om', () => {
    expect(localToUtcIso('2026-07-15T09:00:00', AMS)).toBe('2026-07-15T07:00:00.000Z');
  });

  it('maakt van een kale datum de standaardtijd in de zone', () => {
    expect(localToUtcIso('2026-11-03', AMS)).toBe('2026-11-03T08:00:00.000Z');
    expect(localToUtcIso('2026-06-03', AMS)).toBe('2026-06-03T07:00:00.000Z');
    expect(localToUtcIso('2026-06-03', { ...AMS, reminderTime: '07:30' })).toBe('2026-06-03T05:30:00.000Z');
  });

  it('klopt rond de overgangen naar zomer- en wintertijd', () => {
    expect(localToUtcIso('2026-03-29T03:30:00', AMS)).toBe('2026-03-29T01:30:00.000Z');
    expect(localToUtcIso('2026-10-25T12:00:00', AMS)).toBe('2026-10-25T11:00:00.000Z');
  });

  it('laat tijden met een zone ongemoeid', () => {
    expect(localToUtcIso('2026-01-15T09:00:00Z', NY)).toBe('2026-01-15T09:00:00.000Z');
    expect(localToUtcIso('2026-01-15T09:00:00+02:00', NY)).toBe('2026-01-15T07:00:00.000Z');
  });

  it('weigert ongeldige invoer', () => {
    expect(() => localToUtcIso('morgen', AMS)).toThrow(/invalid date/);
    expect(() => localToUtcIso('2026-13-45T25:00:00Z', AMS)).toThrow(/invalid date/);
  });
});

describe('inZone', () => {
  it('zet de vorige zone terug, ook na een fout', () => {
    const before = getTimeZone();
    expect(inZone(NY, () => getTimeZone())).toBe('America/New_York');
    expect(() => inZone(NY, () => { throw new Error('x'); })).toThrow('x');
    expect(getTimeZone()).toBe(before);
    expect(localToUtcIso('2026-11-03', { ...AMS, reminderTime: '07:30' })).toBe('2026-11-03T06:30:00.000Z');
    expect(localToUtcIso('2026-11-03', AMS)).toBe('2026-11-03T08:00:00.000Z'); // standaardtijd ook terug
  });
});
