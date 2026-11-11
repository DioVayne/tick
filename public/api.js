import { errorText, t } from './i18n.js';

/** Geen verbinding met de server (fetch zelf mislukte). */
export class Offline extends Error {}

/**
 * JSON-request naar de eigen API. Gooit Offline zonder netwerk, en een Error met `status` bij een HTTP-fout.
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @param {Record<string, string>} [extra] extra headers (zoals x-tick-op uit de outbox)
 */
export async function request(method, path, body, extra) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Offline(t('api.offline'));
  }
  if (res.status === 401) location.href = '/login';
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(errorText(data, res.statusText)), { status: res.status });
  return data;
}
