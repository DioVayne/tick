import { describe, expect, it } from 'vitest';
import { NUDGE_PAUSE_MS, nudgeFor } from '../public/nudge.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const base = {
  supported: true, permission: 'default', subscribed: false, iosNeedsHomeScreen: false, inApp: false,
  place: false, turnedOff: false, dismissedAt: null as number | null, now: NOW,
};

describe('balk "Zet meldingen aan" (nudgeFor)', () => {
  it('meldingen nog niet gevraagd: de aanzetknop', () => {
    expect(nudgeFor(base)).toBe('ask');
    expect(nudgeFor({ ...base, inApp: true })).toBe('ask');
    // toestemming wel, maar niet aangemeld (bijvoorbeeld na wissen van de site-gegevens)
    expect(nudgeFor({ ...base, permission: 'granted' })).toBe('ask');
  });

  it('meldingen aan: geen balk', () => {
    expect(nudgeFor({ ...base, permission: 'granted', subscribed: true })).toBeNull();
  });

  it('geblokkeerd: uitleg, in de app de route in de telefooninstellingen', () => {
    expect(nudgeFor({ ...base, permission: 'denied' })).toBe('blocked');
    expect(nudgeFor({ ...base, permission: 'denied', inApp: true })).toBe('app');
  });

  it('iPhone niet op het beginscherm: uitleg; zonder push helemaal geen balk', () => {
    expect(nudgeFor({ ...base, supported: false, permission: 'unsupported', iosNeedsHomeScreen: true })).toBe('ios');
    expect(nudgeFor({ ...base, supported: false, permission: 'unsupported' })).toBeNull();
  });

  it('een plek alleen in de Android-app (de browser meldt geen plekken)', () => {
    expect(nudgeFor({ ...base, place: true })).toBeNull();
    expect(nudgeFor({ ...base, place: true, inApp: true })).toBe('ask');
  });

  it('zelf uitgezet in Instellingen: geen balk', () => {
    expect(nudgeFor({ ...base, turnedOff: true })).toBeNull();
  });

  it('"Niet nu" geeft 30 dagen rust, daarna weer één keer', () => {
    expect(nudgeFor({ ...base, dismissedAt: NOW - 1000 })).toBeNull();
    expect(nudgeFor({ ...base, dismissedAt: NOW - NUDGE_PAUSE_MS + 1000 })).toBeNull();
    expect(nudgeFor({ ...base, dismissedAt: NOW - NUDGE_PAUSE_MS })).toBe('ask');
    expect(NUDGE_PAUSE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
