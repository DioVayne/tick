// Intent-links naar de Android-app. Geen imports, zodat de tests dit bestand los kunnen laden.

/** De officiële Android-app (GitHub Releases); ook nodig in src/assetlinks.ts. */
export const OFFICIAL_PACKAGE = 'nl.detussenpartij.tick';

/** Waar je de officiële app downloadt; daar gaat Chrome heen als de app er (nog) niet is. */
export const RELEASES_URL = 'https://github.com/DioVayne/tick/releases/latest';

/**
 * Geeft de eenmalige koppelcode en het adres van deze Tick aan de app. Met fallback opent Chrome dat adres als de app
 * niet geïnstalleerd is.
 */
export const pairIntent = (pkg, code, base, fallback) => `intent://pair?code=${encodeURIComponent(code)}`
  + (base ? `&base=${encodeURIComponent(base)}` : '')
  + `#Intent;scheme=tick;package=${pkg};`
  + (fallback ? `S.browser_fallback_url=${encodeURIComponent(fallback)};` : '')
  + 'end';

/** Het package van de app uit document.referrer van een TWA-start (android-app://<package>/), of null. */
export const packageFromReferrer = (referrer) =>
  /^android-app:\/\/([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)(?:\/|$)/.exec(referrer ?? '')?.[1] ?? null;

/** Opent de instellingen van de app (meldingen, locatie). */
export const settingsIntent = (pkg) => `intent://settings#Intent;scheme=tick;package=${pkg};end`;

/**
 * Wat doet de PWA na het koppelen met meldingen? De app vraagt zelf om de toestemming; de PWA wacht daarop.
 * @param {string} permission Notification.permission
 * @param {boolean} subscribed is er al een push-abonnement
 * @returns {'subscribe' | 'wait' | 'none'}
 */
export const pushAction = (permission, subscribed) => {
  if (subscribed || permission === 'denied') return 'none';
  return permission === 'granted' ? 'subscribe' : 'wait';
};

/**
 * Wat doet de PWA met meldingen bij een gewone start in de app (zonder koppelen)? Abonneren als de app toestemming
 * heeft en er nog geen abonnement is, bijvoorbeeld na een update van een versie die het niet deed. Niet als je het op
 * dit apparaat zelf uitzette, en niet wachten: zonder toestemming blijft de schakelaar in Instellingen over.
 * @param {string} permission Notification.permission
 * @param {boolean} subscribed is er al een push-abonnement
 * @param {boolean} turnedOff zelf uitgezet op dit apparaat
 * @returns {'subscribe' | 'none'}
 */
export const startPushAction = (permission, subscribed, turnedOff) =>
  !turnedOff && !subscribed && permission === 'granted' ? 'subscribe' : 'none';

/** Zo lang blijft de locatiebalk weg na wegklikken (bij dezelfde status). */
export const LOC_BAR_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Telefoons waarop locatiemeldingen niet werken: geen locatietoegang "altijd" of meldingen uit. Een telefoon zonder
 * gemelde status (oude app) telt niet mee: daar weten we het niet.
 * @param {{ key_id: string, status: { location: string, notifications: boolean } | null }[]} phones uit GET /api/devices
 */
export const locationProblems = (phones) =>
  phones.filter((p) => p.status && (p.status.location !== 'always' || !p.status.notifications));

/** Sleutel voor het wegklikken: verandert zodra een telefoon een andere status meldt, dan komt de balk terug. */
export const problemKey = (problems) =>
  problems.map((p) => `${p.key_id}:${p.status.location}:${p.status.notifications}`).sort().join('|');

/**
 * Toont Tick de balk "locatiemeldingen werken niet"? In de app altijd (daar verwacht je ze), elders alleen als er een
 * open taak met een plek is. Weggeklikt: niet bij dezelfde status, tot LOC_BAR_SNOOZE_MS voorbij is.
 * @param {{ problems: any[], inApp: boolean, hasLocationTasks: boolean, dismissed: { key: string, at: number } | null, now: number }} s
 */
export const showLocationBar = ({ problems, inApp, hasLocationTasks, dismissed, now }) => {
  if (!problems.length || !(inApp || hasLocationTasks)) return false;
  return !(dismissed && dismissed.key === problemKey(problems) && now - dismissed.at < LOC_BAR_SNOOZE_MS);
};
