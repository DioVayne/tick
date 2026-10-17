// Intent-links naar de Android-app. Geen imports, zodat de tests dit bestand los kunnen laden.

/** Geeft de eenmalige koppelcode aan de app. */
export const pairIntent = (pkg, code) => `intent://pair?code=${encodeURIComponent(code)}#Intent;scheme=tick;package=${pkg};end`;

/** Opent de instellingen van de app (meldingen, locatie). */
export const settingsIntent = (pkg) => `intent://settings#Intent;scheme=tick;package=${pkg};end`;
