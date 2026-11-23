import { describe, expect, it } from 'vitest';
import { fromShare } from '../public/sharein.js';
import { call } from './helpers';

// Delen naar Tick: wat het deelmenu meegeeft (share_target, GET) wordt een voorstel voor de invoerkaart.
const share = (q: Record<string, string>) => fromShare(new URLSearchParams(q));

describe('delen naar Tick', () => {
  it('niets gedeeld: geen voorstel', () => {
    expect(share({})).toBeNull();
    expect(share({ add: '1' })).toBeNull();
    expect(share({ shared_title: ' ', shared_text: '', shared_url: '' })).toBeNull();
  });

  it('Chrome op Android: paginatitel, link in de tekst', () => {
    expect(share({ shared_title: 'Recept: pompoensoep', shared_text: 'https://example.com/soep' }))
      .toEqual({ title: 'Recept: pompoensoep', description: 'https://example.com/soep' });
  });

  it('link in url en in tekst: één keer in de omschrijving', () => {
    expect(share({ shared_title: 'Soep', shared_text: 'https://example.com/soep', shared_url: 'https://example.com/soep' }))
      .toEqual({ title: 'Soep', description: 'https://example.com/soep' });
  });

  it('zonder titel: de tekst zonder link wordt de titel', () => {
    expect(share({ shared_text: 'Kijk dit artikel eens https://example.com/a.' }))
      .toEqual({ title: 'Kijk dit artikel eens', description: 'https://example.com/a' });
  });

  it('meerdere regels: eerste regel titel, de rest in de omschrijving', () => {
    expect(share({ shared_text: 'Boodschappen\nmelk\nbrood' }))
      .toEqual({ title: 'Boodschappen', description: 'melk\nbrood' });
  });

  it('alleen een link: die wordt de titel en staat ook (klikbaar) in de omschrijving', () => {
    expect(share({ shared_url: 'https://example.com/x' }))
      .toEqual({ title: 'https://example.com/x', description: 'https://example.com/x' });
  });

  it('de link ook als titel: dan de tekst of de link als titel', () => {
    expect(share({ shared_title: 'https://example.com/x', shared_text: 'https://example.com/x' }))
      .toEqual({ title: 'https://example.com/x', description: 'https://example.com/x' });
  });

  it('geen http(s) in url: genegeerd', () => {
    expect(share({ shared_title: 'Hoi', shared_url: 'javascript:alert(1)' })).toEqual({ title: 'Hoi', description: '' });
  });

  it('heel lange titel: ingekort, de volledige tekst in de omschrijving', () => {
    const long = 'woord '.repeat(60).trim();
    const r = share({ shared_text: long });
    expect(r?.title.length).toBeLessThanOrEqual(200);
    expect(r?.title.endsWith('…')).toBe(true);
    expect(r?.description).toBe(long);
  });

  it('het manifest heeft een share_target met dezelfde namen', async () => {
    const m = JSON.parse(await (await call('/manifest.webmanifest')).text());
    expect(m.share_target).toEqual({ action: '/', method: 'GET', params: { title: 'shared_title', text: 'shared_text', url: 'shared_url' } });
  });
});
