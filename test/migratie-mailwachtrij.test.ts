import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('migratie 0031 (mail-wachtrij)', () => {
  it('tabel mail_queue heeft de kolommen en de index op next_try_at', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(mail_queue)').all<{ name: string; notnull: number; dflt_value: string | null; pk: number }>();
    const by = Object.fromEntries(cols.results.map((c) => [c.name, c]));
    expect(Object.keys(by).sort()).toEqual(
      ['attempts', 'created_at', 'id', 'kind', 'lang', 'last_status', 'next_try_at', 'origin', 'ref', 'user_id'],
    );
    expect(by.id.pk).toBe(1);
    for (const n of ['kind', 'lang', 'origin', 'created_at', 'next_try_at', 'attempts']) expect(by[n].notnull).toBe(1);
    for (const n of ['user_id', 'ref', 'last_status']) expect(by[n].notnull).toBe(0);
    expect(by.attempts.dflt_value).toBe('0');

    const idx = await env.DB.prepare('PRAGMA index_info(mail_queue_next)').all<{ name: string }>();
    expect(idx.results.map((i) => i.name)).toEqual(['next_try_at']);
  });

  it('een rij invoegen geeft attempts 0', async () => {
    await env.DB.prepare("INSERT INTO mail_queue (id, kind, lang, origin, created_at, next_try_at) VALUES ('q1', 'verify', 'nl', 'https://x.test', 'a', 'b')").run();
    const r = await env.DB.prepare("SELECT attempts, user_id, ref, last_status FROM mail_queue WHERE id = 'q1'").first();
    expect(r).toEqual({ attempts: 0, user_id: null, ref: null, last_status: null });
  });
});
