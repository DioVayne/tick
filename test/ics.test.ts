import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/ics';
import { getTimeZone } from '../public/repeat.js';

const FROM = Date.parse('2026-11-09T00:00:00Z');
const TO = FROM + 14 * 86_400_000;
const opts = { from: FROM, to: TO, zone: 'Europe/Amsterdam' };

/** Een agenda met de gegeven VEVENT-regels (elk event een array regels). */
const cal = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const iso = (ms: number) => new Date(ms).toISOString();

describe('parseIcs', () => {
  it('een los event in UTC, alleen titel en tijden', () => {
    const out = parseIcs(cal(['UID:a', 'SUMMARY:Overleg', 'DTSTART:20261110T130000Z', 'DTEND:20261110T140000Z',
      'DESCRIPTION:geheim', 'LOCATION:kantoor', 'ATTENDEE:mailto:x@example.com']), opts);
    expect(out).toEqual([{ title: 'Overleg', start: Date.parse('2026-11-10T13:00:00Z'), end: Date.parse('2026-11-10T14:00:00Z'), allDay: false }]);
    expect(Object.keys(out[0]).sort()).toEqual(['allDay', 'end', 'start', 'title']);
  });

  it('TZID en een zwevende tijd (zone van de gebruiker)', () => {
    const before = getTimeZone();
    const out = parseIcs(cal(
      ['UID:a', 'SUMMARY:NY', 'DTSTART;TZID=America/New_York:20261110T090000', 'DTEND;TZID=America/New_York:20261110T100000'],
      ['UID:b', 'SUMMARY:Lokaal', 'DTSTART:20261111T090000', 'DURATION:PT45M'],
    ), opts);
    expect(iso(out[0].start)).toBe('2026-11-10T14:00:00.000Z');
    expect(iso(out[1].start)).toBe('2026-11-11T08:00:00.000Z');
    expect(out[1].end - out[1].start).toBe(45 * 60_000);
    expect(getTimeZone()).toBe(before); // de globale zone is teruggezet
  });

  it('Windows-TZID van Outlook en een mozilla-pad', () => {
    const out = parseIcs(cal(
      ['UID:a', 'SUMMARY:W', 'DTSTART;TZID=W. Europe Standard Time:20261110T090000', 'DTEND;TZID=W. Europe Standard Time:20261110T093000'],
      ['UID:b', 'SUMMARY:M', 'DTSTART;TZID=/mozilla.org/20050126_1/Europe/Amsterdam:20261111T090000', 'DURATION:PT1H'],
      ['UID:c', 'SUMMARY:Q', 'DTSTART;TZID="Europe/London":20261112T090000', 'DURATION:PT1H'],
    ), opts);
    expect(out.map((e) => iso(e.start))).toEqual(['2026-11-10T08:00:00.000Z', '2026-11-11T08:00:00.000Z', '2026-11-12T09:00:00.000Z']);
  });

  it('hele dag', () => {
    const [e] = parseIcs(cal(['UID:a', 'SUMMARY:Vrij', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261114']), opts);
    expect(e.allDay).toBe(true);
    expect(iso(e.start)).toBe('2026-11-11T23:00:00.000Z');
    expect(iso(e.end)).toBe('2026-11-13T23:00:00.000Z');
  });

  it('wekelijks herhalen, alleen binnen het venster', () => {
    const out = parseIcs(cal(['UID:a', 'SUMMARY:Sport', 'DTSTART;TZID=Europe/Amsterdam:20250106T190000',
      'DTEND;TZID=Europe/Amsterdam:20250106T200000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO']), opts);
    expect(out.map((e) => iso(e.start))).toEqual([
      '2026-11-09T18:00:00.000Z', '2026-11-11T18:00:00.000Z', '2026-11-16T18:00:00.000Z', '2026-11-18T18:00:00.000Z']);
    expect(out.every((e) => e.end - e.start === 3_600_000)).toBe(true);
  });

  it('EXDATE haalt een keer weg (ook meerdere op één regel)', () => {
    const out = parseIcs(cal(['UID:a', 'SUMMARY:Stand-up', 'DTSTART;TZID=Europe/Amsterdam:20261109T090000', 'DURATION:PT15M',
      'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=Europe/Amsterdam:20261110T090000,20261112T090000']), opts);
    expect(out.map((e) => iso(e.start).slice(0, 10))).toEqual(['2026-11-09', '2026-11-11', '2026-11-13']);
  });

  it('RECURRENCE-ID: verplaatst en geannuleerd, ook als de uitzondering vóór de reeks staat', () => {
    const out = parseIcs(cal(
      ['UID:r', 'SUMMARY:Verzet', 'RECURRENCE-ID;TZID=Europe/Amsterdam:20261110T100000',
        'DTSTART;TZID=Europe/Amsterdam:20261110T150000', 'DTEND;TZID=Europe/Amsterdam:20261110T160000'],
      ['UID:r', 'SUMMARY:Reeks', 'DTSTART;TZID=Europe/Amsterdam:20261109T100000', 'DTEND;TZID=Europe/Amsterdam:20261109T110000',
        'RRULE:FREQ=DAILY;UNTIL=20261112T225959Z'],
      ['UID:r', 'STATUS:CANCELLED', 'RECURRENCE-ID;TZID=Europe/Amsterdam:20261111T100000', 'DTSTART;TZID=Europe/Amsterdam:20261111T100000'],
    ), opts);
    expect(out.map((e) => `${e.title} ${iso(e.start)}`)).toEqual([
      'Reeks 2026-11-09T09:00:00.000Z', 'Verzet 2026-11-10T14:00:00.000Z', 'Reeks 2026-11-12T09:00:00.000Z']);
  });

  it('maandelijks met BYSETPOS (Outlook) wordt de n-de weekdag', () => {
    const out = parseIcs(cal(['UID:a', 'SUMMARY:Borrel', 'DTSTART;TZID=Europe/Amsterdam:20260113T170000', 'DURATION:PT2H',
      'RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2']), opts);
    expect(out.map((e) => iso(e.start))).toEqual(['2026-11-10T16:00:00.000Z']);
  });

  it('herhaalde hele dagen', () => {
    const out = parseIcs(cal(['UID:a', 'SUMMARY:Verjaardag', 'DTSTART;VALUE=DATE:20001115', 'DTEND;VALUE=DATE:20001116', 'RRULE:FREQ=YEARLY']), opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ allDay: true, start: Date.parse('2026-11-14T23:00:00Z') });
  });

  it('slaat over wat het niet begrijpt, de rest blijft', () => {
    const out = parseIcs(cal(
      ['UID:a', 'SUMMARY:Raar', 'DTSTART:20261110T090000Z', 'DURATION:PT1H', 'RRULE:FREQ=HOURLY;INTERVAL=3'],
      ['UID:b', 'SUMMARY:Kapot', 'DTSTART:gisteren'],
      ['UID:c', 'SUMMARY:Vrij blok', 'TRANSP:TRANSPARENT', 'DTSTART:20261110T090000Z', 'DURATION:PT1H'],
      ['UID:d', 'SUMMARY:Afgezegd', 'STATUS:CANCELLED', 'DTSTART:20261110T090000Z', 'DURATION:PT1H'],
      ['UID:e', 'SUMMARY:Goed', 'DTSTART:20261110T090000Z', 'DURATION:PT1H'],
    ), opts);
    expect(out.map((e) => e.title)).toEqual(['Goed']);
  });

  it('gevouwen regels, escapes en een alarm in het event', () => {
    const text = cal(['UID:a', 'SUMMARY:Lange titel met\\, komma en', ' vervolg\\; en\\nregel', 'DTSTART:20261110T090000Z', 'DURATION:PT1H',
      'BEGIN:VALARM', 'SUMMARY:Alarm', 'TRIGGER:-PT10M', 'END:VALARM']).replace(/\r\n/g, '\n');
    expect(parseIcs(text, opts).map((e) => e.title)).toEqual(['Lange titel met, komma envervolg; en regel']);
  });

  it('buiten het venster telt niet; een event dat over het begin heen loopt wel; hooguit max', () => {
    const out = parseIcs(cal(
      ['UID:a', 'SUMMARY:Oud', 'DTSTART:20261001T090000Z', 'DURATION:PT1H'],
      ['UID:b', 'SUMMARY:Ver weg', 'DTSTART:20270101T090000Z', 'DURATION:PT1H'],
      ['UID:c', 'SUMMARY:Nacht', 'DTSTART:20261108T230000Z', 'DTEND:20261109T010000Z'],
    ), opts);
    expect(out.map((e) => e.title)).toEqual(['Nacht']);
    const many = cal(...Array.from({ length: 30 }, (_, i) => [`UID:${i}`, 'SUMMARY:x', `DTSTART:202611${10 + (i % 10)}T0${i % 10}0000Z`, 'DURATION:PT1H']));
    expect(parseIcs(many, { ...opts, max: 5 })).toHaveLength(5);
  });

  it('een lege titel blijft leeg', () => {
    expect(parseIcs(cal(['UID:a', 'DTSTART:20261110T090000Z', 'DURATION:PT1H']), opts)[0].title).toBe('');
  });
});
