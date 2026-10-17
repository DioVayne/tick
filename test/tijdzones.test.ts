import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { getTimeZone, setTimeZone } from '../public/repeat.js';
import { callAs, createUser, json, type Task } from './helpers';

const POISON = 'Pacific/Kiritimati'; // UTC+14: wie de globale zone leest, rekent zichtbaar fout

type User = Awaited<ReturnType<typeof createUser>>;

async function withZone(timeZone: string, reminderTime?: string): Promise<User> {
  const u = await createUser();
  const res = await callAs(u.cookie, '/api/settings', { method: 'PATCH', json: { timeZone, ...(reminderTime ? { reminderTime } : {}) } });
  expect(res.status).toBe(200);
  return u;
}

/** Zet de globale zone van de rekenmodule op een foute waarde, voert `fn` uit en controleert dat geen request hem verandert. */
async function poisoned(fn: () => Promise<void>): Promise<void> {
  setTimeZone(POISON);
  try {
    await fn();
    expect(getTimeZone()).toBe(POISON); // geen request laat een zone achter
  } finally {
    setTimeZone(env.TIMEZONE!);
  }
}

describe('tijdzone per request', () => {
  it('twee gebruikers met verschillende zones maken tegelijk een taak met een tijd zonder zone', async () => {
    const a = await withZone('Europe/Amsterdam');
    const b = await withZone('America/New_York');
    await poisoned(async () => {
      const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        callAs((i % 2 ? b : a).cookie, '/api/tasks', { method: 'POST', json: { title: `t${i}`, remind_at: '2030-06-01T10:00' } })));
      for (const [i, r] of res.entries()) {
        expect(r.status).toBe(201);
        expect((await json<Task>(r)).remind_at).toBe(i % 2 ? '2030-06-01T14:00:00.000Z' : '2030-06-01T08:00:00.000Z');
      }
    });
  });

  it('een kale datum krijgt tegelijk ieders eigen herinneringstijd', async () => {
    const a = await withZone('Europe/Amsterdam', '07:30');
    const b = await withZone('America/New_York', '09:00');
    await poisoned(async () => {
      const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        callAs((i % 2 ? b : a).cookie, '/api/tasks', { method: 'POST', json: { title: `d${i}`, remind_at: '2030-06-01' } })));
      for (const [i, r] of res.entries()) {
        expect(r.status).toBe(201);
        expect((await json<Task>(r)).remind_at).toBe(i % 2 ? '2030-06-01T13:00:00.000Z' : '2030-06-01T05:30:00.000Z');
      }
    });
  });

  it('een herhalende taak doorschuiven rekent in de zone van de eigenaar', async () => {
    const a = await withZone('Europe/Amsterdam');
    const b = await withZone('America/New_York');
    const make = async (u: User) => json<Task>(await callAs(u.cookie, '/api/tasks', {
      method: 'POST', json: { title: 'dagelijks', remind_at: '2030-06-01T10:00', repeat: 'FREQ=DAILY' },
    }));
    const ta = await make(a);
    const tb = await make(b);
    expect(tb.remind_at).toBe('2030-06-01T14:00:00.000Z');
    await poisoned(async () => {
      const res = await Promise.all([
        callAs(b.cookie, `/api/tasks/${tb.id}/done`, { method: 'POST' }),
        callAs(a.cookie, `/api/tasks/${ta.id}/done`, { method: 'POST' }),
      ]);
      for (const r of res) expect(r.status).toBe(200);
    });
    const got = async (u: User, id: string) => (await json<Task[]>(await callAs(u.cookie, '/api/tasks'))).find((t) => t.id === id)!;
    expect((await got(b, tb.id)).remind_at).toBe('2030-06-02T14:00:00.000Z');
    expect((await got(a, ta.id)).remind_at).toBe('2030-06-02T08:00:00.000Z');
  });
});
