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
