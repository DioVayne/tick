import { beforeAll, describe, expect, it } from 'vitest';
import { pairIntent, settingsIntent } from '../public/applink.js';
import { call } from './helpers';

describe('intent-links voor de Android-app', () => {
  it('bouwt het koppel-intent met gecodeerde code', () =>
    expect(pairIntent('com.example.tick', 'a+b/c')).toBe('intent://pair?code=a%2Bb%2Fc#Intent;scheme=tick;package=com.example.tick;end'));

  it('bouwt het intent voor de telefooninstellingen', () =>
    expect(settingsIntent('com.example.tick')).toBe('intent://settings#Intent;scheme=tick;package=com.example.tick;end'));
});

describe('swclick.js: waar een tik op een melding heen gaat', () => {
  // Het klassieke script komt uit de assets van de Worker, zoals de browser het ook ophaalt.
  let clickTarget: (data: unknown, wins: unknown[]) => unknown;
  beforeAll(async () => {
    const fake: Record<string, any> = {};
    new Function('self', await (await call('/swclick.js')).text())(fake);
    clickTarget = fake.tickClickTarget;
  });
  const win = { focus: () => {} };

  it('opent de taak in een nieuw venster als er geen is', () =>
    expect(clickTarget({ taskId: 't1' }, [])).toEqual({ open: '/?task=t1' }));
  it('focust een open venster en stuurt het de taak', () =>
    expect(clickTarget({ taskId: 't1' }, [win])).toEqual({ focus: win, message: { type: 'open-task', id: 't1' } }));
  it('zonder taak: gewoon de app', () => {
    expect(clickTarget({}, [])).toEqual({ open: '/' });
    expect(clickTarget(undefined, [win])).toEqual({ focus: win });
  });
  it('codeert het taak-id in het adres', () =>
    expect(clickTarget({ taskId: 'a&b' }, [])).toEqual({ open: '/?task=a%26b' }));
});
