import type { Env as TickEnv } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends TickEnv {
      MIGRATE_DB: D1Database;
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
  }
}
