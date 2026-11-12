import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { busyAt, calendarSlots, freeFrom, suggest } from '../public/planner.js';
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

describe('agenda als bron', () => {
  const Z = (s: string) => Date.parse(s);
  // Di 10 nov 2026, Amsterdam (UTC+1). Bezet 08:00-13:00 en 18:00-19:00 lokaal; zaterdag een hele dag (telt niet).
  const busy = [
    { start: Z('2026-11-10T07:00:00Z'), end: Z('2026-11-10T12:00:00Z'), title: 'Werk', allDay: false },
    { start: Z('2026-11-10T17:00:00Z'), end: Z('2026-11-10T18:00:00Z'), title: 'Sport', allDay: false },
    { start: Z('2026-11-13T23:00:00Z'), end: Z('2026-11-14T23:00:00Z'), title: 'Verjaardag', allDay: true },
  ];

  it('calendarSlots: eerstvolgende vrije moment, een avond en een weekend, 30 minuten', () => {
    const slots = calendarSlots(busy, Z('2026-11-10T07:00:00Z'));
    expect(slots.map((s) => s.at)).toEqual(['2026-11-10T12:00:00.000Z', '2026-11-10T18:00:00.000Z', '2026-11-14T07:00:00.000Z']);
    expect(slots.every((s) => s.source === 'calendar' && s.label.includes(':'))).toBe(true);
  });

  it('calendarSlots: niet midden in de nacht', () => {
    const slots = calendarSlots([], Z('2026-11-10T21:50:00Z'));
    expect(slots[0].at).toBe('2026-11-11T07:00:00.000Z');
  });

  it('calendarSlots: een blok van 30 minuten past niet in een gat van 20', () => {
    const gap = [
      { start: Z('2026-11-10T07:00:00Z'), end: Z('2026-11-10T09:10:00Z'), title: 'A', allDay: false },
      { start: Z('2026-11-10T09:30:00Z'), end: Z('2026-11-10T11:00:00Z'), title: 'B', allDay: false },
    ];
    expect(calendarSlots(gap, Z('2026-11-10T07:00:00Z'))[0].at).toBe('2026-11-10T11:00:00.000Z');
  });

  it('busyAt: het event dat het halfuur raakt, hele dagen niet', () => {
    expect(busyAt(Z('2026-11-10T11:45:00Z'), busy)?.title).toBe('Werk');
    expect(busyAt(Z('2026-11-10T12:00:00Z'), busy)).toBeNull();
    expect(busyAt(Z('2026-11-14T09:00:00Z'), busy)).toBeNull();
  });

  it('suggest met agenda: eerst de vrije momenten, vaste voorstellen zeggen wat er dan bezet is', async () => {
    const meeting = [{ start: Z('2026-11-11T07:30:00Z'), end: Z('2026-11-11T09:00:00Z'), title: 'Overleg', allDay: false }];
    const slots = await suggest({}, { now: Z('2026-11-10T09:00:00Z'), busy: meeting });
    expect(slots[0].source).toBe('calendar');
    const tomorrow = slots.find((s) => s.source === 'fixed' && s.at === '2026-11-11T08:00:00.000Z');
    expect(tomorrow?.busy).toBe('Overleg');
    expect(new Set(slots.map((s) => s.at)).size).toBe(slots.length);
  });

  it('suggest zonder agenda (null): alleen de vaste voorstellen', async () => {
    const slots = await suggest({}, { now: Z('2026-11-10T09:00:00Z'), busy: null });
    expect(slots.every((s) => s.source === 'fixed' && !s.busy)).toBe(true);
  });
});

describe('freeFrom: snelkeuzes van het herinneringsmenu vallen nooit op een afspraak', () => {
  const at = (s: string) => Date.parse(s);
  const ev = (start: string, end: string, allDay = false) => ({ start: at(start), end: at(end), title: 'Overleg', allDay });

  it('vrij: blijft staan', () => {
    expect(freeFrom(at('2026-11-13T08:00:00Z'), [ev('2026-11-13T10:00:00Z', '2026-11-13T11:00:00Z')])).toBe(at('2026-11-13T08:00:00Z'));
  });

  it('op een afspraak: naar het einde, op een kwartier naar boven', () => {
    const busy = [ev('2026-11-13T08:00:00Z', '2026-11-13T08:40:00Z')];
    expect(freeFrom(at('2026-11-13T08:00:00Z'), busy)).toBe(at('2026-11-13T08:45:00Z'));
  });

  it('aaneengesloten afspraken: voorbij allemaal', () => {
    const busy = [ev('2026-11-13T08:00:00Z', '2026-11-13T09:00:00Z'), ev('2026-11-13T09:00:00Z', '2026-11-13T10:30:00Z')];
    expect(freeFrom(at('2026-11-13T08:00:00Z'), busy)).toBe(at('2026-11-13T10:30:00Z'));
  });

  it('dag vol tot na 21:30 (Amsterdam): null', () => {
    expect(freeFrom(at('2026-11-13T08:00:00Z'), [ev('2026-11-13T07:00:00Z', '2026-11-13T21:00:00Z')])).toBeNull();
  });

  it('een afspraak van een hele dag blokkeert niets', () => {
    const busy = [ev('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z', true)];
    expect(freeFrom(at('2026-11-13T08:00:00Z'), busy)).toBe(at('2026-11-13T08:00:00Z'));
  });
});
