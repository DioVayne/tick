import { describe, expect, it } from 'vitest';
import { normLocale, parseAcceptLanguage, pickLocale, STRINGS, translate } from '../public/i18n.js';
import { loginPage } from '../src/login';
import { call, json, login, randomIp } from './helpers';

describe('i18n', () => {
  it('en en nl hebben dezelfde sleutels', () => {
    expect(Object.keys(STRINGS.nl).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('geen enkele instellingentekst (set.*) noemt een "token"', () => {
    for (const locale of ['en', 'nl'] as const) {
      const keys = Object.keys(STRINGS[locale]).filter((k) => k.startsWith('set.'));
      expect(keys.length, locale).toBeGreaterThan(0);
      for (const k of keys) expect(STRINGS[locale][k], `${locale} ${k}`).not.toMatch(/token/i);
    }
  });

  it('vult variabelen in en valt terug op en en daarna op de sleutel', () => {
    expect(translate('nl', 'err.too_long', { field: 'title', max: 500 })).toBe('title is langer dan 500 tekens');
    expect(translate('en', 'err.too_long', { field: 'title', max: 500 })).toBe('title is longer than 500 characters');
    expect(translate('xx', 'err.not_found')).toBe(translate('en', 'err.not_found'));
    expect(translate(undefined, 'err.not_found')).toBe('not found');
    expect(translate('en', 'bestaat.niet')).toBe('bestaat.niet');
  });

  it('herkent de taal', () => {
    expect(normLocale('nl')).toBe('nl');
    expect(normLocale('NL-be')).toBe('nl');
    expect(normLocale('fr')).toBe('en');
    expect(normLocale(undefined)).toBe('en');
  });

  it('parseAcceptLanguage sorteert op q en laat q=0 en * weg', () => {
    expect(parseAcceptLanguage('en;q=0.5, nl, *;q=0.1, fr;q=0')).toEqual(['nl', 'en']);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });

  it('pickLocale neemt de eerste en of nl', () => {
    expect(pickLocale(['de-DE', 'nl-BE', 'en'])).toBe('nl');
    expect(pickLocale(['EN-gb'])).toBe('en');
    expect(pickLocale(['fr', 'de'])).toBeNull();
    expect(pickLocale([])).toBeNull();
  });

  it('de server antwoordt in LOCALE (en in de tests)', async () => {
    const res = await call('/api/tasks', { method: 'POST', json: { title: '' } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('title is required');
    const missing = await call('/api/tasks/00000000-0000-0000-0000-000000000000', { method: 'PATCH', json: { title: 'x' } });
    expect((await json<{ error: string }>(missing)).error).toBe('not found');
  });

  it('een fout wachtwoord geeft een leesbare melding', async () => {
    const res = await login('fout', randomIp());
    expect(res.status).toBe(401);
    expect((await json<{ error: string }>(res)).error).toBe('Unknown email address or wrong password.');
  });

  it('de loginpagina volgt de locale', () => {
    expect(loginPage('nl')).toContain('lang="nl"');
    expect(loginPage('nl')).toContain('Wachtwoord');
    expect(loginPage('en')).toContain('lang="en"');
    expect(loginPage('en')).toContain('Password');
  });
});
