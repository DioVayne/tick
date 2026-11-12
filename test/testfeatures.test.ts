import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { callWith, createUser } from './helpers';
import { testFeature, testFeatures } from '../src/features';

// De testschakelaar (TEST_FEATURES): alleen namen die de code kent, zetten iets aan.
describe('testfeatures (TEST_FEATURES)', () => {
  it('onbekende namen zetten niets aan', () => {
    expect(testFeatures({})).toEqual([]);
    expect(testFeatures({ TEST_FEATURES: ' freetime , iets-anders' })).toEqual([]);
    expect(testFeature({ TEST_FEATURES: 'freetime' }, 'freetime')).toBe(false);
  });

  it('/config.js geeft de PWA de lijst', async () => {
    const u = await createUser();
    expect(await (await callWith({ ...env, TEST_FEATURES: 'freetime' }, '/config.js', { cookie: u.cookie })).text()).toContain('"testFeatures":[]');
  });

  it('de API van "Tijd voor een taak?" bestaat niet meer', async () => {
    const u = await createUser();
    expect((await callWith({ ...env, TEST_FEATURES: 'freetime' }, '/api/freetime', { cookie: u.cookie })).status).toBe(404);
  });
});
