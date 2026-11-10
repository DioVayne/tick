import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv, readTickTickText } from '../public/ticktick.js';
import { userSettingStmt } from '../src/prefs';
import { ADMIN_ID, call, callAs, createUser, json, session } from './helpers';

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
  row({ 'List Name': 'Werk', Title: 'Ouder, met komma', Content: 'Regel 1\nregel \\(2\\)\n▫\nstap', 'Due Date': '2099-10-20T10:00:00+0000', Reminder: 'TRIGGER:PT0S', 'Created Time': '2026-10-01T08:00:00+0000', Order: '1024', taskId: 'A1', projectKind: 'TASK' }),
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
  await env.DB.prepare("DELETE FROM tasks WHERE id LIKE 'ttA%' OR id LIKE 'tt%-A%'").run();
});

describe('TickTick-import', () => {
  it('importeert, en opnieuw importeren laat bestaande taken met rust', async () => {
    expect(await json<any>(await importCsv(CSV))).toEqual({ added: 4, existing: 0, skipped: 1, repeats: 0 });
    const parent = await get('ttA1');
    expect(parent).toMatchObject({
      title: 'Ouder, met komma', description: 'Regel 1\nregel (2)\nstap', list: 'Werk', parent_id: null, position: 1024,
      remind_at: '2099-10-20T10:00:00.000Z', done: 0, notified: 0, source: 'import', created_at: '2026-10-01T08:00:00.000Z',
    });
    expect(await get('ttA2')).toMatchObject({ title: 'Subtaak "quote"', parent_id: 'ttA1' });
    expect(await get('ttA3')).toMatchObject({ list: 'Inbox', done: 1, remind_at: null, done_at: '2026-10-02T11:00:00.000Z' });
    expect(await get('ttA6')).toMatchObject({ title: 'Wees', parent_id: null }); // ouder zonder titel
    expect(await get('ttA5')).toBeNull();

    await call('/api/tasks/ttA1', { method: 'PATCH', json: { title: 'Gewijzigd in Tick' } });
    expect(await json<any>(await importCsv(CSV))).toEqual({ added: 0, existing: 4, skipped: 1, repeats: 0 });
    expect((await get('ttA1')).title).toBe('Gewijzigd in Tick');
  });

  it('een ander dan de beheerder krijgt eigen ids; dezelfde backup kan bij twee mensen', async () => {
    const b = await createUser();
    expect((await importCsv(CSV)).status).toBe(200);
    const r = await json<{ added: number }>(await callAs(b.cookie, '/api/import/ticktick', { method: 'POST', body: CSV }));
    expect(r.added).toBe(4);
    const p = `tt${b.id.slice(0, 8)}-`;
    expect(await get(`${p}A2`)).toMatchObject({ parent_id: `${p}A1`, user_id: b.id });
    expect(await get('ttA1')).toMatchObject({ user_id: ADMIN_ID });
  });

  it('een kind waarvan de ouder-id al bij een ander account bestaat, krijgt parent_id null', async () => {
    const b = await createUser();
    expect((await callAs(b.cookie, '/api/import/ticktick', { method: 'POST', body: CSV })).status).toBe(200);
    const theirs = `${b.id.slice(0, 8)}-A1`; // bij de beheerder wordt dit tt<b>-A1: de id van B's taak
    const csv = [
      HEADER.map(q).join(','),
      row({ Title: 'Kaper-ouder', taskId: theirs, projectKind: 'TASK' }),
      row({ Title: 'Kind', taskId: 'A9K', parentId: theirs, projectKind: 'TASK' }),
    ].join('\n');
    expect((await importCsv(csv)).status).toBe(200);
    expect(await get('ttA9K')).toMatchObject({ user_id: ADMIN_ID, parent_id: null });
    expect(await get(`tt${theirs}`)).toMatchObject({ user_id: b.id, title: 'Ouder, met komma' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM tasks WHERE parent_id = ? AND user_id = ?').bind(`tt${theirs}`, ADMIN_ID).first()).toEqual({ n: 0 });
  });

  it('weigert tekst zonder TickTick-kop en te grote bestanden', async () => {
    const res = await importCsv('a,b\n1,2');
    expect(res.status).toBe(400);
    expect((await json<any>(res)).error).toContain('TickTick');
    const noTitle = HEADER.filter((h) => h !== 'Title').map(q).join(',');
    expect((await importCsv(`${noTitle}\n`)).status).toBe(400); // kolom ontbreekt
    expect((await importCsv('x'.repeat(10 * 1024 * 1024 + 1))).status).toBe(400);
  });

  it('een tijd die al voorbij is, staat na de import als gemeld; een in de toekomst niet', async () => {
    const csv = [
      HEADER.map(q).join(','),
      row({ Title: 'Verlopen', 'Due Date': '2020-01-05T10:00:00+0000', taskId: 'A10', projectKind: 'TASK' }),
      row({ Title: 'Straks', 'Due Date': '2099-01-05T10:00:00+0000', taskId: 'A11', projectKind: 'TASK' }),
    ].join('\n');
    expect(await json<any>(await importCsv(csv))).toEqual({ added: 2, existing: 0, skipped: 0, repeats: 0 });
    expect(await get('ttA10')).toMatchObject({ remind_at: '2020-01-05T10:00:00.000Z', notified: 1 });
    expect(await get('ttA11')).toMatchObject({ remind_at: '2099-01-05T10:00:00.000Z', notified: 0 });
  });

  it('hele dag: de eigen zone en "Herinnering zonder tijd"; herhalingen worden geteld', async () => {
    const b = await createUser();
    await userSettingStmt(env.DB, b.id, 'timezone', 'America/New_York').run();
    await userSettingStmt(env.DB, b.id, 'reminder_time', '07:30').run();
    const csv = [
      HEADER.map(q).join(','),
      // Middernacht 21 januari in Amsterdam, zoals TickTick een hele dag schrijft.
      row({ Title: 'Hele dag', 'Due Date': '2099-01-20T23:00:00+0000', 'Is All Day': 'true', Timezone: 'Europe/Amsterdam', taskId: 'A12', projectKind: 'TASK' }),
      row({ Title: 'Wekelijks', 'Due Date': '2099-01-22T10:00:00+0000', Repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=1', taskId: 'A13', projectKind: 'TASK' }),
    ].join('\n');
    const res = await callAs(b.cookie, '/api/import/ticktick', { method: 'POST', body: csv });
    expect(await json<any>(res)).toEqual({ added: 2, existing: 0, skipped: 0, repeats: 1 });
    const p = `tt${b.id.slice(0, 8)}-`;
    // 21 januari 07:30 in New York (-05:00) = 12:30 UTC
    expect(await get(`${p}A12`)).toMatchObject({ remind_at: '2099-01-21T12:30:00.000Z', notified: 0 });
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
