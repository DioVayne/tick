import { describe, expect, it } from 'vitest';
import { call, callAs, createTask, createUser, INBOX, json, openTasks, session } from './helpers';

type Rpc = { jsonrpc: '2.0'; id: unknown; result?: any; error?: { code: number; message: string } };

let n = 0;
const rpc = (method: string, params?: unknown, init: { auth?: string | null; headers?: Record<string, string> } = {}) =>
  call('/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: ++n, method, params }, ...init });

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await json<Rpc>(await rpc('tools/call', { name, arguments: args }));
  return { isError: !!r.result.isError, text: r.result.content[0].text as string, data: () => JSON.parse(r.result.content[0].text) };
}

describe('MCP', () => {
  it('initialize geeft de gevraagde protocolversie terug en meldt tools', async () => {
    const r = await json<Rpc>(await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
    expect(r.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tick' } });
    const odd = await json<Rpc>(await rpc('initialize', { protocolVersion: '1999-01-01' }));
    expect(odd.result.protocolVersion).toBe('2025-11-25');
  });

  it('een notificatie krijgt 202 zonder body', async () => {
    const res = await call('/mcp', { method: 'POST', json: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('tools/list noemt de taak-tools met een schema', async () => {
    const r = await json<Rpc>(await rpc('tools/list'));
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['list_tasks', 'list_lists', 'create_task', 'update_task', 'complete_task', 'reopen_task', 'snooze_task', 'delete_task']);
    for (const t of r.result.tools) expect(t.inputSchema.type).toBe('object');
  });

  it('maken, vinden, wijzigen, afvinken en weggooien via de tools', async () => {
    const list = `mcp-${crypto.randomUUID().slice(0, 8)}`;
    const made = (await tool('create_task', { title: 'via Claude', list, description: 'notitie' })).data();
    expect(made).toMatchObject({ title: 'via Claude', list, description: 'notitie' });
    const sub = (await tool('create_task', { title: 'stapje', parent_id: made.id })).data();
    expect(sub).toMatchObject({ parent_id: made.id, list });

    expect((await tool('list_tasks', { list })).data().map((t: { id: string }) => t.id)).toEqual([made.id, sub.id]);
    expect((await tool('list_lists')).data()).toContainEqual({ name: list, open: 2, id: expect.any(String), shared: null });

    expect((await tool('update_task', { id: made.id, title: 'nieuw', pinned: true })).data()).toMatchObject({ title: 'nieuw', pinned: true });
    expect((await tool('snooze_task', { id: made.id, minutes: 30 })).data().remind_at).toEqual(expect.any(String));

    await tool('complete_task', { id: made.id });
    expect((await openTasks()).some((t) => t.id === made.id)).toBe(false);
    expect((await tool('list_tasks', { list, done: true })).data()[0]).toMatchObject({ id: made.id, done: true });
    await tool('reopen_task', { id: made.id });
    expect((await openTasks()).some((t) => t.id === made.id)).toBe(true);

    await tool('delete_task', { id: made.id });
    expect((await openTasks()).some((t) => t.id === made.id)).toBe(false);
  });

  it('een tijd zonder zone telt in de tijdzone van de gebruiker', async () => {
    const t = (await tool('create_task', { title: 'zone', remind_at: '2099-07-01T10:00:00' })).data();
    expect(t.remind_at).toBe('2099-07-01T08:00:00.000Z'); // Europe/Amsterdam in de zomer
  });

  it('een fout van de API wordt een tool-resultaat met isError', async () => {
    const missing = await tool('complete_task', { id: crypto.randomUUID() });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not found/i);
    expect((await tool('create_task', { title: '' })).isError).toBe(true);
    expect((await tool('update_task', {})).isError).toBe(true);
  });

  it('onbekende methode of tool geeft een JSON-RPC-fout', async () => {
    expect((await json<Rpc>(await rpc('resources/list'))).error?.code).toBe(-32601);
    expect((await json<Rpc>(await rpc('tools/call', { name: 'drop_tables' }))).error?.code).toBe(-32602);
    const bad = await call('/mcp', { method: 'POST', body: 'geen json', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
  });

  it('alleen met een full-sleutel: geen sleutel 401, inbox-sleutel en sessie 403', async () => {
    expect((await rpc('tools/list', undefined, { auth: null })).status).toBe(401);
    expect((await rpc('tools/list', undefined, { auth: INBOX })).status).toBe(403);
    const cookie = await session();
    expect((await callAs(cookie, '/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status).toBe(403);
  });

  it('een vreemde Origin wordt geweigerd; GET geeft 405', async () => {
    expect((await rpc('tools/list', undefined, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await rpc('tools/list', undefined, { headers: { origin: 'https://tick.test' } })).status).toBe(200);
    expect((await call('/mcp')).status).toBe(405);
  });

  it('een sleutel van een lid ziet alleen de taken van dat lid', async () => {
    const admin = await createTask({ title: 'van de beheerder' });
    const b = await createUser();
    const { key } = await json<{ key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'Claude', kind: 'full' } }));
    const asB = (name: string, args: Record<string, unknown> = {}) =>
      rpc('tools/call', { name, arguments: args }, { auth: `Bearer ${key}` }).then((r) => json<Rpc>(r));
    const made = JSON.parse((await asB('create_task', { title: 'van het lid' })).result.content[0].text);
    const seen = JSON.parse((await asB('list_tasks')).result.content[0].text).map((t: { id: string }) => t.id);
    expect(seen).toEqual([made.id]);
    expect((await asB('complete_task', { id: admin.id })).result.isError).toBe(true);
  });
});
