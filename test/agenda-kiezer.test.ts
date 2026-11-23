import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allDayTitles, dayEvents, daySlots, gridDays, MAX_DAYS, openHour, PAGE_DAYS, SLOTS_PER_DAY, tipSet } from '../public/agendagrid.js';
import { setTimeZone } from '../public/repeat.js';
import { WINDOW_DAYS } from '../src/calendar';

const reset = () => setTimeZone('Europe/Amsterdam');
beforeEach(reset);
afterEach(reset);

// Maandag 23 november 2026, 10:40 in Amsterdam (09:40 UTC).
const NOW = Date.parse('2026-11-23T09:40:00Z');
const ams = (s: string) => Date.parse(s + '+01:00');
const busy = [
  { start: ams('2026-11-23T11:00:00'), end: ams('2026-11-23T12:30:00'), title: 'Overleg', allDay: false },
  { start: ams('2026-11-23T11:30:00'), end: ams('2026-11-23T12:00:00'), title: 'Bellen', allDay: false },
  { start: ams('2026-11-23T15:00:00'), end: ams('2026-11-23T16:00:00'), title: 'Klant', allDay: false },
  { start: ams('2026-11-24T00:00:00'), end: ams('2026-11-25T00:00:00'), title: 'Thuiswerkdag', allDay: true },
  { start: ams('2026-11-24T23:00:00'), end: ams('2026-11-25T01:00:00'), title: 'Feest', allDay: false },
];

describe('agenda-kiezer: dagen', () => {
  it('begint vandaag in de ingestelde zone, met begin en eind van elke dag', () => {
    const days = gridDays(NOW, 3);
    expect(days.map((d) => d.key)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
    expect(days[0].start).toBe(ams('2026-11-23T00:00:00'));
    expect(days[0].end).toBe(days[1].start);
    expect(days[0].wd).toBe(0); // maandag
  });

  it('kijkt niet verder vooruit dan de server afspraken bewaart', () => {
    expect(MAX_DAYS).toBe(WINDOW_DAYS);
    expect(MAX_DAYS % PAGE_DAYS).toBe(0);
  });

  it('volgt de zone, niet de klok van het apparaat', () => {
    setTimeZone('America/New_York');
    expect(gridDays(Date.parse('2026-11-23T03:00:00Z'), 1)[0].key).toBe('2026-11-22');
  });
});

describe('agenda-kiezer: halve uren', () => {
  it('de hele dag, verleden niet te kiezen, afspraken alleen ter informatie', () => {
    const [today] = gridDays(NOW, 1);
    const slots = daySlots(today, { busy, now: NOW });
    expect(slots).toHaveLength(SLOTS_PER_DAY);
    expect(slots[0]).toMatchObject({ h: 0, mi: 0, past: true });
    expect(slots[20]).toMatchObject({ h: 10, mi: 0, past: true });
    expect(slots[21]).toMatchObject({ h: 10, mi: 30, past: true, busy: null }); // al begonnen
    expect(slots[22]).toMatchObject({ h: 11, mi: 0, past: false });
    expect(slots[22].busy?.title).toBe('Overleg');
    expect(slots[47]).toMatchObject({ h: 23, mi: 30, past: false });
  });

  it('een taak staat in het halfuur van zijn herinnering', () => {
    const [today] = gridDays(NOW, 1);
    const slots = daySlots(today, { now: NOW, tasks: [{ at: ams('2026-11-23T17:15:00'), title: 'Plantjes' }] });
    expect(slots[34].task).toBe('Plantjes');
    expect(slots.filter((s) => s.task)).toHaveLength(1);
  });

  it('de voorstellen van de planner zijn gemarkeerd', () => {
    const tips = tipSet(busy, NOW);
    expect(tips.size).toBeGreaterThan(0);
    const [today] = gridDays(NOW, 1);
    const slots = daySlots(today, { busy, now: NOW, tips });
    const first = slots.find((s) => s.tip);
    expect(first && first.at).toBe(Math.min(...tips));
    expect(tipSet(null, NOW).size).toBe(0);
  });

  it('een zomertijdwissel volgt de wandklok', () => {
    const [d] = gridDays(Date.parse('2026-03-29T00:30:00Z'), 1); // de nacht dat de klok vooruit gaat
    const slots = daySlots(d, { now: 0 });
    expect(slots).toHaveLength(SLOTS_PER_DAY);
    expect(new Set(slots.map((s) => s.at)).size).toBeLessThanOrEqual(SLOTS_PER_DAY);
  });
});

describe('agenda-kiezer: afspraken', () => {
  it('plek in halve uren; overlappende afspraken naast elkaar', () => {
    const [today] = gridDays(NOW, 1);
    const evs = dayEvents(today, busy);
    expect(evs.map((e) => e.title)).toEqual(['Overleg', 'Bellen', 'Klant']);
    expect(evs[0]).toMatchObject({ top: 22, len: 3, lane: 0, lanes: 2 });
    expect(evs[1]).toMatchObject({ top: 23, len: 1, lane: 1, lanes: 2 });
    expect(evs[2]).toMatchObject({ top: 30, len: 2, lane: 0, lanes: 1 });
  });

  it('over middernacht: op beide dagen, afgekapt', () => {
    const [, tue, wed] = gridDays(NOW, 3);
    expect(dayEvents(tue, busy)).toEqual([expect.objectContaining({ title: 'Feest', top: 46, len: 2 })]);
    expect(dayEvents(wed, busy)).toEqual([expect.objectContaining({ title: 'Feest', top: 0, len: 2 })]);
  });

  it('een hele dag is een strookje, geen blok', () => {
    const [mon, tue] = gridDays(NOW, 2);
    expect(allDayTitles(tue, busy)).toEqual(['Thuiswerkdag']);
    expect(allDayTitles(mon, busy)).toEqual([]);
    expect(dayEvents(tue, busy).some((e) => e.title === 'Thuiswerkdag')).toBe(false);
  });
});

describe('agenda-kiezer: waar hij opent', () => {
  it('een uur voor de keuze', () => {
    expect(openHour(ams('2026-11-25T14:30:00'), NOW)).toBe(13);
  });
  it('zonder keuze een uur voor nu, niet vóór 06:00, behalve midden in de nacht', () => {
    expect(openHour(null, NOW)).toBe(9);
    expect(openHour(null, ams('2026-11-23T06:20:00'))).toBe(6);
    expect(openHour(null, ams('2026-11-23T02:10:00'))).toBe(2);
  });
});
