// Teller op het icoon: hoeveel taken vandaag af moeten (te laat meegeteld). Op het app-icoon (Badging API, als de
// browser die heeft), in het favicon en in de titel van het tabblad. Rood als er iets te laat is. Per apparaat uit te zetten.
import { zonedParts } from './repeat.js';
import { startOfDay } from './calendar.js';

export const BADGE_OFF_KEY = 'tick.badgeOff';
const TITLE = 'Tick';
const RED = '#dc2626';
const DARK = '#1e293b';

/**
 * Open hoofdtaken met een herinnering vóór middernacht (in de ingestelde tijdzone), net als de widget "Vandaag & te laat".
 * @param {any[]} tasks
 * @param {number} nowMs
 * @returns {{ count: number, overdue: number }}
 */
export function dueCount(tasks, nowMs) {
  const p = zonedParts(nowMs);
  const today = startOfDay(p.y, p.m, p.d);
  const end = startOfDay(p.y, p.m, p.d + 1);
  let count = 0, overdue = 0;
  for (const t of tasks) {
    if (!t.remind_at || t.done || t.deleted_at || t.parent_id) continue;
    const at = Date.parse(t.remind_at);
    if (!(at < end)) continue;
    count++;
    if (at < today) overdue++;
  }
  return { count, overdue };
}

export const badgeLabel = (n) => (n > 99 ? '99+' : String(n));

/** Het Tick-icoon (zoals icon.svg), met rechtsboven een bolletje met het getal als n > 0. */
export function faviconSvg(n, late) {
  const label = badgeLabel(n);
  const size = label.length === 1 ? 230 : label.length === 2 ? 180 : 130;
  const dot = n > 0
    ? `<circle cx="372" cy="140" r="140" fill="${late ? RED : DARK}" stroke="#fff" stroke-width="16"/>`
      + `<text x="372" y="140" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" font-size="${size}" text-anchor="middle" dominant-baseline="central">${label}</text>`
    : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    + '<g transform="translate(256 260) scale(1.5) translate(-256 -260)">'
    + `<path d="M256 104C184 104 132 158 132 226C132 312 256 416 256 416C256 416 380 312 380 226C380 158 328 104 256 104Z" fill="#fcd34d" stroke="${DARK}" stroke-width="16" stroke-linejoin="round"/>`
    + `<path d="M200 228l40 40 76-86" fill="none" stroke="${DARK}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>`
    + `</g>${dot}</svg>`;
}

export const badgeOff = () => { try { return localStorage.getItem(BADGE_OFF_KEY) === '1'; } catch { return false; } };

let source = () => /** @type {any[]} */ ([]);
let last = '';
let midnight;

/** Waar de taken vandaan komen (een functie: de lijst wordt bij elke load vervangen); tekent meteen. */
export function startBadge(getTasks) {
  source = getTasks;
  updateBadge();
}

/** Zet teller, favicon en titel naar de taken; om middernacht vanzelf opnieuw (dan schuift vandaag door). */
export function updateBadge() {
  const { count, overdue } = badgeOff() ? { count: 0, overdue: 0 } : dueCount(source(), Date.now());
  clearTimeout(midnight);
  const p = zonedParts(Date.now());
  midnight = setTimeout(updateBadge, Math.max(1000, startOfDay(p.y, p.m, p.d + 1) - Date.now() + 1000));
  const key = `${count}/${overdue > 0}`;
  if (key === last) return;
  last = key;
  document.title = count ? `(${badgeLabel(count)}) ${TITLE}` : TITLE;
  const link = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[rel="icon"]'));
  if (link) link.href = count ? 'data:image/svg+xml,' + encodeURIComponent(faviconSvg(count, overdue > 0)) : '/icon.svg';
  const nav = /** @type {any} */ (navigator);
  if (count) nav.setAppBadge?.(count).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

/** Aan- of uitzetten op dit apparaat, en meteen bijwerken. */
export function setBadgeOff(off) {
  try { if (off) localStorage.setItem(BADGE_OFF_KEY, '1'); else localStorage.removeItem(BADGE_OFF_KEY); } catch { /* geen opslag */ }
  updateBadge();
}
