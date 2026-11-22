import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { rruleToTick, stableId } from '../public/importkit.js';
import { tickTickRows } from '../public/ticktick.js';
import { projectName, todoistDate, todoistRows } from '../public/todoist.js';
import { setDefaultTime, setTimeZone } from '../public/repeat.js';
import { ADMIN_ID, call, json, session } from './helpers';

const NOW = Date.parse('2026-11-18T12:00:00Z'); // woensdag

describe('rruleToTick', () => {
  it('zet de ritmes om die Tick kent', () => {
    expect(rruleToTick('RRULE:FREQ=DAILY;INTERVAL=1')).toBe('FREQ=DAILY');
    expect(rruleToTick('RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE')).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(rruleToTick('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(rruleToTick('RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2')).toBe('FREQ=MONTHLY;BYDAY=2TU');
    expect(rruleToTick('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=4')).toBe('FREQ=YEARLY');
    expect(rruleToTick('RRULE:FREQ=DAILY;UNTIL=20261231T000000Z')).toBe('FREQ=DAILY;UNTIL=20261231');
  });

  it('weigert wat Tick niet kan', () => {
    expect(rruleToTick('RRULE:FREQ=DAILY;COUNT=5')).toBeNull();
    expect(rruleToTick('RRULE:FREQ=DAILY;TT_SKIP=HOLIDAY')).toBeNull();
    expect(rruleToTick('ERULE:NAME=CUSTOM;BYDATE=20261120')).toBeNull();
    expect(rruleToTick('RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15')).toBeNull();
    expect(rruleToTick('')).toBeNull();
  });
});

describe('TickTick: prioriteit en subtaken', () => {
  const base = { 'List Name': 'Werk', Content: '', 'Due Date': '', Repeat: '', Status: '0', 'Created Time': '2026-10-01T08:00:00+0000',
    'Completed Time': '', Order: '1', parentId: '', projectKind: 'TASK', Priority: '0' };
  it('prioriteit wordt een regel in de notitie; hoog pint vast; een subtaak van een subtaak komt onder de hoofdtaak', () => {
    const out = tickTickRows([
      { ...base, Title: 'Hoog', taskId: 'P1', Priority: '5', Content: 'Notitie' },
      { ...base, Title: 'Laag', taskId: 'P2', Priority: '1' },
      { ...base, Title: 'Kind', taskId: 'P3', parentId: 'P1', Priority: '5' },
      { ...base, Title: 'Kleinkind', taskId: 'P4', parentId: 'P3' },
    ], 'tt', { now: NOW, priority: (p) => `Prioriteit: ${p}` });
    const by = Object.fromEntries(out.tasks.map((t) => [t.id, t]));
    expect(by.ttP1).toMatchObject({ description: 'Notitie\n\nPrioriteit: high', pinned: true, parent_id: null });
    expect(by.ttP2).toMatchObject({ description: 'Prioriteit: low', pinned: false });
    expect(by.ttP3).toMatchObject({ parent_id: 'ttP1', pinned: false });
    expect(by.ttP4).toMatchObject({ parent_id: 'ttP1' });
    expect(out.lost.flattened).toBe(1);
    // Ouders eerst (foreign key).
    expect(out.tasks.findIndex((t) => t.id === 'ttP1')).toBeLessThan(out.tasks.findIndex((t) => t.id === 'ttP4'));
  });
});

const HEAD = 'TYPE,CONTENT,DESCRIPTION,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG';
const line = (type: string, content: string, o: { desc?: string; prio?: string; indent?: string; date?: string; lang?: string; deadline?: string } = {}) =>
  [type, `"${content}"`, `"${o.desc ?? ''}"`, '', o.prio ?? '4', o.indent ?? '1', '', '', `"${o.date ?? ''}"`, o.lang ?? 'en', '', '', '', o.deadline ?? '', ''].join(',');
const WERK = [HEAD,
  line('task', 'Rapport schrijven', { desc: 'Voor Q4', prio: '1', date: '2026-11-25', deadline: '2026-11-30' }),
  line('note', 'Eerste opmerking'),
  line('task', 'Bronnen zoeken', { indent: '2' }),
  line('task', 'Diep', { indent: '3' }),
  line('section', 'Later'),
  line('task', 'Wekelijks overleg', { date: 'every monday at 9am', prio: '2' }),
  line('task', 'Om de twee weken', { date: 'elke 2 weken', lang: 'nl' }),
  line('task', 'Na afvinken', { date: 'every! 3 days' }),
  line('task', 'Frans', { date: 'tous les jours', lang: 'fr' }),
  line('task', ''),
].join('\n');

describe('Todoist omzetten', () => {
  beforeAll(() => { setTimeZone('Europe/Amsterdam'); setDefaultTime('09:00'); });

  it('projectnaam uit de bestandsnaam', () => {
    expect(projectName('Werk [2203306141].csv')).toBe('Werk');
    expect(projectName('backup/Thuis.csv')).toBe('Thuis');
  });

  it('datums en herhalingen in woorden', () => {
    expect(todoistDate('2026-11-25', 'en', NOW)).toMatchObject({ ok: true, wall: '2026-11-25T09:00', rule: null });
    expect(todoistDate('2026-11-25T14:30:00', 'en', NOW)).toMatchObject({ wall: '2026-11-25T14:30' });
    expect(todoistDate('every day', 'en', NOW)).toMatchObject({ rule: 'FREQ=DAILY', wall: '2026-11-18T09:00' });
    expect(todoistDate('every monday at 9am', 'en', NOW)).toMatchObject({ rule: 'FREQ=WEEKLY;BYDAY=MO', wall: '2026-11-18T09:00' });
    expect(todoistDate('every weekday at 8:30', 'en', NOW)).toMatchObject({ rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', wall: '2026-11-18T08:30' });
    expect(todoistDate('every 15th', 'en', NOW)).toMatchObject({ rule: 'FREQ=MONTHLY;BYMONTHDAY=15' });
    expect(todoistDate('every first monday', 'en', NOW)).toMatchObject({ rule: 'FREQ=MONTHLY;BYDAY=1MO' });
    expect(todoistDate('every other week', 'en', NOW)).toMatchObject({ rule: 'FREQ=WEEKLY;INTERVAL=2' });
    expect(todoistDate('elke maandag en vrijdag om 9 uur', 'nl', NOW)).toMatchObject({ rule: 'FREQ=WEEKLY;BYDAY=MO,FR', wall: '2026-11-18T09:00' });
    expect(todoistDate('om de 3 dagen', 'nl', NOW)).toMatchObject({ rule: 'FREQ=DAILY;INTERVAL=3' });
    expect(todoistDate('elk jaar', 'nl', NOW)).toMatchObject({ rule: 'FREQ=YEARLY' });
    expect(todoistDate('every nov 25', 'en', NOW)).toMatchObject({ rule: 'FREQ=YEARLY', wall: '2026-11-25T09:00' });
    // Vaste datum in woorden; een dag zonder jaar die net voorbij is, blijft dit jaar (een verlopen taak).
    expect(todoistDate('Nov 25 14:00', 'en', NOW)).toMatchObject({ ok: true, wall: '2026-11-25T14:00' });
    expect(todoistDate('Nov 10', 'en', NOW)).toMatchObject({ ok: true, wall: '2026-11-10T09:00' });
    // Wat niet kan.
    expect(todoistDate('every! 3 days', 'en', NOW)).toMatchObject({ ok: true, wall: null, lostRepeat: true });
    expect(todoistDate('every 3rd workday', 'en', NOW)).toMatchObject({ wall: null, lostRepeat: true });
    expect(todoistDate('tous les jours', 'fr', NOW)).toMatchObject({ ok: false, wall: null });
    expect(todoistDate('ergens volgend voorjaar', 'nl', NOW)).toMatchObject({ ok: false });
  });

  it('bestand naar taken: lijst, subtaken, opmerkingen, prioriteit, deadline, secties', () => {
    const r = todoistRows([{ name: 'Werk [123].csv', text: WERK }, { name: 'iets.csv', text: 'a,b\n1,2' }], 'td-', {
      now: NOW, priority: (p) => `Prioriteit: ${p}`, deadline: (d) => `Deadline: ${d}`,
    });
    expect(r.invalid).toEqual(['iets.csv']);
    expect(r.skipped).toBe(1);
    expect(r.lost).toEqual({ repeats: 1, dates: 1, flattened: 1, sections: 1 });
    const by = Object.fromEntries(r.tasks.map((t) => [t.title, t]));
    expect(by['Rapport schrijven']).toMatchObject({
      list: 'Werk', parent_id: null, pinned: true, remind_at: '2026-11-25T08:00:00.000Z',
      description: 'Voor Q4\n\nEerste opmerking\n\nPrioriteit: high\nDeadline: 2026-11-30',
    });
    expect(by['Bronnen zoeken'].parent_id).toBe(by['Rapport schrijven'].id);
    expect(by.Diep.parent_id).toBe(by['Rapport schrijven'].id);
    expect(by['Wekelijks overleg']).toMatchObject({ repeat_rule: 'FREQ=WEEKLY;BYDAY=MO', pinned: false, description: 'Prioriteit: medium' });
    expect(by['Om de twee weken'].repeat_rule).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(by['Na afvinken']).toMatchObject({ repeat_rule: null, remind_at: null });
    expect(by.Frans.remind_at).toBeNull();
    // Hetzelfde bestand geeft dezelfde ids (opnieuw importeren maakt niets dubbel).
    expect(todoistRows([{ name: 'Werk [123].csv', text: WERK }], 'td-', { now: NOW }).tasks.map((t) => t.id)).toEqual(r.tasks.map((t) => t.id));
    expect(stableId('a')).not.toBe(stableId('b'));
  });
});

describe('Importeren via de API en ongedaan maken', () => {
  const prefix = `td${ADMIN_ID.slice(0, 8)}-`;
  afterEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tasks WHERE id LIKE 'td%' OR id = 'imp-eigen'"),
      env.DB.prepare("DELETE FROM user_settings WHERE key = 'import_last'"),
    ]);
  });
  const post = async (path: string, body?: unknown) => call(path, {
    method: 'POST', auth: null, headers: { cookie: await session(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const get = async (path: string) => call(path, { auth: null, headers: { cookie: await session() } });

  it('importeert Todoist, opnieuw importeren voegt niets toe, ongedaan maken zet alleen de import in de prullenbak', async () => {
    const files = [{ name: 'Werk [123].csv', text: WERK }];
    const r = await json<any>(await post('/api/import/todoist', { files }));
    expect(r).toMatchObject({ added: 7, existing: 0, skipped: 1, invalid: 0 });
    const rows = (await env.DB.prepare('SELECT * FROM tasks WHERE id LIKE ? ORDER BY position').bind(`${prefix}%`).all<any>()).results;
    expect(rows).toHaveLength(7);
    const weekly = rows.find((t) => t.title === 'Wekelijks overleg');
    expect(weekly).toMatchObject({ repeat_rule: 'FREQ=WEEKLY;BYDAY=MO', source: 'import' });
    expect(weekly.repeat_at).toBe(weekly.remind_at);
    expect(rows.find((t) => t.title === 'Rapport schrijven')).toMatchObject({ pinned: 1 });
    expect(rows.every((t) => t.import_id === rows[0].import_id)).toBe(true);

    // Een taak die je later zelf onder een geïmporteerde taak zet, gaat mee; een eigen taak niet.
    const parent = rows.find((t) => t.title === 'Rapport schrijven');
    await env.DB.prepare("INSERT INTO tasks (id, user_id, title, position, created_at, updated_at) VALUES ('imp-eigen', ?, 'Eigen', 0, '2026-11-18', '2026-11-18')")
      .bind(ADMIN_ID).run();
    await env.DB.prepare("INSERT INTO tasks (id, user_id, title, parent_id, position, created_at, updated_at) VALUES ('tdzelf-kind', ?, 'Zelf', ?, 0, '2026-11-18', '2026-11-18')")
      .bind(ADMIN_ID, parent.id).run();

    expect(await json<any>(await post('/api/import/todoist', { files }))).toMatchObject({ added: 0, existing: 7 });
    const last = (await json<any>(await get('/api/import/last'))).last;
    expect(last).toMatchObject({ source: 'todoist', added: 7, id: rows[0].import_id });

    expect(await json<any>(await post('/api/import/undo'))).toEqual({ removed: 8 });
    const left = await env.DB.prepare("SELECT count(*) AS n FROM tasks WHERE (id LIKE 'td%') AND deleted_at IS NULL").first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect(await env.DB.prepare("SELECT deleted_at FROM tasks WHERE id = 'imp-eigen'").first()).toEqual({ deleted_at: null });
    expect((await json<any>(await get('/api/import/last'))).last).toBeNull();
    expect((await post('/api/import/undo')).status).toBe(404);
  });

  it('weigert een bestand dat geen Todoist-export is', async () => {
    expect((await post('/api/import/todoist', { files: [{ name: 'x.csv', text: 'a,b\n1,2' }] })).status).toBe(400);
    expect((await post('/api/import/todoist', { files: [] })).status).toBe(400);
    expect((await post('/api/import/todoist', 'geen json')).status).toBe(400);
  });
});
