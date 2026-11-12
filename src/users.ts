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
  /** NULL = e-mailadres niet bevestigd (telt alleen op een openbare Tick, zie src/signup.ts). */
  email_verified_at: string | null;
  /** Openbare Tick: wanneer een nooit bevestigd, zelf aangemaakt account verdwijnt; NULL = nooit. */
  verify_deadline: string | null;
  /** Geschorst door de beheerder (na een melding); NULL = niet geschorst. */
  suspended_at: string | null;
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

/**
 * Meldingen (openbare Tick) blijven bestaan als een account verwijderd wordt, zodat de beheerder ziet dat er een
 * melding was, de reden, de data en de afhandeling, maar zonder de verwijderde persoon:
 * - zijn id wordt NULL (de beheerpagina toont "verwijderd account"; naam en adres kwamen altijd uit `users`);
 * - de toelichting gaat weg, of hij nu de melder was (zijn eigen woorden) of de gemelde (tekst over hem);
 * - was hij de gemelde, dan gaan ook de titel en de bestandsnaam weg (dat was zijn inhoud), en de verwijzing naar een
 *   gemelde lijst: die gaat bij het verwijderen over naar een ander lid (transferListsStmts) en is dan van die ander.
 * De verwijzingen naar taak en bijlage blijven: dat zijn willekeurige ids, en de beheerpagina toont alleen wat er nu nog
 * bestaat (zijn eigen taken zijn dan weg; wat hij in de lijst van een ander zette, kan de beheerder nog verwijderen).
 */
export function anonymiseReportsStmts(db: D1Database, id: string): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE reports SET reporter_id = NULL, note = '' WHERE reporter_id = ?").bind(id),
    db.prepare("UPDATE reports SET reported_id = NULL, note = '', title = '', attachment_name = NULL, list_id = NULL WHERE reported_id = ?").bind(id),
  ];
}

/** Alles van één gebruiker wissen, in een volgorde die de verwijzingen respecteert; de aanroeper draait het als batch. */
export function deleteUserStmts(db: D1Database, id: string): D1PreparedStatement[] {
  return [
    // Gedeelde lijsten (de eigendom ging al over via transferListsStmts): lidmaatschappen, meldrijen en claims weg.
    db.prepare('UPDATE tasks SET claimed_by = NULL WHERE claimed_by = ?').bind(id),
    // "Kopie van …" bij de ontvangers: zonder afzender.
    db.prepare('UPDATE tasks SET copied_from = NULL WHERE copied_from = ?').bind(id),
    db.prepare('DELETE FROM task_watch WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM list_members WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM devices WHERE key_id IN (SELECT id FROM api_keys WHERE user_id = ?)').bind(id),
    // Delen: deelrijen van en naar deze gebruiker, en op zijn taken (die verdwijnen ook bij de ontvangers).
    db.prepare('DELETE FROM task_shares WHERE to_user = ?1 OR from_user = ?1 OR task_id IN (SELECT id FROM tasks WHERE user_id = ?1)').bind(id),
    db.prepare('DELETE FROM reminder_sent WHERE user_id = ?1 OR task_id IN (SELECT id FROM tasks WHERE user_id = ?1)').bind(id),
    // Uitnodigingen aan e-mailadressen (openbare Tick) van deze gebruiker.
    db.prepare('DELETE FROM email_invites WHERE from_user = ?').bind(id),
    // Blokkades (openbare Tick) van en over deze gebruiker.
    db.prepare('DELETE FROM blocks WHERE user_id = ?1 OR blocked_id = ?1').bind(id),
    ...anonymiseReportsStmts(db, id),
    // Gekoppelde agenda's: eerst de afspraken, dan de feeds.
    db.prepare('DELETE FROM calendar_events WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM calendar_feeds WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM calendar_clashes WHERE user_id = ?').bind(id),
    ...['api_keys', 'pair_codes', 'move_codes', 'push_subscriptions', 'tasks', 'places', 'user_settings', 'lists', 'review_skip_lists', 'list_ids', 'op_seen']
      .map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
    // Ook links die deze gebruiker zelf aanmaakte (created_by verwijst naar users).
    db.prepare('DELETE FROM account_links WHERE user_id = ? OR created_by = ?').bind(id, id),
    // Niet wissen maar loskoppelen: de rijen tellen mee voor de daggrenzen (anders zet verwijderen die terug).
    db.prepare('UPDATE mail_log SET user_id = NULL WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ];
}
