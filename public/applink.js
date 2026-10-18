// Intent-links naar de Android-app. Geen imports, zodat de tests dit bestand los kunnen laden.

/** Geeft de eenmalige koppelcode aan de app. */
export const pairIntent = (pkg, code) => `intent://pair?code=${encodeURIComponent(code)}#Intent;scheme=tick;package=${pkg};end`;

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
