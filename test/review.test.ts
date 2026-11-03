import { describe, expect, it } from 'vitest';
import { DAY, isStale, nextIndex, reviewPrefsOf, staleDays, staleTasks, topOf } from '../public/review.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const P = { on: true, newDays: 14, seenDays: 30 };
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const task = (o: Record<string, unknown> = {}) => ({
  id: `t${++n}`, list: 'Werk', parent_id: null, done: false, pinned: false, repeat: null, remind_at: null,
  created_at: iso(NOW - 100 * DAY), reviewed_at: null, position: 5_000_000, share: null, ...o,
});
const none = new Set<string>();

describe('isStale', () => {
  it('nieuw: oud vanaf precies 14 dagen', () => {
    expect(isStale(task({ created_at: iso(NOW - 14 * DAY) }), P, none, NOW)).toBe(true);
    expect(isStale(task({ created_at: iso(NOW - 14 * DAY + 1) }), P, none, NOW)).toBe(false);
  });
  it('bekeken: oud vanaf precies 30 dagen, ook als created_at oud is', () => {
    expect(isStale(task({ reviewed_at: iso(NOW - 30 * DAY) }), P, none, NOW)).toBe(true);
    expect(isStale(task({ reviewed_at: iso(NOW - 29 * DAY) }), P, none, NOW)).toBe(false);
  });
  it('andere termijnen volgen prefs', () => {
    expect(isStale(task({ created_at: iso(NOW - 3 * DAY) }), { ...P, newDays: 3 }, none, NOW)).toBe(true);
    expect(isStale(task({ reviewed_at: iso(NOW - 3 * DAY) }), { ...P, seenDays: 3 }, none, NOW)).toBe(true);
  });
  it('doet niet mee', () => {
    expect(isStale(task({ pinned: true }), P, none, NOW)).toBe(false);
    expect(isStale(task({ repeat: { rule: 'FREQ=DAILY' } }), P, none, NOW)).toBe(false);
    expect(isStale(task({ remind_at: iso(NOW + 60_000) }), P, none, NOW)).toBe(false);
    expect(isStale(task({ parent_id: 'x' }), P, none, NOW)).toBe(false);
    expect(isStale(task({ done: true }), P, none, NOW)).toBe(false);
    expect(isStale(task({ list: 'Thuis' }), P, new Set(['Thuis']), NOW)).toBe(false);
  });
  it('verlopen herinnering telt mee', () => {
    expect(isStale(task({ remind_at: iso(NOW - 60_000) }), P, none, NOW)).toBe(true);
    expect(isStale(task({ remind_at: iso(NOW) }), P, none, NOW)).toBe(true);
  });
  it('gedeelde lijst: bekeken door een ander telt ook', () => {
    expect(isStale(task({ share: { with: 'x' }, reviewed_at: iso(NOW - 2 * DAY) }), P, none, NOW)).toBe(false);
  });
});

describe('staleTasks', () => {
  it('oudste eerst, op id bij gelijke tijd, niet-oude valt weg', () => {
    const a = task({ id: 'a', created_at: iso(NOW - 50 * DAY) });
    const b = task({ id: 'b', created_at: iso(NOW - 90 * DAY) });
    const c = task({ id: 'c', created_at: iso(NOW - 99 * DAY), reviewed_at: iso(NOW - 40 * DAY) });
    const d = task({ id: 'd', created_at: iso(NOW - DAY) });
    const e = task({ id: 'e', created_at: iso(NOW - 50 * DAY) });
    expect(staleTasks([e, a, d, c, b], P, none, NOW).map((t) => t.id)).toEqual(['b', 'a', 'e', 'c']);
  });
});

describe('staleDays', () => {
  it('rondt naar beneden af', () => {
    expect(staleDays(task({ created_at: iso(NOW - 20.9 * DAY) }), NOW)).toBe(20);
    expect(staleDays(task({ reviewed_at: iso(NOW - 3 * DAY) }), NOW)).toBe(3);
  });
});

describe('topOf', () => {
  const me = task({ id: 'me', position: 9_000_000 });
  it('kleinste positie van de anderen min 1e6', () => {
    const others = [task({ position: 5_000_000 }), task({ position: 7_000_000 }), me];
    expect(topOf(me, others)).toBe(4_000_000);
  });
  it('vastgepinde, andere lijsten, subtaken en afgeronde tellen niet', () => {
    const others = [
      task({ position: 1_000_000, pinned: true }), task({ position: 2_000_000, list: 'Thuis' }),
      task({ position: 2_000_000, parent_id: 'x' }), task({ position: 2_000_000, done: true }),
      task({ position: 6_000_000 }), me,
    ];
    expect(topOf(me, others)).toBe(5_000_000);
  });
  it('geen anderen of al bovenaan: eigen positie', () => {
    expect(topOf(me, [task({ position: 1_000_000, pinned: true }), me])).toBe(9_000_000);
    expect(topOf(me, [me])).toBe(9_000_000);
    expect(topOf(me, [task({ position: 9_500_000 }), me])).toBe(9_000_000);
  });
});

describe('nextIndex', () => {
  it('slaat verdwenen taken over', () => {
    const open = new Set(['a', 'c']);
    expect(nextIndex(['a', 'b', 'c'], 1, open)).toBe(2);
    expect(nextIndex(['a', 'b', 'c'], 3, open)).toBe(3);
    expect(nextIndex(['a', 'b', 'c'], 0, new Set())).toBe(3);
  });
});

describe('reviewPrefsOf', () => {
  it('standaarden en uit', () => {
    expect(reviewPrefsOf({})).toEqual({ on: true, newDays: 14, seenDays: 30 });
    expect(reviewPrefsOf({ tickmanager: false }).on).toBe(false);
    expect(reviewPrefsOf({ reviewNewDays: 7, reviewSeenDays: 60 })).toEqual({ on: true, newDays: 7, seenDays: 60 });
  });
});
