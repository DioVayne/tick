import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv, readTickTickText } from '../public/ticktick.js';
import { call, json, session } from './helpers';

const HEADER = [
  'Folder Name', 'List Name', 'Title', 'Kind', 'Tags', 'Content', 'Is Check list', 'Start Date', 'Due Date', 'Reminder',
  'Repeat', 'Priority', 'Status', 'Created Time', 'Completed Time', 'Order', 'Timezone', 'Is All Day', 'Is Floating',
  'Column Name', 'Column Order', 'View Mode', 'taskId', 'parentId', 'projectKind',
];
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const row = (o: Record<string, string>) => HEADER.map((h) => q(o[h] ?? '')).join(',');
const CSV = [
  '"Date: 2026-10-01+0000"', '"Version: 7.1"', '"Status: 0 Normal 1 Completed 2 Archived"',
  HEADER.map(q).join(','),
  row({ 'List Name': 'Werk', Title: 'Ouder, met komma', Content: 'Regel 1\nregel \\(2\\)\n▫\nstap', 'Due Date': '2026-10-20T10:00:00+0000', Reminder: 'TRIGGER:PT0S', 'Created Time': '2026-10-01T08:00:00+0000', Order: '1024', taskId: 'A1', projectKind: 'TASK' }),
  row({ 'List Name': 'Werk', Title: 'Subtaak "quote"', 'Created Time': '2026-10-01T08:05:00+0000', Order: '2048', taskId: 'A2', parentId: 'A1', projectKind: 'TASK' }),
  row({ Title: 'Klaar', Status: '2', 'Due Date': '2026-10-02T10:00:00+0000', Reminder: 'TRIGGER:PT0S', 'Created Time': '2026-10-01T09:00:00+0000', 'Completed Time': '2026-10-02T11:00:00+0000', Order: '3', taskId: 'A3', projectKind: 'TASK' }),
  row({ 'List Name': 'Werk', Title: '  ', taskId: 'A4', projectKind: 'TASK' }),
  row({ 'List Name': 'Werk', Title: 'Wees', Order: '6', taskId: 'A6', parentId: 'A4', projectKind: 'TASK' }),
  row({ 'List Name': 'Notities', Title: 'Notitie', Kind: 'NOTE', taskId: 'A5', projectKind: 'NOTE' }),
].join('\n');

const importCsv = async (text: string) =>
  call('/api/import/ticktick', { method: 'POST', body: text, auth: null, headers: { cookie: await session() } });
const get = async (id: string) => env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>();

afterEach(async () => {
  await env.DB.prepare("DELETE FROM tasks WHERE id LIKE 'ttA%'").run();
});

describe('TickTick-import', () => {
  it('importeert, en opnieuw importeren laat bestaande taken met rust', async () => {
    expect(await json<any>(await importCsv(CSV))).toEqual({ added: 4, existing: 0, skipped: 1 });
    const parent = await get('ttA1');
    expect(parent).toMatchObject({
      title: 'Ouder, met komma', description: 'Regel 1\nregel (2)\nstap', list: 'Werk', parent_id: null, position: 1024,
      remind_at: '2026-10-20T10:00:00.000Z', done: 0, notified: 0, source: 'import', created_at: '2026-10-01T08:00:00.000Z',
    });
    expect(await get('ttA2')).toMatchObject({ title: 'Subtaak "quote"', parent_id: 'ttA1' });
    expect(await get('ttA3')).toMatchObject({ list: 'Inbox', done: 1, remind_at: null, done_at: '2026-10-02T11:00:00.000Z' });
    expect(await get('ttA6')).toMatchObject({ title: 'Wees', parent_id: null }); // ouder zonder titel
    expect(await get('ttA5')).toBeNull();

    await call('/api/tasks/ttA1', { method: 'PATCH', json: { title: 'Gewijzigd in Tick' } });
    expect(await json<any>(await importCsv(CSV))).toEqual({ added: 0, existing: 4, skipped: 1 });
    expect((await get('ttA1')).title).toBe('Gewijzigd in Tick');
  });

  it('weigert tekst zonder TickTick-kop en te grote bestanden', async () => {
    const res = await importCsv('a,b\n1,2');
    expect(res.status).toBe(400);
    expect((await json<any>(res)).error).toContain('TickTick');
    const noTitle = HEADER.filter((h) => h !== 'Title').map(q).join(',');
    expect((await importCsv(`${noTitle}\n`)).status).toBe(400); // kolom ontbreekt
    expect((await importCsv('x'.repeat(10 * 1024 * 1024 + 1))).status).toBe(400);
  });

  it('weigert een API-token zonder sessie', async () => {
    expect((await call('/api/import/ticktick', { method: 'POST', body: CSV })).status).toBe(403);
  });

  it("parseCsv: aanhalingstekens, komma's en regeleinden in velden", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n"x\ny",z\n')).toEqual([['a', 'b,c', 'd "e"'], ['x\ny', 'z']]);
  });

  it('readTickTickText: BOM en voorregels weg; zonder kop leeg', () => {
    const rows = readTickTickText(`﻿Version: 7
${HEADER.map(q).join(',')}
${row({ Title: 'Een', taskId: 'x' })}
`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Title: 'Een', taskId: 'x' });
    expect(readTickTickText('a,b')).toEqual([]);
  });
});
