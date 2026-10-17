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
  it('de route werkt zonder inlog en geeft JSON', async () => {
    const res = await call('/.well-known/assetlinks.json', { auth: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual([]); // de testbindings hebben geen package
  });
});
