import { beforeAll, describe, expect, it } from 'vitest';
import { LOC_BAR_SNOOZE_MS, OFFICIAL_PACKAGE, RELEASES_URL, locationProblems, packageFromReferrer, pairIntent, problemKey, pushAction, settingsIntent, showLocationBar, startPushAction } from '../public/applink.js';
import { OFFICIAL_APP } from '../src/assetlinks';
import { call } from './helpers';

describe('intent-links voor de Android-app', () => {
  it('bouwt het koppel-intent met gecodeerde code', () =>
    expect(pairIntent('com.example.tick', 'a+b/c')).toBe('intent://pair?code=a%2Bb%2Fc#Intent;scheme=tick;package=com.example.tick;end'));

  it('geeft het adres van de Tick mee, en zo nodig een downloadpagina als de app er niet is', () => {
    expect(pairIntent('com.example.tick', 'abc', 'https://t.example')).toBe(
      'intent://pair?code=abc&base=https%3A%2F%2Ft.example#Intent;scheme=tick;package=com.example.tick;end');
    expect(pairIntent(OFFICIAL_PACKAGE, 'abc', 'https://t.example', RELEASES_URL)).toBe(
      `intent://pair?code=abc&base=https%3A%2F%2Ft.example#Intent;scheme=tick;package=${OFFICIAL_PACKAGE};`
      + `S.browser_fallback_url=${encodeURIComponent(RELEASES_URL)};end`);
  });

  it('leest het package van de app uit de referrer van een TWA-start', () => {
    expect(packageFromReferrer('android-app://nl.detussenpartij.tick/')).toBe('nl.detussenpartij.tick');
    expect(packageFromReferrer('android-app://com.example.tick')).toBe('com.example.tick');
    expect(packageFromReferrer('https://t.example/')).toBeNull();
    expect(packageFromReferrer('android-app://geen-package/')).toBeNull();
    expect(packageFromReferrer('android-app://com.example.tick;end/')).toBeNull();
    expect(packageFromReferrer('')).toBeNull();
  });

  it('de officiële app heeft hetzelfde package als in assetlinks', () => expect(OFFICIAL_PACKAGE).toBe(OFFICIAL_APP.pkg));

  it('bouwt het intent voor de telefooninstellingen', () =>
    expect(settingsIntent('com.example.tick')).toBe('intent://settings#Intent;scheme=tick;package=com.example.tick;end'));
});

describe('pushAction: wanneer de PWA meldingen aanzet na het koppelen', () => {
  it('toestemming gegeven en nog niet geabonneerd: abonneren', () => expect(pushAction('granted', false)).toBe('subscribe'));
  it('al geabonneerd: niets doen', () => {
    expect(pushAction('granted', true)).toBe('none');
    expect(pushAction('default', true)).toBe('none');
  });
  it('nog niet beantwoord: wachten op de app', () => expect(pushAction('default', false)).toBe('wait'));
  it('geweigerd: niets doen', () => expect(pushAction('denied', false)).toBe('none'));
});

describe('startPushAction: meldingen aanzetten bij elke start van de app', () => {
  it('toestemming gegeven, geen abonnement: abonneren (ook zonder opnieuw te koppelen, bijvoorbeeld na een update)', () =>
    expect(startPushAction('granted', false, false)).toBe('subscribe'));
  it('zelf uitgezet op dit apparaat: niets doen', () => expect(startPushAction('granted', false, true)).toBe('none'));
  it('al geabonneerd, geweigerd of nog niet beantwoord: niets doen (bij de start wacht hij niet)', () => {
    expect(startPushAction('granted', true, false)).toBe('none');
    expect(startPushAction('denied', false, false)).toBe('none');
    expect(startPushAction('default', false, false)).toBe('none');
  });
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
  it('url met een taak: een open venster krijgt die taak', () => {
    expect(clickTarget({ url: '/?task=t2' }, [win])).toEqual({ focus: win, message: { type: 'open-task', id: 't2' } });
    expect(clickTarget({ url: '/?task=a%26b' }, [win])).toEqual({ focus: win, message: { type: 'open-task', id: 'a&b' } });
    expect(clickTarget({ url: '/?task=t2' }, [])).toEqual({ open: '/?task=t2' });
    expect(clickTarget({ url: '/' }, [win])).toEqual({ focus: win });
  });
  it('geo=1 (een plek van een ander) gaat mee naar een open venster', () => {
    expect(clickTarget({ url: '/?task=t3&geo=1' }, [win])).toEqual({ focus: win, message: { type: 'open-task', id: 't3', geo: true } });
    expect(clickTarget({ url: '/?task=t3&geo=1' }, [])).toEqual({ open: '/?task=t3&geo=1' });
  });
  it('codeert het taak-id in het adres', () =>
    expect(clickTarget({ taskId: 'a&b' }, [])).toEqual({ open: '/?task=a%26b' }));
});

describe('locatiebalk: wanneer Tick waarschuwt dat locatiemeldingen niet werken', () => {
  const phone = (key_id: string, location: string, notifications = true) => ({ key_id, status: { location, notifications } });
  const now = 1_000_000_000;

  it('telt telefoons zonder altijd-locatie of zonder meldingen; zonder status niet', () => {
    const phones = [phone('a', 'always'), phone('b', 'foreground'), phone('c', 'off'), phone('d', 'always', false), { key_id: 'e', status: null }];
    expect(locationProblems(phones).map((p) => p.key_id)).toEqual(['b', 'c', 'd']);
  });

  it('in de app altijd, elders alleen met een taak met een plek', () => {
    const problems = [phone('b', 'off')];
    expect(showLocationBar({ problems, inApp: true, hasLocationTasks: false, dismissed: null, now })).toBe(true);
    expect(showLocationBar({ problems, inApp: false, hasLocationTasks: false, dismissed: null, now })).toBe(false);
    expect(showLocationBar({ problems, inApp: false, hasLocationTasks: true, dismissed: null, now })).toBe(true);
    expect(showLocationBar({ problems: [], inApp: true, hasLocationTasks: true, dismissed: null, now })).toBe(false);
  });

  it('weggeklikt blijft weg, tot de status verandert of de tijd om is', () => {
    const problems = [phone('b', 'off')];
    const dismissed = { key: problemKey(problems), at: now };
    expect(showLocationBar({ problems, inApp: true, hasLocationTasks: true, dismissed, now: now + 1000 })).toBe(false);
    expect(showLocationBar({ problems, inApp: true, hasLocationTasks: true, dismissed, now: now + LOC_BAR_SNOOZE_MS + 1 })).toBe(true);
    expect(showLocationBar({ problems: [phone('b', 'foreground')], inApp: true, hasLocationTasks: true, dismissed, now: now + 1000 })).toBe(true);
  });
});
