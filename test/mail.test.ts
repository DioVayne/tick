import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAs, createUser, session } from './helpers';
import { claimCapNotice, dailyLimit, mailEnabled, mailLayout, releaseMail, reserveMail, sendMail } from '../src/mail';

const mailEnv = { ...env, RESEND_API_KEY: 'test-resend', MAIL_FROM: 'Tick <noreply@ticktodo.nl>' };
const MIN = 60_000;
// Elke test een eigen (verre) dag, zodat de daggrens van de ene test de andere niet raakt.
let day = Date.UTC(2031, 0, 1, 12);
const freshDay = () => (day += 10 * 86_400_000);
const user = async () => (await createUser()).id;

afterEach(() => vi.restoreAllMocks());

describe('mailEnabled en dailyLimit', () => {
  it('aan alleen met sleutel én afzender', () => {
    expect(mailEnabled({ ...env, RESEND_API_KEY: '', MAIL_FROM: 'x' })).toBe(false);
    expect(mailEnabled({ ...env, RESEND_API_KEY: 'k', MAIL_FROM: '' })).toBe(false);
    expect(mailEnabled({ ...env, RESEND_API_KEY: undefined, MAIL_FROM: undefined })).toBe(false);
    expect(mailEnabled(mailEnv)).toBe(true);
  });

  it('daggrens: standaard 50, alleen een geheel getal vanaf 1 telt', () => {
    expect(dailyLimit({ ...env, MAIL_DAILY_LIMIT: undefined })).toBe(50);
    expect(dailyLimit({ ...env, MAIL_DAILY_LIMIT: '10' })).toBe(10);
    expect(dailyLimit({ ...env, MAIL_DAILY_LIMIT: '0' })).toBe(50);
    expect(dailyLimit({ ...env, MAIL_DAILY_LIMIT: 'x' })).toBe(50);
  });
});

describe('sendMail', () => {
  it('stuurt via Resend met de sleutel en geeft true bij 2xx', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    expect(await sendMail(mailEnv, { to: 'a@example.test', subject: 'S', text: 'T', html: '<p>T</p>' })).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Bearer test-resend');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ from: 'Tick <noreply@ticktodo.nl>', to: ['a@example.test'], subject: 'S' });
  });

  it('een fout van Resend geeft false en logt geen adres of sleutel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nee', { status: 422 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail(mailEnv, { to: 'a@example.test', subject: 'S', text: 'T', html: 'H' })).toBe(false);
    expect(log).toHaveBeenCalled();
    for (const args of log.mock.calls) expect(args.join(' ')).not.toMatch(/test-resend|a@example\.test/);
  });

  it('een netwerkfout geeft false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('weg'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail(mailEnv, { to: 'a@example.test', subject: 'S', text: 'T', html: 'H' })).toBe(false);
  });
});

describe('mailLayout', () => {
  it('tekst met de link voluit, html met knop en ge-escapete tekst', () => {
    const m = mailLayout('nl', { heading: 'Kop', intro: 'Hoi <script>x</script>', button: { label: 'Klik', url: 'https://tick.test/reset/abc' }, outro: 'Doei' });
    expect(m.text).toContain('https://tick.test/reset/abc');
    expect(m.text).toContain('Kop');
    expect(m.html).toContain('href="https://tick.test/reset/abc"');
    expect(m.html).toContain('Klik');
    expect(m.html).not.toContain('<script>');
  });
});

