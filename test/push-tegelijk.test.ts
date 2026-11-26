import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/index';
import { loadInstallPrefs } from '../src/prefs';
import { SEND_CONCURRENCY, inParallel, pushRound, reminderPayload, runReminders, sendToAll, type Sender } from '../src/push';
import { createUser } from './helpers';

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Een abonnement met echte sleutels, zodat de melding opgebouwd kan worden (de pushdienst zelf is nep). */
async function subscribe(userId: string, endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const p256dh = b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at,locale,user_id) VALUES (?,?,?,?,?,?,?)')
    .bind(endpoint, p256dh, auth, '', new Date().toISOString(), 'nl', userId).run();
}

async function vapid(): Promise<Env> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { ...env, VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)) };
}

/** Nep-pushdienst die elk verzoek `ms` laat duren en bijhoudt hoeveel er tegelijk liepen. */
function slowPush(ms: number, status = 201) {
  const seen = { now: 0, max: 0, urls: [] as string[] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    seen.urls.push(String(input));
    seen.now++;
    seen.max = Math.max(seen.max, seen.now);
    await new Promise((r) => setTimeout(r, ms));
    seen.now--;
    return new Response(null, { status });
  });
  return seen;
}

describe('push: tegelijk versturen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('inParallel houdt de volgorde en het maximum aan', async () => {
    let now = 0; let max = 0;
    const out = await inParallel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      now++; max = Math.max(max, now);
      await new Promise((r) => setTimeout(r, 5 * (11 - n)));
      now--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(max).toBe(3);
    expect(await inParallel([], 3, async () => 1)).toEqual([]);
  });

  it('naar twaalf trage abonnementen tegelijk, hoogstens zes tegelijk, en elk precies één keer', async () => {
    const u = await createUser({ name: 'Sam' });
    for (let i = 0; i < 12; i++) await subscribe(u.id, `https://push.invalid/sam/${i}`);
    const e = await vapid();
    const seen = slowPush(200);
    const t0 = Date.now();
    const r = await sendToAll(e, u.id, (locale) => reminderPayload({ id: 'x', title: 'Planten', description: '' }, locale), 'nl');
    const ms = Date.now() - t0;
    expect(r).toEqual({ ok: 12, total: 12 });
    expect(seen.max).toBe(SEND_CONCURRENCY);
    expect(new Set(seen.urls).size).toBe(12);
    expect(seen.urls).toHaveLength(12);
    expect(ms).toBeLessThan(12 * 200 / 2); // na elkaar zou het 2,4 s duren
  });

  it('pushRound leest de abonnementen van een persoon één keer per ronde, en laat een verlopen adres daarna weg', async () => {
    const u = await createUser({ name: 'Alex' });
    await subscribe(u.id, 'https://push.invalid/alex/weg');
    await subscribe(u.id, 'https://push.invalid/alex/goed');
    const e = await vapid();
    let reads = 0;
    const db = new Proxy(e.DB, {
      get(target, prop) {
        if (prop === 'prepare') return (sql: string) => { if (/FROM push_subscriptions WHERE user_id/.test(sql)) reads++; return target.prepare(sql); };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      urls.push(String(input));
      return new Response(null, { status: String(input).endsWith('/weg') ? 410 : 201 });
    });
    const send = pushRound();
    const make = (locale: 'en' | 'nl') => reminderPayload({ id: 'y', title: 'Brood', description: '' }, locale);
    const [a, b] = await Promise.all([send({ ...e, DB: db }, u.id, make, 'nl'), send({ ...e, DB: db }, u.id, make, 'nl')]);
    expect(reads).toBe(1);
    expect(a.ok + b.ok).toBe(2);
    const c = await send({ ...e, DB: db }, u.id, make, 'nl');
    expect(c).toEqual({ ok: 1, total: 1 }); // het verlopen adres is weg, ook in de ronde
    expect(reads).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%/alex/weg'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('runReminders verwerkt taken tegelijk, en elke ontvanger krijgt elke taak precies één keer', async () => {
    const u = await createUser({ name: 'Sanne' });
    const ids: string[] = [];
    const at = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 10; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await env.DB.prepare("INSERT INTO tasks (id,user_id,title,description,list,position,source,created_at,updated_at,remind_at) VALUES (?,?,?,'','Inbox',?,'app',?,?,?)")
        .bind(id, u.id, `Taak ${i}`, i, at, at, at).run();
    }
    let now = 0; let max = 0;
    const got: string[] = [];
    const send: Sender = async (_e, userId, make) => {
      now++; max = Math.max(max, now);
      await new Promise((r) => setTimeout(r, 50));
      now--;
      if (userId === u.id) got.push(make('nl').taskId!);
      return { ok: 1, total: 1 };
    };
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(got.sort()).toEqual([...ids].sort());
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(SEND_CONCURRENCY);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND notified = 0').bind(u.id).first<{ n: number }>();
    expect(left).toEqual({ n: 0 });
    // Een tweede ronde stuurt niets opnieuw.
    got.length = 0;
    await runReminders(env, await loadInstallPrefs(env), send);
    expect(got).toEqual([]);
  });
});
