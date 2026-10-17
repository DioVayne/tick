import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInstallPrefs, userSettingStmt } from '../src/prefs';
import { reminderPayload, runReminders, sendToAll } from '../src/push';
import { STRINGS } from '../public/i18n.js';
import { ADMIN_ID, createTask } from './helpers';

const notified = async (id: string) =>
  (await env.DB.prepare('SELECT notified FROM tasks WHERE id = ?').bind(id).first<{ notified: number }>())!.notified;

describe('runReminders (zonder push en zonder fallback)', () => {
  it('probeert het binnen 15 minuten opnieuw', async () => {
    const t = await createTask({ title: 'net verlopen', remind_at: new Date(Date.now() - 60_000).toISOString() });
    await runReminders(env, await loadInstallPrefs(env));
    expect(await notified(t.id)).toBe(0);
  });

  it('geeft het na 15 minuten zonder bezorging op', async () => {
    const t = await createTask({ title: 'lang verlopen', remind_at: new Date(Date.now() - 20 * 60_000).toISOString() });
    await runReminders(env, await loadInstallPrefs(env));
    expect(await notified(t.id)).toBe(1);
  });

  it('laat toekomstige reminders met rust', async () => {
    const t = await createTask({ title: 'later', remind_at: new Date(Date.now() + 3_600_000).toISOString() });
    await runReminders(env, await loadInstallPrefs(env));
    expect(await notified(t.id)).toBe(0);
  });
});

describe('reminderPayload', () => {
  it('zet bij een herhalende taak de keer (repeat_at) als occurrence in het bericht', () => {
    const p = reminderPayload({ id: 'a', title: 'planten', description: 'x', repeat_at: '2099-10-18T08:00:00.000Z' });
    expect(p).toMatchObject({ taskId: 'a', occurrence: '2099-10-18T08:00:00.000Z' });
  });

  it('laat occurrence weg bij een gewone taak', () => {
    expect(reminderPayload({ id: 'b', title: 'los', description: '', repeat_at: null })).not.toHaveProperty('occurrence');
  });

  it('geeft de actieknoppen mee in de taal van de installatie', () => {
    const t = { id: 'c', title: 'x', description: '' };
    expect(reminderPayload(t, 'nl').actions).toEqual([{ action: 'done', title: 'Klaar' }, { action: 'snooze', title: '+1 uur' }]);
    expect(reminderPayload(t, undefined).actions).toEqual([{ action: 'done', title: 'Done' }, { action: 'snooze', title: '+1 hour' }]);
  });
});

describe('sendToAll: taal per abonnement', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare('DELETE FROM push_subscriptions').run();
  });

  it('bouwt de melding per abonnement in zijn eigen taal, zonder taal in de standaardtaal', async () => {
    const ins = env.DB.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at,locale,user_id) VALUES (?,?,?,?,?,?,?)');
    await env.DB.batch([
      ins.bind('https://push.invalid/nl', 'p', 'a', '', 'x', 'nl', ADMIN_ID),
      ins.bind('https://push.invalid/en', 'p', 'a', '', 'x', 'en', ADMIN_ID),
      ins.bind('https://push.invalid/oud', 'p', 'a', '', 'x', null, ADMIN_ID),
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const t = { id: 'a', title: 'x', description: '' };
    const make = vi.fn((locale: 'en' | 'nl') => reminderPayload(t, locale));
    // Een geldige sleutel, anders stopt sendToAll vóór het opbouwen (de nep-abonnementen zelf mogen falen).
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const VAPID_PRIVATE_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await sendToAll({ ...env, VAPID_PRIVATE_KEY }, ADMIN_ID, make, 'nl');
    expect(r.total).toBe(3);
    expect(make.mock.calls.map((c) => c[0]).sort()).toEqual(['en', 'nl', 'nl']);
    const titles = make.mock.results.map((x) => x.value.actions[0].title);
    expect(titles.sort()).toEqual([STRINGS.en['push.done'], STRINGS.nl['push.done'], STRINGS.nl['push.done']].sort());
  });
});

describe('runReminders: fallback', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(ADMIN_ID).run();
  });

  it('post via de fallback_webhook van de eigenaar in de standaardtaal', async () => {
    const t = await createTask({ title: 'fb', remind_at: new Date(Date.now() - 60_000).toISOString() });
    await userSettingStmt(env.DB, ADMIN_ID, 'fallback_webhook', 'https://hook.invalid/x').run();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await runReminders(env, { ...(await loadInstallPrefs(env)), defaultLocale: 'nl' });
    const hit = spy.mock.calls.find((c) => String(c[0]) === 'https://hook.invalid/x')!;
    expect(JSON.parse(hit[1]!.body as string).actions[0].title).toBe(STRINGS.nl['push.done']);
    expect(await notified(t.id)).toBe(1);
  });

  it('zonder fallbackWebhook niets posten', async () => {
    await createTask({ title: 'geen', remind_at: new Date(Date.now() - 60_000).toISOString() });
    const spy = vi.spyOn(globalThis, 'fetch');
    await runReminders(env, await loadInstallPrefs(env));
    expect(spy).not.toHaveBeenCalled();
  });
});
