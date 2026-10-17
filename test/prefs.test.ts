import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { setDefaultTime, setTimeZone, weekdayOrder } from '../public/repeat.js';
import { repeatColumns } from '../src/repeat';
import { loadPrefs, setSetting } from '../src/prefs';
import { call, INBOX, json, type Task } from './helpers';

afterEach(async () => {
  for (const k of ['timezone', 'reminder_time']) await setSetting(env.DB, k, null);
});

describe('installatie-instellingen', () => {
  it('zonder rijen gelden de config-waarden', async () => {
    expect(await loadPrefs(env)).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00', weekStart: 'mon', defaultLocale: 'en', fallbackWebhook: null, fallbackFromEnv: false });
  });
  it('een rij in settings gaat voor de config', async () => {
    await setSetting(env.DB, 'timezone', 'Europe/London');
    await setSetting(env.DB, 'reminder_time', '07:30');
    expect(await loadPrefs(env)).toMatchObject({ timeZone: 'Europe/London', reminderTime: '07:30' });
  });
  it('ongeldige waarden vallen terug', async () => {
    await setSetting(env.DB, 'timezone', 'Mars/Olympus');
    await setSetting(env.DB, 'reminder_time', '25:99');
    expect(await loadPrefs(env)).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00' });
  });
  it('een kale inbox-datum krijgt de ingestelde reminder-tijd', async () => {
    await setSetting(env.DB, 'reminder_time', '07:30');
    const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'x', due: '2030-03-04' } });
    expect((await json<Task>(res)).remind_at).toBe('2030-03-04T06:30:00.000Z');
  });
  it('een ritme zonder reminder start op de ingestelde reminder-tijd', async () => {
    await setSetting(env.DB, 'reminder_time', '07:30');
    const p = await loadPrefs(env);
    setTimeZone(p.timeZone);
    setDefaultTime(p.reminderTime);
    try {
      const start = String(repeatColumns('FREQ=DAILY', null).repeat_start);
      expect(new Date(start).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })).toBe('07:30');
    } finally {
      setDefaultTime('09:00');
    }
  });
  it('weekdayOrder', () => {
    expect(weekdayOrder('mon')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder('sun')).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});
