import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { suggest } from '../public/planner.js';
import { setDefaultTime, setTimeZone } from '../public/repeat.js';

const reset = () => {
  setTimeZone('Europe/Amsterdam');
  setDefaultTime('09:00');
};
beforeEach(reset);
afterEach(reset);

describe('suggest', () => {
  it('vóór de standaardtijd: vandaag, morgen, volgende week', async () => {
    const slots = await suggest({}, { now: Date.parse('2026-11-03T07:00:00Z') });
    expect(slots.map((s) => s.at)).toEqual(['2026-11-03T08:00:00.000Z', '2026-11-04T08:00:00.000Z', '2026-11-09T08:00:00.000Z']);
    expect(slots.every((s) => s.source === 'fixed' && s.label)).toBe(true);
  });

  it('na de standaardtijd: geen vandaag', async () => {
    const slots = await suggest({}, { now: Date.parse('2026-11-03T09:00:00Z') });
    expect(slots).toHaveLength(2);
    expect(slots[0].at).toBe('2026-11-04T08:00:00.000Z');
  });

  it('precies op de standaardtijd: geen vandaag', async () => {
    const slots = await suggest({}, { now: Date.parse('2026-11-03T08:00:00Z') });
    expect(slots).toHaveLength(2);
    expect(slots[0].at).toBe('2026-11-04T08:00:00.000Z');
  });

  it('volgt de ingestelde zone, niet UTC', async () => {
    setTimeZone('Pacific/Auckland');
    const slots = await suggest({}, { now: Date.parse('2026-11-03T22:00:00Z') });
    expect(slots[0].at).toBe('2026-11-04T20:00:00.000Z');
  });

  it('is async', () => {
    expect(suggest({})).toBeInstanceOf(Promise);
  });
});
