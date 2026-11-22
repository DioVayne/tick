// "Wat is er nieuw" in Instellingen: per versie hooguit vier korte zinnen, met een stipje (bij Instellingen in het menu,
// bij de menuknop en bij het blok) zolang de gebruiker de nieuwste versie nog niet heeft opengeklapt.
// De versies en zinnen staan in news.js.
//
// "Gezien" is per gebruiker (rij `news_seen` in user_settings, via /config.js als CONFIG.newsSeen), zodat het stipje op
// al je apparaten verdwijnt. Zonder rij geldt de dag waarop het account is gemaakt: een nieuw account krijgt dus geen
// stipje voor oudere versies. Dit apparaat onthoudt het ook zelf (localStorage), voor offline en een oude /config.js.
import CONFIG from './settings.js';
import { dateLocale, t } from './i18n.js';
import { el } from './render.js';
import { icon } from './icons.js';
import { request } from './api.js';
import { hasUnseen as unseenIn, visibleNews as visibleIn } from './news.js';

const visibleNews = () => visibleIn(CONFIG);
const hasUnseen = (seen) => unseenIn(seen, CONFIG);
const LOCAL_KEY = 'tick.newsSeen';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const localSeen = () => { try { const v = localStorage.getItem(LOCAL_KEY); return v && DATE.test(v) ? v : null; } catch { return null; } };

/** Wat deze gebruiker als laatste zag: de server of dit apparaat, wat het nieuwste is. */
const seenNow = () => [CONFIG.newsSeen, localSeen()].filter(Boolean).sort().pop() ?? null;

/** Zet of wist het stipje (html[data-news]; de CSS tekent het bij het menu, Instellingen en het blok). */
export function paintNewsDot() {
  document.documentElement.toggleAttribute('data-news', hasUnseen(seenNow()));
}

/** Nieuwste versie gezien: stipje weg, onthouden op dit apparaat en bij de server (een fout is niet erg: dit apparaat weet het). */
export function markNewsSeen() {
  const top = visibleNews()[0];
  if (!top || !hasUnseen(seenNow())) return;
  CONFIG.newsSeen = top.date;
  try { localStorage.setItem(LOCAL_KEY, top.date); } catch { /* geen opslag */ }
  paintNewsDot();
  request('PATCH', '/api/settings', { newsSeen: top.date }).catch(() => {});
}

/** "22 november 2026" in de taal van de app. */
const dayText = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Het blok in Instellingen; openklappen telt als gezien. */
export function newsBlock() {
  const block = el('details', { class: 'set-block set-news' },
    el('summary', {}, el('span', { class: 'set-icon' }, icon('sparkle')), el('span', { class: 'set-title' }, t('news.title')),
      el('span', { class: 'set-sub' }, '')),
    el('div', { class: 'set-content' }, el('div', { class: 'set-body news-body' },
      ...visibleNews().map((v) => el('section', { class: 'news-version' },
        el('h3', { class: 'news-date' }, dayText(v.date)),
        el('ul', { class: 'news-list' }, ...v.items.map((k) => el('li', {}, t(k)))))))));
  block.addEventListener('toggle', () => { if (/** @type {HTMLDetailsElement} */ (block).open) markNewsSeen(); });
  return block;
}

paintNewsDot();
