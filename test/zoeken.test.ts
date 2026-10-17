import { describe, expect, it } from 'vitest';
import { call, createTask, json, type Task } from './helpers';

/** Unieke tekst per test, zodat taken uit andere tests niet meetellen. */
const tag = () => `z${crypto.randomUUID().slice(0, 8)}`;

async function search(q: string, done = false): Promise<string[]> {
  const res = await call(`/api/tasks?${done ? 'done=1&' : ''}q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return (await json<Task[]>(res)).map((t) => t.title);
}

async function finish(t: Task) {
  expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
}

describe('zoeken', () => {
  it('vindt afgeronde taken op titel en omschrijving, hoofdletterongevoelig', async () => {
    const k = tag();
    await finish(await createTask({ title: `Garage ${k}` }));
    await finish(await createTask({ title: 'Iets anders', description: `staat in de omschrijving: ${k.toUpperCase()}` }));
    await createTask({ title: `Nog open ${k}` });
    expect((await search(k, true)).sort()).toEqual([`Garage ${k}`, 'Iets anders']);
  });

  it('zoekt ook in open taken', async () => {
    const k = tag();
    await createTask({ title: `Open ${k}` });
    await finish(await createTask({ title: `Klaar ${k}` }));
    expect(await search(k)).toEqual([`Open ${k}`]);
  });

  // Acht requests: tegelijk, en met ruime marge, want onder de belasting van de hele suite liep hij over de 5 s.
  it('behandelt % en _ letterlijk', async () => {
    const k = tag();
    await Promise.all([`${k} 100% klaar`, `${k} 100 klaar`, `${k} a_b`, `${k} axb`]
      .map(async (title) => finish(await createTask({ title }))));
    expect(await search(`${k} 100%`, true)).toEqual([`${k} 100% klaar`]);
    expect(await search(`${k} a_b`, true)).toEqual([`${k} a_b`]);
  }, 15_000);

  it('negeert een lege zoekterm', async () => {
    const k = tag();
    await createTask({ title: `Leeg ${k}` });
    expect(await search('   ')).toContain(`Leeg ${k}`);
  });

  it('weigert een te lange zoekterm', async () => {
    expect((await call(`/api/tasks?done=1&q=${'x'.repeat(201)}`)).status).toBe(400);
  });
});
