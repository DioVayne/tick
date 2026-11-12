import type { Env } from './index';

// Testfeatures: nieuwe functies die eerst alleen op een eigen Tick draaien. Ze staan aan met hun naam in
// TEST_FEATURES (wrangler.jsonc, komma's ertussen, bijv. "freetime"); zonder die naam bestaat de functie niet: geen
// instelling, geen API (404) en geen cron-stap. Welke er zijn en wat bij elk hoort: "Testfeatures" in ARCHITECTURE.md.

/** De testfeatures die deze code kent. Een naam die hier niet staat, zet niets aan. */
export const TEST_FEATURES = ['freetime'] as const;
export type TestFeature = (typeof TEST_FEATURES)[number];

/** De testfeatures die op deze Tick aanstaan (alleen bekende namen, zonder dubbele). */
export function testFeatures(env: Pick<Env, 'TEST_FEATURES'>): TestFeature[] {
  const names = (env.TEST_FEATURES ?? '').split(',').map((s) => s.trim().toLowerCase());
  return TEST_FEATURES.filter((f) => names.includes(f));
}

/** Staat deze testfeature aan op deze Tick? */
export const testFeature = (env: Pick<Env, 'TEST_FEATURES'>, name: TestFeature): boolean => testFeatures(env).includes(name);
