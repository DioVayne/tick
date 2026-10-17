import { afterEach, describe, expect, it, vi } from 'vitest';
import { Offline, request } from '../public/api.js';
import { setLocale } from '../public/i18n.js';

describe('request (client)', () => {
  afterEach(() => { vi.restoreAllMocks(); setLocale('en'); });

  it('meldt geen verbinding in de taal van de app', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('GET', '/api/tasks')).rejects.toThrow(Offline);
    await expect(request('GET', '/api/tasks')).rejects.toThrow('no connection');
    setLocale('nl');
    await expect(request('GET', '/api/tasks')).rejects.toThrow('Geen verbinding');
  });
});
