import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index';
import { loadInstallPrefs, userSettingStmt } from '../src/prefs';
import { MAX_OVERDUE_USERS, runOverdue } from '../src/overdue';
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
  it('niemand aan de beurt: één query, hoeveel mensen er ook zijn', async () => {
    for (let i = 0; i < 30; i++) {
      const u = await createUser();
      await userSettingStmt(env.DB, u.id, 'overdue_time', 'off').run();
    }
    // Wie er al was (beheerder en eerdere leden) is vandaag al geweest.
    await env.DB.prepare("INSERT INTO user_settings (user_id, key, value) SELECT id, 'overdue_day', '2030-06-15' FROM users WHERE true ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run();
    const { e, queries } = counting();
    await runOverdue(e, await loadInstallPrefs(env), noSend, NOW);
    expect(queries()).toBe(1);
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
