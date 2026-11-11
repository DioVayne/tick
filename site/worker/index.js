// ticktodo.nl: static assets plus a small inline CMS (mini-CMS).
// Only the editable pages and /api/* reach this Worker (assets.run_worker_first in wrangler.jsonc);
// everything else is served straight from site/public.
//
// - Every editable element in the HTML has data-edit="key". The text in the HTML is the default.
// - Edits live in KV (binding CMS) under the key "content" as JSON {key: html}. An edit wins over the HTML.
// - Logged in (cookie from /beheer), the page also gets /beheer/editor.css and /beheer/editor.js.
import { gelijk, isIngelogd, sessieCookie, uitlogCookie, zelfdeHerkomst } from './auth.js';

// Paths of the pages with data-edit elements. Keep in step with run_worker_first in wrangler.(example.)jsonc.
export const PAGINAS = ['/', '/index.html', '/en/', '/en/index.html'];

// The same headers as /* in site/public/_headers, for the responses this Worker builds.
export const BEVEILIGING = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MAX_POGINGEN = 10;
const SLEUTEL = /^[a-z0-9-]{1,60}$/;

function metBeveiliging(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BEVEILIGING)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

async function leesJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function pagina(request, env) {
  // Always fetch the full page; otherwise the browser keeps an old copy from its cache.
  const schoon = new Request(request);
  schoon.headers.delete('if-none-match');
  schoon.headers.delete('if-modified-since');
  const res = await env.ASSETS.fetch(schoon);
  if (!env.CMS || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  const [content, ingelogd] = await Promise.all([env.CMS.get('content', 'json'), isIngelogd(request, env)]);
  const teksten = content || {};

  let rw = new HTMLRewriter().on('[data-edit]', {
    element(e) {
      const sleutel = e.getAttribute('data-edit');
      if (Object.prototype.hasOwnProperty.call(teksten, sleutel)) e.setInnerContent(teksten[sleutel], { html: true });
    },
  });
  if (ingelogd) {
    rw = rw
      .on('head', { element(e) { e.append('<link rel="stylesheet" href="/beheer/editor.css">', { html: true }); } })
      .on('body', { element(e) { e.append('<script src="/beheer/editor.js"></script>', { html: true }); } });
  }

  const uit = rw.transform(res);
  const headers = new Headers(uit.headers);
  headers.delete('etag');
  headers.delete('last-modified');
  headers.set('cache-control', 'no-store');
  headers.set('vary', 'Accept-Language, Cookie');
  return new Response(uit.body, { status: uit.status, headers });
}

async function login(request, env) {
  if (!zelfdeHerkomst(request)) return json({ fout: 'Niet toegestaan.' }, 403);
  // No password set: no admin at all.
  if (!env.ADMIN_PASSWORD || !env.CMS) return json({ fout: 'Het beheer is nog niet ingesteld.' }, 503);

  const pogingKey = 'poging:' + (request.headers.get('cf-connecting-ip') || 'onbekend');
  const pogingen = Number(await env.CMS.get(pogingKey)) || 0;
  if (pogingen >= MAX_POGINGEN) return json({ fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }, 429);

  const body = await leesJson(request);
  if (typeof body.wachtwoord !== 'string' || !(await gelijk(body.wachtwoord, env.ADMIN_PASSWORD))) {
    await env.CMS.put(pogingKey, String(pogingen + 1), { expirationTtl: 900 });
    return json({ fout: 'Dat wachtwoord klopt niet.' }, 401);
  }
  if (pogingen > 0) await env.CMS.delete(pogingKey);
  return json({ ok: true }, 200, { 'set-cookie': await sessieCookie(env) });
}

async function content(request, env) {
  if (!env.CMS) return json({ fout: 'De opslag is niet gekoppeld.' }, 500);
  if (request.method === 'GET') {
    if (!(await isIngelogd(request, env))) return json({ fout: 'Niet ingelogd.' }, 401);
    return json({ content: (await env.CMS.get('content', 'json')) || {} });
  }
  if (request.method !== 'PUT') return json({ fout: 'Niet toegestaan.' }, 405);
  if (!zelfdeHerkomst(request)) return json({ fout: 'Niet toegestaan.' }, 403);
  if (!(await isIngelogd(request, env))) return json({ fout: 'Je bent niet (meer) ingelogd.' }, 401);

  // { key, html } saves a text; { key, html: null } puts the original back.
  const { key, html } = await leesJson(request);
  if (typeof key !== 'string' || !SLEUTEL.test(key)) return json({ fout: 'Onbekend vlak.' }, 400);
  if (html !== null && (typeof html !== 'string' || html.length > 20000)) return json({ fout: 'Tekst is te lang.' }, 400);

  const opgeslagen = (await env.CMS.get('content', 'json')) || {};
  if (html === null) delete opgeslagen[key];
  else opgeslagen[key] = html;
  await env.CMS.put('content', JSON.stringify(opgeslagen));
  return json({ ok: true });
}

async function api(request, env, pad) {
  if (pad === '/api/content') return content(request, env);
  if (pad === '/api/login') return request.method === 'POST' ? login(request, env) : json({ fout: 'Niet toegestaan.' }, 405);
  if (pad === '/api/logout') {
    if (request.method !== 'POST') return json({ fout: 'Niet toegestaan.' }, 405);
    if (!zelfdeHerkomst(request)) return json({ fout: 'Niet toegestaan.' }, 403);
    return json({ ok: true }, 200, { 'set-cookie': uitlogCookie });
  }
  return json({ fout: 'Niet gevonden.' }, 404);
}

// Language: the browser's first choice ('nl' or 'en'; any other language counts as 'en'), or null without a usable header.
export function voorkeurTaal(header) {
  let beste = null;
  let besteQ = 0;
  for (const deel of (header || '').split(',')) {
    const [tag, ...params] = deel.trim().split(';');
    const taal = tag.trim().toLowerCase().split('-')[0];
    if (!taal || taal === '*') continue;
    let q = 1;
    for (const p of params) {
      const m = p.trim().match(/^q=([\d.]+)$/i);
      if (m) q = Number(m[1]);
    }
    if (q > besteQ) [beste, besteQ] = [taal, q];
  }
  return beste === null ? null : beste === 'nl' ? 'nl' : 'en';
}

const TAAL_JAAR = 60 * 60 * 24 * 365;

function doorsturen(doel, extra = {}) {
  return new Response(null, {
    status: 302,
    headers: { location: doel, 'cache-control': 'no-store', vary: 'Accept-Language, Cookie', ...extra },
  });
}

// The language switch links carry ?taal=nl|en: remember that choice in a cookie.
// On the Dutch home page: a remembered choice wins; a click from our own site stays Dutch;
// otherwise a browser that prefers another language than Dutch goes to /en/.
function taalRoute(request, url) {
  const keuze = url.searchParams.get('taal');
  if (keuze === 'nl' || keuze === 'en') {
    const cookie = `taal=${keuze}; Path=/; Max-Age=${TAAL_JAAR}; SameSite=Lax; Secure`;
    return doorsturen(keuze === 'en' ? '/en/' : '/', { 'set-cookie': cookie });
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') return null;
  const onthouden = (request.headers.get('cookie') || '').match(/(?:^|;\s*)taal=(nl|en)(?:;|$)/)?.[1];
  if (onthouden) return onthouden === 'en' ? doorsturen('/en/') : null;
  try {
    if (new URL(request.headers.get('referer') || '').origin === url.origin) return null;
  } catch {
    // no or invalid referer: decide on the browser language
  }
  return voorkeurTaal(request.headers.get('accept-language')) === 'en' ? doorsturen('/en/') : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pad = url.pathname;
    if (pad.startsWith('/api/')) return metBeveiliging(await api(request, env, pad));
    if (request.method === 'GET' && PAGINAS.includes(pad)) {
      const taal = taalRoute(request, url);
      if (taal) return metBeveiliging(taal);
      return metBeveiliging(await pagina(request, env));
    }
    return env.ASSETS.fetch(request);
  },
};
