import { describe, expect, it } from 'vitest';
import { assetLinks } from '../src/assetlinks';
import { call } from './helpers';

const FP = 'AB:'.repeat(31) + 'CD';

describe('assetlinks', () => {
  it('geeft de verklaring voor package en vingerafdrukken', () => {
    expect(assetLinks('com.example.tick', ` ${FP.toLowerCase()} , ${FP}`)).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.example.tick', sha256_cert_fingerprints: [FP] },
    }]);
  });
  it('zonder package of zonder geldige vingerafdruk een lege lijst', () => {
    expect(assetLinks('', FP)).toEqual([]);
    expect(assetLinks('com.example.tick', '')).toEqual([]);
    expect(assetLinks('com.example.tick', 'geen-vingerafdruk')).toEqual([]);
  });
  it('de officiële app staat erbij, ook zonder eigen build', () => {
    const official = { pkg: 'nl.example.official', certs: FP };
    const statement = (name: string) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: name, sha256_cert_fingerprints: [FP] },
    });
    expect(assetLinks(undefined, undefined, official)).toEqual([statement('nl.example.official')]);
    expect(assetLinks('com.example.tick', FP, official)).toEqual([statement('nl.example.official'), statement('com.example.tick')]);
    // Een eigen build onder dezelfde naam: één verklaring met beide vingerafdrukken.
    const other = 'EF:'.repeat(31) + '01';
    expect(assetLinks('nl.example.official', other, official)).toEqual([{
      ...statement('nl.example.official'),
      target: { ...statement('nl.example.official').target, sha256_cert_fingerprints: [FP, other] },
    }]);
    // Zonder vingerafdruk van de officiële app (nog geen release-sleutel): alleen de eigen build.
    expect(assetLinks('com.example.tick', FP, { pkg: 'nl.example.official', certs: '' })).toEqual([statement('com.example.tick')]);
  });
  it('/api/hello werkt zonder inlog en zegt dat dit een Tick is', async () => {
    const res = await call('/api/hello', { auth: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'tick' });
  });
  it('de route werkt zonder inlog en geeft JSON', async () => {
    const res = await call('/.well-known/assetlinks.json', { auth: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    // De testbindings hebben geen package; de officiële app alleen als zijn vingerafdruk er al is.
    expect(await res.json()).toEqual(assetLinks(undefined, undefined));
  });
});
