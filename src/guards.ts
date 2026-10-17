import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './index';

/** Alleen een sessie (of dev-bypass): het API-token en het inbox-token mogen niet aan de instellingen komen. */
export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const kind = c.get('auth')?.kind;
  if (kind !== 'session' && kind !== 'dev') return c.text('Forbidden', 403);
  await next();
};
