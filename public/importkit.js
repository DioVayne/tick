// Gedeelde stukken voor het importeren uit andere apps (ticktick.js, todoist.js). Puur: de Worker, de browser (het
// voorbeeld vóór het importeren) en scripts/ gebruiken dezelfde omzetting.
import { normalizeRule } from './repeat.js';

/**
 * Eén taak zoals een import hem aanlevert. `remind_at` is UTC; `repeat_rule` is een Tick-ritme (alleen bij een open
 * hoofdtaak met een tijd: de Worker rekent er `repeat_start`/`repeat_at` bij).
 * @typedef {{ id: string, title: string, description: string, list: string, parent_id: string | null,
 *   position: number, remind_at: string | null, notified: boolean, done: boolean, done_at: string | null, created_at: string,
 *   repeat_rule: string | null, pinned: boolean }} ImportTask
 */

/**
 * Wat er niet (helemaal) mee kan, voor het voorbeeld en de melding na afloop.
 * - `repeats`: een herhaling die Tick niet kent; de taak komt zonder herhaling.
 * - `dates`: een datum die niet te lezen is; de taak komt zonder tijd.
 * - `flattened`: een subtaak van een subtaak; Tick heeft één niveau, dus hij hangt onder de hoofdtaak.
 * - `sections`: Todoist-secties; de taken komen gewoon in de lijst.
 * @typedef {{ repeats: number, dates: number, flattened: number, sections: number }} Lost
 */

/** @returns {Lost} */
export const noLoss = () => ({ repeats: 0, dates: 0, flattened: 0, sections: 0 });

/** Prioriteit zoals de import hem kent: hoog wordt ook vastgepind. @typedef {'high' | 'medium' | 'low'} Priority */

/**
 * De notitie met een regel voor de prioriteit (en eventueel meer regels) eronder. Een vaste vorm ("Prioriteit: hoog",
 * "Priority: high"), zodat Tick hem later kan omzetten als er ooit prioriteiten komen.
 * @param {string} description
 * @param {string[]} lines
 */
export function withLines(description, lines) {
  const extra = lines.filter(Boolean).join('\n');
  if (!extra) return description;
  return description ? `${description}\n\n${extra}` : extra;
}

/**
 * Een korte, vaste id uit tekst (FNV-1a, 2× 32 bits): hetzelfde bestand opnieuw importeren geeft dezelfde ids, zodat
 * er niets dubbel komt. Voor apps zonder eigen taak-id in de export (Todoist).
 * @param {string} s
 */
export function stableId(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

const WEEKDAY = /^(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$/;

/**
 * Een iCal-RRULE (zoals TickTick hem schrijft: "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE") als Tick-ritme, of null als
 * Tick hem niet kan: "nog 5 keer" (COUNT), meerdere maanddagen, alleen werkdagen overslaan, herhalen na afvinken en
 * andere TickTick-uitbreidingen. Een jaarlijks ritme volgt de datum van de taak (BYMONTH/BYMONTHDAY vallen weg).
 * @param {string | undefined} text
 * @returns {string | null}
 */
export function rruleToTick(text) {
  const s = (text ?? '').trim().replace(/^RRULE:/i, '');
  if (!s || /^[A-Z]+RULE:/i.test(s)) return null;
  /** @type {Record<string, string>} */
  const kv = {};
  for (const part of s.toUpperCase().split(';')) {
    if (!part) continue;
    const m = /^([A-Z_]+)=(.*)$/.exec(part);
    if (!m) return null;
    kv[m[1]] = m[2];
  }
  const freq = kv.FREQ;
  delete kv.WKST;
  if (freq === 'YEARLY') { delete kv.BYMONTH; delete kv.BYMONTHDAY; }
  // "Tweede maandag van de maand" schrijven sommige apps als BYDAY=MO;BYSETPOS=2.
  if (freq === 'MONTHLY' && kv.BYSETPOS && kv.BYDAY && /^(-1|[1-4])$/.test(kv.BYSETPOS) && /^(MO|TU|WE|TH|FR|SA|SU)$/.test(kv.BYDAY)) {
    kv.BYDAY = kv.BYSETPOS + kv.BYDAY;
    delete kv.BYSETPOS;
  }
  if (kv.INTERVAL === '1') delete kv.INTERVAL;
  if (kv.BYDAY && !kv.BYDAY.split(',').every((d) => WEEKDAY.test(d))) return null;
  if (kv.UNTIL) {
    const m = /^(\d{8})(?:T\d{6}Z?)?$/.exec(kv.UNTIL);
    if (!m) return null;
    kv.UNTIL = m[1];
  }
  for (const k of Object.keys(kv)) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL'].includes(k)) return null;
  try {
    return normalizeRule(Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(';'));
  } catch { return null; }
}

/**
 * Hangt elke subtaak onder zijn hoofdtaak (Tick kent één niveau) en zet ouders vóór kinderen (de foreign key). Een
 * ouder die niet in de lijst staat, maakt het kind een hoofdtaak. Telt in `lost.flattened` hoeveel er een niveau omhoog gingen.
 * @param {ImportTask[]} tasks
 * @param {Lost} lost
 * @returns {ImportTask[]}
 */
export function oneLevel(tasks, lost) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  /** @param {ImportTask} t */
  const rootOf = (t) => {
    const seen = new Set([t.id]);
    let p = t.parent_id ? byId.get(t.parent_id) : undefined;
    if (!p) return null;
    while (p.parent_id && byId.has(p.parent_id) && !seen.has(p.parent_id)) {
      seen.add(p.id);
      p = /** @type {ImportTask} */ (byId.get(p.parent_id));
    }
    // Een kring (A onder B onder A): los maken.
    return p.parent_id && seen.has(p.parent_id) ? null : p.id;
  };
  const out = tasks.map((t) => {
    const root = rootOf(t);
    if (root && root !== t.parent_id) lost.flattened++;
    if (!root) return { ...t, parent_id: null };
    // Een subtaak pint niet en herhaalt niet: alleen een hoofdtaak schuift door.
    if (t.repeat_rule) lost.repeats++;
    return { ...t, parent_id: root, pinned: false, repeat_rule: null };
  });
  return [...out.filter((t) => !t.parent_id), ...out.filter((t) => t.parent_id)];
}

/**
 * Samenvatting voor het voorbeeld: per lijst hoeveel taken, en hoeveel met een tijd, herhaling of pin.
 * @param {ImportTask[]} tasks
 */
export function summarize(tasks) {
  /** @type {Map<string, number>} */
  const lists = new Map();
  for (const t of tasks) if (!t.parent_id) lists.set(t.list, (lists.get(t.list) ?? 0) + 1);
  return {
    total: tasks.length,
    open: tasks.filter((t) => !t.done).length,
    done: tasks.filter((t) => t.done).length,
    subtasks: tasks.filter((t) => t.parent_id).length,
    timed: tasks.filter((t) => t.remind_at && !t.done).length,
    repeating: tasks.filter((t) => t.repeat_rule).length,
    pinned: tasks.filter((t) => t.pinned).length,
    lists: [...lists].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
