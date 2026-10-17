import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashKey } from '../src/keys';
import { hashPassword } from '../src/password';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';

// Zet een database in de vorm van vóór de accounts (migraties tot en met 0007) vol met voorbeeldgegevens.
async function seedOld(db: D1Database): Promise<string> {
  const hash = await hashPassword('oud-wachtwoord');
  const keyHash = await hashKey('tick_oud');
  await db.batch([
    db.prepare("INSERT INTO tasks (id, title, parent_id, position, created_at, updated_at) VALUES ('ouder', 'Ouder', NULL, 1, ?, ?)").bind(NOW, NOW),
    db.prepare("INSERT INTO tasks (id, title, parent_id, position, created_at, updated_at) VALUES ('kind', 'Kind', 'ouder', 2, ?, ?)").bind(NOW, NOW),
    db.prepare("INSERT INTO places (id, name, lat, lng, radius, created_at, updated_at) VALUES ('p1', 'Thuis', 52.1, 5.1, 200, ?, ?)").bind(NOW, NOW),
    db.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at, locale) VALUES ('https://push.example/1', 'p', 'a', 'ua', ?, 'nl')").bind(NOW),
    db.prepare("INSERT INTO api_keys (id, name, kind, hash, hint, created_at) VALUES ('k1', 'Oud', 'full', ?, 'woud', ?)").bind(keyHash, NOW),
    db.prepare("INSERT INTO devices (key_id, name, notifications, location, seen_at) VALUES ('k1', 'Telefoon', 1, 'always', ?)").bind(NOW),
    db.prepare("INSERT INTO devices (key_id, name, notifications, location, seen_at) VALUES ('env-api', 'Oude token', 0, 'off', ?)").bind(NOW),
    db.prepare("INSERT INTO pair_codes (id, hash, expires_at) VALUES ('c1', 'codehash', ?)").bind('2099-01-01T00:00:00.000Z'),
    db.prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?), ('session_version', '3'), ('timezone', 'Europe/London'), ('reminder_time', '08:30'), ('week_start', 'sun'), ('fallback_webhook', 'https://hook.example/x'), ('default_locale', 'nl'), ('env_api_token_off', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(hash),
  ]);
  return hash;
}

async function counts(db: D1Database) {
  const out: Record<string, number> = {};
  for (const t of ['tasks', 'places', 'push_subscriptions', 'api_keys', 'pair_codes', 'devices'])
    out[t] = (await db.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
  return out;
}

describe('migratie naar accounts', () => {
  it('een database in de oude vorm wordt één beheerder die alles bezit', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0008'));
    const hash = await seedOld(db);
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    expect((await db.prepare('SELECT * FROM users').all()).results).toEqual([expect.objectContaining({
      id: ADMIN, name: 'Tick', email: null, role: 'admin', session_version: 3, password_hash: hash })]);
    for (const t of ['tasks', 'places', 'push_subscriptions', 'api_keys', 'pair_codes'])
      expect((await db.prepare(`SELECT DISTINCT user_id FROM ${t}`).all()).results).toEqual([{ user_id: ADMIN }]);
    expect(await counts(db)).toEqual({ tasks: 2, places: 1, push_subscriptions: 1, api_keys: 1, pair_codes: 1, devices: 2 });
    expect(await db.prepare("SELECT parent_id FROM tasks WHERE id = 'kind'").first()).toEqual({ parent_id: 'ouder' });
    expect(Object.fromEntries((await db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').bind(ADMIN).all<{ key: string; value: string }>()).results.map((r) => [r.key, r.value])))
      .toEqual({ timezone: 'Europe/London', reminder_time: '08:30', week_start: 'sun', fallback_webhook: 'https://hook.example/x' });
    expect(await db.prepare("SELECT value FROM settings WHERE key = 'default_locale'").first()).toEqual({ value: 'nl' });
    expect(await db.prepare("SELECT value FROM settings WHERE key = 'env_api_token_off'").first()).toEqual({ value: '1' });
    // 0010: wat naar users en user_settings is verhuisd, staat niet meer in settings.
    expect((await db.prepare("SELECT key FROM settings WHERE key IN ('password_hash', 'session_version', 'timezone', 'reminder_time', 'week_start', 'fallback_webhook')").all()).results).toEqual([]);
  });

  it('plekken: dezelfde naam bij twee accounts mag, twee keer bij één account niet', async () => {
    const db = env.MIGRATE_DB; // gemigreerd door de test hierboven
    await db.prepare("INSERT INTO users (id, name, email, role, created_at) VALUES ('b', 'B', 'b@example.com', 'member', ?)").bind(NOW).run();
    const add = (id: string, user: string, name: string) =>
      db.prepare('INSERT INTO places (id, user_id, name, lat, lng, radius, created_at, updated_at) VALUES (?, ?, ?, 1, 2, 100, ?, ?)').bind(id, user, name, NOW, NOW).run();
    await add('p2', 'b', 'thuis'); // 'Thuis' bestaat al bij de beheerder
    await expect(add('p3', 'b', 'THUIS')).rejects.toThrow(/UNIQUE/);
    await expect(add('p4', ADMIN, 'thuis')).rejects.toThrow(/UNIQUE/);
  });

  it('een verse database heeft ook de beheerder, zonder wachtwoord en e-mailadres', async () => {
    expect(await env.DB.prepare('SELECT role, email, password_hash FROM users WHERE id = ?').bind(ADMIN).first())
      .toEqual({ role: 'admin', email: null, password_hash: null });
  });
});
