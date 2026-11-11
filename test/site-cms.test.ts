import { describe, expect, it } from 'vitest';
// The Worker of ticktodo.nl (site/worker): the mini-CMS behind /beheer. Tested with a fake ASSETS and KV.
import worker, { BEVEILIGING, PAGINAS, voorkeurTaal } from '../site/worker/index.js';

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
  }
}

const pages = import.meta.glob<string>('../site/public/**/index.html', { query: '?raw', import: 'default', eager: true });
const headersFile = Object.values(
  import.meta.glob<string>('../site/public/_header[s]', { query: '?raw', import: 'default', eager: true }),
)[0] ?? '';
const NL = pages['../site/public/index.html'];
const EN = pages['../site/public/en/index.html'];
const ORIGIN = 'https://ticktodo.nl';

function fakeKv() {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string, type?: string) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) { data.set(key, value); },
    async delete(key: string) { data.delete(key); },
  };
}

function makeEnv(password?: string) {
  return {
    ADMIN_PASSWORD: password,
    CMS: fakeKv(),
    ASSETS: {
      async fetch(req: Request) {
        const path = new URL(req.url).pathname;
        const body = path.startsWith('/en/') ? EN : path === '/' || path === '/index.html' ? NL : 'body { }';
        const type = body === NL || body === EN ? 'text/html; charset=utf-8' : 'text/css';
        return new Response(body, { headers: { 'content-type': type, etag: '"x"' } });
      },
    },
  };
}

type Env = ReturnType<typeof makeEnv>;
const call = (env: Env, path: string, init: RequestInit = {}) =>
  (worker as unknown as { fetch(r: Request, e: Env): Promise<Response> }).fetch(new Request(ORIGIN + path, init), env);
