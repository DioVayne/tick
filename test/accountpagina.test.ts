import { afterEach, describe, expect, it } from 'vitest';
import { activityOf, filterUsers, groupUsers, monthOf, sortUsers, summarize } from '../public/accounts.js';
import { setTimeZone, setWeekStart } from '../public/repeat.js';

const NOW = Date.parse('2026-11-19T10:00:00Z'); // donderdag 19 nov 2026, 11:00 in Amsterdam
const acc = (o: Record<string, unknown>) => ({
  id: String(o.name), name: 'x', email: null, role: 'member', created_at: '2026-01-01T00:00:00Z', last_seen: null,
  tasks_open: 0, tasks_done: 0, browsers: 0, phones: 0, lists_shared: 0, lists_joined: 0, ...o,
}) as any;

afterEach(() => { setTimeZone('UTC'); setWeekStart('mon'); });

describe('accountpagina: zoeken, sorteren, groeperen', () => {
  const users = [
    acc({ name: 'Émile', email: 'emile@voorbeeld.test', created_at: '2026-11-02T09:00:00Z', last_seen: '2026-11-19T08:00:00Z', tasks_open: 3 }),
    acc({ name: 'anna', email: 'anna@x.test', created_at: '2026-10-31T23:30:00Z', last_seen: '2026-11-17T08:00:00Z', tasks_done: 9, phones: 1 }),
    acc({ name: 'Bart', email: 'b@x.test', created_at: '2026-09-15T10:00:00Z', last_seen: '2026-11-03T08:00:00Z', browsers: 2, phones: 1 }),
    acc({ name: 'Cor', email: 'cor@x.test', created_at: '2025-12-01T10:00:00Z', last_seen: '2026-10-01T08:00:00Z' }),
    acc({ name: 'Dirk', email: 'dirk@x.test', created_at: '2026-11-18T10:00:00Z' }),
  ];

  it('zoekt in naam en e-mailadres, zonder hoofdletters of accenten', () => {
    expect(filterUsers(users, 'emile').map((u) => u.name)).toEqual(['Émile']);
    expect(filterUsers(users, ' X.TEST ').map((u) => u.name)).toEqual(['anna', 'Bart', 'Cor', 'Dirk']);
    expect(filterUsers(users, '')).toHaveLength(5);
  });

  it('sorteert op naam, aangemaakt, laatst gezien, taken en apparaten', () => {
    const names = (k: string) => sortUsers(users, k).map((u) => u.name);
    expect(names('name')).toEqual(['anna', 'Bart', 'Cor', 'Dirk', 'Émile']);
    expect(names('created')).toEqual(['Dirk', 'Émile', 'anna', 'Bart', 'Cor']);
    expect(names('seen')).toEqual(['Émile', 'anna', 'Bart', 'Cor', 'Dirk']); // nooit gezien onderaan
    expect(names('tasks')).toEqual(['anna', 'Émile', 'Bart', 'Cor', 'Dirk']);
    expect(names('devices')).toEqual(['Bart', 'anna', 'Cor', 'Dirk', 'Émile']);
  });

  it('activiteit rekent met vandaag, deze week en deze maand in de tijdzone van Tick', () => {
    setTimeZone('Europe/Amsterdam');
    expect(activityOf('2026-11-18T23:30:00Z', NOW)).toBe('today'); // 00:30 op de 19e in Amsterdam
    expect(activityOf('2026-11-18T22:30:00Z', NOW)).toBe('week');
    expect(activityOf('2026-11-15T22:30:00Z', NOW)).toBe('month'); // zondag: vorige week bij maandag als weekstart
    setWeekStart('sun');
    expect(activityOf('2026-11-15T22:30:00Z', NOW)).toBe('week');
    expect(activityOf('2026-10-31T23:30:00Z', NOW)).toBe('month'); // 1 nov in Amsterdam
    expect(activityOf('2026-10-31T22:30:00Z', NOW)).toBe('older');
    expect(activityOf(null, NOW)).toBe('never');
  });

  it('groepeert op activiteit (vaste volgorde, lege groepen weg) en op maand van aanmelden (nieuwste eerst)', () => {
    setTimeZone('Europe/Amsterdam');
    const act = groupUsers(users, 'activity', NOW).map((g) => [g.key, g.users.map((u) => u.name)]);
    expect(act).toEqual([['today', ['Émile']], ['week', ['anna']], ['month', ['Bart']], ['older', ['Cor']], ['never', ['Dirk']]]);
    expect(monthOf('2026-10-31T23:30:00Z')).toBe('2026-11');
    const month = groupUsers(users, 'month', NOW).map((g) => [g.key, g.users.length]);
    expect(month).toEqual([['2026-11', 3], ['2026-09', 1], ['2025-12', 1]]);
    expect(groupUsers(users, 'none', NOW)).toEqual([{ key: 'all', users }]);
  });

  it('samenvatting: totaal en deze week actief', () => {
    setTimeZone('Europe/Amsterdam');
    expect(summarize(users, NOW)).toEqual({ total: 5, week: 2 });
  });
});
