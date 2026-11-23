import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { callAs, createUser } from './helpers';
import { MAX_ITEMS, NEWS, SHOWN, hasUnseen, visibleNews } from '../public/news.js';
import { STRINGS } from '../public/i18n.js';

const keys = NEWS.flatMap((v) => v.items.map((i) => (typeof i === 'string' ? i : i.key)));
const configOf = async (cookie: string) => JSON.parse((await (await callAs(cookie, '/config.js')).text()).replace(/^export default /, '').replace(/;\s*$/, ''));

describe('Wat is er nieuw: de lijst (public/news.js)', () => {
  it('versies zijn datums, nieuwste eerst, zonder dubbele', () => {
    for (const v of NEWS) expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dates = NEWS.map((v) => v.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it(`hooguit ${MAX_ITEMS} zinnen per versie, elke zin in en en nl`, () => {
    for (const v of NEWS) {
      expect(v.items.length).toBeGreaterThan(0);
      expect(v.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    }
    for (const k of keys) {
      expect(STRINGS.en[k as keyof typeof STRINGS.en], k).toBeTruthy();
      expect(STRINGS.nl[k as keyof typeof STRINGS.nl], k).toBeTruthy();
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('een zin met `when` alleen waar die functie aan staat; hooguit SHOWN versies', () => {
    const off = visibleNews({ calendarFeeds: false }).flatMap((v) => v.items);
    const on = visibleNews({ calendarFeeds: true }).flatMap((v) => v.items);
    // De zinnen met `when` in de versies die nu in beeld zijn: alleen waar de functie aan staat.
    const conditional = NEWS.slice(0, SHOWN).flatMap((v) => v.items).filter((i) => typeof i !== 'string').map((i) => (i as { key: string }).key);
    for (const key of conditional) {
      expect(off).not.toContain(key);
      expect(on).toContain(key);
    }
    expect(off.length + conditional.length).toBe(on.length);
    expect(visibleNews({}).length).toBeLessThanOrEqual(SHOWN);
  });

  it('stipje zolang de nieuwste versie niet gezien is', () => {
    const top = NEWS[0].date;
    expect(hasUnseen(null, {})).toBe(true);
    expect(hasUnseen('2000-01-01', {})).toBe(true);
    expect(hasUnseen(top, {})).toBe(false);
    expect(hasUnseen('2999-12-31', {})).toBe(false);
  });
});

describe('Wat is er nieuw: gezien per gebruiker', () => {
  it('zonder rij telt de dag van aanmelden: een nieuw account heeft geen stipje, een oud wel', async () => {
    const nieuw = await createUser();
    expect((await configOf(nieuw.cookie)).newsSeen).toBe(new Date().toISOString().slice(0, 10));
    expect(hasUnseen((await configOf(nieuw.cookie)).newsSeen, {})).toBe(false);
    const oud = await createUser({ createdAt: '2026-01-05T10:00:00.000Z' });
    expect((await configOf(oud.cookie)).newsSeen).toBe('2026-01-05');
    expect(hasUnseen('2026-01-05', {})).toBe(true);
  });

  it('PATCH newsSeen bewaart de datum (op alle apparaten via /config.js); geen datum geeft 400', async () => {
    const u = await createUser({ createdAt: '2026-01-05T10:00:00.000Z' });
    const res = await callAs(u.cookie, '/api/settings', { method: 'PATCH', json: { newsSeen: NEWS[0].date } });
    expect(res.status).toBe(200);
    expect((await res.json<{ newsSeen: string }>()).newsSeen).toBe(NEWS[0].date);
    expect((await configOf(u.cookie)).newsSeen).toBe(NEWS[0].date);
    const row = await env.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'news_seen'").bind(u.id).first<{ value: string }>();
    expect(row?.value).toBe(NEWS[0].date);
    for (const bad of ['gisteren', 20261122, null, '2026-11-22T10:00']) {
      expect((await callAs(u.cookie, '/api/settings', { method: 'PATCH', json: { newsSeen: bad } })).status, String(bad)).toBe(400);
    }
  });
});
