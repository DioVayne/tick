import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, json } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('GET /api/geocode', () => {
  it('zet Nominatim-resultaten om', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json([{ display_name: 'Utrecht, Netherlands', lat: '52.0907', lon: '5.1214' }]));
    const res = await call('/api/geocode?q=Utrecht');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([{ name: 'Utrecht, Netherlands', lat: 52.0907, lng: 5.1214 }]);
    const [url, init] = spy.mock.calls[0] as [string | URL | Request, RequestInit];
    const href = String(url instanceof Request ? url.url : url);
    expect(href).toContain('q=Utrecht');
    expect(href).toContain('format=jsonv2');
    expect(href).toContain('limit=5');
    expect(new Headers(init.headers).get('user-agent')).toMatch(/^Tick\/1\.0/);
  });

  it('laat rijen zonder geldige coördinaten weg', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json([
        { display_name: 'Kapot', lat: 'abc', lon: '6.0' },
        { display_name: 'Zonder lon', lat: '51.0' },
        { display_name: 'Utrecht, Netherlands', lat: '52.0907', lon: '5.1214' },
      ]));
    const res = await call('/api/geocode?q=Utrecht');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([{ name: 'Utrecht, Netherlands', lat: 52.0907, lng: 5.1214 }]);
  });

  it('weigert te korte of te lange zoektermen', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await call('/api/geocode?q=a')).status).toBe(400);
    expect((await call('/api/geocode?q=' + 'x'.repeat(201))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('geeft 502 als Nominatim faalt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('netwerk'));
    const res = await call('/api/geocode?q=Utrecht');
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: 'search is unavailable right now' });
    spy.mockImplementationOnce(async () => new Response('nee', { status: 503 }));
    expect((await call('/api/geocode?q=Utrecht')).status).toBe(502);
  });

  it('vereist inlog', async () => {
    expect((await call('/api/geocode?q=Utrecht', { auth: null })).status).toBe(401);
  });
});
