import { describe, expect, it } from 'vitest';
import { applyListOp, findList, mergeLists, normName, sameName } from '../public/lists.js';

const t = (id: string, list: string, extra: Record<string, unknown> = {}) => ({ id, list, done: false, parent_id: null, ...extra });

describe('lijstnamen', () => {
  it('sameName negeert hoofdletters en spaties eromheen', () => {
    expect(sameName('werk ', 'Werk')).toBe(true);
    expect(sameName('Werk', 'Werken')).toBe(false);
    // Alleen hoofdletters tellen niet; accenten wel (anders: spec).
    expect(sameName('Cafe', 'Café')).toBe(false);
    expect(findList(['Inbox', 'Werk'], ' werk')).toBe('Werk');
    expect(normName('   ')).toBe('Inbox');
  });
  it('mergeLists: Inbox eerst, tellingen uit de taken, lijsten met alleen afgerond uit de server, sessielijsten erbij', () => {
    const tasks = [t('1', 'Werk'), t('2', 'Werk', { parent_id: '1' }), t('3', 'Inbox')];
    expect(mergeLists([{ name: 'Archief', open: 0 }, { name: 'Werk', open: 9 }], tasks, ['Nieuw'])).toEqual([
      { name: 'Inbox', open: 1 }, { name: 'Archief', open: 0 }, { name: 'Nieuw', open: 0 }, { name: 'Werk', open: 2 },
    ]);
  });
  it('mergeLists toont Werk en werk uit oude data als twee lijsten', () => {
    expect(mergeLists([], [t('1', 'Werk'), t('2', 'werk')], []).map((l) => l.name)).toEqual(['Inbox', 'Werk', 'werk']);
  });
  it('applyListOp hernoemen raakt alleen exact die lijst', () => {
    const out = applyListOp([t('1', 'Wekr'), t('2', 'wekr')], { type: 'list-rename', from: 'Wekr', to: 'Werk' });
    expect(out.map((x) => x.list)).toEqual(['Werk', 'wekr']);
  });
  it('applyListOp verwijderen: naar Inbox, of weg inclusief subtaken', () => {
    const tasks = [t('1', 'Thuis'), t('2', 'Thuis', { parent_id: '1' }), t('3', 'Werk')];
    expect(applyListOp(tasks, { type: 'list-delete', name: 'Thuis', tasks: 'inbox' }).map((x) => x.list)).toEqual(['Inbox', 'Inbox', 'Werk']);
    expect(applyListOp(tasks, { type: 'list-delete', name: 'Thuis', tasks: 'delete' }).map((x) => x.id)).toEqual(['3']);
  });
  it('een create in de oude lijst vóór de hernoeming eindigt in de nieuwe lijst', () => {
    // Zo speelt load() de outbox na: eerst de create (taak in Wekr), dan de hernoeming.
    const afterCreate = [t('1', 'Wekr')];
    expect(applyListOp(afterCreate, { type: 'list-rename', from: 'Wekr', to: 'Werk' })[0].list).toBe('Werk');
  });
  it('mergeLists bewaart shared van de server, zoals id', () => {
    const shared = { id: 'L1', mine: true, owner: { id: 'u1', name: 'Ik' }, members: [], notify_done: false };
    const out = mergeLists([{ name: 'Boodschappen', open: 0, id: 'L1', shared }, { name: 'Werk', open: 0, id: 'L2', shared: null }], [], []);
    expect(out).toEqual([
      { name: 'Inbox', open: 0 }, { name: 'Boodschappen', open: 0, id: 'L1', shared }, { name: 'Werk', open: 0, id: 'L2' },
    ]);
  });
});
