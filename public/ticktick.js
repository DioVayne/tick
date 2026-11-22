// TickTick-backup (CSV) inlezen. Puur: gedeeld door de Worker, het voorbeeld in de app (importview.js) en scripts/import-ticktick.mjs.
import { noLoss, oneLevel, rruleToTick, withLines } from './importkit.js';

/** @typedef {import('./importkit.js').ImportTask} ImportTask */
/** @typedef {import('./importkit.js').Lost} Lost */
/** @typedef {import('./importkit.js').Priority} Priority */

/** Eenvoudige CSV-parser: aanhalingstekens, komma's en regeleinden binnen velden.
 * @param {string} s
 * @returns {string[][]} */
export function parseCsv(s) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let r = [];
  let f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      r.push(f); f = ''; rows.push(r); r = [];
    } else f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

/** Kolommen die tickTickRows leest; ontbreekt er een, dan is het geen bruikbare export. */
const REQUIRED = ['List Name', 'Title', 'Content', 'Due Date', 'Reminder', 'Status', 'Created Time', 'Completed Time', 'Order', 'taskId', 'parentId'];

/** Rijen na de kopregel `Folder Name` als objecten; een lege lijst als die kopregel ontbreekt.
 * @param {string} text
 * @returns {Record<string, string>[]} */
