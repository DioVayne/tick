/** Id van de beheerder uit migratie 0008, ook op een verse installatie. */
export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

export type Role = 'admin' | 'member';

export type User = {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
  role: Role;
  session_version: number;
  created_at: string;
  last_seen: string | null;
};

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

/**
 * Gebruiker bij een inlogpoging. Een leeg adres is de overgang van vóór de accounts: dat geeft de beheerder,
 * maar alleen zolang die geen e-mailadres heeft. De kolom `email` is NOCASE.
 */
export async function findLoginUser(db: D1Database, email: string): Promise<User | null> {
  if (!email) return db.prepare("SELECT * FROM users WHERE role = 'admin' AND id = ? AND email IS NULL").bind(ADMIN_ID).first<User>();
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
}

const SEEN_EVERY_MS = 3_600_000;

/** Werkt `last_seen` hoogstens eens per uur bij; een mislukte schrijfactie mag het verzoek niet breken. */
export async function touchLastSeen(db: D1Database, user: User): Promise<void> {
  if (Date.parse(user.last_seen ?? '') >= Date.now() - SEEN_EVERY_MS) return;
  try {
    const now = new Date().toISOString();
    await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run();
    user.last_seen = now;
  } catch (e) {
    console.warn('last_seen bijwerken mislukt', e);
  }
}
