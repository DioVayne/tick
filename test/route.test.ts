import { describe, expect, it } from 'vitest';
import { parseHash, toHash } from '../public/route.js';

const view = { page: null, task: null, showDone: false, showTrash: false, list: null };

describe('adres (route.js)', () => {
  it('toHash: pagina gaat voor taak, taak voor de lijst', () => {
    expect(toHash(view)).toBe('#/all');
    expect(toHash({ ...view, list: 'Inbox' })).toBe('#/inbox');
    expect(toHash({ ...view, list: 'Werk', listId: 'ab12' })).toBe('#/list/ab12');
    expect(toHash({ ...view, list: 'Werk' })).toBe(''); // nog geen id
    expect(toHash({ ...view, showDone: true, list: 'Werk', listId: 'ab12' })).toBe('#/done');
    expect(toHash({ ...view, showTrash: true })).toBe('#/trash');
    expect(toHash({ ...view, task: 't 1', list: 'Werk', listId: 'ab12' })).toBe('#/task/t%201');
    expect(toHash({ ...view, page: 'calendar' })).toBe('#/calendar');
    expect(toHash({ ...view, page: 'calendar', task: 'x' })).toBe('#/task/x');
    expect(toHash({ ...view, page: 'settings', task: 'x' })).toBe('#/settings');
    expect(toHash({ ...view, page: 'help' })).toBe('#/help');
  });
  it('parseHash leest terug wat toHash schrijft', () => {
    for (const hash of ['#/all', '#/inbox', '#/done', '#/trash', '#/calendar', '#/settings', '#/help'])
      expect(parseHash(hash)).toEqual({ page: hash.slice(2) });
    expect(parseHash('#/list/ab12')).toEqual({ page: 'list', id: 'ab12' });
    expect(parseHash('#/task/t%201')).toEqual({ page: 'task', id: 't 1' });
  });
  it('parseHash: onbekend of kapot is null', () => {
    for (const hash of ['', '#', '#/', '#/list', '#/task/', '#/onzin', '#/all/x', '#/list/a/b', '#/task/%E0', 'all'])
      expect(parseHash(hash)).toBeNull();
  });
});