export function readTickTickText(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const hi = rows.findIndex((r) => r[0] === 'Folder Name');
  if (hi < 0) return [];
  const h = rows[hi];
  if (REQUIRED.some((k) => !h.includes(k))) return [];
  return rows.slice(hi + 1).filter((r) => r.length === h.length)
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

/** Milliseconden, of NaN bij een lege of onleesbare datum. TickTick schrijft de zone als +0000.
 * @param {string | undefined} v */
const parse = (v) => (v ? Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN);
/** ISO-tijd, of null bij een lege of onleesbare datum (één kapotte rij mag de import niet afbreken).
 * @param {string | undefined} v */
const iso = (v) => {
  const ms = parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/** @type {Map<string, Intl.DateTimeFormat | null>} */
const formats = new Map();
/** Hoeveel de wandklok in zone `tz` op moment `ms` voorloopt op UTC; null bij een lege of onbekende zone.
 * @param {string | undefined} tz
 * @param {number} ms */
function offsetIn(tz, ms) {
  if (!tz) return null;
  if (!formats.has(tz)) {
    try {
      formats.set(tz, new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    } catch {
      formats.set(tz, null);
    }
  }
  const f = formats.get(tz);
  if (!f) return null;
  /** @type {Record<string, number>} */
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC-moment van een wandklok (`m` 1-12) in zone `tz`; zonder geldige zone is de wandklok UTC.
 * @param {string | undefined} tz
 * @param {number} y @param {number} m @param {number} d @param {number} h @param {number} mi @param {number} [s] */
function wallToUtc(tz, y, m, d, h, mi, s = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const first = offsetIn(tz, guess);
  if (first === null) return guess;
  return guess - (offsetIn(tz, guess - first) ?? first);
}

/** Standaardtijd voor een datum zonder tijd, zoals de standaard van "Herinnering zonder tijd" in Tick. */
const ALL_DAY_HOUR = 9;
const HALF_DAY_MS = 12 * 3600_000;

/**
 * De kalenderdag (JJJJ-MM-DD) van een vervaldatum die de hele dag duurt. TickTick schrijft die als middernacht in de
 * zone van de taak, omgerekend naar UTC (Amsterdam: 22:00 of 23:00 UTC de dag ervoor). Met een geldige `Timezone` is
 * het de datum in die zone; zonder rondt het af op de dichtstbijzijnde UTC-middernacht (klopt voor elke zone binnen ±12 uur).
 * @param {Record<string, string>} r
 * @returns {string | null} */
function allDayOf(r) {
  const v = r['Due Date'];
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ms = parse(v);
  if (Number.isNaN(ms)) return null;
  const off = /(Z|[+-]\d{2}:?\d{2})$/.test(v) ? offsetIn(r.Timezone, ms) : 0;
  return new Date(off === null ? ms + HALF_DAY_MS : ms + off).toISOString().slice(0, 10);
}

/**
 * Het tijdstip van de taak uit de vervaldatum: een hele dag wordt die dag op de standaardtijd (via `allDay` als de
 * Worker de zone en standaardtijd van de gebruiker meegeeft, anders 09:00 in de zone van de rij); een tijd met zone is
 * een UTC-moment; een tijd zonder zone geldt in de zone van de rij.
 * @param {Record<string, string>} r
 * @param {((ymd: string) => string | null) | undefined} allDay
 * @returns {string | null} */
function dueOf(r, allDay) {
  const v = r['Due Date'];
  if (!v) return null;
  if (r['Is All Day'] === 'true' || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const day = allDayOf(r);
    if (!day) return null;
    if (allDay) {
      try { return allDay(day); } catch { return null; }
    }
    const [y, m, d] = day.split('-').map(Number);
    const ms = wallToUtc(r.Timezone, y, m, d, ALL_DAY_HOUR, 0);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(v);
  if (local) {
    const [, y, m, d, h, mi, s] = local.map(Number);
    const ms = wallToUtc(r.Timezone, y, m, d, h, mi, s || 0);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return iso(v);
}
/** @param {string} s */
const clean = (s) => s.replace(/\r\n?/g, '\n').replace(/\\([()\[\]#*_>.\-!+])/g, '$1').replace(/▫\n?/g, '').trim();

/** TickTick-status: 0 open, 1 afgerond, 2 gearchiveerd (oudere exports: 2 afgerond), -1 "niet doen". */
const DONE_STATUS = new Set(['1', '2', '-1']);

/** TickTick-prioriteit: 5 hoog, 3 middel, 1 laag, 0 geen. @type {Record<string, Priority>} */
const PRIORITY = { 5: 'high', 3: 'medium', 1: 'low' };

/**
 * Zet TickTick-rijen om naar taken, ouders eerst (voor de foreign key).
 *
 * Tijd: een open taak met een `Due Date` krijgt die als `remind_at` (UTC), met of zonder `Reminder`. Een vervaldatum
 * die de hele dag duurt (`Is All Day`), wordt die dag op de standaardtijd: `opts.allDay(JJJJ-MM-DD)` als de aanroeper
 * hem meegeeft (de Worker: zone en "Herinnering zonder tijd" van de gebruiker), anders 09:00 in de `Timezone` van de rij.
 * Een tijd die al voorbij is, krijgt `notified: true`: na de import komt er dan niet voor elke verlopen taak een melding.
 * Afgeronde taken krijgen geen tijd.
 *
 * Herhaling: een `Repeat` die Tick kent (rruleToTick) wordt `repeat_rule` van een open hoofdtaak met een tijd; anders
 * telt hij in `lost.repeats`. Prioriteit: een regel onderaan de notitie (`opts.priority` geeft de tekst, in de taal van
 * de gebruiker), en een open taak met hoge prioriteit wordt vastgepind. Subtaken van subtaken hangen onder de hoofdtaak.
 * @param {Record<string, string>[]} all
 * @param {string} [prefix] voorvoegsel voor de ids
 * @param {{ allDay?: (ymd: string) => string | null, now?: number, priority?: (p: Priority) => string }} [opts]
 * @returns {{ tasks: ImportTask[], skipped: number, lost: Lost }} */
export function tickTickRows(all, prefix = 'tt', opts = {}) {
  const now = opts.now ?? Date.now();
  const kept = all.filter((r) => r.projectKind === 'TASK' || !r.projectKind);
  const rows = kept.filter((r) => r.Title.trim());
  const skipped = kept.length - rows.length;
  const lost = noLoss();
  const ids = new Set(rows.map((r) => r.taskId));
  /** @type {ImportTask[]} */
  const tasks = rows.map((r) => {
    const done = DONE_STATUS.has(r.Status);
    const created = iso(r['Created Time']) ?? new Date().toISOString();
    const remind = done ? null : dueOf(r, opts.allDay);
    let rule = null;
    if (!done && r.Repeat?.trim()) {
      rule = remind ? rruleToTick(r.Repeat) : null;
      if (!rule) lost.repeats++;
    }
    const prio = PRIORITY[r.Priority?.trim() ?? ''];
    return {
      id: `${prefix}${r.taskId}`,
      title: r.Title,
      description: withLines(clean(r.Content), [prio && opts.priority ? opts.priority(prio) : '']),
      list: r['List Name'] || 'Inbox',
      // Een ouder zonder titel wordt niet geïmporteerd; zijn kinderen worden dan hoofdtaak.
      parent_id: r.parentId && ids.has(r.parentId) ? `${prefix}${r.parentId}` : null,
      position: Number(r.Order) || 0,
      remind_at: remind,
      notified: remind !== null && Date.parse(remind) <= now,
      done,
      done_at: done ? iso(r['Completed Time']) ?? created : null,
      created_at: created,
      repeat_rule: rule,
      pinned: prio === 'high' && !done,
    };
  });
  return { tasks: oneLevel(tasks, lost), skipped, lost };
}