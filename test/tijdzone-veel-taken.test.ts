import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import type { Env } from '../src/index';
import { callWith, createUser } from './helpers';

/** Env waarvan de D1 telt hoeveel statements er gemaakt worden (elk statement telt voor de querylimiet van D1). */
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

const AMS_10 = '2030-06-01T08:00:00.000Z'; // 10:00 in Amsterdam (de zone van de tests)
const NY_10 = '2030-06-01T14:00:00.000Z'; // 10:00 in New York

it('andere tijdzone met veel open taken: een begrensd aantal queries, en alle taken schuiven mee', async () => {
  const u = await createUser();
  const N = 120;
  const now = new Date().toISOString();
  // In één statement: N open taken met een tijd, een afgeronde, een herhalende en een zonder tijd.
  await env.DB.prepare(
    'INSERT INTO tasks (id, user_id, title, position, remind_at, done, repeat_start, repeat_at, repeat_prev, created_at, updated_at) ' +
    "SELECT 'tz-' || value, ?1, 'T' || value, value, ?2, 0, NULL, NULL, NULL, ?3, ?3 FROM json_each(?4) " +
    "UNION ALL SELECT 'tz-klaar', ?1, 'Klaar', 0, ?2, 1, NULL, NULL, NULL, ?3, ?3 " +
    "UNION ALL SELECT 'tz-herhaal', ?1, 'Herhaal', 0, ?2, 0, ?2, ?2, ?2, ?3, ?3 " +
    "UNION ALL SELECT 'tz-zonder', ?1, 'Zonder', 0, NULL, 0, NULL, NULL, NULL, ?3, ?3",
  ).bind(u.id, AMS_10, now, JSON.stringify(Array.from({ length: N }, (_, i) => i))).run();

  const { e, queries } = counting();
  const res = await callWith(e, '/api/settings', { method: 'PATCH', cookie: u.cookie, json: { timeZone: 'America/New_York' } });
  expect(res.status).toBe(200);
  expect(queries()).toBeLessThan(20);

  const { results } = await env.DB.prepare("SELECT id, remind_at, repeat_start, repeat_at, repeat_prev FROM tasks WHERE user_id = ? AND id LIKE 'tz-%'")
    .bind(u.id).all<{ id: string; remind_at: string | null; repeat_start: string | null; repeat_at: string | null; repeat_prev: string | null }>();
  const by = new Map(results.map((r) => [r.id, r]));
  for (let i = 0; i < N; i++) expect(by.get(`tz-${i}`)!.remind_at).toBe(NY_10);
  expect(by.get('tz-klaar')!.remind_at).toBe(AMS_10); // afgerond: blijft staan
  expect(by.get('tz-zonder')!.remind_at).toBeNull();
  expect(by.get('tz-herhaal')).toMatchObject({ remind_at: NY_10, repeat_start: NY_10, repeat_at: NY_10, repeat_prev: null });
});