describe('reserveMail', () => {
  it('per account 1 per 5 minuten en 5 per 24 uur', async () => {
    const id = await user(); const t = freshDay();
    expect(await reserveMail(env.DB, env, 'reset', id, t)).toHaveProperty('id');
    expect(await reserveMail(env.DB, env, 'reset', id, t + 1 * MIN)).toBe('account_limit');
    for (let i = 1; i <= 4; i++) expect(await reserveMail(env.DB, env, 'reset', id, t + i * 6 * MIN)).toHaveProperty('id');
    expect(await reserveMail(env.DB, env, 'reset', id, t + 60 * MIN)).toBe('account_limit');
    // Een andere soort mail heeft zijn eigen grens per account.
    expect(await reserveMail(env.DB, env, 'verify', id, t + 60 * MIN)).toHaveProperty('id');
  });

  it('daggrens voor heel Tick, per UTC-dag, alle soorten samen', async () => {
    const lim = { ...env, MAIL_DAILY_LIMIT: '2' }; const t = freshDay();
    expect(await reserveMail(env.DB, lim, 'reset', await user(), t - 86_400_000)).toHaveProperty('id'); // gisteren telt niet
    expect(await reserveMail(env.DB, lim, 'reset', await user(), t)).toHaveProperty('id');
    expect(await reserveMail(env.DB, lim, 'verify', await user(), t)).toHaveProperty('id');
    expect(await reserveMail(env.DB, lim, 'reset', await user(), t)).toBe('daily_limit');
  });

  it('twee aanvragen tegelijk voor één account: precies één slaagt', async () => {
    const id = await user(); const t = freshDay();
    const r = await Promise.all([reserveMail(env.DB, env, 'reset', id, t), reserveMail(env.DB, env, 'reset', id, t)]);
    expect(r.filter((x) => typeof x === 'object')).toHaveLength(1);
  });

  it('eigen grenzen per soort: zonder wachttijd, 5 per 24 uur', async () => {
    const id = await user(); const t = freshDay();
    const o = { gapMs: 0, perDay: 5 };
    for (let i = 0; i < 5; i++) expect(await reserveMail(env.DB, env, 'invite_mail', id, t + i, o)).toHaveProperty('id');
    expect(await reserveMail(env.DB, env, 'invite_mail', id, t + 10, o)).toBe('account_limit');
  });

  it('dailyShare: deze soort mag maar een deel van de daggrens gebruiken; andere soorten daarna nog wel', async () => {
    const lim = { ...env, MAIL_DAILY_LIMIT: '4' }; const t = freshDay();
    const o = { gapMs: 0, dailyShare: 0.5 };
    expect(await reserveMail(env.DB, lim, 'invite_mail', await user(), t, o)).toHaveProperty('id');
    expect(await reserveMail(env.DB, lim, 'invite_mail', await user(), t, o)).toHaveProperty('id');
    expect(await reserveMail(env.DB, lim, 'invite_mail', await user(), t, o)).toBe('daily_limit');
    expect(await reserveMail(env.DB, lim, 'reset', await user(), t)).toHaveProperty('id');
  });

  it('recipient: hooguit één mail per adres per 24 uur, ook van verschillende afzenders en in andere schrijfwijze', async () => {
    const t = freshDay(); const email = `ontvanger-${t}@ex.test`;
    const o = { gapMs: 0, recipient: email.toUpperCase() };
    expect(await reserveMail(env.DB, env, 'invite_mail', await user(), t, o)).toHaveProperty('id');
    expect(await reserveMail(env.DB, env, 'invite_mail', await user(), t + MIN, { gapMs: 0, recipient: ` ${email} ` })).toBe('account_limit');
    expect(await reserveMail(env.DB, env, 'invite_mail', await user(), t + 86_400_001, o)).toHaveProperty('id');
    const row = await env.DB.prepare("SELECT recipient_hash FROM mail_log WHERE kind = 'invite_mail' AND recipient_hash IS NOT NULL LIMIT 1").first<{ recipient_hash: string }>();
    expect(row!.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('releaseMail maakt de plek weer vrij', async () => {
    const id = await user(); const t = freshDay();
    const r = await reserveMail(env.DB, env, 'reset', id, t);
    if (typeof r !== 'object') throw new Error('verwacht een reservering');
    await releaseMail(env.DB, r.id);
    expect(await reserveMail(env.DB, env, 'reset', id, t)).toHaveProperty('id');
  });
});

describe('claimCapNotice', () => {
  it('één keer per UTC-dag', async () => {
    const t = freshDay();
    expect(await claimCapNotice(env.DB, t)).toBe(true);
    expect(await claimCapNotice(env.DB, t + 60 * MIN)).toBe(false);
    expect(await claimCapNotice(env.DB, t + 86_400_000)).toBe(true);
  });
});

it('een account met verstuurde mails kan nog verwijderd worden', async () => {
  const id = await user();
  await reserveMail(env.DB, env, 'reset', id, freshDay());
  const res = await callAs(await session(), `/api/users/${id}`, { method: 'DELETE' });
  expect(res.status).toBeLessThan(300);
  expect(await env.DB.prepare('SELECT 1 FROM mail_log WHERE user_id = ?').bind(id).first()).toBeNull();
});
