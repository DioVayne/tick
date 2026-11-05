import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, createUser, openEnv } from './helpers';
import { purgeUnverified } from '../src/signup';
import { cronSteps } from '../src/index';
import { installPrefsFrom } from '../src/prefs';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const exists = async (id: string) => !!(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first());

describe('onbevestigde accounts opruimen', () => {
  it('na 30 dagen weg; jonger, bevestigd of beheerder blijft', async () => {
    const old = await createUser({ verified: false, createdAt: ago(31) });
    const young = await createUser({ verified: false, createdAt: ago(29) });
    const confirmed = await createUser({ createdAt: ago(40) });
    await env.DB.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').bind(ADMIN_ID).run();
    try {
      expect(await purgeUnverified(openEnv, Date.now())).toBeGreaterThanOrEqual(1);
      expect(await exists(old.id)).toBe(false);
      expect(await exists(young.id)).toBe(true);
      expect(await exists(confirmed.id)).toBe(true);
      expect(await exists(ADMIN_ID)).toBe(true);
    } finally {
      await env.DB.prepare('UPDATE users SET email_verified_at = created_at WHERE id = ?').bind(ADMIN_ID).run();
    }
  });

  it('zonder mail of zonder OPEN_SIGNUP gebeurt niets', async () => {
    const old = await createUser({ verified: false, createdAt: ago(31) });
    expect(await purgeUnverified({ ...openEnv, RESEND_API_KEY: undefined }, Date.now())).toBe(0);
    expect(await purgeUnverified(env, Date.now())).toBe(0);
    expect(await exists(old.id)).toBe(true);
    await env.DB.prepare('UPDATE users SET email_verified_at = created_at WHERE id = ?').bind(old.id).run(); // niet meer opruimen in andere tests
  });

  it('verlopen uitnodigingen aan adressen verdwijnen, geldige blijven', async () => {
    const a = await createUser();
    const t = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO tasks (id, user_id, title, list, position, created_at, updated_at) VALUES (?, ?, 'T', 'Thuis', 1, ?, ?)").bind(t, a.id, now, now).run();
    const ins = (id: string, email: string, expires: string) => env.DB.prepare("INSERT INTO email_invites (id, email, from_user, task_id, mode, created_at, expires_at) VALUES (?, ?, ?, ?, 'shared', ?, ?)")
      .bind(id, email, a.id, t, now, expires).run();
    const oldId = crypto.randomUUID(); const newId = crypto.randomUUID();
    await ins(oldId, `oud-${oldId}@ex.test`, ago(1));
    await ins(newId, `nieuw-${newId}@ex.test`, new Date(Date.now() + DAY).toISOString());
    await purgeUnverified(env, Date.now()); // ook zonder OPEN_SIGNUP
    const left = await env.DB.prepare('SELECT id FROM email_invites WHERE id IN (?, ?)').bind(oldId, newId).all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual([newId]);
  });

  it('de cron draait de stap elk heel uur', () => {
    const names = cronSteps(env, installPrefsFrom(env), Date.parse('2031-01-01T10:00:00Z')).map(([n]) => n);
    expect(names).toContain('onbevestigd');
  });
});
