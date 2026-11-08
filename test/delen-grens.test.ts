import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv as roomy, randomIp } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

// Gratis versie op een openbare Tick: je deelt met hoogstens FREE_SHARE_PEOPLE (standaard 1) verschillende mensen.
type User = Awaited<ReturnType<typeof createUser>>;

// De gratis standaard, zonder de ruime grens uit de testhulp.
const openEnv: Env = { ...roomy, FREE_SHARE_PEOPLE: undefined };
const uniq = () => crypto.randomUUID().slice(0, 8);
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

const as = (u: { cookie: string }, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: { cookie: string }, list = 'Thuis', e: Env = openEnv) =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title: `T ${uniq()}`, list } }, e)).json()) as { id: string; title: string };
const share = async (u: { cookie: string }, to: string, e: Env = openEnv, mode = 'shared') =>
  as(u, '/api/shares', { method: 'POST', json: { task_id: (await newTask(u, 'Thuis', e)).id, mode, to } }, e);
const limitError = (max: number) => ({ error: translate('en', 'err.share_limit', { max }) });

describe('gratis versie: delen met 1 persoon', () => {
  it('met dezelfde persoon onbeperkt; een tweede persoon (met of zonder account) niet', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    expect((await share(a, b.email)).status).toBe(201);
    expect((await share(a, b.email.toUpperCase())).status).toBe(201);
    const second = await share(a, c.email);
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual(limitError(1));
    const unknown = await share(a, `nieuw-${uniq()}@ex.test`);
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual(limitError(1));
  });

  it('een uitnodiging aan een adres zonder account telt mee, ook een tweede keer naar hetzelfde adres', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const email = `adres-${uniq()}@ex.test`;
    expect((await share(a, email)).status).toBe(201);
    expect((await share(a, email)).status).toBe(201);
    expect((await share(a, b.email)).status).toBe(403);
  });

  it('een gedeelde lijst telt mee', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await newTask(a);
    expect((await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: b.email } })).status).toBe(201);
    await newTask(a, 'Werk');
    const res = await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Werk', to: c.email } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(limitError(1));
    const own = await newTask(a, 'Prive');
    expect((await as(a, '/api/shares', { method: 'POST', json: { task_id: own.id, mode: 'shared', to: c.email } })).status).toBe(403);
  });

  it('wat een ander met jou deelt, telt niet', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    expect((await share(b, a.email)).status).toBe(201);
    expect((await share(a, c.email)).status).toBe(201);
  });

  it('een geaccepteerde kopie blijft meetellen', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const t = await newTask(a);
    await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'copy', to: b.email } });
    const inv = ((await (await as(b, '/api/shares/incoming')).json()) as { id: string; task: { title: string } }[]).find((i) => i.task.title === t.title)!;
    expect((await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await share(a, c.email)).status).toBe(403);
  });

  it('FREE_SHARE_PEOPLE is instelbaar', async () => {
    const two: Env = { ...openEnv, FREE_SHARE_PEOPLE: '2' };
    const [a, b, c, d] = [await createUser(), await createUser(), await createUser(), await createUser()];
    expect((await share(a, b.email, two)).status).toBe(201);
    expect((await share(a, c.email, two)).status).toBe(201);
    const third = await share(a, d.email, two);
    expect(third.status).toBe(403);
    expect(await third.json()).toEqual(limitError(2));
  });

  it('de beheerder heeft geen grens', async () => {
    const login = await callWith(env, '/login', { method: 'POST', json: { email: '', password: 'test-wachtwoord' }, ip: randomIp() });
    const admin = { cookie: login.headers.get('set-cookie')!.split(';')[0] };
    const [b, c] = [await createUser(), await createUser()];
    expect((await share(admin, b.email)).status).toBe(201);
    expect((await share(admin, c.email)).status).toBe(201);
  });

  it('zonder OPEN_SIGNUP geen grens', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    expect((await share(a, b.email, env)).status).toBe(201);
    expect((await share(a, c.email, env)).status).toBe(201);
  });
});

void (null as unknown as User);
