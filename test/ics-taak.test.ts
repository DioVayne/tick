import { describe, expect, it } from 'vitest';
import { googleCalendarUrl, taskIcs } from '../public/ics.js';
import { parseIcs } from '../src/ics';
import { call, json, type Task } from './helpers';

const task = { id: '11111111-2222-4333-8444-555555555555', title: 'Belastingaangifte, deel 1; met \\ en\nregel', remind_at: '2026-11-10T09:00:00.000Z' };

describe('Zet in je agenda', () => {
  it('Google-link: titel, 30 minuten vanaf de herinnering', () => {
    const u = new URL(googleCalendarUrl(task));
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('text')).toBe(task.title);
    expect(u.searchParams.get('dates')).toBe('20261110T090000Z/20261110T093000Z');
  });

  it('.ics: één event met escapes, leesbaar voor de eigen lezer', () => {
    const text = taskIcs(task, Date.parse('2026-11-09T12:00:00Z'));
    expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(text).toContain('UID:11111111-2222-4333-8444-555555555555@tick');
    expect(text).toContain('DTSTART:20261110T090000Z');
    expect(text).toContain('DTEND:20261110T093000Z');
    expect(text.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    const [e] = parseIcs(text, { from: Date.parse('2026-11-09T00:00:00Z'), to: Date.parse('2026-11-20T00:00:00Z'), zone: 'UTC' });
    expect(e).toEqual({ title: 'Belastingaangifte, deel 1; met \\ en regel', start: Date.parse(task.remind_at), end: Date.parse(task.remind_at) + 1_800_000, allDay: false });
  });

  it('GET /api/tasks/:id/calendar.ics als download; zonder herinnering 404', async () => {
    const t = await json<Task>(await call('/api/tasks', { method: 'POST', json: { title: 'Tandarts bellen', remind_at: '2030-01-02T10:00:00Z' } }));
    const res = await call(`/api/tasks/${t.id}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/calendar/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="tick-.*\.ics"/);
    expect(await res.text()).toContain('SUMMARY:Tandarts bellen');
    const none = await json<Task>(await call('/api/tasks', { method: 'POST', json: { title: 'Zonder tijd' } }));
    expect((await call(`/api/tasks/${none.id}/calendar.ics`)).status).toBe(404);
    expect((await call(`/api/tasks/${crypto.randomUUID()}/calendar.ics`)).status).toBe(404);
  });
});
