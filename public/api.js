import { t } from './i18n.js';

/** Geen verbinding met de server (fetch zelf mislukte). */
export class Offline extends Error {}

/** JSON-request naar de eigen API. Gooit Offline zonder netwerk, en een Error met `status` bij een HTTP-fout. */
export async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Offline(t('api.offline'));
  }
  if (res.status === 401) location.href = '/login';
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}
