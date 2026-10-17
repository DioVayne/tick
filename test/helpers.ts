import { exports } from 'cloudflare:workers';

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

export function login(password: string, from = randomIp()) {
  return call('/login', { method: 'POST', json: { password }, auth: null, headers: { 'cf-connecting-ip': from } });
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
