import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { setTimeZone } from '../public/repeat.js';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Pure functies (zonder request) rekenen in dezelfde zone als de Worker in de tests (TIMEZONE in vitest.config.ts).
setTimeZone(env.TIMEZONE);
