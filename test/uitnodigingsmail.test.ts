import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

type User = Awaited<ReturnType<typeof createUser>>;
type Mail = { to: string[]; subject: string; text: string; html: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
let sent: () => Mail[];
beforeEach(() => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 }));
  sent = () => spy.mock.calls
    .filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Mail);
});
afterEach(() => vi.restoreAllMocks());

const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: User, title = `Taak ${uniq()}`, e: Env = openEnv) =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title, list: 'Thuis' } }, e)).json()) as { id: string; title: string };
const share = (u: User, taskId: string, to: string, e: Env = openEnv) =>
  as(u, '/api/shares', { method: 'POST', json: { task_id: taskId, mode: 'shared', to } }, e);
const invitesTo = (email: string) => sent().filter((m) => m.to[0].toLowerCase() === email.toLowerCase() && m.subject.includes('Tick'));

describe('uitnodigingsmail', () => {
  it('een onbekend adres krijgt één mail met de naam van de deler en een /signup-link; Play-link alleen als ingesteld', async () => {
    const a = await createUser({ name: 'Annemiek' });
    const nobody = `mail-${uniq()}@ex.test`;
    expect((await share(a, (await newTask(a)).id, nobody)).status).toBe(201);
    const mails = invitesTo(nobody);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(translate('en', 'mail.invite_subject', { name: 'Annemiek' }));
    expect(mails[0].text).toContain('https://tick.test/signup');
    expect(mails[0].text).not.toContain('play.google.com');
    expect(mails[0].text).not.toContain(nobody); // geen adres in een link of tekst

    const play: Env = { ...openEnv, PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=nl.ticktodo.app' };
    const other = `play-${uniq()}@ex.test`;
    await share(a, (await newTask(a, undefined, play)).id, other, play);
    expect(invitesTo(other)[0].text).toContain('https://play.google.com/store/apps/details?id=nl.ticktodo.app');
  });

  it('een bevestigd account krijgt geen uitnodigingsmail', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await share(a, (await newTask(a)).id, b.email);
    expect(invitesTo(b.email)).toHaveLength(0);
  });

  it('per adres één mail per dag, ook van twee delers; beide uitnodigingen staan klaar', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const nobody = `twee-${uniq()}@ex.test`;
    await share(a, (await newTask(a)).id, nobody);
    await share(b, (await newTask(b)).id, nobody);
    expect(invitesTo(nobody)).toHaveLength(1);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_invites WHERE email = ?').bind(nobody).first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it('aanmelden en bevestigen met dat adres zet taak- en lijstuitnodigingen om', async () => {
    const a = await createUser({ name: 'Ad' });
    const email = `nieuw-${uniq()}@ex.test`;
    const t = await newTask(a);
    await share(a, t.id, email);
    await as(a, '/api/tasks', { method: 'POST', json: { title: `Lijsttaak ${uniq()}`, list: 'Werk' } });
    expect((await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Werk', to: email } })).status).toBe(201);

    const res = await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'Nieuw', email: email.toUpperCase(), password: 'lang-genoeg-1' } });
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const verify = /https:\/\/tick\.test(\/verify\/[A-Za-z0-9_-]+)/.exec(sent().at(-1)!.text)![1];
    // Vóór bevestigen staat er niets klaar.
    expect(await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()).toEqual([]);
    expect((await callWith(openEnv, verify, { accept: 'text/html' })).status).toBe(200);
    const incoming = (await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()) as { task: { title: string } }[];
    expect(incoming.map((i) => i.task.title)).toContain(t.title);
    const lists = (await (await callWith(openEnv, '/api/shared-lists/incoming', { cookie })).json()) as { name: string }[];
    expect(lists.map((l) => l.name)).toEqual(['Werk']);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_invites WHERE email = ?').bind(email).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('een gedeelde taak die intussen in een gedeelde lijst staat, wordt niet los omgezet (zoals bij gewoon delen)', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const email = `lijst-${uniq()}@ex.test`;
    const t = await newTask(a);
    await share(a, t.id, email);
    // Daarna deelt a de lijst Thuis (met de taak erin) met b: de taak hoort nu bij de gedeelde lijst.
    expect((await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: b.email } })).status).toBe(201);
    const res = await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'Nieuw', email, password: 'lang-genoeg-1' } });
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const verify = /https:\/\/tick\.test(\/verify\/[A-Za-z0-9_-]+)/.exec(sent().at(-1)!.text)![1];
    await callWith(openEnv, verify, { accept: 'text/html' });
    expect(await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()).toEqual([]);
  });

  it('een uitnodiging voor een intussen verwijderde taak wordt overgeslagen', async () => {
    const a = await createUser();
    const email = `weg-${uniq()}@ex.test`;
    const t = await newTask(a);
    await share(a, t.id, email);
    expect((await as(a, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    const res = await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'Nieuw', email, password: 'lang-genoeg-1' } });
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const verify = /https:\/\/tick\.test(\/verify\/[A-Za-z0-9_-]+)/.exec(sent().at(-1)!.text)![1];
    expect((await callWith(openEnv, verify, { accept: 'text/html' })).status).toBe(200);
    expect(await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()).toEqual([]);
  });
});
