import { describe, expect, it } from 'vitest';
import { call } from './helpers';
import { translate } from '../public/i18n.js';
import { privacyPage } from '../src/login';

const page = (lang: string) => call('/privacy', { auth: null, headers: { 'accept-language': lang, accept: 'text/html' } });

describe('openbare privacypagina', () => {
  it('/privacy werkt zonder inloggen, in beide talen', async () => {
    const nl = await page('nl');
    expect(nl.status).toBe(200);
    expect(nl.headers.get('content-type')).toMatch(/text\/html/);
    const html = await nl.text();
    for (const key of ['priv.title', 'priv.location', 'priv.not', 'priv.rights_title']) expect(html).toContain(translate('nl', key));
    expect(html).toContain('href="/delete-account"');
    expect(await (await page('en')).text()).toContain(translate('en', 'priv.title'));
  });

  it('zonder beheerder en adres (het voorbeeldadres telt niet): de algemene zin, geen mailto', async () => {
    const html = await (await page('nl')).text();
    expect(html).toContain(translate('nl', 'priv.who_unnamed'));
    expect(html).not.toContain('mailto:');
  });

  it("gekoppelde agenda's: wat, hoe vaak en wissen, alleen als de functie aan staat", async () => {
    const html = await (await page('nl')).text();
    expect(html).toContain(translate('nl', 'priv.calendar_title'));
    expect(html).toContain(translate('nl', 'priv.calendar'));
    expect(translate('en', 'priv.calendar')).toMatch(/title and the start and end time.*14 days.*encrypted.*Unlinking/s);
    expect(privacyPage('nl', null)).not.toContain(translate('nl', 'priv.calendar_title'));
    expect(privacyPage('nl', null, undefined, false, false, true)).toContain(translate('nl', 'priv.calendar'));
  });

  it('met mail aan noemt de pagina Resend, zonder niet', () => {
    expect(privacyPage('nl', null, undefined, true)).toContain(translate('nl', 'priv.others_mail'));
    expect(privacyPage('nl', null)).not.toContain('Resend');
  });

  it('op een openbare Tick: uitnodigingen per mail en het opruimen van onbevestigde accounts', () => {
    const open = privacyPage('nl', null, undefined, true, true);
    expect(open).toContain(translate('nl', 'priv.open_invites'));
    expect(open).toContain(translate('nl', 'priv.open_unverified'));
    expect(open).toContain(translate('nl', 'priv.open_reports'));
    expect(privacyPage('nl', null, undefined, true)).not.toContain(translate('nl', 'priv.open_reports'));
    expect(privacyPage('nl', null, undefined, true)).not.toContain(translate('nl', 'priv.open_invites'));
  });

  it('met naam en adres: beide op de pagina, en de naam wordt ge-escaped', () => {
    const html = privacyPage('nl', 'dio@ticktodo.nl', 'Dio <Communicatieadvies>');
    expect(html).toContain('Dio &#60;Communicatieadvies&#62;');
    expect(html).not.toContain('<Communicatieadvies>');
    expect(html).toContain('href="mailto:dio@ticktodo.nl"');
    expect(html).not.toContain(translate('nl', 'priv.who_unnamed'));
  });

  it('de verwijderpagina linkt naar de privacypagina', async () => {
    const html = await (await call('/delete-account', { auth: null, headers: { accept: 'text/html' } })).text();
    expect(html).toContain('href="/privacy"');
  });
});
