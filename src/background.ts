import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { maxUpload } from './attachments';
import { userSettingStmt } from './prefs';

/**
 * Achtergrondfoto: één foto per persoon, in R2 onder `bg/<userId>`. Dat hij er is staat als versie (tijdstip) in
 * `user_settings` (`background`), zodat andere apparaten de foto bij het laden van de instellingen oppikken.
 * Zonder `FILES`-binding geven alle routes een 404.
 */
export const backgroundApi = new Hono<AppEnv>();
backgroundApi.use('*', sessionOnly);
backgroundApi.use('*', async (c, next) => {
  if (!c.env.FILES) throw new HttpError(404, 'err.not_found');
  await next();
});

/** Types die de browser als achtergrond kan tonen; de client maakt er altijd een JPEG van. */
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export const backgroundKey = (userId: string) => `bg/${userId}`;

backgroundApi.put('/', async (c) => {
  const max = maxUpload(c.env);
  const length = Number(c.req.header('content-length'));
  if (!Number.isInteger(length) || length < 0 || !c.req.raw.body) throw new HttpError(411, 'err.length_required');
  if (length > max) throw new HttpError(413, 'err.file_too_big', { max: Math.round(max / 1024 / 1024) });
  const type = String(c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) throw new HttpError(400, 'err.not_an_image');
  const userId = c.get('auth').userId;
  await c.env.FILES!.put(backgroundKey(userId), c.req.raw.body, { httpMetadata: { contentType: type } });
  const version = String(Date.now());
  await userSettingStmt(c.env.DB, userId, 'background', version).run();
  return c.json({ version });
});

backgroundApi.get('/', async (c) => {
  const obj = await c.env.FILES!.get(backgroundKey(c.get('auth').userId), { onlyIf: c.req.raw.headers });
  if (!obj) throw new HttpError(404, 'err.not_found');
  const headers = new Headers({
    'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
    // Het adres blijft gelijk; de browser vraagt telkens of er een nieuwe is (ETag), dat is goedkoop.
    'cache-control': 'private, no-cache',
    etag: obj.httpEtag,
    'content-security-policy': 'sandbox',
  });
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
});

backgroundApi.delete('/', async (c) => {
  const userId = c.get('auth').userId;
  await c.env.FILES!.delete(backgroundKey(userId));
  await userSettingStmt(c.env.DB, userId, 'background', null).run();
  return c.json({ ok: true });
});
