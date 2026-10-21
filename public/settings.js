// Instellingen van de gebruiker en de installatie (/config.js, door de Worker gemaakt). app.js importeert deze module als eerste,
// zodat taal en tijdzone al gelden als de andere modules laden.
import CONFIG from './config.js';
import { getLocale, pickLocale, setLocale, translate } from './i18n.js';
import { setDefaultTime, setTimeZone, setWeekStart } from './repeat.js';

const LANG_KEY = 'tick.lang';
const COOKIE = 'tick_lang';
const known = (v) => (v === 'en' || v === 'nl' ? v : null);

const stored = () => { try { return known(localStorage.getItem(LANG_KEY)); } catch { return null; } };

/** Het cookie dat de server leest voor zijn meldingen; null wist het. @param {'en' | 'nl' | null} lang */
const writeCookie = (lang) => {
  document.cookie = lang
    ? `${COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
    : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
};

/**
 * Vertaalt een stuk pagina opnieuw: `data-i18n` (tekst) en `data-i18n-attr` ("attr:sleutel;attr2:sleutel2").
 * De server vertaalt de schil al; dit is voor als de taal in de browser anders uitvalt of wisselt.
 * @param {ParentNode} root
 */
export function applyI18n(root = document) {
  const locale = getLocale();
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(locale, node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) node.setAttribute(attr, translate(locale, key));
    }
  }
  document.documentElement.lang = locale;
}

/**
 * Taalkeuze van dit apparaat: bewaart in localStorage en in het cookie dat de server leest, of wist beide
 * (null = automatisch). Laadt de pagina niet opnieuw; dat doet de aanroeper.
 * @param {'en' | 'nl' | null} choice
 */
export function setLanguage(choice) {
  const lang = known(choice);
  try { if (lang) localStorage.setItem(LANG_KEY, lang); else localStorage.removeItem(LANG_KEY); } catch { /* geen opslag */ }
  writeCookie(lang);
  setLocale(lang ?? pickLocale(navigator.languages) ?? CONFIG.defaultLocale);
}

// Het cookie kan verlopen of gewist zijn terwijl de keuze in localStorage nog staat; dan antwoordt de server in een andere taal.
const chosen = stored();
if (chosen) writeCookie(chosen);
setLocale(chosen ?? pickLocale(navigator.languages) ?? CONFIG.defaultLocale);
setTimeZone(CONFIG.timeZone);
setDefaultTime(CONFIG.reminderTime);
setWeekStart(CONFIG.weekStart);
if (document.documentElement.lang !== getLocale()) applyI18n(document);

/**
 * Instellingen van de ingelogde gebruiker plus de standaardtaal van de installatie.
 * @type {{ locale: 'en' | 'nl', defaultLocale: 'en' | 'nl', timeZone: string, reminderTime: string, weekStart: 'mon' | 'sun',
 *   androidPackage: string | null, userId: string, userName: string, isAdmin: boolean }}
 */
export default CONFIG;
