import { describe, expect, it } from 'vitest';
import { tickTickRows } from '../public/ticktick.js';

const base = { 'List Name': 'Werk', Content: '', Reminder: '', 'Due Date': '', Status: '0', 'Created Time': '', 'Completed Time': '', Order: '1', parentId: '', projectKind: 'TASK' };

describe('TickTick-import: datums', () => {
  it('een onleesbare datum breekt de import niet af: dat veld wordt leeg', () => {
    const rows = [
      { ...base, Title: 'Kapotte datums', taskId: 'B1', Reminder: 'TRIGGER:PT0S', 'Due Date': 'morgen', 'Created Time': 'gisteren' },
      { ...base, Title: 'Klaar, kapotte afronddatum', taskId: 'B2', Status: '2', 'Created Time': '2026-10-01T08:00:00+0000', 'Completed Time': 'xx' },
      { ...base, Title: 'Goed', taskId: 'B3', Reminder: 'TRIGGER:PT0S', 'Due Date': '2026-10-20T10:00:00+0000', 'Created Time': '2026-10-01T08:00:00+0000' },
    ];
    const { tasks } = tickTickRows(rows);
    expect(tasks).toHaveLength(3);
    const [bad, done, good] = tasks;
    expect(bad.remind_at).toBeNull();
    expect(Number.isNaN(Date.parse(bad.created_at))).toBe(false); // valt terug op nu
    expect(done.done_at).toBe('2026-10-01T08:00:00.000Z'); // valt terug op de aanmaakdatum
    expect(good.remind_at).toBe('2026-10-20T10:00:00.000Z');
  });
});
