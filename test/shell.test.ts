import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../public/i18n.js';
import { BASE, call } from './helpers';

describe('instellingen en vertaalde shell', () => {
  it('/config.js geeft taal, tijdzone en Android-package als module', async () => {
    const res = await call('/config.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const text = await res.text();
    expect(text).toMatch(/^export default \{/);
    expect(text).toContain('"locale":"en"');
    expect(text).toContain('"timeZone":"Europe/Amsterdam"');
    expect(text).toContain('"androidPackage":null');
    expect(text).toContain('"reminderTime":"09:00"');
    expect(text).toContain('"weekStart":"mon"');
    expect(text).toContain('"defaultLocale":"en"');
  });

  it('/config.js vereist inlog', async () => {
    expect((await call('/config.js', { auth: null })).status).toBe(401);
  });

  it('de shell is vertaald naar LOCALE', async () => {
    const res = await call('/', { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`placeholder="${STRINGS.en['ui.new_task_placeholder']}"`);
    expect(html).toContain(`>${STRINGS.en['ui.add']}</button>`);
    // data-i18n blijft staan zodat de client de taal opnieuw kan toepassen; de tekst zelf is al vertaald.
    expect(html).toContain('data-i18n');
  });

  it('de shell geeft geen 304 op de ETag van het onvertaalde bestand', async () => {
    const first = await call('/', { headers: { accept: 'text/html' } });
    expect(first.headers.get('etag')).toBeNull();
    const raw = await env.ASSETS.fetch(new Request(BASE + '/'));
    const etag = raw.headers.get('etag') ?? '"x"';
    const again = await call('/', { headers: { accept: 'text/html', 'if-none-match': etag } });
    expect(again.status).toBe(200);
    expect(await again.text()).toContain('<html lang="en">');
    const manifest = await call('/manifest.webmanifest', { headers: { 'if-none-match': etag } });
    expect(manifest.status).toBe(200);
  });

  it('het manifest volgt LOCALE', async () => {
    const res = await call('/manifest.webmanifest');
    expect(res.status).toBe(200);
    const m = await res.json<{ lang: string; shortcuts: { name: string }[] }>();
    expect(m.lang).toBe('en');
    expect(m.shortcuts[0].name).toBe(STRINGS.en['ui.new_task']);
  });

  it('de zijbalk heeft alleen ⚙ Instellingen, geen losse knoppen voor meldingen, thema en uitloggen', async () => {
    const html = await (await call('/', { headers: { accept: 'text/html' } })).text();
    expect(html).toContain('id="btn-settings"');
    for (const id of ['btn-theme', 'btn-push', 'btn-logout']) expect(html).not.toContain(id);
  });
});
