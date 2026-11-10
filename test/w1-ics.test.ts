// Fixes uit ronde w1 voor agenda's: een reeks met een begin in UTC herhaalt op een vaste UTC-tijd (RFC 5545), en het
// .ics-bestand vouwt regels op UTF-8-bytes zonder een teken door te knippen.
import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/ics';
import { taskIcs } from '../public/ics.js';

const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const iso = (ms: number) => new Date(ms).toISOString();

describe('G: een reeks met DTSTART in UTC', () => {
  // Zomertijd eindigt in Europa op 25 oktober 2026.
  const opts = { from: Date.parse('2026-10-19T00:00:00Z'), to: Date.parse('2026-11-12T00:00:00Z'), zone: 'Europe/Amsterdam' };

  it('herhaalt wekelijks op dezelfde UTC-tijd, ook over de wisseling naar wintertijd', () => {
    const out = parseIcs(cal('UID:w1-utc', 'SUMMARY:Stand-up', 'DTSTART:20261020T090000Z', 'DTEND:20261020T093000Z', 'RRULE:FREQ=WEEKLY'), opts);
    expect(out.map((e) => iso(e.start))).toEqual([
      '2026-10-20T09:00:00.000Z', '2026-10-27T09:00:00.000Z', '2026-11-03T09:00:00.000Z', '2026-11-10T09:00:00.000Z',
    ]);
  });

  it('een EXDATE in UTC na de wisseling schrapt de juiste keer', () => {
    const out = parseIcs(cal('UID:w1-ex', 'SUMMARY:Stand-up', 'DTSTART:20261020T090000Z', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY',
      'EXDATE:20261103T090000Z'), opts);
    expect(out.map((e) => iso(e.start))).toEqual(['2026-10-20T09:00:00.000Z', '2026-10-27T09:00:00.000Z', '2026-11-10T09:00:00.000Z']);
  });

  it('met TZID blijft de reeks op de lokale tijd', () => {
    const out = parseIcs(cal('UID:w1-tz', 'SUMMARY:Lokaal', 'DTSTART;TZID=Europe/Amsterdam:20261020T110000', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY'), opts);
    expect(out.map((e) => iso(e.start))).toEqual([
      '2026-10-20T09:00:00.000Z', '2026-10-27T10:00:00.000Z', '2026-11-03T10:00:00.000Z', '2026-11-10T10:00:00.000Z',
    ]);
  });
});

describe('H: vouwen en escapen in taskIcs', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const unfold = (text: string) => text.replace(/\r\n /g, '');

  it('regels van hooguit 75 bytes, zonder een teken (ook geen emoji) door te knippen', () => {
    const title = '😀é'.repeat(40) + ' en wat tekst ' + 'ü'.repeat(30);
    const text = taskIcs({ id: '11111111-2222-4333-8444-555555555555', title, remind_at: '2026-11-10T09:00:00.000Z' }, 0);
    for (const line of text.split('\r\n')) {
      expect(bytes(line), JSON.stringify(line)).toBeLessThanOrEqual(75);
      // Geen losse helft van een surrogaatpaar aan het eind of begin van een regel.
      expect(/[\uD800-\uDBFF]$/.test(line), JSON.stringify(line)).toBe(false);
      expect(/^ ?[\uDC00-\uDFFF]/.test(line), JSON.stringify(line)).toBe(false);
    }
    expect(unfold(text)).toContain(`SUMMARY:${title}`);
    const [e] = parseIcs(text, { from: Date.parse('2026-11-09T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z'), zone: 'UTC' });
    expect(e.title).toBe(title.slice(0, 200));
  });

  it('een losse \\r in de titel wordt ge-escaped', () => {
    const text = taskIcs({ id: '11111111-2222-4333-8444-555555555555', title: 'a\rb\r\nc\nd', remind_at: '2026-11-10T09:00:00.000Z' }, 0);
    expect(text).toContain('SUMMARY:a\\nb\\nc\\nd\r\n');
    expect(text.split('\r\n').every((l) => !l.includes('\r') && !l.includes('\n'))).toBe(true);
  });
});
