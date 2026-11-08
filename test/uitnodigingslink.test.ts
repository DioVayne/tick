import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

// De knop in de uitnodigingsmail: een unieke link (/join/<code>) die het aanmeldscherm met het adres invult, en
// waarmee de uitnodiging de link volgt (ook bij een ander adres, of in een bestaand account).
type User = Awaited<ReturnType<typeof createUser>>;
type Mail = { to: string[]; subject: string; text: string; html: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
let sent: () => Mail[];
beforeEach(() => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 }));
  sent = () => spy.mock.calls.filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Mail);
});
afterEach(() => vi.restoreAllMocks());

const as = (u: { cookie: string }, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const html = { accept: 'text/html' };

/** a deelt een nieuwe taak met `email`; geeft de taak en het pad van de link in de mail. */
async function invite(a: User, email: string) {
  const title = `Taak ${uniq()}`;
  const t = (await (await as(a, '/api/tasks', { method: 'POST', json: { title, list: 'Thuis' } })).json()) as { id: string; title: string };
  expect((await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'shared', to: email } })).status).toBe(201);
  const mail = sent().filter((m) => m.to[0] === email).at(-1)!;
  const path = /https:\/\/tick\.test(\/join\/[A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  return { t, path: path!, mail };
}
const incoming = async (cookie: string) => ((await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()) as { task: { title: string } }[])
  .map((i) => i.task.title);
const signupVia = (path: string, email: string) => callWith(openEnv, '/signup', {
  method: 'POST', json: { name: 'Jan', email, password: 'lang-genoeg-1', join: path.split('/').pop() },
});

describe('uitnodigingslink', () => {
  it('de mail linkt naar een unieke /join/-link zonder adres erin', async () => {
    const a = await createUser();
    const email = `jan-${uniq()}@ex.test`;
    const { path, mail } = await invite(a, email);
    expect(path).toMatch(/^\/join\/[A-Za-z0-9_-]{20,}$/);
    expect(mail.text).not.toContain('/signup');
    expect(path).not.toContain(email.split('@')[0]);
  });

  it('de link opent het aanmeldscherm met het adres ingevuld en wie wat deelt', async () => {
    const a = await createUser({ name: 'Ad' });
    const email = `jan-${uniq()}@ex.test`;
    const { path, t } = await invite(a, email);
    const res = await callWith(openEnv, path, html);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain(`value="${email}"`);
    expect(page).toContain(translate('en', 'join.intro', { name: 'Ad', title: t.title }).replace(/"/g, '&#34;'));
    expect(page).toContain(`href="/login?next=${encodeURIComponent(path)}"`);
  });

  it('aanmelden via de link met hetzelfde adres: meteen bevestigd en de uitnodiging staat klaar, zonder bevestigingsmail', async () => {
    const a = await createUser();
    const email = `jan-${uniq()}@ex.test`;
    const { path, t } = await invite(a, email);
    const before = sent().length;
    const res = await signupVia(path, email.toUpperCase());
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const row = await env.DB.prepare('SELECT email_verified_at AS v, verify_deadline AS d FROM users WHERE email = ?').bind(email).first<{ v: string | null; d: string | null }>();
    expect(row!.v).toBeTruthy();
    expect(row!.d).toBeNull();
    expect(await incoming(cookie)).toContain(t.title);
    expect(sent().length).toBe(before); // geen bevestigingsmail nodig
  });

  it('aanmelden via de link met een ander adres: de uitnodiging volgt de link', async () => {
    const a = await createUser();
    const email = `jan-${uniq()}@ex.test`;
    const other = `jan-werk-${uniq()}@ex.test`;
    const { path, t } = await invite(a, email);
    const res = await signupVia(path, other);
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(await incoming(cookie)).toContain(t.title);
    const row = await env.DB.prepare('SELECT email_verified_at AS v FROM users WHERE email = ?').bind(other).first<{ v: string | null }>();
    expect(row!.v).toBeNull(); // het andere adres bevestigt hij zelf nog
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_invites WHERE email = ?').bind(email).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('al ingelogd: de link zet de uitnodiging in je account en gaat naar de app', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const { path, t } = await invite(a, `jan-${uniq()}@ex.test`);
    const res = await callWith(openEnv, path, { ...html, cookie: b.cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(await incoming(b.cookie)).toContain(t.title);
    // De link is daarna op.
    expect(await (await callWith(openEnv, path, html)).text()).toContain(translate('en', 'join.invalid'));
  });

  it('een onbekende code: nette melding, en aanmelden ermee geeft err.link_invalid', async () => {
    expect(await (await callWith(openEnv, '/join/onzin-code-die-niet-bestaat', html)).text()).toContain(translate('en', 'join.invalid'));
    const res = await callWith(openEnv, '/signup', { method: 'POST', json: { name: 'X', email: `x-${uniq()}@ex.test`, password: 'lang-genoeg-1', join: 'onzin' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: translate('en', 'err.link_invalid') });
  });

  it('zonder OPEN_SIGNUP bestaat /join niet', async () => {
    expect((await callWith(env, '/join/iets', html)).status).toBe(404);
  });
});
