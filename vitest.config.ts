import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Dezelfde migraties als productie; test/setup.ts past ze toe op de lokale D1.
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

// Je eigen wrangler.jsonc als die er is, anders het voorbeeld (CI, een verse clone). De bindings hieronder
// overschrijven de vars, zodat beide dezelfde tests geven.
const configPath = existsSync('./wrangler.jsonc') ? './wrangler.jsonc' : './wrangler.example.jsonc';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath },
      miniflare: {
        // Vaste testwaarden; overschrijft ook een lokale .dev.vars (DEV_AUTH_BYPASS).
        bindings: {
          LOGIN_PASSWORD: 'test-wachtwoord',
          SESSION_SECRET: 'test-sessie-geheim',
          API_TOKEN: 'test-token',
          DEV_AUTH_BYPASS: '',
          FALLBACK_WEBHOOK: '',
          INBOX_TOKEN: 'test-inbox-token',
          TIMEZONE: 'Europe/Amsterdam',
          LOCALE: 'en',
          ANDROID_PACKAGE: '',
          // Vaste testsleutel (alleen de vorm telt): het voorbeeld heeft een lege VAPID_PUBLIC_KEY.
          VAPID_PUBLIC_KEY: 'BODSvJ4nOeqW2EzlIrbRLEzxO227EYmlsX3hYfV5EC7-1QzMyXWS8RaBNnBArOM6FurdGPVpUOEu3IngsAsMSFY',
          ADMIN_CONTACT: 'mailto:test@example.com',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15000, // dev-machine onder load; D1-aanroepen kunnen traag zijn
  },
});
