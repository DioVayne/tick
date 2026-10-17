// Waar je na het inloggen heen gaat: alleen een pad op deze site, nooit een andere host.
// Stuurtekens (ook tab, LF en CR, die de browser uit een URL haalt) en backslashes worden geweigerd.
export function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  return raw;
}

/**
 * Waar je na het inloggen of aanmelden heen gaat. In de Android-app (of als het pad al app=android heeft) komen
 * app=android en pair=1 erbij, zodat de app opnieuw koppelt met de sleutel van wie nu is ingelogd.
 * @param {string | null} raw
 * @param {boolean} inApp
 */
export function afterLogin(raw, inApp) {
  const path = safeNext(raw);
  const url = new URL(path, 'https://x.invalid');
  if (!inApp && url.searchParams.get('app') !== 'android') return path;
  url.searchParams.set('app', 'android');
  url.searchParams.set('pair', '1');
  // De URL-parser normaliseert het pad ('/.//x' wordt '//x', een andere host): daarom het resultaat opnieuw controleren.
  const out = url.pathname + url.search + url.hash;
  return safeNext(out) === out ? out : '/?app=android&pair=1';
}

/**
 * Haalt /config.js (met userId) uit elke cache van de service worker. Na inloggen of uitloggen mag een trage
 * verbinding nooit de config van de vorige gebruiker uit de cache opleveren.
 */
export async function forgetCachedConfig() {
  try {
    for (const k of await caches.keys()) await (await caches.open(k)).delete('/config.js');
  } catch { /* geen Cache Storage */ }
}

/** Draait deze pagina in de Android-app? Dezelfde test als androidapp.js. */
export function inAndroidApp() {
  try {
    return sessionStorage.getItem('tick.app') === 'android' || document.referrer.startsWith('android-app://');
  } catch {
    return false;
  }
}
