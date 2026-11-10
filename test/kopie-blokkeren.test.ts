import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { notifyCopyDone } from '../src/copies';
import type { TaskRow } from '../src/index';
import { userSettingStmt } from '../src/prefs';
import type { Sender } from '../src/push';
import { callAs, createUser, json, type Task } from './helpers';

type U = Awaited<ReturnType<typeof createUser>> & { name: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
const NOW = new Date().toISOString();
const mk = async (name: string): Promise<U> => ({ ...await createUser({ name }), name });
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const block = (by: U, other: U) => env.DB.prepare('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(by.id, other.id, NOW).run();
const unblock = (by: U, other: U) => env.DB.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(by.id, other.id).run();

async function post(u: U, title: string) {
  const res = await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title } });
  expect(res.status).toBe(201);
  return (await json<Task>(res)).id;
}
/** `from` deelt `taskId` als kopie (of gedeeld) met u, u accepteert; geeft de share-id. */
async function give(taskId: string, from: U, u: U, mode = 'copy') {
  const res = await callAs(from.cookie, '/api/shares', { method: 'POST', json: { task_id: taskId, to_user: u.id, mode } });
  expect(res.status).toBe(201);
  const s = await json<{ id: string }>(res);
  expect((await callAs(u.cookie, `/api/shares/${s.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
}
const copyOf = async (u: U, title: string) =>
  (await env.DB.prepare('SELECT id FROM tasks WHERE user_id = ? AND title = ? AND parent_id IS NULL').bind(u.id, title).first<{ id: string }>())!.id;
const copiesOf = async (u: U, id: string) => (await json<Task[]>(await callAs(u.cookie, '/api/tasks'))).find((x) => x.id === id)?.copies;
const names = async (u: U, id: string) => ((await copiesOf(u, id))?.members ?? []).map((m) => m.name);

function fakeSender() {
  const to: string[] = [];
  const send: Sender = async (_env, userId, make) => {
    make('nl');
    to.push(userId);
    return { ok: 0, total: 0 };
  };
  return { send, to };
}

describe('blokkeren in een kopiegroep', () => {
  let a: U, b: U, c: U, d: U;
  beforeAll(async () => {
    [a, b, c, d] = await Promise.all(['Anna', 'Bert', 'Cor', 'Dirk'].map((n) => mk(`${n} ${uniq()}`)));
  });

  /** Groep van a met b en c (c kreeg zijn kopie van b); b's exemplaar is gedeeld met d. */
  async function group() {
    const title = `Klus ${uniq()}`;
    const ta = await post(a, title);
    await give(ta, a, b);
    const tb = await copyOf(b, title);
    await give(tb, b, c);
    const tc = await copyOf(c, title);
    await give(tb, b, d, 'shared');
    return { ta, tb, tc };
  }

  it('wie blokkeert en wie geblokkeerd is, zien elkaar niet meer als lid; de anderen merken niets', async () => {
    const g = await group();
    expect(await names(b, g.tb)).toEqual([a.name, c.name].sort((x, y) => x.localeCompare(y)));
    await block(b, c);
    try {
      expect(await names(b, g.tb)).toEqual([a.name]);
      expect(await names(c, g.tc)).toEqual([a.name]);
      // d deelt b's exemplaar maar heeft zelf geen blokkade: ziet c nog.
      expect(await names(d, g.tb)).toEqual([a.name, c.name].sort((x, y) => x.localeCompare(y)));
      expect(await names(a, g.ta)).toEqual([b.name, c.name].sort((x, y) => x.localeCompare(y)));
      // De groep zelf blijft intact.
      expect((await row(g.tc)).copy_group).toBe((await row(g.ta)).copy_group);
    } finally {
      await unblock(b, c);
    }
    expect(await names(c, g.tc)).toEqual([a.name, b.name].sort((x, y) => x.localeCompare(y)));
  });

  it('"Kopie van": geen naam van een afzender met wie je een blokkade hebt', async () => {
    const g = await group();
    expect((await copiesOf(c, g.tc))!.from).toBe(b.name);
    await block(b, c); // b blokkeert c: c ziet b's naam ook niet
    try {
      expect((await copiesOf(c, g.tc))!.from).toBeNull();
    } finally {
      await unblock(b, c);
    }
    await block(c, b); // en andersom
    try {
      expect((await copiesOf(c, g.tc))!.from).toBeNull();
    } finally {
      await unblock(c, b);
    }
    expect((await copiesOf(c, g.tc))!.from).toBe(b.name);
  });

  it('notifyCopyDone: geen melding tussen geblokkeerden, in beide richtingen', async () => {
    const g = await group();
    await block(c, b);
    try {
      const viaB = fakeSender();
      await notifyCopyDone(env, await row(g.tb), { id: b.id, name: b.name }, 'nl', viaB.send);
      expect(viaB.to).toEqual([a.id]);
      const viaC = fakeSender();
      await notifyCopyDone(env, await row(g.tc), { id: c.id, name: c.name }, 'nl', viaC.send);
      // Niet naar b (eigenaar van zijn exemplaar), wel naar d die b's exemplaar deelt.
      expect(viaC.to.sort()).toEqual([a.id, d.id].sort());
    } finally {
      await unblock(c, b);
    }
    const after = fakeSender();
    await notifyCopyDone(env, await row(g.tc), { id: c.id, name: c.name }, 'nl', after.send);
    expect(after.to.sort()).toEqual([a.id, b.id, d.id].sort());
  });

  it('notifyCopyDone: wie afvinkte telt, ook als het een deelnemer is', async () => {
    const g = await group();
    await block(a, d);
    try {
      // d vinkt b's exemplaar af: a krijgt geen "d is klaar", c wel.
      const byD = fakeSender();
      await notifyCopyDone(env, await row(g.tb), { id: d.id, name: d.name }, 'nl', byD.send);
      expect(byD.to).toEqual([c.id]);
      // b vinkt zelf af: a krijgt hem gewoon.
      const byB = fakeSender();
      await notifyCopyDone(env, await row(g.tb), { id: b.id, name: b.name }, 'nl', byB.send);
      expect(byB.to.sort()).toEqual([a.id, c.id].sort());
      // Alleen een naam (oude aanroep): voorzichtig, iedereen op het afgevinkte exemplaar telt.
      const byName = fakeSender();
      await notifyCopyDone(env, await row(g.tb), b.name, 'nl', byName.send);
      expect(byName.to).toEqual([c.id]);
    } finally {
      await unblock(a, d);
    }
  });

  it('via de route telt wie afvinkte, niet iedereen op het exemplaar', async () => {
    const g = await group();
    const HOOK_A = 'https://hook.invalid/blok-a', HOOK_C = 'https://hook.invalid/blok-c';
    await userSettingStmt(env.DB, a.id, 'fallback_webhook', HOOK_A).run();
    await userSettingStmt(env.DB, c.id, 'fallback_webhook', HOOK_C).run();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }));
    const hits = (url: string) => spy.mock.calls.filter(([u]) => String(u) === url).length;
    await block(a, d);
    try {
      // b vinkt zijn eigen exemplaar af; d deelt het, maar vinkte niet af: a's blokkade van d telt dan niet.
      expect((await callAs(b.cookie, `/api/tasks/${g.tb}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
      await vi.waitFor(() => expect(hits(HOOK_C)).toBe(1));
      await vi.waitFor(() => expect(hits(HOOK_A)).toBe(1));
      // Nu vinkt d (deelnemer) af: c krijgt hem, a niet.
      expect((await callAs(d.cookie, `/api/tasks/${g.tb}`, { method: 'PATCH', json: { done: false } })).status).toBe(200);
      expect((await callAs(d.cookie, `/api/tasks/${g.tb}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
      await vi.waitFor(() => expect(hits(HOOK_C)).toBe(2));
      await new Promise((r) => setTimeout(r, 50));
      expect(hits(HOOK_A)).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await unblock(a, d);
      await userSettingStmt(env.DB, a.id, 'fallback_webhook', null).run();
      await userSettingStmt(env.DB, c.id, 'fallback_webhook', null).run();
    }
  });
});
