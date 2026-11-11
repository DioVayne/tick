import { Offline, request } from './api.js';
import { kvGet, kvSet } from './db.js';
import { t } from './i18n.js';
import { knownAppPackage } from './androidapp.js';

// Favoriete plekken, het label van een plek en het wekken van de Android-app.

/**
 * Grenzen van de straal in meters, gelijk aan die van de server. De standaard hangt af van de trigger: bij vertrek
 * klein (dan meldt Android het eerder), bij aankomst groter (met de auto rijd je anders door een kleine cirkel heen).
 */
export const RADIUS = { min: 200, max: 2000, step: 50, default: { enter: 500, exit: 200 } };

/** "500 m" of vanaf 1 km "1,2 km" (decimaalteken volgens de taal). */
export const formatRadius = (m) => (m >= 1000 ? t('places.km', { km: (m / 1000).toFixed(1).replace('.', t('places.decimal')) }) : `${m} m`);

/** Bijvoorbeeld "Station · 500 m · bij aankomst" (het plekicoon staat ervoor in de knop). */
export function locationLabel(loc) {
  return `${loc.name} · ${formatRadius(loc.radius)} · ${loc.trigger === 'exit' ? t('places.on_leave') : t('places.on_arrive')}`;
}

/** Zoveel plekken heeft een taak hooguit (gelijk aan MAX_PLACES op de server). */
export const MAX_PLACES = 10;
/** Zoveel plekken bewaakt Android tegelijk per app (GeoPlan.MAX in de Android-app). */
export const PHONE_MAX = 100;

/** Alle plekken van een taaklocatie, de eerste voorop: `[{ name, lat, lng, radius }]`; leeg zonder locatie. */
export function placesOf(loc) {
  if (!loc) return [];
  return [{ name: loc.name, lat: loc.lat, lng: loc.lng, radius: loc.radius }, ...(loc.more ?? [])];
}

/** Kort, voor een regel in de lijst: "Station" of bij meer plekken "Station +2". */
export const placeShort = (loc) => (loc.more?.length ? t('places.and_more', { name: loc.name, n: String(loc.more.length) }) : loc.name);

/** Alle namen achter elkaar, voor het taakscherm: "Station, Markt, Haven". */
export const placeNames = (loc) => placesOf(loc).map((p) => p.name).join(', ');

/**
 * Hoeveel plekken de telefoon nu zou bewaken: open taken met een plek die nog niet gemeld is, zonder `exceptId` (de
 * taak die je net aanpast). Zoals GeoPlan in de app: een taak telt met al zijn plekken.
 */
export function watchedPlaces(tasks, exceptId) {
  return tasks.filter((x) => x.id !== exceptId && x.location && !x.done && !x.location_notified)
    .reduce((n, x) => n + placesOf(x.location).length, 0);
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
export const updatePlace = (id, { name, lat, lng, radius }) => request('PATCH', `/api/places/${id}`, { name, lat, lng, radius });
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
  // Zonder taak: gewoon één keer verversen (bijvoorbeeld een plek die een ander op een gedeelde taak zette).
  const query = taskId ? `?task=${encodeURIComponent(taskId)}&since=${encodeURIComponent(since)}` : '';
  location.href = `intent://sync${query}`
    + `#Intent;scheme=tick;package=${pkg};S.browser_fallback_url=${fallback};end`;
}
