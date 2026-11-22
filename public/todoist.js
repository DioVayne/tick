// Todoist-export (CSV per project, of de back-up-zip met een CSV per project) inlezen. Puur: gedeeld door de Worker en
// het voorbeeld in de app (importview.js). Het uitpakken van de zip gebeurt in de browser (unzip.js); de Worker krijgt
// alleen de CSV-teksten met hun bestandsnaam.
//
// Todoist schrijft een datum als tekst in de taal van de app ("every monday at 9am", "elke maandag om 9:00", "Nov 25").
// Nederlands en Engels lezen we (quickdate.js plus de herhaalwoorden hieronder); in een andere taal komt de taak zonder
// datum binnen. Afgevinkte taken zitten niet in een Todoist-export.
import { parseCsv } from './ticktick.js';
import { findDate } from './quickdate.js';
import { fromWallInput, getDefaultTime, normalizeRule, zonedParts } from './repeat.js';
import { noLoss, oneLevel, stableId, withLines } from './importkit.js';

/** @typedef {import('./importkit.js').ImportTask} ImportTask */
/** @typedef {import('./importkit.js').Lost} Lost */
/** @typedef {import('./importkit.js').Priority} Priority */
/** @typedef {{ name: string, text: string }} TodoistFile */

/** Kolommen die we lezen; zonder deze kop is het geen Todoist-export. */
const REQUIRED = ['TYPE', 'CONTENT', 'PRIORITY', 'INDENT', 'DATE'];

/**
 * De rijen van één CSV-bestand als objecten, of null als het geen Todoist-export is.
 * @param {string} text
 * @returns {Record<string, string>[] | null} */
export function readTodoistText(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const h = rows[0]?.map((k) => k.trim());
  if (!h || REQUIRED.some((k) => !h.includes(k))) return null;
  return rows.slice(1).filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

/** De projectnaam uit de bestandsnaam: "Werk [2203306141].csv" en "map/Werk.csv" worden "Werk". @param {string} name */
export function projectName(name) {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.csv$/i, '').replace(/\s*\[\d+\]$/, '').trim() || 'Inbox';
}

/** Todoist-prioriteit in de CSV: 1 is hoogst (p1), 4 is geen (p4). @type {Record<string, Priority>} */
const PRIORITY = { 1: 'high', 2: 'medium', 3: 'low' };

// ---------- Datums en herhalingen ----------

const DAYS = [
  ['mo', 'mon', 'monday', 'ma', 'maandag'], ['tu', 'tue', 'tues', 'tuesday', 'di', 'dinsdag'], ['we', 'wed', 'wednesday', 'wo', 'woensdag'],
  ['th', 'thu', 'thur', 'thurs', 'thursday', 'do', 'donderdag'], ['fr', 'fri', 'friday', 'vr', 'vrijdag'],
  ['sa', 'sat', 'saturday', 'za', 'zaterdag'], ['su', 'sun', 'sunday', 'zo', 'zondag'],
];
const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const dayCode = (w) => { const i = DAYS.findIndex((d) => d.includes(w.replace(/\.$/, ''))); return i < 0 ? null : CODES[i]; };
const ORDINAL = { first: 1, '1st': 1, eerste: 1, '1e': 1, second: 2, '2nd': 2, tweede: 2, '2e': 2, third: 3, '3rd': 3, derde: 3, '3e': 3,
  fourth: 4, '4th': 4, vierde: 4, '4e': 4, last: -1, laatste: -1 };
const NUMBER = { other: 2, andere: 2, two: 2, twee: 2, three: 3, drie: 3, four: 4, vier: 4 };
const p2 = (n) => String(n).padStart(2, '0');

/** "9am", "9:30 pm", "21:00", "9 uur", "9u" als uren en minuten, of null. @param {string} s */
function clockOf(s) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?m\.?|uur|u)?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === 'p' ? 12 : 0); }
  return h <= 23 && mi <= 59 ? { h, mi } : null;
}

/**
 * Een herhaling in woorden ("every monday at 9am", "elke 2 weken", "every 15th", "elke eerste maandag") als Tick-ritme
 * met een begin (wandklok 'YYYY-MM-DDTHH:MM'), of null als we hem niet kennen. "every!" (herhalen vanaf afvinken)
 * kent Tick niet, en ook geen "vanaf"/"tot"-delen.
 * @param {string} text al in kleine letters, zonder het woord "every"/"elke"
 * @param {number} now
 * @returns {{ rule: string, start: string } | null}
 */
