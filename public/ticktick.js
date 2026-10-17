// TickTick-backup (CSV) inlezen. Geen imports: gedeeld door de Worker en scripts/import-ticktick.mjs.

/**
 * @typedef {{ id: string, title: string, description: string, list: string, parent_id: string | null,
 *   position: number, remind_at: string | null, done: boolean, done_at: string | null, created_at: string }} ImportTask
 */

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

/** @param {string} v */
const iso = (v) => (v ? new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString() : null);
/** @param {string} s */
const clean = (s) => s.replace(/\r\n?/g, '\n').replace(/\\([()\[\]#*_>.\-!+])/g, '$1').replace(/▫\n?/g, '').trim();

/** Zet TickTick-rijen om naar taken, ouders eerst (voor de foreign key).
 * @param {Record<string, string>[]} all
 * @returns {{ tasks: ImportTask[], skipped: number }} */
export function tickTickRows(all) {
  const kept = all.filter((r) => r.projectKind === 'TASK' || !r.projectKind);
  const rows = kept.filter((r) => r.Title.trim());
  const skipped = kept.length - rows.length;
  const ids = new Set(rows.map((r) => r.taskId));
  // Een ouder zonder titel wordt niet geïmporteerd; zijn kinderen krijgen dan parent null.
  /** @param {Record<string, string>} r */
  const parentOf = (r) => (r.parentId && ids.has(r.parentId) ? r.parentId : '');
  /** @type {ImportTask[]} */
  const tasks = [];
  // Op diepte: een rij komt pas na zijn ouder (foreign key).
  const emitted = new Set();
  let rest = rows;
  while (rest.length) {
    let ready = rest.filter((r) => !parentOf(r) || emitted.has(parentOf(r)));
    const cycle = ready.length === 0; // kringverwijzing: los maken
    if (cycle) ready = rest;
    for (const r of ready) {
      emitted.add(r.taskId);
      const done = r.Status === '2' || r.Status === '-1';
      const created = iso(r['Created Time']) ?? new Date().toISOString();
      tasks.push({
        id: `tt${r.taskId}`,
        title: r.Title,
        description: clean(r.Content),
        list: r['List Name'] || 'Inbox',
        parent_id: parentOf(r) && !cycle ? `tt${parentOf(r)}` : null,
        position: Number(r.Order) || 0,
        remind_at: r.Reminder && r['Due Date'] && !done ? iso(r['Due Date']) : null,
        done,
        done_at: done ? iso(r['Completed Time']) ?? created : null,
        created_at: created,
      });
    }
    const set = new Set(ready);
    rest = rest.filter((r) => !set.has(r));
  }
  return { tasks, skipped };
}
