import { describe, expect, it } from 'vitest';
import { STRINGS } from '../public/i18n.js';
import { call, json } from './helpers';

describe('taal per apparaat', () => {
  it.each([
    ['nl-BE,nl;q=0.9,en;q=0.5', 'nl'], ['de-DE,de;q=0.9', 'en'], ['*', 'en'], ['fr;q=1, nl;q=0.8', 'nl'], ['nl;q=0, en', 'en'],
  ])('Accept-Language %s → %s', async (header, lang) => {
    const res = await call('/login', { auth: null, headers: { 'accept-language': header } });
    expect(await res.text()).toContain(`<html lang="${lang}">`);
  });

  it('cookie tick_lang gaat voor Accept-Language; een onbekende waarde telt niet', async () => {
    const page = (cookie: string) => call('/login', { auth: null, headers: { cookie, 'accept-language': 'nl' } }).then((r) => r.text());
    expect(await page('tick_lang=en')).toContain('<html lang="en">');
    expect(await page('tick_lang=xx')).toContain('<html lang="nl">');
  });

  it('foutmeldingen volgen de taal van de request', async () => {
    const res = await call('/api/tasks', { method: 'POST', json: {}, headers: { 'accept-language': 'nl' } });
    expect((await json<{ error: string }>(res)).error).toBe(STRINGS.nl['err.required'].replace('{field}', 'title'));
  });

  it('/config.js geeft de taal van de request en de standaardtaal', async () => {
    const text = await (await call('/config.js', { headers: { cookie: 'tick_lang=nl' } })).text();
    expect(text).toContain('"locale":"nl"');
    expect(text).toContain('"defaultLocale":"en"');
  });

  it('shell en manifest volgen de taal van de request', async () => {
    const html = await (await call('/', { headers: { accept: 'text/html', cookie: 'tick_lang=nl' } })).text();
    expect(html).toContain('<html lang="nl">');
    expect(html).toContain(`>${STRINGS.nl['ui.add']}</button>`);
    const m = await (await call('/manifest.webmanifest', { headers: { cookie: 'tick_lang=nl' } })).json<{ lang: string }>();
    expect(m.lang).toBe('nl');
  });
});
