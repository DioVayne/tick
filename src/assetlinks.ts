const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Digital Asset Links: koppelt de Android-app aan dit domein, zodat hij zonder adresbalk opent (TWA). */
export function assetLinks(pkg: string | undefined, certs: string | undefined): object[] {
  if (!pkg) return [];
  const fingerprints: string[] = [];
  for (const raw of (certs ?? '').split(',')) {
    const fp = raw.trim().toUpperCase();
    if (!fp) continue;
    if (!FINGERPRINT.test(fp)) {
      console.error('ANDROID_CERT_SHA256: ongeldige vingerafdruk overgeslagen');
      continue;
    }
    if (!fingerprints.includes(fp)) fingerprints.push(fp);
  }
  if (!fingerprints.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
  }];
}
