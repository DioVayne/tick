// Kalenderberekeningen: puur, zonder DOM. Dagen volgen de ingestelde tijdzone (zonedParts), nooit die van de browser.
import { occurrencesBetween, parseRule, weekdayOrder, zonedParts, zonedToUtc } from './repeat.js';

const pad = (n) => String(n).padStart(2, '0');

/** Dagsleutel `YYYY-MM-DD` van een UTC-moment, in de ingestelde tijdzone. */
export function dayKey(ms) {
  const p = zonedParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Dagsleutel van een wandklok-datum plus n dagen (`m` is 1-12). */
function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Snelknoppen van de datumkiezer. Volgende week is de eerste dag van de volgende week (maandag of zondag,
 * naar de weekstart), dus altijd 1 tot 7 dagen verder.
 * @param {{ y: number, m: number, d: number }} now wandklok van nu
 * @param {'mon' | 'sun'} weekStart
 * @returns {{ today: string, tomorrow: string, nextWeek: string }}
 */
export function quickDays(now, weekStart) {
  const wd = (new Date(Date.UTC(now.y, now.m - 1, now.d)).getUTCDay() + 6) % 7; // 0 = maandag
  const toNext = 7 - ((wd - weekdayOrder(weekStart)[0] + 7) % 7);
  return { today: keyOf(now.y, now.m, now.d), tomorrow: addDays(now.y, now.m, now.d, 1), nextWeek: addDays(now.y, now.m, now.d, toNext) };
}

/**
 * Beginstand van een lege datumkiezer: vandaag op het volgende hele uur; na 23:00 is dat er niet meer,
 * dan wordt het morgen op de standaardtijd.
 * @param {{ y: number, m: number, d: number, h: number }} now wandklok van nu
 * @param {{ h: number, mi: number }} def standaardtijd (getDefaultTime)
 * @returns {{ day: string, time: string }}
 */
export function pickerDefault(now, def) {
  if (now.h < 23) return { day: keyOf(now.y, now.m, now.d), time: `${pad(now.h + 1)}:00` };
  return { day: addDays(now.y, now.m, now.d, 1), time: `${pad(def.h)}:${pad(def.mi)}` };
}

/** Begin (00:00) van de dag met deze wandklok-datum, als UTC-moment. `m` is 1-12; d mag buiten de maand lopen. */
export function startOfDay(y, m, d) {
  const n = new Date(Date.UTC(y, m - 1, d));
  return zonedToUtc(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0);
}

/**
 * Weken van een maandraster (altijd hele weken, 4 tot 6 rijen).
 * @param {number} year
 * @param {number} month 1-12
 * @param {'mon' | 'sun'} weekStart
 * @returns {{ y: number, m: number, d: number, key: string, inMonth: boolean, wd: number }[][]}
 */
export function monthGrid(year, month, weekStart) {
  const order = weekdayOrder(weekStart);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWd = (first.getUTCDay() + 6) % 7; // 0 = maandag
  const lead = (firstWd - order[0] + 7) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((lead + days) / 7);
  const weeks = [];
  for (let r = 0; r < rows; r++) {
    const week = [];
    for (let c = 0; c < 7; c++) {
      const dt = new Date(Date.UTC(year, month - 1, 1 - lead + r * 7 + c));
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      week.push({ y, m, d, key: keyOf(y, m, d), inMonth: m === month, wd: (dt.getUTCDay() + 6) % 7 });
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * De momenten waarop een taak in [fromMs, toMs) valt. Een herhalende taak telt vanaf zijn huidige keer mee
 * (eerdere keren zijn niet bewaard).
 * @param {any} task
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number[]}
 */
export function taskMoments(task, fromMs, toMs) {
  if (!task.remind_at || task.done || task.deleted_at) return [];
  const at = Date.parse(task.remind_at);
  if (isNaN(at)) return [];
  if (!task.repeat) return at >= fromMs && at < toMs ? [at] : [];
  try {
    parseRule(task.repeat.rule); // een onbekende regel valt terug op de ene keer
    return occurrencesBetween(task.repeat.rule, task.repeat.start, Math.max(fromMs, at), toMs);
  } catch { return at >= fromMs && at < toMs ? [at] : []; }
}

/**
 * Taken per dag in [fromMs, toMs), op tijd gesorteerd.
 * @param {any[]} tasks
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Map<string, { task: any, ms: number }[]>}
 */
export function tasksByDay(tasks, fromMs, toMs) {
  const map = new Map();
  for (const task of tasks) {
    for (const ms of taskMoments(task, fromMs, toMs)) {
      const key = dayKey(ms);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ task, ms });
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.ms - b.ms || a.task.title.localeCompare(b.task.title));
  return map;
}

/**
 * Agenda: achterstallige taken en de komende dagen met taken (lege dagen blijven weg).
 * @param {any[]} tasks
 * @param {number} nowMs
 * @param {number} days hoeveel dagen vooruit, vanaf vandaag
 * @returns {{ overdue: { task: any, ms: number }[], days: { key: string, ms: number, items: { task: any, ms: number }[] }[] }}
 */
export function agenda(tasks, nowMs, days) {
  const t = zonedParts(nowMs);
  const today = startOfDay(t.y, t.m, t.d);
  const end = startOfDay(t.y, t.m, t.d + days);
  const overdue = [];
  for (const task of tasks) {
    if (!task.remind_at || task.done || task.deleted_at) continue;
    const at = Date.parse(task.remind_at);
    if (at < today) overdue.push({ task, ms: at });
  }
  overdue.sort((a, b) => a.ms - b.ms);
  const map = tasksByDay(tasks, today, end);
  const list = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, items]) => ({ key, ms: items[0].ms, items }));
  return { overdue, days: list };
}

/**
 * Een getypte tijd als 'HH:MM', of null als het geen tijd is. Ruim: "7" is 07:00, "715" en "7.15" zijn 07:15,
 * "1915" en "19:15" zijn 19:15.
 */
export function parseTime(text) {
  const s = String(text).trim().replace(/[:.\s]/, '');
  if (!/^\d{1,4}$/.test(s)) return null;
  const h = Number(s.length <= 2 ? s : s.slice(0, -2));
  const m = Number(s.length <= 2 ? 0 : s.slice(-2));
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
}
