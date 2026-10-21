import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { badgeLabel, dueCount, faviconSvg } from '../public/badge.js';
import { setTimeZone } from '../public/repeat.js';

const ms = (s: string) => Date.parse(s);
const task = (id: string, remind_at: string | null, extra: object = {}) => ({ id, title: id, remind_at, done: 0, parent_id: null, ...extra });

beforeEach(() => setTimeZone('Europe/Amsterdam'));
afterEach(() => setTimeZone('Europe/Amsterdam'));

describe('dueCount', () => {
  const now = ms('2026-10-21T10:00:00Z'); // 12:00 in Amsterdam

  it('telt taken van vandaag en te laat, niet die van morgen of zonder datum', () => {
    const tasks = [
      task('te laat', '2026-10-19T08:00:00Z'),
      task('vanochtend', '2026-10-21T06:00:00Z'),
      task('vanavond', '2026-10-21T20:00:00Z'),
      task('morgen', '2026-10-22T07:00:00Z'),
      task('zonder', null),
    ];
    expect(dueCount(tasks, now)).toEqual({ count: 3, overdue: 1 });
  });

  it('de dag volgt de ingestelde tijdzone: 23:30 UTC is in Amsterdam al morgen', () => {
    expect(dueCount([task('laat', '2026-10-21T22:30:00Z')], now).count).toBe(0);
    setTimeZone('UTC');
    expect(dueCount([task('laat', '2026-10-21T22:30:00Z')], now).count).toBe(1);
  });

  it('gisteravond in Amsterdam is te laat, ook al is het in UTC nog dezelfde dag als vandaag 00:30', () => {
    expect(dueCount([task('gisteravond', '2026-10-20T21:30:00Z')], now)).toEqual({ count: 1, overdue: 1 });
  });

  it('subtaken, afgeronde en verwijderde taken tellen niet mee', () => {
    const tasks = [
      task('sub', '2026-10-21T06:00:00Z', { parent_id: 'x' }),
      task('af', '2026-10-21T06:00:00Z', { done: 1 }),
      task('weg', '2026-10-21T06:00:00Z', { deleted_at: '2026-10-21T07:00:00Z' }),
    ];
    expect(dueCount(tasks, now)).toEqual({ count: 0, overdue: 0 });
  });
});

describe('badgeLabel en faviconSvg', () => {
  it('boven de 99 wordt het 99+', () => {
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(99)).toBe('99');
    expect(badgeLabel(140)).toBe('99+');
  });

  it('zonder taken het gewone icoon, met taken een bolletje met het getal', () => {
    const plain = faviconSvg(0, false);
    expect(plain).not.toContain('<circle');
    const dot = faviconSvg(4, false);
    expect(dot).toContain('<circle');
    expect(dot).toContain('>4</text>');
  });

  it('te laat kleurt het bolletje rood', () => {
    expect(faviconSvg(2, true)).toContain('#dc2626');
    expect(faviconSvg(2, false)).not.toContain('#dc2626');
  });
});
