import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDetector, distance, driveTasks, ENTER_MS, EXIT_MS, NEAR_M, snoozeValid } from '../public/drive.js';
import { setTimeZone } from '../public/repeat.js';

const T0 = Date.parse('2026-11-02T10:00:00Z');
/** Een locatie met de snelheid van de telefoon (m/s), op `s` seconden na T0. */
const fix = (s: number, speed: number | null, extra: object = {}) => ({ lat: 52, lng: 5, accuracy: 10, speed, at: T0 + s * 1000, ...extra });

describe('rijden herkennen', () => {
  it('gaat aan na een halve minuut achter elkaar snel, niet eerder', () => {
    const d = createDetector();
    expect(d.update(fix(0, 15))).toBe(false);
    expect(d.update(fix(20, 15))).toBe(false);
    expect(d.update(fix(ENTER_MS / 1000, 15))).toBe(true);
    expect(d.driving).toBe(true);
  });

  it('even langzaam vóór de halve minuut begint opnieuw (fietsen, een stukje hardlopen)', () => {
    const d = createDetector();
    d.update(fix(0, 15));
    d.update(fix(20, 2));
    d.update(fix(31, 15));
    expect(d.driving).toBe(false);
    d.update(fix(61, 15));
    expect(d.driving).toBe(true);
  });

  it('wandelen of fietsen zet hem niet aan', () => {
    const d = createDetector();
    for (let s = 0; s <= 120; s += 10) d.update(fix(s, 5));
    expect(d.driving).toBe(false);
  });

  it('zonder snelheid van de telefoon: berekend uit de afstand tussen twee locaties', () => {
    const d = createDetector();
    // 0,0005 graad breedte is ruim 55 m; elke 5 s is dat ruim 11 m/s (40 km/u).
    for (let i = 0; i <= 7; i++) d.update(fix(i * 5, null, { lat: 52 + i * 0.0005 }));
    expect(d.driving).toBe(true);
  });

  it('onnauwkeurige locaties tellen niet mee', () => {
    const d = createDetector();
    for (let s = 0; s <= 60; s += 10) d.update(fix(s, 20, { accuracy: 500 }));
    expect(d.driving).toBe(false);
  });

  it('een stoplicht houdt hem aan; drie minuten stil zet hem uit, ook zonder nieuwe locatie', () => {
    const d = createDetector();
    d.update(fix(0, 15));
    d.update(fix(30, 15));
    expect(d.update(fix(60, 0))).toBe(false); // stoplicht
    expect(d.update(fix(120, 12))).toBe(false); // weer rijden
    expect(d.tick(T0 + 120_000 + EXIT_MS - 1000)).toBe(false);
    expect(d.tick(T0 + 120_000 + EXIT_MS)).toBe(true);
    expect(d.driving).toBe(false);
  });

  it('in de file (langzaam, maar boven loopsnelheid) blijft hij aan', () => {
    const d = createDetector();
    d.update(fix(0, 15));
    d.update(fix(30, 15));
    for (let s = 60; s <= 600; s += 30) d.update(fix(s, 4.5));
    expect(d.driving).toBe(true);
  });
});

describe('"Nu niet"', () => {
  it('geldt tot de rit voorbij is', () => {
    expect(snoozeValid(T0, T0 + 60_000)).toBe(true);
    expect(snoozeValid(T0, T0 + EXIT_MS)).toBe(false);
    expect(snoozeValid(NaN, T0)).toBe(false);
  });
});

describe('taken in de rijmodus', () => {
  beforeEach(() => setTimeZone('Europe/Amsterdam'));
  afterEach(() => setTimeZone('Europe/Amsterdam'));

  const here = { lat: 52.0907, lng: 5.1214 }; // Utrecht
  const task = (id: string, extra: object = {}) => ({ id, title: id, done: false, deleted_at: null, parent_id: null, remind_at: null, location: null, location_notified: false, ...extra });
  const now = Date.parse('2026-11-02T10:00:00Z'); // 11:00 in Amsterdam

  it('vlakbij (dichtstbij eerst), dan vandaag en te laat (vroegste eerst); de rest geteld', () => {
    const tasks = [
      task('ver weg', { location: { name: 'Amsterdam', lat: 52.37, lng: 4.89, radius: 100 } }),
      task('om de hoek', { location: { name: 'Bakker', lat: 52.091, lng: 5.122, radius: 100 } }),
      task('iets verder', { location: { name: 'Markt', lat: 52.1, lng: 5.12, radius: 100 } }),
      task('vanavond', { remind_at: '2026-11-02T18:00:00Z' }),
      task('te laat', { remind_at: '2026-10-30T08:00:00Z' }),
      task('morgen', { remind_at: '2026-11-03T08:00:00Z' }),
      task('af', { done: true, remind_at: '2026-11-02T09:00:00Z' }),
      task('subtaak', { parent_id: 'x', remind_at: '2026-11-02T09:00:00Z' }),
    ];
    const r = driveTasks(tasks, now, here);
    expect(r.near.map((t) => t.id)).toEqual(['om de hoek', 'iets verder']);
    expect(r.today.map((t) => t.id)).toEqual(['te laat', 'vanavond']);
    expect(r.rest).toBe(2); // ver weg, morgen
  });

  it('een taak met plek én datum vandaag staat één keer, onder vlakbij; een al gemelde plek niet', () => {
    const loc = { name: 'Bakker', lat: 52.091, lng: 5.122, radius: 100 };
    const r = driveTasks([task('beide', { location: loc, remind_at: '2026-11-02T12:00:00Z' }), task('gemeld', { location: loc, location_notified: true })], now, here);
    expect(r.near.map((t) => t.id)).toEqual(['beide']);
    expect(r.today).toEqual([]);
  });

  it('zonder locatie geen vlakbij', () => {
    expect(driveTasks([task('a', { location: { name: 'x', lat: 52.091, lng: 5.122, radius: 100 } })], now, null).near).toEqual([]);
  });

  it('afstand klopt ongeveer en de grens is ' + NEAR_M + ' m', () => {
    expect(Math.round(distance({ lat: 52, lng: 5 }, { lat: 53, lng: 5 }) / 1000)).toBe(111);
  });
});
