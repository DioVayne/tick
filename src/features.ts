import type { Env } from './index';

// Testfeatures: nieuwe functies die eerst alleen op een eigen Tick draaien. Ze staan aan met hun naam in
// TEST_FEATURES (wrangler.jsonc, komma's ertussen, bijv. "mijnfeature"); zonder die naam bestaat de functie niet: geen
// instelling, geen API (404) en geen cron-stap. Welke er zijn en wat bij elk hoort: "Testfeatures" in ARCHITECTURE.md.

/**
 * De testfeatures die deze code kent. Een naam die hier niet staat, zet niets aan. "placecheck": proefmelding en uitleg per merk in de Android-app (PlaceCheck.java;
 * de app hoort het via /api/config). Eerder getest en verwijderd: "freetime" (migratie 0029 ruimt zijn instellingen op).
 * "hatrigger": triggers uit Home Assistant bij een taak kiezen (src/hatrigger.ts, public/hatrigger.js).
 * Eerder getest en een gewone functie geworden: "quickdate" (datum uit de tekst, public/quickdate.js).
 */
export const TEST_FEATURES: readonly string[] = ['placecheck', 'hatrigger'];
export type TestFeature = string;

/** De testfeatures die op deze Tick aanstaan (alleen bekende namen, zonder dubbele). */
export function testFeatures(env: Pick<Env, 'TEST_FEATURES'>): TestFeature[] {
  const names = (env.TEST_FEATURES ?? '').split(',').map((s) => s.trim().toLowerCase());
  return TEST_FEATURES.filter((f) => names.includes(f));
}

/** Staat deze testfeature aan op deze Tick? */
export const testFeature = (env: Pick<Env, 'TEST_FEATURES'>, name: TestFeature): boolean => testFeatures(env).includes(name);
