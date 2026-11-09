const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * De officiële Android-app (GitHub Releases). Elke Tick vertrouwt hem, zodat hij zonder adresbalk opent zonder dat je
 * iets instelt. De vingerafdruk is die van de release-sleutel (de release-workflow controleert de APK hiertegen).
 */
export const OFFICIAL_APP = { pkg: 'nl.detussenpartij.tick', certs: '23:DE:94:99:96:1B:4A:C6:31:1C:E1:03:74:7E:BC:D6:82:C8:95:66:EC:BF:DF:6A:2B:C8:5E:C4:60:A0:6E:38' };

/**
 * De Google Play-app (android/app/build.gradle, -PtickPreset=play). Ook die vertrouwt elke Tick, want je kunt er een
 * ander adres in kiezen. Play ondertekent de app zelf: dit is de SHA-256 van de app-ondertekeningssleutel uit Play
 * Console (Test en release › App-integriteit), niet die van de upload-sleutel. Leeg = nog niet bekend, dan valt hij weg.
 */
export const PLAY_APP = { pkg: 'nl.ticktodo.app', certs: 'B2:B4:80:CC:C3:CB:F7:33:07:DD:C0:5F:08:C2:03:C7:FA:F3:C8:82:D4:F5:EB:77:1A:2C:AD:8D:33:11:8D:C8' };

type App = { pkg: string; certs: string };

/** De vingerafdrukken uit een lijst met komma's, in hoofdletters en zonder dubbele; ongeldige vallen weg (met een log). */
function fingerprints(certs: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (certs ?? '').split(',')) {
    const fp = raw.trim().toUpperCase();
    if (!fp) continue;
    if (!FINGERPRINT.test(fp)) {
      console.error('ANDROID_CERT_SHA256: ongeldige vingerafdruk overgeslagen');
      continue;
    }
    if (!out.includes(fp)) out.push(fp);
  }
  return out;
}

/**
 * Digital Asset Links: koppelt Android-apps aan dit domein, zodat ze zonder adresbalk openen (TWA). De apps die Tick
 * zelf kent (GitHub en Play) en je eigen build (ANDROID_PACKAGE + ANDROID_CERT_SHA256); elk alleen met minstens één
 * geldige vingerafdruk.
 */
export function assetLinks(pkg: string | undefined, certs: string | undefined, builtIn: App[] = [OFFICIAL_APP, PLAY_APP]): object[] {
  const apps = new Map<string, string[]>();
  for (const [name, list] of [...builtIn.map((a) => [a.pkg, a.certs] as const), [pkg, certs] as const]) {
    if (!name) continue;
    const fps = fingerprints(list);
    if (!fps.length) continue;
    apps.set(name, [...new Set([...(apps.get(name) ?? []), ...fps])]);
  }
  return [...apps].map(([name, fps]) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: name, sha256_cert_fingerprints: fps },
  }));
}
