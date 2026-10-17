import { hashKey, newKey } from './keys';

export const INVITE_TTL_MS = 7 * 86_400_000;
export const RESET_TTL_MS = 3_600_000;

export type LinkKind = 'invite' | 'reset';

/** Maakt een eenmalige link-code; alleen de hash komt in de database. Ruimt eerst verlopen en gebruikte links op. */
export async function createLink(db: D1Database, kind: LinkKind, createdBy: string, userId: string | null): Promise<{ code: string; expires_at: string }> {
  const now = Date.now();
  const code = newKey().slice('tick_'.length);
  const expires_at = new Date(now + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS)).toISOString();
  await db.prepare('DELETE FROM account_links WHERE expires_at < ? OR used_at IS NOT NULL').bind(new Date(now).toISOString()).run();
  await db.prepare('INSERT INTO account_links (id, hash, kind, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), await hashKey(code), kind, userId, createdBy, expires_at).run();
  return { code, expires_at };
}

/** Is de link nog te gebruiken (bestaat, juiste soort, niet verlopen, niet gebruikt)? Verbruikt hem niet. */
export async function linkValid(db: D1Database, kind: LinkKind, code: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS ok FROM account_links WHERE hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await hashKey(code), kind, new Date().toISOString()).first();
  return !!row;
}

/** Verbruikt de link in één statement; null als hij onbekend, verlopen of al gebruikt is. */
export async function consumeLink(db: D1Database, kind: LinkKind, code: string): Promise<{ user_id: string | null } | null> {
  const now = new Date().toISOString();
  return db.prepare('UPDATE account_links SET used_at = ? WHERE hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(now, await hashKey(code), kind, now).first<{ user_id: string | null }>();
}
