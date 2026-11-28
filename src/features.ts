import type { Env } from './index';

// Testfeatures: nieuwe functies die eerst alleen op een eigen Tick draaien. Ze staan aan met hun naam in
// TEST_FEATURES (wrangler.jsonc, komma's ertussen, bijv. "mijnfeature"); zonder die naam bestaat de functie niet: geen
// instelling, geen API (404) en geen cron-stap. Welke er zijn en wat bij elk hoort: "Testfeatures" in ARCHITECTURE.md.

/**
 * De testfeatures die deze code kent. Een naam die hier niet staat, zet niets aan. "placecheck": proefmelding en uitleg per merk in de Android-app (PlaceCheck.java;
 * de app hoort het via /api/config). "condall": condities combineren met "Pas als alles klopt" (src/condall.ts). Eerder getest en verwijderd: "freetime" (migratie 0029 ruimt zijn instellingen op).
 * Eerder getest en een gewone functie geworden: "quickdate" (datum uit de tekst, public/quickdate.js) en "hatrigger"
 * (Home Assistant-triggers, src/hatrigger.ts).
 */
export const TEST_FEATURES: readonly string[] = ['placecheck', 'condall'];
export type TestFeature = string;

/** De testfeatures die op deze Tick aanstaan (alleen bekende namen, zonder dubbele). */
export function testFeatures(env: Pick<Env, 'TEST_FEATURES'>): TestFeature[] {
  const names = (env.TEST_FEATURES ?? '').split(',').map((s) => s.trim().toLowerCase());
  return TEST_FEATURES.filter((f) => names.includes(f));
}

/** Staat deze testfeature aan op deze Tick? */
export const testFeature = (env: Pick<Env, 'TEST_FEATURES'>, name: TestFeature): boolean => testFeatures(env).includes(name);
