import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agenda, dayKey, monthGrid, startOfDay, taskMoments, tasksByDay } from '../public/calendar.js';
import { occurrencesBetween, setTimeZone } from '../public/repeat.js';

const ms = (s: string) => Date.parse(s);
const task = (id: string, remind_at: string | null, extra: object = {}) => ({ id, title: id, remind_at, done: 0, ...extra });

beforeEach(() => setTimeZone('Europe/Amsterdam'));
afterEach(() => setTimeZone('Europe/Amsterdam'));

describe('monthGrid', () => {
  it('oktober 2026 met maandag als weekstart: 5 weken, begint op ma 28 sep', () => {
    const w = monthGrid(2026, 10, 'mon');
    expect(w).toHaveLength(5);
    expect(w[0][0].key).toBe('2026-09-28');
    expect(w[0][0].inMonth).toBe(false);
    expect(w[4][6].key).toBe('2026-11-01');
  });
  it('met zondag als weekstart begint de eerste rij op zo 27 sep', () => {
    const w = monthGrid(2026, 10, 'sun');
    expect(w[0][0].key).toBe('2026-09-27');
    expect(w[0][0].wd).toBe(6);
    expect(w.every((r) => r.length === 7)).toBe(true);
  });
  it('februari 2027 past precies in 4 weken', () => {
    expect(monthGrid(2027, 2, 'mon')).toHaveLength(4);
  });
});

describe('dagindeling in de ingestelde tijdzone', () => {
  it('23:30 UTC valt in Amsterdam op de volgende dag', () => {
    expect(dayKey(ms('2026-10-19T23:30:00Z'))).toBe('2026-10-20');
    setTimeZone('UTC');
    expect(dayKey(ms('2026-10-19T23:30:00Z'))).toBe('2026-10-19');
  });
  it('startOfDay klopt over de overgang naar wintertijd (zo 25 okt 2026)', () => {
    expect(new Date(startOfDay(2026, 10, 25)).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(new Date(startOfDay(2026, 10, 26)).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});

describe('taskMoments / tasksByDay', () => {
  const from = startOfDay(2026, 10, 1);
  const to = startOfDay(2026, 11, 1);
  it('slaat taken zonder datum, afgeronde en verwijderde over', () => {
    const list = [task('a', null), task('b', '2026-10-05T08:00:00Z', { done: 1 }), task('c', '2026-10-05T08:00:00Z', { deleted_at: 'x' })];
    expect(tasksByDay(list, from, to).size).toBe(0);
  });
  it('sorteert per dag op tijd', () => {
    const m = tasksByDay([task('laat', '2026-10-05T15:00:00Z'), task('vroeg', '2026-10-05T07:00:00Z')], from, to);
    expect(m.get('2026-10-05')!.map((i) => i.task.id)).toEqual(['vroeg', 'laat']);
  });
  it('herhaling: elke zondag vanaf de huidige keer, niet eerder', () => {
    const t = task('r', '2026-10-11T08:00:00Z', { repeat: { rule: 'FREQ=WEEKLY;BYDAY=SU', start: '2026-10-04T08:00:00Z', at: '2026-10-11T08:00:00Z' } });
    expect([...tasksByDay([t], from, to).keys()]).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
  });
  it('een herhaling zonder volgende keer valt terug op één keer', () => {
    const t = task('x', '2026-10-05T08:00:00Z', { repeat: { rule: 'ONZIN', start: '2026-10-05T08:00:00Z', at: '2026-10-05T08:00:00Z' } });
    expect(taskMoments(t, from, to)).toEqual([ms('2026-10-05T08:00:00Z')]);
  });
});

describe('occurrencesBetween', () => {
  it('houdt zich aan de cap bij een dagelijkse regel', () => {
    expect(occurrencesBetween('FREQ=DAILY', '2026-01-01T08:00:00Z', ms('2026-01-01T00:00:00Z'), ms('2030-01-01T00:00:00Z'), 10)).toHaveLength(10);
  });
  it('is leeg als het bereik voor de start ligt', () => {
    expect(occurrencesBetween('FREQ=DAILY', '2026-10-10T08:00:00Z', ms('2026-10-01T00:00:00Z'), ms('2026-10-10T00:00:00Z'))).toEqual([]);
  });
});

describe('agenda', () => {
  it('toont achterstallige taken apart en laat lege dagen weg', () => {
    const now = ms('2026-10-19T10:00:00Z');
    const a = agenda([task('oud', '2026-10-10T08:00:00Z'), task('nu', '2026-10-19T12:00:00Z'), task('later', '2026-10-22T08:00:00Z')], now, 30);
    expect(a.overdue.map((i) => i.task.id)).toEqual(['oud']);
    expect(a.days.map((d) => d.key)).toEqual(['2026-10-19', '2026-10-22']);
  });
});
