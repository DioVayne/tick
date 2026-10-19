const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * De officiële Android-app (GitHub Releases). Elke Tick vertrouwt hem, zodat hij zonder adresbalk opent zonder dat je
 * iets instelt. De vingerafdruk is die van de release-sleutel; leeg zolang die er nog niet is (dan alleen een eigen build).
 */
export const OFFICIAL_APP = { pkg: 'nl.detussenpartij.tick', certs: '' };

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
 * Digital Asset Links: koppelt Android-apps aan dit domein, zodat ze zonder adresbalk openen (TWA). Je eigen build
 * (ANDROID_PACKAGE + ANDROID_CERT_SHA256) en de officiële app; elk alleen met minstens één geldige vingerafdruk.
 */
export function assetLinks(pkg: string | undefined, certs: string | undefined, official = OFFICIAL_APP): object[] {
  const apps = new Map<string, string[]>();
  for (const [name, list] of [[official.pkg, official.certs], [pkg, certs]] as const) {
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
