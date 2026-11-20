import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { callWith, createUser } from './helpers';
import { testFeature, testFeatures } from '../src/features';

// De testschakelaar (TEST_FEATURES): alleen namen die de code kent, zetten iets aan.
describe('testfeatures (TEST_FEATURES)', () => {
  it('onbekende namen zetten niets aan', () => {
    expect(testFeatures({})).toEqual([]);
    expect(testFeatures({ TEST_FEATURES: ' freetime , quickdate, iets-anders' })).toEqual([]); // quickdate is nu gewoon aan
    expect(testFeature({ TEST_FEATURES: 'freetime' }, 'freetime')).toBe(false);
  });

  it('/config.js geeft de PWA de lijst', async () => {
    const u = await createUser();
    expect(await (await callWith({ ...env, TEST_FEATURES: 'freetime' }, '/config.js', { cookie: u.cookie })).text()).toContain('"testFeatures":[]');
  });

  it('placecheck staat alleen aan met zijn naam', async () => {
    expect(testFeature({ TEST_FEATURES: 'PlaceCheck' }, 'placecheck')).toBe(true);
    const u = await createUser();
    expect(await (await callWith({ ...env, TEST_FEATURES: 'placecheck' }, '/config.js', { cookie: u.cookie })).text()).toContain('"testFeatures":["placecheck"]');
  });

  it('placecheck: de Android-app hoort het via /api/config', async () => {
    const u = await createUser();
    const off = await (await callWith({ ...env, TEST_FEATURES: '' }, '/api/config', { cookie: u.cookie })).json();
    expect(off).toMatchObject({ testFeatures: [] });
    const on = await (await callWith({ ...env, TEST_FEATURES: 'quickdate, placecheck' }, '/api/config', { cookie: u.cookie })).json();
    expect(on).toMatchObject({ testFeatures: ['placecheck'] });
  });

  it('de API van "Tijd voor een taak?" bestaat niet meer', async () => {
    const u = await createUser();
    expect((await callWith({ ...env, TEST_FEATURES: 'freetime' }, '/api/freetime', { cookie: u.cookie })).status).toBe(404);
  });
});
