// Eén zone in de app: kiezen, tonen en de snelkeuzes rekenen in de ingestelde TIMEZONE, ook als het apparaat in een
// andere zone staat. De klok van het "apparaat" is hier die van de machine waarop de tests draaien (DEVICE); de tests
// met New York en Auckland rekenen in een andere zone, zodat wie de apparaatklok gebruikt zichtbaar fout rekent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dayKey, pickerDefault } from '../public/calendar.js';
import { setLocale } from '../public/i18n.js';
import { quickWhen } from '../public/planner.js';
import {
  fromWallInput, quickRules, describeRule, setDefaultTime, setTimeZone, setWeekStart, toWallInput, wallToUtc, zonedFormat, zonedParts,
} from '../public/repeat.js';

const reset = () => {
  setTimeZone('Europe/Amsterdam');
  setDefaultTime('09:00');
  setWeekStart('mon');
  setLocale('en');
};
beforeEach(reset);
afterEach(reset);

const iso = (ms: number) => new Date(ms).toISOString();
const DEVICE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const WHEN = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } as const;

describe('kiezen: wandklok in de ingestelde zone ↔ UTC', () => {
  it('maandag 20:00 in Amsterdam blijft overal maandag 20:00 (lijst, ritmemenu, kalender)', () => {
    const at = fromWallInput('2026-11-09T20:00');
    expect(at).toBe('2026-11-09T19:00:00.000Z');
    expect(toWallInput(at)).toBe('2026-11-09T20:00');
    expect(quickRules(at!)[1].rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(describeRule('FREQ=WEEKLY', at!)).toBe('Every week on Mon');
    expect(dayKey(Date.parse(at!))).toBe('2026-11-09');
    expect(zonedFormat('en-GB', WHEN).format(new Date(at!))).toMatch(/Mon.*9 Nov.*20:00/);
  });

  it('New York: maandag 20:00 is dinsdag in UTC, maar blijft maandag in de app', () => {
    setTimeZone('America/New_York');
    const at = fromWallInput('2026-11-09T20:00');
    expect(at).toBe('2026-11-10T01:00:00.000Z');
    expect(toWallInput(at)).toBe('2026-11-09T20:00');
    expect(quickRules(at!)[1].rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(dayKey(Date.parse(at!))).toBe('2026-11-09');
    expect(zonedFormat('en-GB', WHEN).format(new Date(at!))).toMatch(/Mon.*9 Nov.*20:00/);
  });

  it('leeg blijft leeg', () => {
    expect(toWallInput(null)).toBe('');
    expect(toWallInput('')).toBe('');
    expect(fromWallInput('')).toBeNull();
    expect(fromWallInput(null)).toBeNull();
    expect(toWallInput('geen datum')).toBe('');
    expect(fromWallInput('geen datum')).toBeNull();
  });

  it('met de zone van het apparaat precies als vroeger: new Date(wandklok) en de lokale getters, ook rond zomertijd', () => {
    setTimeZone(DEVICE);
    const p = (n: number) => String(n).padStart(2, '0');
    const old = (s: string) => { const d = new Date(s); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
    for (const s of ['2026-01-01T00:00:00.000Z', '2026-03-29T00:30:00.000Z', '2026-03-29T01:30:00.000Z', '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z', '2026-03-08T07:30:00.000Z', '2026-11-01T06:30:00.000Z', '2026-12-31T23:59:00.000Z', '2028-02-29T12:05:00.000Z']) {
      expect(toWallInput(s), s).toBe(old(s));
    }
    // ook de tijden die niet of twee keer bestaan (Amsterdam en New York)
    for (const w of ['2026-03-29T02:30', '2026-10-25T02:30', '2026-03-08T02:30', '2026-11-01T01:30', '2026-06-01T12:00', '2026-01-15T00:00']) {
      expect(fromWallInput(w), w).toBe(new Date(w).toISOString());
    }
  });

  it('de tests rekenen echt in een andere zone dan het apparaat', () => {
    expect(DEVICE).not.toBe('America/New_York');
    expect(DEVICE).not.toBe('Pacific/Auckland');
  });
});

describe('zomer- en wintertijd in Amsterdam', () => {
  it('29 maart 2026: 02:00-03:00 bestaat niet en schuift een uur op, net als in de browser', () => {
    expect(fromWallInput('2026-03-29T01:30')).toBe('2026-03-29T00:30:00.000Z');
    expect(fromWallInput('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z'); // = 03:30 zomertijd
    expect(fromWallInput('2026-03-29T03:00')).toBe('2026-03-29T01:00:00.000Z');
    expect(toWallInput('2026-03-29T01:30:00.000Z')).toBe('2026-03-29T03:30');
  });

  it('25 oktober 2026: 02:30 bestaat twee keer; kiezen geeft de eerste, net als de browser', () => {
    expect(fromWallInput('2026-10-25T02:30')).toBe('2026-10-25T00:30:00.000Z');
    expect(toWallInput('2026-10-25T00:30:00.000Z')).toBe('2026-10-25T02:30');
    expect(toWallInput('2026-10-25T01:30:00.000Z')).toBe('2026-10-25T02:30');
    expect(fromWallInput('2026-10-25T03:00')).toBe('2026-10-25T02:00:00.000Z');
  });

  it('heen en terug geeft dezelfde wandklok, elk kwartier van beide dagen (behalve het gat)', () => {
    const p = (n: number) => String(n).padStart(2, '0');
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26']) {
      for (let min = 0; min < 24 * 60; min += 15) {
        const wall = `${day}T${p(Math.floor(min / 60))}:${p(min % 60)}`;
        if (day === '2026-03-29' && min >= 120 && min < 180) continue;
        expect(toWallInput(fromWallInput(wall)), wall).toBe(wall);
      }
    }
  });

  it('wallToUtc en zonedParts zijn elkaars omgekeerde', () => {
    const ms = wallToUtc(2026, 10, 25, 9, 0);
    expect(iso(ms)).toBe('2026-10-25T08:00:00.000Z');
    expect(zonedParts(ms)).toMatchObject({ y: 2026, m: 10, d: 25, h: 9, mi: 0, wd: 6 });
  });

  it('een tijd tonen gebruikt de zone op dat moment, niet die van nu', () => {
    expect(zonedFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date('2026-03-29T00:30:00Z'))).toBe('01:30');
    expect(zonedFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date('2026-03-29T01:30:00Z'))).toBe('03:30');
  });
});

describe('snelkeuzes Vandaag, Morgen, Volgende week', () => {
  it('rekent vanaf de wandklok in de ingestelde zone', () => {
    // dinsdag 10 nov 2026 08:15 in Amsterdam
    expect(quickWhen(Date.parse('2026-11-10T07:15:00Z'))).toEqual({
      today: '2026-11-10T09:00', tomorrow: '2026-11-11T09:00', nextWeek: '2026-11-16T09:00', def: '09:00',
    });
  });

  it('na 23:00 in de zone geen Vandaag meer, ook al is het in UTC pas 22:30', () => {
    const q = quickWhen(Date.parse('2026-11-10T22:30:00Z')); // 23:30 in Amsterdam
    expect(q.today).toBeNull();
    expect(q.tomorrow).toBe('2026-11-11T09:00');
  });

  it('de nacht naar zomertijd: morgen 09:00 is in UTC een uur eerder dan de dag ervoor', () => {
    const q = quickWhen(Date.parse('2026-03-28T22:30:00Z')); // za 23:30 wintertijd
    expect(q.today).toBeNull();
    expect(q.tomorrow).toBe('2026-03-29T09:00');
    expect(fromWallInput(q.tomorrow)).toBe('2026-03-29T07:00:00.000Z');
    // zondag 01:30: het volgende hele uur (02:00) bestaat niet en wordt 03:00 zomertijd
    const night = quickWhen(Date.parse('2026-03-29T00:30:00Z'));
    expect(night.today).toBe('2026-03-29T02:00');
    expect(fromWallInput(night.today)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('de nacht naar wintertijd: het tweede 02:30 telt als 02:30', () => {
    const q = quickWhen(Date.parse('2026-10-25T01:30:00Z')); // 02:30 wintertijd
    expect(q.today).toBe('2026-10-25T03:00');
    expect(fromWallInput(q.today)).toBe('2026-10-25T02:00:00.000Z');
    expect(q.nextWeek).toBe('2026-10-26T09:00'); // zondag: volgende week begint morgen
  });

  it('over de datumgrens: Auckland is al dinsdag als UTC nog maandag is', () => {
    setTimeZone('Pacific/Auckland');
    const now = Date.parse('2026-11-09T20:00:00Z'); // ma 20:00 UTC = di 10 nov 09:00 NZDT
    expect(quickWhen(now)).toEqual({
      today: '2026-11-10T10:00', tomorrow: '2026-11-11T09:00', nextWeek: '2026-11-16T09:00', def: '09:00',
    });
    expect(fromWallInput('2026-11-10T10:00')).toBe('2026-11-09T21:00:00.000Z');
    expect(pickerDefault(zonedParts(now), { h: 9, mi: 0 })).toEqual({ day: '2026-11-10', time: '10:00' });
    expect(dayKey(now)).toBe('2026-11-10');
  });

  it('volgt de weekstart', () => {
    setWeekStart('sun');
    expect(quickWhen(Date.parse('2026-11-10T07:15:00Z')).nextWeek).toBe('2026-11-15T09:00');
  });

  it('en de standaardtijd', () => {
    setDefaultTime('07:30');
    const q = quickWhen(Date.parse('2026-11-10T07:15:00Z'));
    expect(q.tomorrow).toBe('2026-11-11T07:30');
    expect(q.def).toBe('07:30');
  });
});

describe('zonedFormat', () => {
  it('formatteert in de ingestelde zone en volgt een wissel van zone', () => {
    const d = new Date('2026-11-09T23:30:00Z');
    const f = { weekday: 'short', hour: '2-digit', minute: '2-digit' } as const;
    expect(zonedFormat('en-GB', f).format(d)).toBe('Tue 00:30');
    setTimeZone('America/New_York');
    expect(zonedFormat('en-GB', f).format(d)).toBe('Mon 18:30');
    setTimeZone('UTC');
    expect(zonedFormat('en-GB', f).format(d)).toBe('Mon 23:30');
  });

  it('een expliciete timeZone in de opties wint (voor een datum zonder tijd, als UTC opgeslagen)', () => {
    expect(zonedFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 9)))).toBe('9 Nov');
  });
});
