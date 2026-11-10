import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// De service worker is een los script: we laden hem met een nagemaakte `self` en vangen zijn handlers op.
const handlers = new Map<string, (e: any) => void>();
const shown: { title: string; opts: any }[] = [];

beforeAll(async () => {
  vi.stubGlobal('importScripts', () => {});
  vi.stubGlobal('registration', { showNotification: async (title: string, opts: any) => { shown.push({ title, opts }); } });
  vi.stubGlobal('clients', { matchAll: async () => [], claim: async () => {}, openWindow: async () => null });
  const add = vi.spyOn(globalThis, 'addEventListener').mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
  try {
    // @ts-expect-error -- sw.js is een klassiek script zonder exports
    await import('../public/sw.js');
  } finally { add.mockRestore(); }
});

afterEach(() => { vi.restoreAllMocks(); shown.length = 0; });

/** Een klik op een knop van een melding; geeft de beloftes van waitUntil terug. */
async function click(action: string, data: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  const notification = {
    title: 'Plant water', body: 'Om 9:00', icon: '/icon-192.png', badge: '/badge-96.png', tag: 't1', data,
    actions: [{ action: 'done', title: '✓' }, { action: 'snooze', title: 'In 1 hour' }], close: vi.fn(),
  };
  handlers.get('notificationclick')!({ action, notification, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return notification;
}

describe('service worker: knoppen in een melding', () => {
  it('een geslaagde actie laat de melding dicht', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const n = await click('done', { taskId: 't1' });
    expect(n.close).toHaveBeenCalled();
    expect(shown).toEqual([]);
  });

  it('geen verbinding: de melding komt terug met dezelfde gegevens en knoppen', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await click('done', { taskId: 't1', occurrence: '2030-01-01T09:00:00.000Z' });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Plant water');
    expect(shown[0].opts).toMatchObject({ body: 'Om 9:00', tag: 't1', data: { taskId: 't1', occurrence: '2030-01-01T09:00:00.000Z' } });
    expect(shown[0].opts.actions.map((a: any) => a.action)).toEqual(['done', 'snooze']);
  });

  it('een weigering van de server (sessie verlopen) geeft de melding ook terug', async () => {
    for (const action of ['tomorrow', 'snooze']) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
      await click(action, { taskId: 't1' });
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    await click('accept', { shareId: 's1' });
    expect(shown).toHaveLength(3);
  });

  it('een taak die elders verwijderd is (404) komt niet terug: opnieuw proberen helpt niet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    await click('done', { taskId: 't1' });
    expect(shown).toEqual([]);
  });
});
