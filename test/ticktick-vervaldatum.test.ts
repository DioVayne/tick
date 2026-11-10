import { describe, expect, it } from 'vitest';
import { tickTickRows } from '../public/ticktick.js';

// Een rij zoals de TickTick-backup hem geeft (alleen de kolommen die tickTickRows leest).
const base = {
  'List Name': 'Werk', Content: '', Reminder: '', 'Due Date': '', 'Start Date': '', Repeat: '', Status: '0',
  'Created Time': '2026-10-01T08:00:00+0000', 'Completed Time': '', Order: '1', Timezone: 'Europe/Amsterdam',
  'Is All Day': 'false', parentId: '', projectKind: 'TASK',
};
const NOW = Date.parse('2026-10-15T12:00:00Z');
const one = (o: Record<string, string>, opts: Parameters<typeof tickTickRows>[2] = {}) =>
  tickTickRows([{ ...base, Title: 'T', taskId: 'X1', ...o }], 'tt', { now: NOW, ...opts }).tasks[0];

describe('TickTick-import: vervaldatum zonder herinnering', () => {
  it('een vervaldatum met tijd en zonder herinnering wordt het tijdstip van de taak (UTC)', () => {
    const t = one({ 'Due Date': '2026-10-20T10:00:00+0000' });
    expect(t.remind_at).toBe('2026-10-20T10:00:00.000Z');
    expect(t.notified).toBe(false);
  });

  it('met herinnering blijft het de vervaldatum, zoals voorheen', () => {
    expect(one({ 'Due Date': '2026-10-20T10:00:00+0000', Reminder: 'TRIGGER:-PT15M' }).remind_at).toBe('2026-10-20T10:00:00.000Z');
  });

  it('een tijd zonder zone geldt in de zone van de rij', () => {
    // 20 oktober 10:00 in Amsterdam (zomertijd, +02:00) = 08:00 UTC
    expect(one({ 'Due Date': '2026-10-20T10:00:00' }).remind_at).toBe('2026-10-20T08:00:00.000Z');
  });

  it('hele dag: de kalenderdag in de zone van de rij, op 09:00 in die zone', () => {
    // TickTick zet middernacht in Amsterdam als UTC: 20 oktober 22:00 UTC = 21 oktober 00:00 lokaal.
    const t = one({ 'Due Date': '2026-10-20T22:00:00+0000', 'Is All Day': 'true' });
    expect(t.remind_at).toBe('2026-10-21T07:00:00.000Z'); // 09:00 Amsterdam (+02:00)
  });

  it('hele dag in de winter en ten westen van UTC', () => {
    expect(one({ 'Due Date': '2026-11-30T23:00:00+0000', 'Is All Day': 'true' }).remind_at).toBe('2026-12-01T08:00:00.000Z');
    expect(one({ 'Due Date': '2026-10-21T04:00:00+0000', 'Is All Day': 'true', Timezone: 'America/New_York' }).remind_at)
      .toBe('2026-10-21T13:00:00.000Z'); // 09:00 New York (-04:00)
  });

  it('hele dag zonder (geldige) zone: afgerond op de dichtstbijzijnde dag, 09:00 UTC', () => {
    expect(one({ 'Due Date': '2026-10-20T22:00:00+0000', 'Is All Day': 'true', Timezone: '' }).remind_at).toBe('2026-10-21T09:00:00.000Z');
    expect(one({ 'Due Date': '2026-10-21T04:00:00+0000', 'Is All Day': 'true', Timezone: 'Mars/Olympus' }).remind_at).toBe('2026-10-21T09:00:00.000Z');
  });

  it('hele dag: een kale datum werkt ook', () => {
    expect(one({ 'Due Date': '2026-10-21', 'Is All Day': 'true' }).remind_at).toBe('2026-10-21T07:00:00.000Z');
  });

  it('hele dag: de Worker kan de dag zelf omzetten (zone en standaardtijd van de gebruiker)', () => {
    const days: string[] = [];
    const t = one({ 'Due Date': '2026-10-20T22:00:00+0000', 'Is All Day': 'true' }, {
      allDay: (ymd: string) => { days.push(ymd); return `${ymd}T06:30:00.000Z`; },
    });
    expect(days).toEqual(['2026-10-21']);
    expect(t.remind_at).toBe('2026-10-21T06:30:00.000Z');
  });

  it('afgeronde en gearchiveerde taken krijgen geen tijd', () => {
    for (const Status of ['1', '2', '-1']) {
      const t = one({ 'Due Date': '2026-10-20T10:00:00+0000', Status, 'Completed Time': '2026-10-19T10:00:00+0000' });
      expect(t.done).toBe(true);
      expect(t.remind_at).toBeNull();
    }
  });

  it('een vervaldatum in het verleden: al gemeld, zodat er na de import geen stapel meldingen komt', () => {
    const t = one({ 'Due Date': '2026-10-01T10:00:00+0000' });
    expect(t.remind_at).toBe('2026-10-01T10:00:00.000Z');
    expect(t.notified).toBe(true);
  });

  it('zonder vervaldatum geen tijd; een onleesbare vervaldatum breekt niets', () => {
    expect(one({}).remind_at).toBeNull();
    expect(one({ 'Due Date': 'morgen', 'Is All Day': 'true' }).remind_at).toBeNull();
    expect(one({ 'Due Date': 'morgen' }).remind_at).toBeNull();
  });

  it('telt de open taken met een herhaling (die komt niet mee)', () => {
    const rows = [
      { ...base, Title: 'Elke week', taskId: 'R1', Repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=1', 'Due Date': '2026-10-20T10:00:00+0000' },
      { ...base, Title: 'Klaar, herhaalde', taskId: 'R2', Repeat: 'RRULE:FREQ=DAILY', Status: '2' },
      { ...base, Title: '', taskId: 'R3', Repeat: 'RRULE:FREQ=DAILY' }, // zonder titel: niet geïmporteerd
      { ...base, Title: 'Gewoon', taskId: 'R4' },
    ];
    const out = tickTickRows(rows, 'tt', { now: NOW });
    expect(out.repeats).toBe(1);
    expect(out.tasks.find((t) => t.id === 'ttR1')!.remind_at).toBe('2026-10-20T10:00:00.000Z');
    expect(out.skipped).toBe(1);
  });

  it('een export zonder kolommen Repeat, Timezone en Is All Day werkt nog', () => {
    const { 'Is All Day': _a, Timezone: _z, Repeat: _r, ...old } = base;
    const out = tickTickRows([{ ...old, Title: 'Oud', taskId: 'O1', 'Due Date': '2026-10-20T10:00:00+0000' }], 'tt', { now: NOW });
    expect(out.tasks[0].remind_at).toBe('2026-10-20T10:00:00.000Z');
    expect(out.repeats).toBe(0);
  });
});
