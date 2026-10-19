import { Offline, request } from './api.js';
import { kvGet, kvSet } from './db.js';
import { t } from './i18n.js';
import { knownAppPackage } from './androidapp.js';

// Favoriete plekken, het label van een plek en het wekken van de Android-app.

/** Grenzen van de straal in meters, gelijk aan die van de server. */
export const RADIUS = { min: 100, max: 2000, step: 50, default: 500 };

/** "500 m" of vanaf 1 km "1,2 km" (decimaalteken volgens de taal). */
export const formatRadius = (m) => (m >= 1000 ? t('places.km', { km: (m / 1000).toFixed(1).replace('.', t('places.decimal')) }) : `${m} m`);

/** Bijvoorbeeld "📍 Station · 500 m · bij aankomst". */
export function locationLabel(loc) {
  return `📍 ${loc.name} · ${formatRadius(loc.radius)} · ${loc.trigger === 'exit' ? t('places.on_leave') : t('places.on_arrive')}`;
}

/** Favorieten van de server, met een lokale kopie voor offline. */
export async function loadPlaces() {
  try {
    const places = await request('GET', '/api/places');
    kvSet('places', places).catch(() => {});
    return places;
  } catch (e) {
    if (!(e instanceof Offline)) throw e;
    return (await kvGet('places').catch(() => null)) ?? [];
  }
}

// Wijzigen kan alleen online; een fout gaat door naar de aanroeper, die een toast toont.
export const savePlace = ({ name, lat, lng, radius }) => request('POST', '/api/places', { name, lat, lng, radius });
export const renamePlace = (id, name) => request('PATCH', `/api/places/${id}`, { name });
export async function deletePlace(id) {
  await request('DELETE', `/api/places/${id}`);
}

/** Adres of plaats zoeken via de eigen proxy naar Nominatim. */
export const geocode = (q) => request('GET', '/api/geocode?q=' + encodeURIComponent(q));

/**
 * Laat de Android-app meteen synchroniseren, zodat de geofence direct goed staat. Zonder app opent
 * Chrome de fallback-URL, dus gewoon Tick. `since` is de updated_at die we nu van de taak kennen.
 */
export function wakeAndroidApp(taskId, since) {
  // Alleen als er een app bekend is (gezien op deze telefoon, of ANDROID_PACKAGE); anders zou Chrome de fallback-URL openen.
  const pkg = knownAppPackage();
  if (!/Android/i.test(navigator.userAgent) || !pkg) return;
  const fallback = encodeURIComponent(location.origin + '/');
  location.href = `intent://sync?task=${encodeURIComponent(taskId)}&since=${encodeURIComponent(since)}`
    + `#Intent;scheme=tick;package=${pkg};S.browser_fallback_url=${fallback};end`;
}
