// Wanneer de balk "Zet meldingen aan" verschijnt (pushnudge.js), zonder DOM zodat de tests hem kunnen nalopen.

/** "Niet nu" geeft zo lang rust op dit apparaat; daarna komt de balk bij de volgende herinnering weer één keer. */
export const NUDGE_PAUSE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Welke balk na het opslaan van een herinnering, of null voor geen balk.
 * - 'ask': meldingen staan hier uit; de knop zet ze aan (zoals "Aanzetten en testmelding sturen").
 * - 'app': in de Android-app staat de telefoon geen meldingen van Tick toe; uitleg waar je dat aanzet.
 * - 'blocked': de browser blokkeert meldingen voor deze site; uitleg.
 * - 'ios': iPhone of iPad, Tick niet vanaf het beginscherm; uitleg.
 * @param {{ supported: boolean, permission: string, subscribed: boolean, iosNeedsHomeScreen: boolean, inApp: boolean,
 *   place: boolean, turnedOff: boolean, dismissedAt: number | null, now: number }} s
 * @returns {'ask' | 'app' | 'blocked' | 'ios' | null}
 */
export function nudgeFor(s) {
  // Een plek meldt alleen de Android-app; in de browser legt de plekdialoog dat al uit.
  if (s.place && !s.inApp) return null;
  // Zelf uitgezet in Instellingen: die keuze respecteren.
  if (s.turnedOff) return null;
  if (s.dismissedAt !== null && s.now - s.dismissedAt < NUDGE_PAUSE_MS) return null;
  if (s.iosNeedsHomeScreen) return 'ios';
  if (!s.supported) return null; // dan kan dit apparaat geen meldingen; daar valt niets aan te zetten
  if (s.permission === 'granted' && s.subscribed) return null;
  if (s.permission === 'denied') return s.inApp ? 'app' : 'blocked';
  return 'ask';
}
