import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { weekdayOrder } from '../public/repeat.js';
import { repeatColumns } from '../src/repeat';
import { loadInstallPrefs, loadUserPrefs, userSettingStmt } from '../src/prefs';
import { ADMIN_ID, call, INBOX, json, type Task } from './helpers';

/** Alle instellingen van de beheerder, zoals de middleware ze zet. */
const loadPrefs = async () => ({ ...await loadInstallPrefs(env), ...await loadUserPrefs(env, { id: ADMIN_ID, role: 'admin' }) });
const setSetting = (key: string, value: string) => userSettingStmt(env.DB, ADMIN_ID, key, value).run();

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(ADMIN_ID),
    env.DB.prepare("DELETE FROM settings WHERE key = 'default_locale'"),
  ]);
});

describe('instellingen van de beheerder', () => {
  it('zonder rijen gelden de config-waarden', async () => {
    expect(await loadPrefs()).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00', weekStart: 'mon', defaultLocale: 'en', fallbackWebhook: null, fallbackFromEnv: false });
  });
  it('een rij in user_settings gaat voor de config', async () => {
    await setSetting('timezone', 'Europe/London');
    await setSetting('reminder_time', '07:30');
    expect(await loadPrefs()).toMatchObject({ timeZone: 'Europe/London', reminderTime: '07:30' });
  });
  it('ongeldige waarden vallen terug', async () => {
    await setSetting('timezone', 'Mars/Olympus');
    await setSetting('reminder_time', '25:99');
    expect(await loadPrefs()).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00' });
  });
  it('een kale inbox-datum krijgt de ingestelde reminder-tijd', async () => {
    await setSetting('reminder_time', '07:30');
    const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'x', due: '2030-03-04' } });
    expect((await json<Task>(res)).remind_at).toBe('2030-03-04T06:30:00.000Z');
  });
  it('een ritme zonder reminder start op de ingestelde reminder-tijd', async () => {
    await setSetting('reminder_time', '07:30');
    const p = await loadPrefs();
    const start = String(repeatColumns('FREQ=DAILY', null, p).repeat_start);
    expect(new Date(start).toLocaleTimeString('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })).toBe('07:30');
  });
  it('weekdayOrder', () => {
    expect(weekdayOrder('mon')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder('sun')).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});