const put = (env: Env, body: unknown, headers: Record<string, string> = {}) =>
  call(env, '/api/content', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function login(env: Env, password: string) {
  const res = await call(env, '/api/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ wachtwoord: password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { res, cookie };
}

describe('website CMS worker', () => {
  it('sets the same CSP as _headers', () => {
    expect(headersFile).toContain(`Content-Security-Policy: ${BEVEILIGING['Content-Security-Policy']}`);
    expect(PAGINAS).toEqual(['/', '/index.html', '/en/', '/en/index.html']);
  });

  it('serves the page unchanged when logged out, with security headers and no editor', async () => {
    const env = makeEnv('geheim');
    for (const path of ['/', '/en/']) {
      const res = await call(env, path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-security-policy')).toBe(BEVEILIGING['Content-Security-Policy']);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('etag')).toBeNull();
      const html = await res.text();
      expect(html).not.toContain('/beheer/editor');
      expect(html).toContain('data-edit="');
    }
  });

  it('puts saved texts into the page', async () => {
    const env = makeEnv('geheim');
    await env.CMS.put('content', JSON.stringify({ 'hero-titel': 'Nieuwe <em>titel</em>', 'en-hero-titel': 'New title' }));
    const nl = await (await call(env, '/')).text();
    expect(nl).toMatch(/data-edit="hero-titel"[^>]*>Nieuwe <em>titel<\/em><\/h1>/);
    const en = await (await call(env, '/en/')).text();
    expect(en).toMatch(/data-edit="en-hero-titel"[^>]*>New title<\/h1>/);
  });

  it('refuses every login while ADMIN_PASSWORD is not set', async () => {
    const env = makeEnv(undefined);
    const { res, cookie } = await login(env, '');
    expect(res.status).toBe(503);
    expect(cookie).toBe('');
    expect((await put(env, { key: 'hero-titel', html: 'x' }, { origin: ORIGIN, cookie: 'cms=1.2' })).status).toBe(401);
  });

  it('logs in, edits and restores; checks origin and session', async () => {
    const env = makeEnv('geheim');
    expect((await login(env, 'fout')).res.status).toBe(401);
    const wrongOrigin = await call(env, '/api/login', {
      method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ wachtwoord: 'geheim' }),
    });
    expect(wrongOrigin.status).toBe(403);

    const { res, cookie } = await login(env, 'geheim');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(cookie).toMatch(/^cms=\d+\.[0-9a-f]{64}$/);

    const page = await (await call(env, '/', { headers: { cookie } })).text();
    expect(page).toContain('<script src="/beheer/editor.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="/beheer/editor.css">');

    expect((await put(env, { key: 'hero-titel', html: 'Hallo' }, { cookie })).status).toBe(403); // no Origin
    expect((await put(env, { key: 'hero-titel', html: 'Hallo' }, { origin: ORIGIN })).status).toBe(401); // no cookie
    expect((await put(env, { key: 'Fout Sleutel', html: 'x' }, { origin: ORIGIN, cookie })).status).toBe(400);
    expect((await put(env, { key: 'hero-titel', html: 'Hallo' }, { origin: ORIGIN, cookie })).status).toBe(200);
    expect(await env.CMS.get('content', 'json')).toEqual({ 'hero-titel': 'Hallo' });

    const read = await call(env, '/api/content', { headers: { cookie } });
    expect(await read.json()).toEqual({ content: { 'hero-titel': 'Hallo' } });
    expect((await call(env, '/api/content')).status).toBe(401);

    expect((await put(env, { key: 'hero-titel', html: null }, { origin: ORIGIN, cookie })).status).toBe(200);
    expect(await env.CMS.get('content', 'json')).toEqual({});

    // A new password ends every session.
    env.ADMIN_PASSWORD = 'nieuw';
    expect((await call(env, '/api/content', { headers: { cookie } })).status).toBe(401);
  });

  it('limits failed logins per IP', async () => {
    const env = makeEnv('geheim');
    for (let i = 0; i < 10; i++) expect((await login(env, 'fout')).res.status).toBe(401);
    expect((await login(env, 'geheim')).res.status).toBe(429);
  });

  it('reads the preferred language from Accept-Language', () => {
    expect(voorkeurTaal(null)).toBeNull();
    expect(voorkeurTaal('*')).toBeNull();
    expect(voorkeurTaal('nl-NL,nl;q=0.9,en;q=0.8')).toBe('nl');
    expect(voorkeurTaal('nl-BE')).toBe('nl');
    expect(voorkeurTaal('en-US,en;q=0.9')).toBe('en');
    expect(voorkeurTaal('de-DE,de;q=0.9,nl;q=0.5')).toBe('en');
    expect(voorkeurTaal('en;q=0.5,nl;q=0.8')).toBe('nl');
  });

  it('sends a foreign browser from the home page to /en/, unless a choice or own link says otherwise', async () => {
    const env = makeEnv('geheim');
    const en = { 'accept-language': 'en-US,en;q=0.9' };
    const naar = async (path: string, headers: Record<string, string> = {}) => {
      const res = await call(env, path, { headers, redirect: 'manual' });
      return res.status === 302 ? res.headers.get('location') : res.status;
    };
    expect(await naar('/', en)).toBe('/en/');
    expect(await naar('/index.html', en)).toBe('/en/');
    expect(await naar('/', { 'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8' })).toBe(200);
    expect(await naar('/')).toBe(200); // crawlers send no Accept-Language
    expect(await naar('/en/', { 'accept-language': 'nl' })).toBe(200); // /en/ never moves by itself
    expect(await naar('/', { ...en, referer: ORIGIN + '/privacy' })).toBe(200); // link on our own site
    expect(await naar('/', { ...en, cookie: 'taal=nl' })).toBe(200);
    expect(await naar('/', { 'accept-language': 'nl', cookie: 'cms=1; taal=en' })).toBe('/en/');

    const kies = await call(env, '/?taal=nl', { headers: en, redirect: 'manual' });
    expect(kies.status).toBe(302);
    expect(kies.headers.get('location')).toBe('/');
    expect(kies.headers.get('set-cookie')).toMatch(/^taal=nl; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/);
    expect(kies.headers.get('content-security-policy')).toBe(BEVEILIGING['Content-Security-Policy']);
    const kiesEn = await call(env, '/en/?taal=en', { redirect: 'manual' });
    expect(kiesEn.headers.get('location')).toBe('/en/');
    expect(kiesEn.headers.get('set-cookie')).toMatch(/^taal=en;/);

    expect((await call(env, '/')).headers.get('vary')).toBe('Accept-Language, Cookie');
  });

  it('language links on the pages remember the choice', () => {
    expect(NL).toContain('<a class="lang" href="/en/?taal=en"');
    expect(EN).toContain('<a class="lang" href="/?taal=nl"');
  });

  it('leaves other paths to the assets', async () => {
    const env = makeEnv('geheim');
    const res = await call(env, '/site.css');
    expect(await res.text()).toBe('body { }');
    expect(res.headers.get('etag')).toBe('"x"');
  });
});
