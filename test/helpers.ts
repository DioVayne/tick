import { env, exports } from 'cloudflare:workers';
import { hashPassword } from '../src/password';

export { ADMIN_ID } from '../src/users';

export const BASE = 'https://tick.test';
export const TOKEN = 'test-token';
export const INBOX = 'Bearer test-inbox-token';

type Json = Record<string, unknown>;

/** Request naar de Worker, standaard met het API-token. */
export function call(path: string, init: RequestInit & { json?: unknown; auth?: string | null } = {}) {
  const headers = new Headers(init.headers);
  const auth = init.auth === undefined ? `Bearer ${TOKEN}` : init.auth;
  if (auth) headers.set('authorization', auth);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return exports.default.fetch(new Request(BASE + path, { ...init, headers, body, redirect: 'manual' }));
}

/** Willekeurig IP, zodat de rate limit (die over testbestanden heen telt) andere tests niet raakt. */
export const randomIp = () => `10.${[...crypto.getRandomValues(new Uint8Array(3))].join('.')}`;

export function login(password: string, from = randomIp(), email = '') {
  return call('/login', { method: 'POST', json: { email, password }, auth: null, headers: { 'cf-connecting-ip': from } });
}

/** Request zonder Bearer, met een sessiecookie (`tick_session=…`). */
export function callAs(cookie: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', randomIp());
  return call(path, { ...init, headers, auth: null });
}

/** Maakt een lid direct in `users` (uniek e-mailadres) en logt in via /login. */
export async function createUser(o: { name?: string; email?: string; password?: string } = {}):
  Promise<{ id: string; email: string; password: string; cookie: string }> {
  const id = crypto.randomUUID();
  const email = o.email ?? `u-${crypto.randomUUID()}@example.test`;
  const password = o.password ?? 'lid-wachtwoord';
  await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'member', ?)")
    .bind(id, o.name ?? 'Lid', email, await hashPassword(password), new Date().toISOString()).run();
  const res = await login(password, randomIp(), email);
  if (res.status !== 200) throw new Error(`inloggen als lid mislukt: ${res.status} ${await res.text()}`);
  return { id, email, password, cookie: res.headers.get('set-cookie')!.split(';')[0] };
}

/** Logt in en geeft de sessiecookie (`tick_session=…`) terug. */
export async function session(): Promise<string> {
  const res = await login('test-wachtwoord', randomIp());
  return res.headers.get('set-cookie')!.split(';')[0];
}

export async function json<T = Json>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export type Task = {
  id: string; title: string; description: string; list: string; parent_id: string | null;
  position: number; remind_at: string | null; notified: boolean; done: boolean; done_at: string | null;
  source: string;
  location: { name: string; lat: number; lng: number; radius: number; trigger: 'enter' | 'exit' } | null;
  location_notified: boolean;
  repeat: { rule: string; start: string; at: string } | null;
};

export async function createTask(body: Json): Promise<Task> {
  const res = await call('/api/tasks', { method: 'POST', json: body });
  if (res.status !== 201) throw new Error(`aanmaken mislukt: ${res.status} ${await res.text()}`);
  return json<Task>(res);
}

export async function openTasks(): Promise<Task[]> {
  return json<Task[]>(await call('/api/tasks'));
}
