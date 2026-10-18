import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { cleanMime, cleanName, MAX_FILES, sweepAttachments } from '../src/attachments';
import { BASE, call, callAs, createTask, createUser, json, openTasks, session, TOKEN } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type Att = { id: string; name: string; mime: string; size: number; width: number | null; height: number | null };

const uniq = () => crypto.randomUUID().slice(0, 8);
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

function upload(taskId: string, body: BodyInit, o: { name?: string; type?: string; w?: number; h?: number; as?: User } = {}) {
  const q = new URLSearchParams({ name: o.name ?? 'foto.jpg', ...(o.w ? { w: String(o.w) } : {}), ...(o.h ? { h: String(o.h) } : {}) });
  const init = { method: 'POST', body, headers: { 'content-type': o.type ?? 'image/jpeg' } };
  return o.as ? callAs(o.as.cookie, `/api/tasks/${taskId}/attachments?${q}`, init) : call(`/api/tasks/${taskId}/attachments?${q}`, init);
}

const row = (id: string) => env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<{ r2_key: string; task_id: string }>();

describe('bijlagen', () => {
  let b: User;
  let c: User;
  beforeAll(async () => {
    b = await createUser({ name: `Bea ${uniq()}` });
    c = await createUser({ name: `Cas ${uniq()}` });
  });

  it('uploaden, ophalen en verwijderen door de eigenaar', async () => {
    const t = await createTask({ title: `Met foto ${uniq()}` });
    const res = await upload(t.id, bytes(1234), { name: 'C:\\fotos\\strand.jpg', w: 800, h: 600 });
    expect(res.status).toBe(201);
    const a = await json<Att>(res);
    expect(a).toMatchObject({ name: 'strand.jpg', mime: 'image/jpeg', size: 1234, width: 800, height: 600 });

    // In de takenlijst en in de eigen route.
    expect((await openTasks()).find((x) => x.id === t.id)).toMatchObject({ attachments: [{ id: a.id, name: 'strand.jpg' }] });
    expect(await json<Att[]>(await call(`/api/tasks/${t.id}/attachments`))).toHaveLength(1);

    const get = await call(`/api/attachments/${a.id}`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/jpeg');
    expect(get.headers.get('content-disposition')).toMatch(/^inline; filename="strand\.jpg"/);
    expect(get.headers.get('cache-control')).toContain('immutable');
    expect(get.headers.get('content-security-policy')).toMatch(/default-src 'self'.*; sandbox$/);
    expect((await get.arrayBuffer()).byteLength).toBe(1234);
    expect((await call(`/api/attachments/${a.id}?download=1`)).headers.get('content-disposition')).toMatch(/^attachment;/);

    // Opnieuw met de ETag: 304. Een stuk: 206.
    const again = await call(`/api/attachments/${a.id}`, { headers: { 'if-none-match': get.headers.get('etag')! } });
    expect(again.status).toBe(304);
    const part = await call(`/api/attachments/${a.id}`, { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-99/1234');
    expect((await part.arrayBuffer()).byteLength).toBe(100);

    const key = (await row(a.id))!.r2_key;
    expect((await call(`/api/attachments/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await row(a.id)).toBeNull();
    expect(await env.FILES!.head(key)).toBeNull();
    expect((await call(`/api/attachments/${a.id}`)).status).toBe(404);
  });

  it('een ander account ziet niets; een geaccepteerde deelnemer wel en mag toevoegen', async () => {
    const t = await createTask({ title: `Gedeeld ${uniq()}` });
    const a = await json<Att>(await upload(t.id, bytes(10)));
    expect((await callAs(c.cookie, `/api/attachments/${a.id}`)).status).toBe(404);
    expect((await upload(t.id, bytes(10), { as: c })).status).toBe(404);
    expect((await callAs(c.cookie, `/api/attachments/${a.id}`, { method: 'DELETE' })).status).toBe(404);

    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: b.email, mode: 'shared' } }));
    expect((await callAs(b.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await callAs(b.cookie, `/api/attachments/${a.id}`)).status).toBe(200);
    const mine = await upload(t.id, bytes(20), { as: b, name: 'lijst.pdf', type: 'application/pdf' });
    expect(mine.status).toBe(201);
    expect(await json<Att[]>(await call(`/api/tasks/${t.id}/attachments`))).toHaveLength(2);
  });

  it('weigert te grote bestanden en te veel bijlagen', async () => {
    const t = await createTask({ title: `Vol ${uniq()}` });
    const big = await upload(t.id, bytes(10 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect((await json<{ error: string }>(big)).error).toContain('10 MB');
    for (let i = 0; i < MAX_FILES; i++) expect((await upload(t.id, bytes(1), { name: `${i}.png`, type: 'image/png' })).status).toBe(201);
    expect((await upload(t.id, bytes(1))).status).toBe(400);
  });

  it('html, svg en onbekende types komen terug als download, nooit met hun eigen type', async () => {
    const t = await createTask({ title: `Gevaarlijk ${uniq()}` });
    for (const [name, type] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml'], ['x.bin', 'nonsense']]) {
      const a = await json<Att>(await upload(t.id, '<script>alert(1)</script>', { name, type }));
      const res = await call(`/api/attachments/${a.id}`);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toMatch(/sandbox$/);
    }
  });

  it('een geaccepteerde kopie deelt het object; het gaat pas weg met de laatste rij', async () => {
    const t = await createTask({ title: `Kopie ${uniq()}` });
    const kid = await createTask({ title: 'kind', parent_id: t.id });
    const a = await json<Att>(await upload(t.id, bytes(5)));
    const k = await json<Att>(await upload(kid.id, bytes(6), { name: 'kind.png', type: 'image/png' }));
    const s = await json<{ id: string }>(await call('/api/shares', { method: 'POST', json: { task_id: t.id, to: c.email, mode: 'copy' } }));
    expect((await callAs(c.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const theirs = (await json<{ id: string; parent_id: string | null; title: string; attachments: Att[] }[]>(await callAs(c.cookie, '/api/tasks')))
      .filter((x) => x.title === t.title || x.title === 'kind');
    const copy = theirs.find((x) => !x.parent_id)!;
    const copyKid = theirs.find((x) => x.parent_id === copy.id)!;
    expect(copy.attachments).toHaveLength(1);
    expect(copyKid.attachments).toMatchObject([{ name: 'kind.png' }]);
    const key = (await row(a.id))!.r2_key;
    expect((await row(copy.attachments[0].id))!.r2_key).toBe(key);

    expect((await call(`/api/attachments/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.FILES!.head(key)).not.toBeNull(); // de kopie gebruikt hem nog
    expect((await callAs(c.cookie, `/api/attachments/${copy.attachments[0].id}`)).status).toBe(200);
    expect((await callAs(c.cookie, `/api/attachments/${copy.attachments[0].id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.FILES!.head(key)).toBeNull();
    expect(k.id).not.toBe(copyKid.attachments[0].id);
  });

  it('de cron ruimt bijlagen van gewiste taken en oude onafgemaakte uploads op', async () => {
    const t = await createTask({ title: `Weg ${uniq()}` });
    const a = await json<Att>(await upload(t.id, bytes(3)));
    const key = (await row(a.id))!.r2_key;
    // Een upload die nooit afkwam: rij pending, met een object, twee uur oud.
    const pendingKey = `a/${crypto.randomUUID()}`;
    await env.FILES!.put(pendingKey, 'half');
    const pendingId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, status, created_at) VALUES (?, ?, 'x', 'half', 'image/jpeg', 4, ?, 'pending', ?)")
      .bind(pendingId, t.id, pendingKey, new Date(Date.now() - 2 * 3600_000).toISOString()).run();

    expect((await call(`/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    await sweepAttachments(env, Date.now());
    expect(await row(a.id)).not.toBeNull(); // in de prullenbak blijft hij bewaard
    expect(await row(pendingId)).toBeNull();
    expect(await env.FILES!.head(pendingKey)).toBeNull();

    expect((await call(`/api/tasks/${t.id}?purge=1`, { method: 'DELETE' })).status).toBe(200);
    while (await sweepAttachments(env, Date.now()));
    expect(await row(a.id)).toBeNull();
    expect(await env.FILES!.head(key)).toBeNull();
  });

  it('de export noemt de bijlagen, zonder de bestanden', async () => {
    const t = await createTask({ title: `Export ${uniq()}` });
    const a = await json<Att>(await upload(t.id, bytes(8), { name: 'bon.pdf', type: 'application/pdf' }));
    const own = await json<{ attachments: { id: string; task_id: string; name: string }[] }>(await callAs(await session(), '/api/export'));
    expect(own.attachments).toContainEqual(expect.objectContaining({ id: a.id, task_id: t.id, name: 'bon.pdf' }));
    const theirs = await json<{ attachments: { id: string }[] }>(await callAs(b.cookie, '/api/export'));
    expect(theirs.attachments.some((x) => x.id === a.id)).toBe(false);
  });

  it('zonder FILES-binding bestaan de bijlagen niet', async () => {
    const t = await createTask({ title: `Zonder ${uniq()}` });
    const noFiles = { ...env, FILES: undefined };
    const go = (path: string, init: RequestInit = {}) => worker.fetch(new Request(BASE + path, {
      ...init, headers: { authorization: `Bearer ${TOKEN}`, ...init.headers as Record<string, string> },
    }), noFiles, createExecutionContext());
    expect((await go(`/api/tasks/${t.id}/attachments`)).status).toBe(404);
    expect((await go(`/api/tasks/${t.id}/attachments?name=x`, { method: 'POST', body: 'x' })).status).toBe(404);
    const tasks = await (await go('/api/tasks')).json<{ id: string; attachments: unknown[] }[]>();
    expect(tasks.find((x) => x.id === t.id)?.attachments).toEqual([]);
    // Andere API-routes werken gewoon, en de app weet dat er geen bijlagen zijn.
    expect((await go('/api/lists')).status).toBe(200);
    expect(await (await go('/config.js')).text()).toContain('"attachments":false');
  });

  it('naam en type worden opgeschoond', () => {
    expect(cleanName('../../etc/passwd')).toBe('passwd');
    expect(cleanName('  \u0007 ')).toBe('file');
    expect(cleanName('a'.repeat(300))).toHaveLength(200);
    expect(cleanMime('IMAGE/PNG; charset=x')).toBe('image/png');
    expect(cleanMime('text/html<script>')).toBe('application/octet-stream');
    expect(cleanMime(undefined)).toBe('application/octet-stream');
  });
});
