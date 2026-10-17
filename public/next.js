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
  return url.pathname + url.search + url.hash;
}

/** Draait deze pagina in de Android-app? Dezelfde test als androidapp.js. */
export function inAndroidApp() {
  try {
    return sessionStorage.getItem('tick.app') === 'android' || document.referrer.startsWith('android-app://');
  } catch {
    return false;
  }
}
