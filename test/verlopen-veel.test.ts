import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index';
import { loadInstallPrefs, userSettingStmt } from '../src/prefs';
import { MAX_OVERDUE_USERS, NEVER, runOverdue } from '../src/overdue';
import { deleteUserStmts } from '../src/users';
import type { Sender } from '../src/push';
import { callAs, createUser } from './helpers';

// 15 juni 2030, 10:00 in Amsterdam: na de standaardtijd van 09:00.
const NOW = Date.parse('2030-06-15T08:00:00Z');

/** Env waarvan de D1 telt hoeveel statements er gemaakt worden (elk statement is een query voor de limiet van D1). */
function counting(): { e: Env; queries: () => number } {
  let n = 0;
  const db = new Proxy(env.DB, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (prop === 'prepare') return (sql: string) => { n++; return target.prepare(sql); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { e: { ...env, DB: db }, queries: () => n };
}

const noSend: Sender = async () => ({ ok: 1, total: 1 });

describe('runOverdue met veel mensen', () => {
  it('niemand aan de beurt: één query die niemand leest, hoeveel mensen er ook zijn', async () => {
    for (let i = 0; i < 30; i++) {
      const u = await createUser();
      await userSettingStmt(env.DB, u.id, 'overdue_time', 'off').run();
    }
    // Wie er al was (beheerder en eerdere leden) is vandaag al geweest.
    await env.DB.prepare("INSERT INTO user_settings (user_id, key, value) SELECT id, 'overdue_day', '2030-06-15' FROM users WHERE true ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run();
    // De eerste ronde rekent voor iedereen het volgende moment uit (overdue_next); daarna kijkt een ronde alleen nog
    // naar wie dat moment bereikt heeft.
    await runOverdue(env, await loadInstallPrefs(env), noSend, NOW);
    const { e, queries } = counting();
    await runOverdue(e, await loadInstallPrefs(env), noSend, NOW + 60_000);
    expect(queries()).toBe(1);
    const read = await env.DB.prepare("SELECT user_id FROM user_settings WHERE key = 'overdue_next' AND value <= ?").bind(new Date(NOW + 60_000).toISOString()).run();
    expect(read.results).toEqual([]);
    expect(read.meta.rows_read).toBeLessThanOrEqual(1); // via de index: niet alle mensen langs
    // Morgen om 09:00 (07:00 UTC) is iedereen met de standaardtijd weer aan de beurt; wie de ronde uit heeft niet.
    const next = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE key = 'overdue_next' AND value = '2030-06-16T07:00:00.000Z'").first<{ n: number }>();
    const off = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE key = 'overdue_next' AND value = ?").bind(NEVER).first<{ n: number }>();
    expect(off!.n).toBeGreaterThanOrEqual(30);
    expect(next!.n).toBeGreaterThanOrEqual(1);
  });

  it('een nieuwe tijd of tijdzone zet het moment terug op meteen kijken; een verwijderd account laat niets achter', async () => {
    const u = await createUser();
    const nextOf = async () => (await env.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'overdue_next'").bind(u.id).first<{ value: string }>())?.value;
    expect(await nextOf()).toBe(''); // nieuw account
    await runOverdue(env, await loadInstallPrefs(env), noSend, Date.parse('2030-06-15T05:00:00Z')); // 07:00 lokaal
    expect(await nextOf()).toBe('2030-06-15T07:00:00.000Z');
    for (const [key, value] of [['overdue_time', '06:30'], ['timezone', 'Europe/London']] as const) {
      await runOverdue(env, await loadInstallPrefs(env), noSend, Date.parse('2030-06-15T05:00:00Z'));
      expect(await nextOf()).not.toBe('');
      await userSettingStmt(env.DB, u.id, key, value).run();
      expect(await nextOf()).toBe('');
    }
    await runOverdue(env, await loadInstallPrefs(env), noSend, Date.parse('2030-06-15T05:00:00Z'));
    await userSettingStmt(env.DB, u.id, 'timezone', null).run(); // terug naar de standaard
    expect(await nextOf()).toBe('');
    // Via de API, zoals de app het doet.
    await runOverdue(env, await loadInstallPrefs(env), noSend, Date.parse('2030-06-15T05:00:00Z'));
    expect((await callAs(u.cookie, '/api/settings', { method: 'PATCH', json: { overdueTime: '08:15' } })).status).toBe(200);
    expect(await nextOf()).toBe('');
    // Account verwijderen: alle rijen weg, ook overdue_next (de triggers zetten er niets terug).
    await env.DB.batch(deleteUserStmts(env.DB, u.id));
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?').bind(u.id).first<{ n: number }>()).toEqual({ n: 0 });
    // Een account zonder eigen instellingen is ook los te wissen: overdue_next gaat mee.
    const v = await createUser();
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(v.id).run();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?').bind(v.id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it(`hoogstens ${MAX_OVERDUE_USERS} mensen per ronde; de rest volgt in de volgende rondes`, async () => {
    const people = [];
    for (let i = 0; i < MAX_OVERDUE_USERS + 3; i++) {
      const u = await createUser();
      const res = await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: `oud ${i}`, remind_at: '2030-06-14T10:00:00Z' } });
      expect(res.status).toBe(201);
      people.push(u.id);
    }
    const seen: string[] = [];
    const send: Sender = async (_e, userId) => { seen.push(userId); return { ok: 1, total: 1 }; };
    const rounds: number[] = [];
    for (let r = 0; r < 5; r++) {
      const before = seen.length;
      await runOverdue(env, await loadInstallPrefs(env), send, NOW + r * 60_000);
      rounds.push(seen.length - before);
    }
    expect(Math.max(...rounds)).toBeLessThanOrEqual(MAX_OVERDUE_USERS);
    expect(new Set(seen)).toEqual(new Set(people));
    expect(seen).toHaveLength(people.length); // ieder precies één keer
  });
});
