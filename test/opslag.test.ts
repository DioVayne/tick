import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { maxAccount } from '../src/attachments';
import { translate } from '../public/i18n.js';
import { BASE, createUser, json } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
const MB = 1024 * 1024;

/** Een verzoek als `u`, met MAX_ACCOUNT_MB = `limit` (of zonder grens). */
function as(u: User, path: string, init: RequestInit = {}, limit?: string) {
  const e = { ...env, MAX_ACCOUNT_MB: limit };
  return worker.fetch(new Request(BASE + path, {
    ...init, headers: { cookie: u.cookie, accept: 'application/json', ...init.headers as Record<string, string> },
  }), e, createExecutionContext());
}

async function task(u: User): Promise<string> {
  const res = await as(u, '/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Met bijlagen' }), headers: { 'content-type': 'application/json' } });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

const upload = (u: User, taskId: string, size: number, limit?: string) =>
  as(u, `/api/tasks/${taskId}/attachments?name=f.jpg`, { method: 'POST', body: new Uint8Array(size), headers: { 'content-type': 'image/jpeg', 'content-length': String(size) } }, limit);

describe('opslag per account', () => {
  it('maxAccount: een positief aantal MB, anders geen grens', () => {
    expect(maxAccount({ MAX_ACCOUNT_MB: '100' })).toBe(100 * MB);
    expect(maxAccount({ MAX_ACCOUNT_MB: '' })).toBeNull();
    expect(maxAccount({ MAX_ACCOUNT_MB: undefined })).toBeNull();
    expect(maxAccount({ MAX_ACCOUNT_MB: '0' })).toBeNull();
    expect(maxAccount({ MAX_ACCOUNT_MB: 'veel' })).toBeNull();
  });

  it('boven de grens → 413 met err.storage_full; wat er al staat telt mee, verwijderen maakt weer ruimte', async () => {
    const u = await createUser();
    const t = await task(u);
    const first = await upload(u, t, 600 * 1024, '1');
    expect(first.status).toBe(201);
    const full = await upload(u, t, 600 * 1024, '1');
    expect(full.status).toBe(413);
    expect((await json<{ error: string }>(full)).error).toBe(translate('en', 'err.storage_full', { max: 1 }));
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM attachments WHERE user_id = ?').bind(u.id).first()).toEqual({ n: 1 });

    const { id } = await json<{ id: string }>(first);
    expect((await as(u, `/api/attachments/${id}`, { method: 'DELETE' }, '1')).status).toBe(200);
    expect((await upload(u, t, 600 * 1024, '1')).status).toBe(201);
  });

  it('zonder grens mag het gewoon, en de grens geldt per account', async () => {
    const a = await createUser();
    const b = await createUser();
    const ta = await task(a);
    expect((await upload(a, ta, 700 * 1024)).status).toBe(201);
    expect((await upload(a, ta, 700 * 1024)).status).toBe(201);
    const tb = await task(b);
    expect((await upload(b, tb, 700 * 1024, '1')).status).toBe(201);
  });

  it('GET /api/storage geeft gebruik en grens in bytes', async () => {
    const u = await createUser();
    const t = await task(u);
    expect(await json(await as(u, '/api/storage', {}, '100'))).toEqual({ used: 0, max: 100 * MB });
    await upload(u, t, 1000, '100');
    await upload(u, t, 2000, '100');
    expect(await json(await as(u, '/api/storage', {}, '100'))).toEqual({ used: 3000, max: 100 * MB });
    expect(await json(await as(u, '/api/storage'))).toEqual({ used: 3000, max: null });
  });

  it('config.js vertelt de app de grens', async () => {
    const u = await createUser();
    expect(await (await as(u, '/config.js', {}, '100')).text()).toContain('"maxAccountMb":100');
    expect(await (await as(u, '/config.js')).text()).toContain('"maxAccountMb":null');
  });
});
