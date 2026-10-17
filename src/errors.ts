import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { KeyedError } from '../public/i18n.js';

/** Fout met een HTTP-status en een vertaalsleutel (public/i18n.js) voor de client; al het andere wordt een 500. */
export class HttpError extends KeyedError {
  constructor(readonly status: ContentfulStatusCode, key: string, vars: Record<string, string | number> = {}) {
    super(key, vars);
  }
}

/** Een KeyedError (ongeldig ritme, ongeldige datum) als 400; een andere fout met de gegeven sleutel. */
export function badRequest(e: unknown, key: string, vars: Record<string, string | number> = {}): HttpError {
  return e instanceof KeyedError ? new HttpError(400, e.key, e.vars) : new HttpError(400, key, vars);
}
