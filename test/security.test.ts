import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { authorize, SESSION_DAYS } from '../src/auth';
import { loadInstallPrefs } from '../src/prefs';
import { ADMIN_ID, call, INBOX, json, login, randomIp, type Task } from './helpers';

const DAY = 86_400_000;

/** Sessiecookie van de beheerder zoals de Worker hem maakt, met zelf gekozen verloopmoment en versie. */
async function cookieFor(exp: number, version = '1', payload = `${exp}.${ADMIN_ID}.${version}`) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode('test-sessie-geheim'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `tick_session=${payload}.${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const withCookie = (cookie: string) => call('/api/tasks', { auth: null, headers: { cookie } });

describe('rate limit op /login', () => {
  it('geeft na 5 pogingen per minuut een 429, per IP', async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i++) expect((await login('test-wachtwoord', ip)).status).toBe(200);
    const blocked = await login('test-wachtwoord', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    // Een ander IP heeft er geen last van.
    expect((await login('test-wachtwoord')).status).toBe(200);
  });
});

describe('sessies', () => {
  it('geeft een cookie van 30 dagen met versie in de payload', async () => {
    const cookie = (await login('test-wachtwoord')).headers.get('set-cookie')!;
    expect(cookie).toContain(`Max-Age=${SESSION_DAYS * 86_400}`);
    expect(cookie).toMatch(new RegExp(String.raw`^tick_session=\d+\.${ADMIN_ID}\.1\.[0-9a-f]{64};`));
  });

  it('logt alle sessies uit als session_version omhoog gaat', async () => {
    const session = (await login('test-wachtwoord')).headers.get('set-cookie')!.split(';')[0];
    expect((await withCookie(session)).status).toBe(200);
    const setVersion = (v: string) => env.DB.prepare('UPDATE users SET session_version = ? WHERE id = ?').bind(Number(v), ADMIN_ID).run();
    await setVersion('2');
    try {
      expect((await withCookie(session)).status).toBe(401);
      // Opnieuw inloggen geeft een cookie met de nieuwe versie.
      const fresh = (await login('test-wachtwoord')).headers.get('set-cookie')!.split(';')[0];
      expect(fresh).toMatch(new RegExp(String.raw`^tick_session=\d+\.${ADMIN_ID}\.2\.`));
      expect((await withCookie(fresh)).status).toBe(200);
    } finally {
      await setVersion('1'); // de D1 wordt tussen tests niet teruggezet
    }
  });

  it('weigert een verlopen cookie en het oude formaat zonder gebruiker', async () => {
    expect((await withCookie(await cookieFor(Date.now() + DAY))).status).toBe(200);
    expect((await withCookie(await cookieFor(Date.now() - 1000))).status).toBe(401);
    const exp = Date.now() + DAY;
    const old = await cookieFor(exp, '1', `${exp}.1`); // geldig ondertekend, maar zonder gebruiker
    expect((await withCookie(old)).status).toBe(401);
  });

  it('vernieuwt de cookie als minder dan de helft van de looptijd over is', async () => {
    const res = await withCookie(await cookieFor(Date.now() + 10 * DAY));
    expect(res.status).toBe(200);
    const renewed = res.headers.get('set-cookie')!;
    expect(renewed).toContain(`Max-Age=${SESSION_DAYS * 86_400}`);
    const exp = Number(renewed.match(/tick_session=(\d+)\./)![1]);
    expect(exp).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it('vernieuwt een verse cookie niet', async () => {
    const res = await withCookie(await cookieFor(Date.now() + 20 * DAY));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('INBOX_TOKEN', () => {
  it('mag taken in de inbox zetten', async () => {
    const res = await call('/api/inbox', { method: 'POST', json: { titel: 'Via de inbox' }, auth: INBOX });
    expect(res.status).toBe(201);
    expect((await json<Task>(res)).source).toBe('api');
  });

  it('mag verder niets', async () => {
    expect((await call('/api/tasks', { auth: INBOX })).status).toBe(403);
    expect((await call('/api/tasks', { method: 'POST', json: { title: 'x' }, auth: INBOX })).status).toBe(403);
    expect((await call('/api/inbox', { auth: INBOX })).status).toBe(403);
    expect((await call('/', { auth: INBOX })).status).toBe(403);
  });

  it('API_TOKEN geeft geen toegang tot /api/inbox', async () => {
    expect((await call('/api/inbox', { method: 'POST', json: { titel: 'Oud token' } })).status).toBe(403);
  });
});

describe('DEV_AUTH_BYPASS', () => {
  const devEnv = { ...env, DEV_AUTH_BYPASS: '1' };

  it('werkt op localhost en 127.0.0.1', async () => {
    expect(await authorize(new Request('http://localhost:8787/api/tasks'), devEnv, await loadInstallPrefs(devEnv))).toEqual({ kind: 'dev', userId: ADMIN_ID });
    expect(await authorize(new Request('http://127.0.0.1:8787/'), devEnv, await loadInstallPrefs(devEnv))).toEqual({ kind: 'dev', userId: ADMIN_ID });
  });

  it('doet niets op een andere host', async () => {
    expect(await authorize(new Request('https://tick.example.com/api/tasks'), devEnv, await loadInstallPrefs(devEnv))).toBeNull();
    expect(await authorize(new Request('http://localhost.evil.test/'), devEnv, await loadInstallPrefs(devEnv))).toBeNull();
  });
});

describe('security headers', () => {
  const check = (res: Response) => {
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  };

  it('staan op de loginpagina, de API, statische bestanden, een redirect en een 401', async () => {
    check(await call('/login', { auth: null }));
    check(await call('/api/tasks'));
    check(await call('/app.js'));
    check(await call('/', { auth: null, headers: { accept: 'text/html' } }));
    check(await call('/api/tasks', { auth: null }));
  });

  it('de loginpagina heeft geen inline script of stijl', async () => {
    const html = await (await call('/login', { auth: null })).text();
    expect(html).not.toMatch(/<script>|<style|style=/);
    expect(html).toContain('<script type="module" src="/login.js">');
  });

  it('login.css en login.js zijn zonder inlog te laden', async () => {
    for (const path of ['/login.css', '/login.js']) {
      const res = await call(path, { auth: null });
      expect(res.status).toBe(200);
      check(res);
    }
    expect((await call('/app.js', { auth: null })).status).toBe(401);
  });
});

describe('uitloggen in de web-app', () => {
  it('de instellingenpagina heeft een uitlogknop (POST /logout)', async () => {
    expect(await (await call('/')).text()).toContain('id="btn-settings"');
    expect(await (await call('/settingsview.js')).text()).toContain("'/logout'");
  });
});

describe('beveiligingsheaders', () => {
  it('staat OSM-tegels en geolocatie toe', async () => {
    const res = await call('/api/tasks');
    expect(res.headers.get('content-security-policy')).toContain("img-src 'self' data: https://tile.openstreetmap.org");
    expect(res.headers.get('permissions-policy')).toContain('geolocation=(self)');
  });
});