function recurrence(text, now) {
  let s = text.trim().replace(/\s+/g, ' ');
  if (/\b(starting|from|until|for|vanaf|tot|gedurende)\b/.test(s)) return null;
  // De tijd aan het eind: "at 9am", "om 9:00", "@ 21:00", of alleen "9am".
  let time = null;
  const tm = /(?:^|\s)(?:(?:at|om|@)\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?|uur|u)?)$/.exec(s);
  if (tm && (/[:.apu]/.test(tm[1]) || /(?:at|om|@)\s*\d/.test(tm[0]))) {
    time = clockOf(tm[1]);
    if (!time) return null;
    s = s.slice(0, tm.index).trim();
  }
  const today = zonedParts(now);
  const at = time ?? getDefaultTime();
  let start = `${today.y}-${p2(today.m)}-${p2(today.d)}T${p2(at.h)}:${p2(at.mi)}`;
  s = s.replace(/^(?:the|de|het|on|op)\s+/, '');
  let rule = null;
  let m;
  const n = (w) => (w ? (NUMBER[w] ?? Number(w)) : 1);
  if ((m = /^(?:(\d{1,2}|other|andere|two|twee|three|drie|four|vier)\s+)?(day|days|dag|dagen)$/.exec(s))) rule = `FREQ=DAILY;INTERVAL=${n(m[1])}`;
  else if (/^(weekday|weekdays|workday|workdays|werkdag|werkdagen|doordeweekse dag)$/.test(s)) rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  else if (/^(weekend|weekenddag|weekend day)$/.test(s)) rule = 'FREQ=WEEKLY;BYDAY=SA,SU';
  else if ((m = /^(?:(\d{1,2}|other|andere|two|twee|three|drie|four|vier)\s+)?(week|weeks|weken)(?:\s+(?:on|op)\s+(.+))?$/.exec(s))) {
    const days = m[3] ? m[3].split(/\s*(?:,|\band\b|\ben\b|&)\s*/).filter(Boolean).map(dayCode) : [];
    if (days.includes(null)) return null;
    rule = `FREQ=WEEKLY;INTERVAL=${n(m[1])}${days.length ? `;BYDAY=${days.join(',')}` : ''}`;
  } else if ((m = /^(?:(\d{1,2}|other|andere|two|twee|three|drie|four|vier)\s+)?(month|months|maand|maanden)(?:\s+(?:on\s+the|on|op\s+de|op)\s+(\d{1,2})(?:st|nd|rd|th|e|ste|de)?)?$/.exec(s))) {
    rule = `FREQ=MONTHLY;INTERVAL=${n(m[1])}${m[3] ? `;BYMONTHDAY=${Number(m[3])}` : ''}`;
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th|e|ste|de)$/.exec(s))) rule = `FREQ=MONTHLY;BYMONTHDAY=${Number(m[1])}`;
  else if ((m = /^(first|1st|eerste|1e|second|2nd|tweede|2e|third|3rd|derde|3e|fourth|4th|vierde|4e|last|laatste)\s+(\S+?)(?:\s+(?:of the month|van de maand))?$/.exec(s))) {
    const code = dayCode(m[2]);
    if (!code) return null;
    rule = `FREQ=MONTHLY;BYDAY=${ORDINAL[m[1]]}${code}`;
  } else if ((m = /^(?:(\d{1,2}|other|andere|two|twee)\s+)?(year|years|jaar)$/.exec(s))) rule = `FREQ=YEARLY;INTERVAL=${n(m[1])}`;
  else if (s.split(/\s*(?:,|\band\b|\ben\b|&)\s*/).every((w) => dayCode(w))) {
    rule = `FREQ=WEEKLY;BYDAY=${s.split(/\s*(?:,|\band\b|\ben\b|&)\s*/).map(dayCode).join(',')}`;
  } else {
    // "every nov 25", "elke 25 november": jaarlijks vanaf die dag.
    const d = findDate(s, now);
    if (!d || d.title) return null;
    rule = 'FREQ=YEARLY';
    start = `${d.value.slice(0, 10)}T${p2(at.h)}:${p2(at.mi)}`;
  }
  try { return { rule: normalizeRule(rule), start }; } catch { return null; }
}

/**
 * Een Todoist-datum als wandklok en eventueel een ritme. `ok: false` als er een datum stond die we niet lezen; een
 * herhaling die Tick niet kent geeft wel de datum maar `lostRepeat`.
 * @param {string} text
 * @param {string} lang de DATE_LANG van de rij
 * @param {number} now
 * @returns {{ ok: boolean, wall: string | null, rule: string | null, lostRepeat: boolean }}
 */
export function todoistDate(text, lang, now) {
  const s = (text ?? '').trim().toLowerCase();
  if (!s) return { ok: true, wall: null, rule: null, lostRepeat: false };
  // Een vaste datum zoals de API hem schrijft: 2026-11-25 of 2026-11-25T09:00(:00).
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2})?)?z?$/.exec(s);
  if (iso) {
    const def = getDefaultTime();
    return { ok: true, wall: `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] ?? p2(def.h)}:${iso[5] ?? p2(def.mi)}`, rule: null, lostRepeat: false };
  }
  if (lang && !/^(en|nl)/i.test(lang)) return { ok: false, wall: null, rule: null, lostRepeat: false };
  const every = /^(?:every!?|elke!?|iedere!?|ieder!?|elk!?|om de)\s+(.*)$/.exec(s);
  if (every) {
    // "every!" herhaalt vanaf het afvinken; dat kent Tick niet. "om de 2 weken" is al een interval.
    const r = /^(every|elke|iedere|ieder|elk)!/.test(s) ? null : recurrence(every[1], now);
    if (r) return { ok: true, wall: r.start, rule: r.rule, lostRepeat: false };
    // De herhaling kennen we niet: zonder datum en zonder herhaling (een gok zou een verkeerde dag geven).
    return { ok: true, wall: null, rule: null, lostRepeat: true };
  }
  const d = findDate(s, now);
  if (!d || d.title) return { ok: false, wall: null, rule: null, lostRepeat: false };
  // Een datum zonder jaar die al voorbij is, maakt findDate volgend jaar; in een export is dat een verlopen taak van dit jaar.
  let wall = d.value;
  if (!/\d{4}/.test(s) && Date.parse(`${wall.slice(0, 10)}T00:00:00Z`) - now > 300 * 86_400_000) {
    wall = `${Number(wall.slice(0, 4)) - 1}${wall.slice(4)}`;
  }
  return { ok: true, wall, rule: null, lostRepeat: false };
}

