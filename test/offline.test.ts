import { describe, expect, it } from 'vitest';
import { call, json, openTasks, type Task } from './helpers';

const post = (body: Record<string, unknown>) => call('/api/tasks', { method: 'POST', json: body });

describe('client-ID\'s (offline aanmaken)', () => {
  it('gebruikt het id van de client', async () => {
    const id = crypto.randomUUID();
    const res = await post({ id, title: 'Offline gemaakt' });
    expect(res.status).toBe(201);
    expect((await json<Task>(res)).id).toBe(id);
  });

  it('is idempotent: hetzelfde id opnieuw geeft de bestaande taak', async () => {
    const id = crypto.randomUUID();
    await post({ id, title: 'Eerste keer' });
    const again = await post({ id, title: 'Tweede keer' });
    expect(again.status).toBe(200);
    expect((await json<Task>(again)).title).toBe('Eerste keer');
    expect((await openTasks()).filter((t) => t.id === id)).toHaveLength(1);
  });

  it('een subtaak kan direct naar een offline aangemaakte parent verwijzen', async () => {
    const parent = crypto.randomUUID();
    const child = crypto.randomUUID();
    await post({ id: parent, title: 'Parent', list: 'Werk' });
    const res = await post({ id: child, title: 'Kind', parent_id: parent });
    expect(res.status).toBe(201);
    expect(await json<Task>(res)).toMatchObject({ id: child, parent_id: parent, list: 'Werk' });
  });

  it('weigert een id dat geen UUID is', async () => {
    for (const id of ['abc', 123, '../../x', `${crypto.randomUUID()}x`]) {
      expect((await post({ id, title: 'x' })).status).toBe(400);
    }
  });

  it('maakt zonder id gewoon een nieuw id', async () => {
    const res = await post({ title: 'Zonder id' });
    expect(res.status).toBe(201);
    expect((await json<Task>(res)).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('een wijziging op een elders verwijderde taak geeft 404', async () => {
    const id = crypto.randomUUID();
    await post({ id, title: 'Weg' });
    await call(`/api/tasks/${id}`, { method: 'DELETE' });
    expect((await call(`/api/tasks/${id}`, { method: 'PATCH', json: { title: 'nieuw' } })).status).toBe(404);
  });
});

describe('app-shell', () => {
  it('index.html laadt app.js als ES-module', async () => {
    expect(await (await call('/')).text()).toContain('<script type="module" src="/app.js">');
  });

  it('alle bestanden uit de shell van de service worker bestaan', async () => {
    const sw = await (await call('/sw.js')).text();
    const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)![1].replace(/'/g, '"').replace(/,\s*\]/, ']')) as string[];
    expect(shell).toContain('/store.js');
    expect(shell).toContain('/settingsview.js');
    for (const p of ['/androidapp.js', '/applink.js', '/swclick.js', '/trash.js', '/share.js', '/copies.js']) expect(shell).toContain(p);
    for (const path of shell) expect((await call(path)).status, path).toBe(200);
  });

  it('de cacheversie is opgehoogd voor de bijlagen', async () => {
    const sw = await (await call('/sw.js')).text();
    expect(sw.match(/const CACHE = '([^']+)'/)![1]).toBe('tick-shell-v15');
  });

  it('elke module die de shell importeert zit zelf ook in de shell (anders is de app offline leeg)', async () => {
    const sw = await (await call('/sw.js')).text();
    const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)![1].replace(/'/g, '"').replace(/,\s*\]/, ']')) as string[];
    for (const path of shell.filter((p) => p.endsWith('.js') && !p.includes('.min.') && p !== '/leaflet.js')) {
      const code = await (await call(path)).text();
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+\.js)['"]/g)) {
        expect(shell, `${path} importeert /${m[1]}`).toContain(`/${m[1]}`);
      }
    }
  });
});
