import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE, call, callAs, callWith, createUser, json, openEnv, randomIp, session } from './helpers';
import { STRINGS, translate } from '../public/i18n.js';
import { addWelcomeTask, WELCOME_TEMPLATE } from '../src/welcome';

type Row = { id: string; title: string; description: string; list: string; parent_id: string | null; position: number; done: number };
const tasksOf = async (userId: string) =>
  (await env.DB.prepare('SELECT id, title, description, list, parent_id, position, done FROM tasks WHERE user_id = ? ORDER BY parent_id IS NOT NULL, position')
    .bind(userId).all<Row>()).results;
const idOf = async (email: string) => (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
const fresh = () => `welkom-${crypto.randomUUID()}@example.test`;

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('welkomsttaak', () => {
  it('elke stap in het sjabloon heeft een tekst in en en nl', () => {
    for (const key of [WELCOME_TEMPLATE.title, WELCOME_TEMPLATE.note, ...WELCOME_TEMPLATE.steps.map((s) => s.key)]) {
      expect(STRINGS.en[key as keyof typeof STRINGS.en], key).toBeTruthy();
      expect(STRINGS.nl[key as keyof typeof STRINGS.nl], key).toBeTruthy();
    }
    expect(WELCOME_TEMPLATE.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('zelf aanmelden geeft één taak met de subtaken op volgorde, in de taal van de aanmelder', async () => {
    const email = fresh();
    const res = await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'Nina', email, password: 'lang-genoeg-1' }, ip: randomIp(), lang: 'nl' });
    expect(res.status).toBe(201);
    const rows = await tasksOf(await idOf(email));
    const [parent, ...subs] = rows;
    expect(parent).toMatchObject({ title: translate('nl', 'welcome.title'), description: translate('nl', 'welcome.note'), list: 'Inbox', parent_id: null, done: 0 });
    expect(subs.map((s) => s.title)).toEqual(WELCOME_TEMPLATE.steps.map((s) => translate('nl', s.key)));
    expect(subs.every((s) => s.parent_id === parent.id && s.done === 0)).toBe(true);

    // Zichtbaar in de app: de taak met zijn subtaken.
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const tasks = await json<{ id: string; title: string; subtasks?: { title: string }[] }[]>(await callWith(openEnv, '/api/tasks', { cookie }));
    const shown = tasks.find((t) => t.id === parent.id)!;
    expect(shown.title).toBe(translate('nl', 'welcome.title'));
  });

  it('in het Engels bij een Engelse browser', async () => {
    const email = fresh();
    await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'Ann', email, password: 'lang-genoeg-1' }, ip: randomIp(), lang: 'en' });
    const [parent] = await tasksOf(await idOf(email));
    expect(parent.title).toBe(translate('en', 'welcome.title'));
  });

  it('een uitnodigingslink van de beheerder geeft hem ook', async () => {
    const path = (await json<{ url: string }>(await callAs(await session(), '/api/users/invite', { method: 'POST' }))).url.replace(BASE, '');
    const email = fresh();
    const res = await call(path, { method: 'POST', auth: null, json: { name: 'Sanne', email, password: 'geheim123' }, headers: { 'cf-connecting-ip': randomIp() } });
    expect(res.status).toBe(201);
    const rows = await tasksOf(await idOf(email));
    expect(rows).toHaveLength(1 + WELCOME_TEMPLATE.steps.length);
  });

  it('een stap met `when` komt alleen mee als die waar is', async () => {
    const u = await createUser();
    await addWelcomeTask(env, u.id, 'en', { title: 'welcome.title', note: 'welcome.note', steps: [{ key: 'welcome.notify' }, { key: 'welcome.place', when: () => false }] });
    const rows = await tasksOf(u.id);
    expect(rows.map((r) => r.title)).toEqual([translate('en', 'welcome.title'), translate('en', 'welcome.notify')]);
  });
});
