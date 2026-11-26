import { afterEach, describe, expect, it } from 'vitest';
import { indexed, lists, openKids, sharedOf, state as storeState, taskById } from '../public/store.js';

const state = storeState as any; // de arrays in de store hebben geen eigen type

// De opzoektabellen voor één render (store.indexed) moeten precies hetzelfde geven als zoeken door de arrays.
const task = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: id, list: 'Inbox', parent_id: null, position: 0, done: false, done_at: null, ...extra }) as any;

describe('store: opzoektabellen tijdens een render', () => {
  afterEach(() => {
    state.open = []; state.done = []; state.sharedDone = []; state.serverLists = []; state.extraLists = [];
  });

  it('geeft dezelfde taken, subtaken en lijsten als zonder tabellen', () => {
    const shared = { owner: { id: 'u1', name: 'Sam' }, members: [] };
    state.open = [task('a', { list: 'Werk' }), task('a1', { parent_id: 'a', list: 'Werk' }), task('b'), task('a2', { parent_id: 'a', list: 'Werk', done: true })];
    state.done = [task('d', { done: true, list: 'Samen' })];
    state.sharedDone = [task('s', { done: true, list: 'Samen' })];
    state.serverLists = [{ name: 'Samen', open: 0, id: 'l1', shared }] as any;
    const plain = {
      a: taskById('a'), d: taskById('d'), s: taskById('s'), x: taskById('x'),
      kids: openKids('a').map((t: any) => t.id), none: openKids('b'), lists: lists(), shared: sharedOf('Samen'), werk: sharedOf('Werk'),
    };
    const fast = indexed(() => ({
      a: taskById('a'), d: taskById('d'), s: taskById('s'), x: taskById('x'),
      kids: openKids('a').map((t: any) => t.id), none: openKids('b'), lists: lists(), shared: sharedOf('Samen'), werk: sharedOf('Werk'),
    }));
    expect(fast).toEqual(plain);
    expect(fast.kids).toEqual(['a1', 'a2']);
    expect(fast.shared).toBe(shared);
  });

  it('een open taak gaat voor dezelfde in Afgerond (zoals find), en de tabellen gelden alleen binnen de aanroep', () => {
    const open = task('a');
    state.open = [open];
    state.done = [task('a', { done: true })];
    expect(indexed(() => taskById('a'))).toBe(open);
    // Erna weer gewoon zoeken: een nieuwe taak is meteen te vinden.
    state.open.push(task('nieuw'));
    expect(taskById('nieuw')?.id).toBe('nieuw');
  });

  it('lijsten worden binnen één render maar één keer berekend, en geneste aanroepen delen de tabellen', () => {
    state.open = [task('a', { list: 'Werk' })];
    indexed(() => {
      const first = lists();
      expect(indexed(() => lists())).toBe(first);
    });
    expect(lists()).not.toBe(lists()); // buiten een render: elke keer vers
  });
});
