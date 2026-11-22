import type { Env } from './index';
import { translate } from '../public/i18n.js';
import type { Locale } from './push';
import { STEP as GAP } from './access';

/**
 * De welkomsttaak: een nieuw account (zelf aanmelden of een uitnodigingslink van de beheerder) krijgt één taak met
 * subtaken die Tick uitleggen. Verhuizen maakt geen nieuw account en krijgt hem dus niet.
 *
 * Aanpassen = dit sjabloon aanpassen: de volgorde van `steps` is de volgorde in de app, een stap weglaten = de regel
 * weghalen, een nieuwe stap = een regel erbij plus de sleutel (en + nl) in public/i18n.js. `when` laat een stap alleen
 * meekomen als een functie op deze Tick aan staat. De tekst wordt in de taal van de aanmelder opgeslagen (gewone data,
 * daarna door de gebruiker te wijzigen); bestaande accounts merken niets van een wijziging hier.
 */
export const WELCOME_TEMPLATE: {
  title: string;
  note: string;
  steps: { key: string; when?: (env: Env) => boolean }[];
} = {
  title: 'welcome.title',
  note: 'welcome.note',
  steps: [
    { key: 'welcome.quickdate' },
    { key: 'welcome.notify' },
    { key: 'welcome.repeat' },
    { key: 'welcome.lists' },
    { key: 'welcome.share' },
    { key: 'welcome.place' },
    { key: 'welcome.manager' },
    { key: 'welcome.undo' },
  ],
};

/** Maakt de welkomsttaak met subtaken voor een net aangemaakt account, in één batch. */
export async function addWelcomeTask(env: Env, userId: string, lang: Locale, template = WELCOME_TEMPLATE): Promise<void> {
  const db = env.DB;
  const ts = new Date().toISOString();
  const parentId = crypto.randomUUID();
  const insert = db.prepare(
    "INSERT INTO tasks (id, user_id, title, description, list, parent_id, position, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'Inbox', ?, ?, 'app', ?, ?)",
  );
  const steps = template.steps.filter((s) => !s.when || s.when(env));
  await db.batch([
    insert.bind(parentId, userId, translate(lang, template.title), translate(lang, template.note), null, -GAP, ts, ts),
    ...steps.map((s, i) => insert.bind(crypto.randomUUID(), userId, translate(lang, s.key), '', parentId, i * GAP, ts, ts)),
  ]);
}

/** Zoals addWelcomeTask, maar een fout houdt het aanmaken van het account niet tegen. */
export async function tryWelcomeTask(env: Env, userId: string, lang: Locale): Promise<void> {
  try {
    await addWelcomeTask(env, userId, lang);
  } catch (e) {
    console.error('welkomsttaak mislukt', e);
  }
}
