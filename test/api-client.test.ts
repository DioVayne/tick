import { afterEach, describe, expect, it, vi } from 'vitest';
import { Offline, request } from '../public/api.js';
import { STRINGS, errorText, setLocale } from '../public/i18n.js';

describe('request (client)', () => {
  afterEach(() => { vi.restoreAllMocks(); setLocale('en'); });

  it('meldt geen verbinding in de taal van de app', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('GET', '/api/tasks')).rejects.toThrow(Offline);
    await expect(request('GET', '/api/tasks')).rejects.toThrow('no connection');
    setLocale('nl');
    await expect(request('GET', '/api/tasks')).rejects.toThrow('Geen verbinding');
  });

  it('een serverfout volgt de taal van de app, niet die van de server', async () => {
    const body = { error: STRINGS.nl['err.share_exists'], key: 'err.share_exists', vars: {} };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), { status: 409 }));
    setLocale('en');
    await expect(request('POST', '/api/tasks/x/shares')).rejects.toThrow(STRINGS.en['err.share_exists']);
    setLocale('nl');
    await expect(request('POST', '/api/tasks/x/shares')).rejects.toThrow(STRINGS.nl['err.share_exists']);
  });
});

describe('errorText', () => {
  it('vertaalt de sleutel met de variabelen in de gevraagde taal', () => {
    const data = { error: 'x', key: 'err.required', vars: { field: 'title' } };
    expect(errorText(data, '', 'en')).toBe(STRINGS.en['err.required'].replace('{field}', 'title'));
    expect(errorText(data, '', 'nl')).toBe(STRINGS.nl['err.required'].replace('{field}', 'title'));
  });

  it('zonder bekende sleutel de tekst van de server, anders de terugval', () => {
    expect(errorText({ error: 'oud antwoord' }, 'Conflict', 'nl')).toBe('oud antwoord');
    expect(errorText({ error: 'tekst', key: 'err.bestaat_niet' }, 'Conflict', 'nl')).toBe('tekst');
    expect(errorText({}, 'Conflict', 'nl')).toBe('Conflict');
    expect(errorText(null, 'Conflict', 'nl')).toBe('Conflict');
  });
});
