import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { callWith, openEnv } from './helpers';
import { translate } from '../public/i18n.js';
import { termsPage } from '../src/login';

const html = { accept: 'text/html' };

describe('algemene voorwaarden', () => {
  it('bestaan niet op een gewone Tick', async () => {
    expect((await callWith(env, '/terms', html)).status).toBe(404);
    expect((await callWith(env, '/voorwaarden', html)).status).toBe(404);
  });

  it('op een openbare Tick: /terms in het Engels en /voorwaarden in het Nederlands, wat de browser ook vraagt', async () => {
    const en = await callWith(openEnv, '/terms', { ...html, lang: 'nl' });
    expect(en.status).toBe(200);
    const enHtml = await en.text();
    expect(enHtml).toContain(translate('en', 'terms.title'));
    expect(enHtml).toContain('href="/voorwaarden"');
    const nl = await (await callWith(openEnv, '/voorwaarden', { ...html, lang: 'en' })).text();
    expect(nl).toContain(translate('nl', 'terms.liability_title'));
    expect(nl).toContain('<html lang="nl">');
    expect(nl).toContain('tick.test/delete-account');
  });

  it('met naam, adres en KvK-nummer: alles op de pagina, ge-escaped', () => {
    const page = termsPage('nl', 'app.ticktodo.nl', 'dio@ticktodo.nl', { name: 'Dio <C>', address: 'Straat 1, 1234 AB Stad', kvk: '58772316' });
    expect(page).toContain('Dio &#60;C&#62;');
    expect(page).not.toContain('<C>');
    expect(page).toContain('Straat 1, 1234 AB Stad · KvK-nummer 58772316');
    expect(page).toContain('href="mailto:dio@ticktodo.nl"');
    expect(page).toContain('app.ticktodo.nl/privacy');
  });

  it('zonder gegevens: de algemene zinnen, geen mailto en geen regel met adres', () => {
    const page = termsPage('en', 'tick.test', null);
    expect(page).toContain(translate('en', 'terms.contact_none'));
    expect(page).toContain(translate('en', 'terms.who_unnamed', { host: 'tick.test' }));
    expect(page).not.toContain('mailto:');
    expect(page).not.toContain('Chamber of Commerce');
  });

  it('de aanmeldpagina en de privacypagina linken naar de voorwaarden', async () => {
    expect(await (await callWith(openEnv, '/signup', { ...html, lang: 'nl' })).text()).toContain('href="/voorwaarden"');
    expect(await (await callWith(openEnv, '/privacy', { ...html, lang: 'en' })).text()).toContain('href="/terms"');
    expect(await (await callWith(env, '/privacy', html)).text()).not.toContain('href="/terms"');
  });
});
