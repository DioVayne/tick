import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startOfDay } from '../public/calendar.js';
import { setTimeZone } from '../public/repeat.js';

// calendarview.js is een pagina van de app: de modules met DOM en opslag vallen hier weg (alleen busyByDay telt), en
// hij hangt bij het laden een toetsluisteraar aan document, dat de Workers-runtime niet heeft.
vi.mock('../public/detail.js', () => ({ selectTask() {} }));
vi.mock('../public/render.js', () => ({ $() {}, el() {}, render() {} }));
vi.mock('../public/sidebar.js', () => ({ closeDrawer() {} }));
vi.mock('../public/store.js', () => ({ state: {} }));
vi.mock('../public/agenda.js', () => ({ busyNow: () => null }));
let busyByDay: typeof import('../public/calendarview.js').busyByDay;
beforeAll(async () => {
  vi.stubGlobal('document', { addEventListener() {} });
  ({ busyByDay } = await import('../public/calendarview.js'));
  vi.unstubAllGlobals();
});

const H = 3_600_000;
const ev = (start: number, end: number, allDay = false) => ({ feed: 'f', title: 'Afspraak', start, end, allDay });
const days = (map: Map<string, { ms: number }[]>) => [...map.keys()].sort();

describe('kalender: afspraken uit een gekoppelde agenda per dag', () => {
  beforeAll(() => setTimeZone('Europe/Amsterdam'));
  const from = startOfDay(2026, 11, 1);
  const to = startOfDay(2026, 12, 1);

  it('een gewone afspraak staat op één dag, op zijn begintijd', () => {
    const start = startOfDay(2026, 11, 10) + 10 * H;
    const map = busyByDay([ev(start, start + H)], from, to);
    expect(days(map)).toEqual(['2026-11-10']);
    expect(map.get('2026-11-10')?.[0].ms).toBe(start);
  });

  it('over middernacht: op beide dagen, de tweede vanaf 00:00', () => {
    const start = startOfDay(2026, 11, 10) + 22 * H;
    const map = busyByDay([ev(start, start + 4 * H)], from, to);
    expect(days(map)).toEqual(['2026-11-10', '2026-11-11']);
    expect(map.get('2026-11-11')?.[0].ms).toBe(startOfDay(2026, 11, 11));
  });

  it('eindigt precies om middernacht: niet op de volgende dag', () => {
    const start = startOfDay(2026, 11, 10) + 22 * H;
    expect(days(busyByDay([ev(start, startOfDay(2026, 11, 11))], from, to))).toEqual(['2026-11-10']);
  });

  it('hele dagen: het einde is exclusief', () => {
    const one = ev(startOfDay(2026, 11, 10), startOfDay(2026, 11, 11), true);
    expect(days(busyByDay([one], from, to))).toEqual(['2026-11-10']);
    const three = ev(startOfDay(2026, 11, 10), startOfDay(2026, 11, 13), true);
    expect(days(busyByDay([three], from, to))).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('afgekapt op het zichtbare stuk, ook over de wintertijd heen', () => {
    // 25 oktober 2026 gaat de klok terug (een dag van 25 uur).
    const long = ev(startOfDay(2026, 10, 20), startOfDay(2026, 11, 3), true);
    expect(days(busyByDay([long], from, to))).toEqual(['2026-11-01', '2026-11-02']);
    expect(days(busyByDay([long], startOfDay(2026, 10, 24), startOfDay(2026, 10, 27))))
      .toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(days(busyByDay([ev(startOfDay(2026, 11, 29), startOfDay(2026, 12, 5), true)], from, to)))
      .toEqual(['2026-11-29', '2026-11-30']);
  });

  it('buiten het zichtbare stuk: niets; een afspraak zonder duur telt op zijn begin', () => {
    expect(busyByDay([ev(startOfDay(2026, 10, 1), from)], from, to).size).toBe(0);
    expect(busyByDay([ev(to, to + H)], from, to).size).toBe(0);
    const at = startOfDay(2026, 11, 5) + 9 * H;
    expect(days(busyByDay([ev(at, at)], from, to))).toEqual(['2026-11-05']);
  });
});
