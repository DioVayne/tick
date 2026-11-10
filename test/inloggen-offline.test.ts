import { describe, expect, it } from 'vitest';
import { translate } from '../public/i18n.js';
import { forgotPage, linkPage, loginPage, signupPage } from '../src/login';

const scripts = import.meta.glob<string>('../public/{login,accountlink,signup,forgot}.js', { query: '?raw', import: 'default', eager: true });
const offline = (lang: 'en' | 'nl') => `data-offline="${translate(lang, 'app.you_are_offline').replace(/'/g, '&#39;')}"`;

describe('inlogpagina\'s zonder verbinding', () => {
  it('elke pagina met een formulier geeft de offline-melding mee, in de taal van de pagina', () => {
    for (const lang of ['en', 'nl'] as const) {
      expect(loginPage(lang)).toContain(offline(lang));
      expect(signupPage(lang, false)).toContain(offline(lang));
      expect(forgotPage(lang)).toContain(offline(lang));
      expect(linkPage(lang, 'invite', true)).toContain(offline(lang));
      expect(linkPage(lang, 'reset', true)).toContain(offline(lang));
    }
  });

  it('de scripts vangen een mislukte fetch op en zetten de knop uit tijdens het versturen', () => {
    expect(Object.keys(scripts)).toHaveLength(4);
    for (const [path, src] of Object.entries(scripts)) {
      expect(src, path).toContain('document.body.dataset.offline');
      expect(src, path).toMatch(/\.disabled = true/);
      expect(src, path).toMatch(/\.disabled = false/);
    }
  });

  it('na succes blijft de knop uit; terug via de bfcache zet pageshow hem weer aan', () => {
    for (const [path, src] of Object.entries(scripts)) {
      if (path.endsWith('forgot.js')) continue; // die haalt de knop bij succes weg
      expect(src, path).toMatch(/addEventListener\('pageshow',[^\n]*\.disabled = false/);
    }
  });
});
