import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { BASE, call, callAs, createUser, json, login, randomIp, session, untilRateLimited } from './helpers';
import { translate } from '../public/i18n.js';

const ip = () => ({ 'cf-connecting-ip': randomIp() });
const get = (path: string) => call(path, { auth: null, headers: ip() });
const invite = async () => (await json<{ url: string }>(await callAs(await session(), '/api/users/invite', { method: 'POST' }))).url.replace(BASE, '');
const resetLink = async (id: string) => (await json<{ url: string }>(await callAs(await session(), `/api/users/${id}/reset`, { method: 'POST' }))).url.replace(BASE, '');
const submit = (path: string, body: unknown, from = randomIp()) => call(path, { method: 'POST', auth: null, json: body, headers: { 'cf-connecting-ip': from } });
const expire = (kind: string) => env.DB.prepare("UPDATE account_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE kind = ? AND used_at IS NULL").bind(kind).run();

describe('uitnodigings- en resetpagina\'s', () => {
  it('een uitnodiging werkt één keer en logt de nieuwe persoon meteen in', async () => {
    const path = await invite();
    expect(await (await get(path)).text()).toContain('id="email"');
    const res = await submit(path, { name: 'Sanne', email: 'sanne@example.test', password: 'geheim123' });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(await json(await callAs(cookie, '/api/account'))).toMatchObject({ name: 'Sanne', role: 'member' });
    expect((await submit(path, { name: 'X', email: 'x@example.test', password: 'geheim123' })).status).toBe(400);
    expect(await (await get(path)).text()).toContain(translate('en', 'link.invalid'));
  });

  it('een bestaand e-mailadres of een te kort wachtwoord geeft een fout, en de link werkt daarna nog', async () => {
    const path = await invite(); const b = await createUser();
    expect((await submit(path, { name: 'X', email: b.email, password: 'geheim123' })).status).toBe(409);
    expect((await submit(path, { name: 'X', email: 'nieuw@example.test', password: 'kort' })).status).toBe(400);
    expect((await submit(path, { name: '', email: 'nieuw@example.test', password: 'geheim123' })).status).toBe(400);
    expect((await submit(path, { name: 'X', email: 'geen-adres', password: 'geheim123' })).status).toBe(400);
    expect((await submit(path, { name: 'X', email: 'nieuw@example.test', password: 'geheim123' })).status).toBe(201);
  });

  it('een verlopen uitnodiging werkt niet', async () => {
    const path = await invite();
    await expire('invite');
    expect((await submit(path, { name: 'X', email: 'laat@example.test', password: 'geheim123' })).status).toBe(400);
    expect(await (await get(path)).text()).toContain(translate('en', 'link.invalid'));
  });

  it('een reset werkt één keer, laat oude sessies vervallen en geeft een werkende sessie', async () => {
    const b = await createUser();
    const path = await resetLink(b.id);
    expect(await (await get(path)).text()).toContain('autocomplete="new-password"');
    const res = await submit(path, { password: 'nieuw-wachtwoord' });
    expect(res.status).toBe(200);
    expect((await callAs(b.cookie, '/api/tasks')).status).toBe(401);
    expect((await callAs(res.headers.get('set-cookie')!.split(';')[0], '/api/tasks')).status).toBe(200);
    expect((await login('nieuw-wachtwoord', randomIp(), b.email)).status).toBe(200);
    expect((await submit(path, { password: 'nog-een-keer' })).status).toBe(400);
  });

  it('een te kort wachtwoord bij een reset laat de link intact', async () => {
    const b = await createUser();
    const path = await resetLink(b.id);
    expect((await submit(path, { password: 'kort' })).status).toBe(400);
    expect((await submit(path, { password: 'lang-genoeg' })).status).toBe(200);
  });

  it('een reset verloopt na 1 uur; een uitnodigingscode werkt niet als reset', async () => {
    const b = await createUser();
    const path = await resetLink(b.id);
    await expire('reset');
    expect((await submit(path, { password: 'nieuw-wachtwoord' })).status).toBe(400);
    expect(await (await get(path)).text()).toContain(translate('en', 'link.invalid'));
    const code = (await invite()).split('/').pop();
    expect((await submit('/reset/' + code, { password: 'nieuw-wachtwoord' })).status).toBe(400);
    expect(await (await get('/reset/' + code)).text()).toContain(translate('en', 'link.invalid'));
  });

  it('een verzonnen code met een bestaand e-mailadres geeft 400, niet 409: zonder geldige link valt er niets te raden', async () => {
    const b = await createUser();
    const res = await submit('/invite/verzonnen', { name: 'X', email: b.email, password: 'geheim123' });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe(translate('en', 'err.link_invalid'));
  });

  it('een onbekende code toont alleen de melding, zonder velden', async () => {
    const res = await get('/invite/verzonnen');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(translate('en', 'link.invalid'));
    expect(html).not.toContain('id="pw"');
  });

  it('te veel pogingen vanaf één IP geeft 429, ook voor de pagina zelf', async () => {
    const from = randomIp();
    const posts = await untilRateLimited(() => submit('/invite/verzonnen', { name: 'x', email: 'x@x.xx', password: 'geheim123' }, from));
    expect(posts.slice(0, -1).every((r) => r.status === 400)).toBe(true);
    // De pagina zelf telt ook mee (eigen IP, zodat een minuutgrens hierboven niet meetelt).
    const page = randomIp();
    const pages = await untilRateLimited(() => call('/reset/verzonnen', { auth: null, headers: { 'cf-connecting-ip': page } }));
    expect(pages.slice(0, -1).every((r) => r.status === 200)).toBe(true);
  });
});
