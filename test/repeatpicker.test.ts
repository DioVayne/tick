import { describe, expect, it } from 'vitest';
import { buildRule, chipDays, customState, setWeekStart } from '../public/repeat.js';

const ZO_10 = '2026-10-18T08:00:00.000Z'; // zondag 18 okt 2026
const DAG_31 = '2026-10-31T09:00:00.000Z'; // zaterdag 31 okt

describe('buildRule (Aangepast-paneel)', () => {
  it('dagen en jaren', () => {
    expect(buildRule({ interval: 1, unit: 'dag' }, ZO_10)).toBe('FREQ=DAILY');
    expect(buildRule({ interval: 3, unit: 'jaar' }, ZO_10)).toBe('FREQ=YEARLY;INTERVAL=3');
  });
  it('weken met gekozen dagen, standaard de dag van de start', () => {
    expect(buildRule({ interval: 2, unit: 'week', days: [6, 0] }, ZO_10)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU');
    expect(buildRule({ interval: 1, unit: 'week', days: [] }, ZO_10)).toBe('FREQ=WEEKLY;BYDAY=SU');
  });
  it('maanden: op de dag, of de n-de/laatste weekdag (na dag 28 altijd laatste)', () => {
    expect(buildRule({ interval: 1, unit: 'maand', monthMode: 'dag' }, ZO_10)).toBe('FREQ=MONTHLY;BYMONTHDAY=18');
    expect(buildRule({ interval: 1, unit: 'maand', monthMode: 'weekdag' }, ZO_10)).toBe('FREQ=MONTHLY;BYDAY=3SU');
    expect(buildRule({ interval: 1, unit: 'maand', monthMode: 'weekdag' }, DAG_31)).toBe('FREQ=MONTHLY;BYDAY=-1SA');
  });
  it('houdt het getal tussen 1 en 99', () => {
    expect(buildRule({ interval: 500, unit: 'dag' }, ZO_10)).toBe('FREQ=DAILY;INTERVAL=99');
    expect(buildRule({ interval: 0, unit: 'dag' }, ZO_10)).toBe('FREQ=DAILY');
  });
});

describe('customState', () => {
  it('beginstand en uit een bestaand ritme', () => {
    expect(customState(null, ZO_10)).toEqual({ interval: 1, unit: 'week', days: [6], monthMode: 'dag' });
    expect(customState('FREQ=MONTHLY;INTERVAL=2;BYDAY=3SU', ZO_10)).toMatchObject({ interval: 2, unit: 'maand', monthMode: 'weekdag' });
  });
});

describe('chipDays (week begint op)', () => {
  it('maandag eerst, of zondag eerst', () => {
    expect(chipDays('mon')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(chipDays('sun')[0]).toBe(6);
  });
  it('zonder argument geldt de ingestelde weekstart', () => {
    setWeekStart('sun');
    expect(chipDays()[0]).toBe(6);
    setWeekStart('mon');
    expect(chipDays()[0]).toBe(0);
  });
});