// ---------- Rijen ----------

/**
 * Zet Todoist-bestanden om naar taken. Elk bestand is een project en wordt een lijst; secties vallen weg (de taken
 * komen in de lijst); ingesprongen taken worden subtaken (dieper dan één niveau: onder de hoofdtaak); opmerkingen
 * (TYPE note) komen onder de notitie van de taak erboven. Prioriteit p1 t/m p3 wordt een regel in de notitie
 * (`opts.priority`), p1 pint ook vast. Een deadline wordt een regel in de notitie (`opts.deadline`).
 *
 * Todoist heeft geen ids in de export: een taak krijgt een vaste id uit bestand, volgnummer en titel, zodat hetzelfde
 * bestand opnieuw importeren niets dubbel maakt. Tijden rekenen in de ingestelde zone (repeat.js): de Worker roept dit
 * aan binnen `inZone`.
 * @param {TodoistFile[]} files
 * @param {string} prefix voorvoegsel voor de ids
 * @param {{ now?: number, priority?: (p: Priority) => string, deadline?: (d: string) => string }} [opts]
 * @returns {{ tasks: ImportTask[], skipped: number, lost: Lost, invalid: string[] }} */
export function todoistRows(files, prefix, opts = {}) {
  const now = opts.now ?? Date.now();
  const lost = noLoss();
  /** @type {ImportTask[]} */
  const tasks = [];
  /** @type {string[]} */
  const invalid = [];
  let skipped = 0;
  const createdAt = new Date(now).toISOString();
  for (const file of files) {
    const rows = readTodoistText(file.text);
    if (!rows) { invalid.push(file.name); continue; }
    const list = projectName(file.name);
    /** @type {(ImportTask | null)[]} op inspring-diepte: de laatste taak op elk niveau */
    const stack = [];
    /** @type {ImportTask | null} */
    let last = null;
    /** Opmerkingen en de regels voor prioriteit en deadline; die laatste komen onderaan. @type {Map<ImportTask, { comments: string[], meta: string[] }>} */
    const notes = new Map();
    rows.forEach((r, i) => {
      const type = (r.TYPE ?? '').trim().toLowerCase();
      if (type === 'section') { lost.sections++; stack.length = 0; last = null; return; }
      if (type === 'note') {
        const text = (r.CONTENT ?? '').trim();
        if (last && text) notes.get(last)?.comments.push(text);
        return;
      }
      if (type !== 'task') return;
      const title = (r.CONTENT ?? '').trim();
      if (!title) { skipped++; last = null; return; }
      const depth = Math.max(1, Number(r.INDENT) || 1);
      const parent = depth > 1 ? (stack.slice(0, depth - 1).reverse().find((t) => t) ?? null) : null;
      const date = todoistDate(r.DATE ?? '', r.DATE_LANG ?? '', now);
      if (!date.ok) lost.dates++;
      if (date.lostRepeat) lost.repeats++;
      const remind = date.wall ? fromWallInput(date.wall) : null;
      const prio = PRIORITY[(r.PRIORITY ?? '').trim()];
      const deadline = (r.DEADLINE ?? '').trim();
      /** @type {ImportTask} */
      const task = {
        id: `${prefix}${stableId(`${list}\u0000${i}\u0000${title}`)}`,
        title,
        description: (r.DESCRIPTION ?? '').trim(),

        list,
        parent_id: parent ? parent.id : null,
        position: (i + 1) * 1024,
        remind_at: remind,
        notified: remind !== null && Date.parse(remind) <= now,
        done: false,
        done_at: null,
        created_at: createdAt,
        repeat_rule: remind ? date.rule : null,
        pinned: prio === 'high',
      };
      stack.length = depth - 1;
      stack[depth - 1] = task;
      notes.set(task, { comments: [], meta: [prio && opts.priority ? opts.priority(prio) : '', deadline && opts.deadline ? opts.deadline(deadline) : ''] });
      tasks.push(task);
      last = task;
    });
    for (const [task, n] of notes) task.description = withLines(withLines(task.description, [n.comments.join('\n\n')]), n.meta);
  }
  return { tasks: oneLevel(tasks, lost), skipped, lost, invalid };
}
