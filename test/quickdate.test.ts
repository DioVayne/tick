import { beforeEach, describe, expect, it } from 'vitest';
import { findDate } from '../public/quickdate.js';
import { setDefaultTime, setTimeZone, setWeekStart } from '../public/repeat.js';

// Datum uit de tekst ("quickdate"): datum en tijd uit de getypte titel.
const WO_1030 = Date.parse('2026-11-18T09:30:00Z'); // woensdag 18 nov 2026 10:30 in Amsterdam
const find = (text: string, now = WO_1030) => findDate(text, now);

describe('quickdate: datum uit de titel', () => {
  beforeEach(() => { setTimeZone('Europe/Amsterdam'); setDefaultTime('09:00'); setWeekStart('mon'); });

  it('morgen met tijd, en de woorden gaan uit de titel', () => {
    expect(find('tandarts bellen morgen 15:00')).toEqual({ value: '2026-11-19T15:00', title: 'tandarts bellen', match: 'morgen 15:00' });
    expect(find('ochtendgymnastiek morgen bespreken')).toMatchObject({ value: '2026-11-19T09:00', title: 'ochtendgymnastiek bespreken' });
    expect(find('call mom tomorrow at 3pm')).toMatchObject({ value: '2026-11-19T15:00', title: 'call mom' });
  });

  it('geen woord in een ander woord', () => {
    expect(find('goedemorgen zeggen')).toBeNull();
    expect(find('de morgens zijn koud')).toBeNull();
    expect(find('boodschappen')).toBeNull();
  });

  it('vier cijfers: alleen met om/at of naast een datum', () => {
    expect(find('vergadering om 1500')).toMatchObject({ value: '2026-11-18T15:00', title: 'vergadering' });
    expect(find('vergadering morgen 1500')).toMatchObject({ value: '2026-11-19T15:00', title: 'vergadering' });
    expect(find('1500 flyers bestellen')).toBeNull();
    expect(find('bel om 2575')).toBeNull();
  });

  it('weekdagen, volgende week, over …', () => {
    expect(find('op vrijdag sporten')).toMatchObject({ value: '2026-11-20T09:00', title: 'sporten' });
    expect(find('woensdag vergadering')).toMatchObject({ value: '2026-11-25T09:00' }); // vandaag is woensdag: de volgende
    expect(find('volgende week opruimen')).toMatchObject({ value: '2026-11-23T09:00', title: 'opruimen' });
    expect(find('volgende week vrijdag feest')).toMatchObject({ value: '2026-11-27T09:00', title: 'feest' });
    expect(find('overmorgen boodschappen')).toMatchObject({ value: '2026-11-20T09:00' });
    expect(find('over 3 dagen terugbellen')).toMatchObject({ value: '2026-11-21T09:00', title: 'terugbellen' });
    expect(find('over 2 uur oven uit')).toMatchObject({ value: '2026-11-18T12:30', title: 'oven uit' });
    expect(find('over een kwartier thee')).toMatchObject({ value: '2026-11-18T10:45' });
    expect(find('check in 20 minutes')).toMatchObject({ value: '2026-11-18T10:50', title: 'check' });
  });

  it('datums: dag en maand, dit jaar of volgend jaar', () => {
    expect(find('verjaardag 24 nov')).toMatchObject({ value: '2026-11-24T09:00', title: 'verjaardag' });
    expect(find('belasting 1 mei 2027 om 10:00')).toMatchObject({ value: '2027-05-01T10:00', title: 'belasting' });
    expect(find('APK 3-2')).toMatchObject({ value: '2027-02-03T09:00', title: 'APK' }); // 3 feb is dit jaar al geweest
    expect(find('party December 31st 8pm')).toMatchObject({ value: '2026-12-31T20:00', title: 'party' });
    expect(find('iets op 31-2')).toBeNull();
  });

  it('tijden: alleen een tijd is vandaag, of morgen als hij al geweest is', () => {
    expect(find('bellen 15:00')).toMatchObject({ value: '2026-11-18T15:00' });
    expect(find('bellen 9:00')).toMatchObject({ value: '2026-11-19T09:00' });
    expect(find('koffie om 3 uur')).toMatchObject({ value: '2026-11-18T15:00', title: 'koffie' });
    expect(find('koffie om half 4')).toMatchObject({ value: '2026-11-18T15:30' });
    expect(find('film vanavond')).toMatchObject({ value: '2026-11-18T20:00', title: 'film' });
    expect(find('film vanavond om 9 uur')).toMatchObject({ value: '2026-11-18T21:00' });
    expect(find('duurt 2 uur')).toBeNull(); // zonder "om" en zonder datum geen tijd
    expect(find('bellen 25:00')).toBeNull();
  });

  it('vandaag zonder tijd: de standaardtijd, of het volgende hele uur als die al geweest is', () => {
    expect(find('vandaag stofzuigen')).toMatchObject({ value: '2026-11-18T11:00', title: 'stofzuigen' });
    expect(find('vandaag stofzuigen', Date.parse('2026-11-18T06:00:00Z'))).toMatchObject({ value: '2026-11-18T09:00' });
  });
});
