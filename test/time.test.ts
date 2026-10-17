import { afterEach, describe, expect, it } from 'vitest';
import { setTimeZone } from '../public/repeat.js';
import { localToUtcIso } from '../src/time';

describe('localToUtcIso', () => {
  afterEach(() => { setTimeZone('Europe/Amsterdam'); });

  it('volgt de ingestelde tijdzone', () => {
    setTimeZone('America/New_York');
    expect(localToUtcIso('2026-11-03')).toBe('2026-11-03T14:00:00.000Z');
  });

  it('rekent wintertijd (CET, UTC+1) om', () => {
    expect(localToUtcIso('2026-01-15T09:00:00')).toBe('2026-01-15T08:00:00.000Z');
  });

  it('rekent zomertijd (CEST, UTC+2) om', () => {
    expect(localToUtcIso('2026-07-15T09:00:00')).toBe('2026-07-15T07:00:00.000Z');
  });

  it('maakt van een kale datum 09:00 Amsterdam', () => {
    expect(localToUtcIso('2026-11-03')).toBe('2026-11-03T08:00:00.000Z');
    expect(localToUtcIso('2026-06-03')).toBe('2026-06-03T07:00:00.000Z');
  });

  it('klopt rond de overgangen naar zomer- en wintertijd', () => {
    expect(localToUtcIso('2026-03-29T03:30:00')).toBe('2026-03-29T01:30:00.000Z');
    expect(localToUtcIso('2026-10-25T12:00:00')).toBe('2026-10-25T11:00:00.000Z');
  });

  it('laat tijden met een zone ongemoeid', () => {
    expect(localToUtcIso('2026-01-15T09:00:00Z')).toBe('2026-01-15T09:00:00.000Z');
    expect(localToUtcIso('2026-01-15T09:00:00+02:00')).toBe('2026-01-15T07:00:00.000Z');
  });

  it('weigert ongeldige invoer', () => {
    expect(() => localToUtcIso('morgen')).toThrow(/invalid date/);
    expect(() => localToUtcIso('2026-13-45T25:00:00Z')).toThrow(/invalid date/);
  });
});
