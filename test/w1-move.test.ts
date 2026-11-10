// Fixes uit ronde w1 voor verhuizen: een pakket wordt helemaal gecontroleerd vóór er iets geschreven wordt, en
// `/file` vertrouwt het bijlage-id uit de body niet.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAs, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const OLD = 'https://old-w1.example.test';
const SECRET = 'w1secretw1secretw1secretw1secret';
const CODE = `${OLD}/api/move/out/${SECRET}`;
/** Wat de nep-oude Tick als pakket teruggeeft; per test in te vullen. */
let bundle: unknown = null;
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === CODE) return Response.json(bundle);
    if (url.startsWith(CODE + '/file/')) return new Response(new Uint8Array([1, 2, 3]));
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const post = (u: User, path: string, body: unknown = {}) => callAs(u.cookie, path, { method: 'POST', json: body });
const now = new Date().toISOString();
const pack = (o: Record<string, unknown>) => ({
  app: 'tick', kind: 'move', version: 1, exported_at: now, account: { name: 'Oud' },
  tasks: [], places: [], lists: [], review_skip: [], settings: {}, calendars: [], attachments: [], background: false, ...o,
});
const taskCount = async (u: User) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?').bind(u.id).first<number>('n'))!;

describe('B: het pakket wordt gecontroleerd vóór de eerste schrijfactie', () => {
  it('een agenda zonder naam geeft geen 500', async () => {
    const b = await createUser();
    bundle = pack({
      tasks: [{ id: crypto.randomUUID(), title: 'mee', position: 1, created_at: now, updated_at: now }],
      calendars: [{ url: 'https://calendar.example.test/ical/w1/basic.ics' }],
    });
    const res = await post(b, '/api/move/import', { code: CODE });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ tasks: 1, calendars: 0, calendars_skipped: 0 });
  });

  it('een taak die geen object is: 400 en er is niets geschreven', async () => {
    const b = await createUser();
    bundle = pack({ tasks: [{ id: crypto.randomUUID(), title: 'mee', position: 1, created_at: now, updated_at: now }, null] });
    const res = await post(b, '/api/move/import', { code: CODE });
    expect(res.status).toBe(400);
    expect(await taskCount(b)).toBe(0);
    bundle = pack({ places: ['x'] });
    expect((await post(b, '/api/move/import', { code: CODE })).status).toBe(400);
  });
});

describe('C: /file met een bijlage-id', () => {
  async function setup() {
    const b = await createUser();
    const t = await json<Task>(await post(b, '/api/tasks', { title: 'met bijlage' }));
    return { b, t };
  }
  const file = (o: Record<string, unknown>) => ({ code: CODE, from: crypto.randomUUID(), name: 'x.bin', mime: 'application/octet-stream', size: 3, ...o });

  it('een id dat geen UUID is: 400', async () => {
    const { b, t } = await setup();
    for (const id of ['', 'abc', '../x', 5]) {
      expect((await post(b, '/api/move/file', file({ id, task_id: t.id }))).status, String(id)).toBe(400);
    }
  });

  it('een bijlage-id van 32 hex-tekens (van een geaccepteerde kopie) verhuist gewoon', async () => {
    const b = await createUser();
    const taskId = crypto.randomUUID();
    const hexId = crypto.randomUUID().replace(/-/g, ''); // zoals lower(hex(randomblob(16))) in copyAttachmentStmt
    bundle = pack({
      tasks: [{ id: taskId, title: 'kopie met bijlage', position: 1, created_at: now, updated_at: now }],
      attachments: [{ id: hexId, task_id: taskId, name: 'k.bin', mime: 'application/octet-stream', size: 3, created_at: now }],
    });
    const imp = await json<{ files: { id: string; from: string; task_id: string; size: number }[] }>(await post(b, '/api/move/import', { code: CODE }));
    expect(imp.files).toHaveLength(1);
    expect(imp.files[0].id).toBe(hexId);
    const f = imp.files[0];
    const res = await post(b, '/api/move/file', file({ id: f.id, from: f.from, task_id: f.task_id, size: f.size }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, existed: false });
    expect(await env.DB.prepare("SELECT status FROM attachments WHERE id = ?").bind(hexId).first('status')).toBe('ready');
    // Hoofdletters of een andere lengte blijven geweigerd.
    for (const id of [hexId.toUpperCase().slice(0, 31), hexId + '0', 'g'.repeat(32)]) {
      expect((await post(b, '/api/move/file', file({ id, task_id: taskId }))).status, id).toBe(400);
    }
  });

  it('een id van een bijlage van een ander account telt niet als bestaand', async () => {
    const { b, t } = await setup();
    const c = await createUser();
    const other = await json<Task>(await post(c, '/api/tasks', { title: 'van C' }));
    const up = await callAs(c.cookie, `/api/tasks/${other.id}/attachments?name=c.bin`, { method: 'POST', body: new Uint8Array([9]), headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(201);
    const cAtt = (await env.DB.prepare('SELECT id FROM attachments WHERE task_id = ?').bind(other.id).first<{ id: string }>())!.id;
    const res = await post(b, '/api/move/file', file({ id: cAtt, task_id: t.id }));
    expect(res.status).toBe(409);
    expect((await json<{ key: string }>(res)).key).toBe('err.id_taken');
    // De bijlage van C is niet aangeraakt.
    expect(await env.DB.prepare('SELECT task_id FROM attachments WHERE id = ?').bind(cAtt).first()).toEqual({ task_id: other.id });
  });

  it('een eigen, al verhuisde bijlage bij dezelfde taak telt wel als bestaand', async () => {
    const { b, t } = await setup();
    const id = crypto.randomUUID();
    expect(await json(await post(b, '/api/move/file', file({ id, task_id: t.id })))).toEqual({ ok: true, existed: false });
    expect(await json(await post(b, '/api/move/file', file({ id, task_id: t.id })))).toEqual({ ok: true, existed: true });
    // Hetzelfde id bij een andere eigen taak: niet "bestaand".
    const t2 = await json<Task>(await post(b, '/api/tasks', { title: 'andere taak' }));
    expect((await post(b, '/api/move/file', file({ id, task_id: t2.id }))).status).toBe(409);
  });
});
