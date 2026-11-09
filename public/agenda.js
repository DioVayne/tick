// Gekoppelde agenda's in de app: de afspraken van de komende 14 dagen (alleen titel en tijden) in het geheugen, voor de
// planner, het herinneringsmenu en de kalender. Bij het openen van de app (en terug na een kwartier) vraagt de app de
// server de feeds te verversen. Zonder CALENDAR_FEEDS of zonder gekoppelde agenda: null, en niets verandert.
import CONFIG from './settings.js';
import { request } from './api.js';
import { setBusySource } from './planner.js';

/** @typedef {import('./planner.js').Busy & { feed: string }} CalBusy */

const STALE_MS = 15 * 60_000;
const S = {
  /** @type {CalBusy[] | null} null: geen agenda gekoppeld of nog niet geladen */ events: null,
  at: 0,
  /** @type {Promise<CalBusy[] | null> | null} */ loading: null,
  /** @type {Set<() => void>} */ listeners: new Set(),
};

export const calendarOn = () => CONFIG.calendarFeeds === true;

/** De afspraken die er nu zijn (null zonder agenda), zonder te laden. */
export const busyNow = () => S.events;

/** Afroepen als de afspraken veranderen (de kalender tekent dan opnieuw). @param {() => void} fn */
export const onAgenda = (fn) => { S.listeners.add(fn); };

/** @param {{ feeds: unknown[], events: { feed: string, title: string, start: string, end: string, allDay: boolean }[] }} r */
function take(r) {
  S.events = r.feeds.length
    ? r.events.map((e) => ({ feed: e.feed, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), allDay: e.allDay }))
    : null;
  S.at = Date.now();
  for (const fn of S.listeners) fn();
  return S.events;
}

/**
 * De afspraken, van de server als ze ouder zijn dan een kwartier. `refresh`: de server haalt verouderde feeds eerst
 * opnieuw op (bij het openen van de app). Offline of een fout: wat er al was.
 * @param {{ refresh?: boolean, force?: boolean }} [o]
 * @returns {Promise<CalBusy[] | null>}
 */
export function loadBusy({ refresh = false, force = false } = {}) {
  if (!calendarOn()) return Promise.resolve(null);
  if (!force && S.at && Date.now() - S.at < STALE_MS) return Promise.resolve(S.events);
  S.loading ??= (refresh ? request('POST', '/api/calendar/refresh') : request('GET', '/api/calendar/events'))
    .then(take, () => S.events)
    .finally(() => { S.loading = null; });
  return S.loading;
}

/** Na koppelen of ontkoppelen in de instellingen: meteen opnieuw. */
export const reloadBusy = () => loadBusy({ force: true });

/** Bij het openen van de app en als hij weer zichtbaar wordt: verversen als het langer dan een kwartier geleden is. */
export function startAgenda() {
  if (!calendarOn()) return;
  const tick = () => { if (!document.hidden && navigator.onLine) loadBusy({ refresh: true }); };
  tick();
  document.addEventListener('visibilitychange', tick);
}

setBusySource(() => loadBusy());
