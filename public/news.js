// De inhoud van "Wat is er nieuw" (de weergave staat in whatsnew.js). Een versie heet naar de dag waarop hij live
// ging (YYYY-MM-DD): de web-app heeft geen versienummer, en een datum staat vanzelf op volgorde. Een nieuwe zichtbare
// wijziging = een zin erbij in de versie van vandaag, of een nieuwe versie bovenaan; hooguit MAX_ITEMS zinnen per versie.
// Elke zin is een sleutel in public/i18n.js (en + nl). Een zin kan `when` hebben: dan komt hij alleen op een Tick
// waar die functie aan staat (bijvoorbeeld de agenda). Geen imports: de tests lezen dit bestand direct.

/** @typedef {string | { key: string, when: (config: Record<string, unknown>) => boolean }} NewsItem */

/** Nieuwste eerst; hooguit MAX_ITEMS zinnen per versie (test/whatsnew.test.ts controleert dat). @type {{ date: string, items: NewsItem[] }[]} */
export const NEWS = [
  { date: '2026-11-28', items: ['news.20261128.snooze', 'news.20261128.taken'] },
  { date: '2026-11-26', items: ['news.20261126.faster', 'news.20261126.design'] },
  { date: '2026-11-25', items: ['news.20261125.hatrigger_when'] },
  { date: '2026-11-24', items: ['news.20261124.hatrigger', 'news.20261124.hatrigger_add'] },
  { date: '2026-11-23', items: ['news.20261123.import', { key: 'news.20261123.agenda', when: (c) => !!c.calendarFeeds }, 'news.20261123.address', 'news.20261123.listpill'] },
  { date: '2026-11-22', items: ['news.20261122.whatsnew', 'news.20261122.welcome', 'news.20261122.pushbar', 'news.20261122.help'] },
  { date: '2026-11-20', items: ['news.20261120.quickdate', 'news.20261120.testpush', 'news.20261120.security', 'news.20261120.android'] },
  { date: '2026-11-19', items: ['news.20261119.repeat', 'news.20261119.repeat_end', 'news.20261119.share3'] },
  { date: '2026-11-12', items: ['news.20261112.remind', { key: 'news.20261112.clash', when: (c) => !!c.calendarFeeds }, 'news.20261112.row', 'news.20261112.settings'] },
];

export const MAX_ITEMS = 4;
/** Zoveel versies staan er in Instellingen. */
export const SHOWN = 4;

/**
 * De versies die op deze Tick iets te melden hebben (hooguit SHOWN), met alleen de zinnen die hier gelden.
 * @param {Record<string, unknown>} config CONFIG uit settings.js
 * @returns {{ date: string, items: string[] }[]}
 */
export function visibleNews(config) {
  return NEWS.map((v) => ({
    date: v.date,
    items: v.items.filter((i) => typeof i === 'string' || i.when(config)).map((i) => (typeof i === 'string' ? i : i.key)),
  })).filter((v) => v.items.length).slice(0, SHOWN);
}

/**
 * Is er een versie nieuwer dan `seen`?
 * @param {string | null | undefined} seen YYYY-MM-DD of niets
 * @param {Record<string, unknown>} config
 */
export function hasUnseen(seen, config) {
  const top = visibleNews(config)[0];
  return !!top && (!seen || seen < top.date);
}
