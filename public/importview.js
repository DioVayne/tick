// Importeren uit een andere app (Instellingen → Gegevens): bestand kiezen, eerst een voorbeeld van wat er binnenkomt
// (dezelfde omzetting als de Worker: ticktick.js, todoist.js), dan importeren; en de laatste import ongedaan maken
// (src/importer.ts). De zip van een Todoist-back-up pakt de browser zelf uit (unzip.js).
import { Offline, request } from './api.js';
import { errorText, t } from './i18n.js';
import { el, toast } from './render.js';
import { load } from './store.js';
import { readTickTickText, tickTickRows } from './ticktick.js';
import { todoistRows } from './todoist.js';
import { summarize } from './importkit.js';
import { unzipText } from './unzip.js';

const APPS = { ticktick: 'TickTick', todoist: 'Todoist' };

/**
 * Helpers uit settingsview.js, zodat de rijen er hetzelfde uitzien.
 * @typedef {{ row: Function, btn: Function, homeNote: Function, modal: Function, off: boolean,
 *   fmtNum: (n: number) => string, fmtDate: (iso: string) => string, offlineText: (e: any) => string }} Helpers
 */

/** Kiest een of meer bestanden; null bij annuleren. @param {string} accept @param {boolean} multiple @returns {Promise<File[] | null>} */
function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept, multiple, hidden: true }));
    input.addEventListener('change', () => { const f = [...(input.files ?? [])]; input.remove(); resolve(f.length ? f : null); });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}

/** De Todoist-bestanden als { name, text }: losse CSV's, en de CSV's uit een zip. @param {File[]} files */
async function todoistFiles(files) {
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) out.push(...await unzipText(await f.arrayBuffer(), (n) => /\.csv$/i.test(n)));
    else out.push({ name: f.name, text: await f.text() });
  }
  return out;
}

/**
 * Het voorbeeld: aantallen, lijsten en wat niet mee kan. Geeft true als je op Importeren tikt.
 * @param {Helpers} h @param {'ticktick' | 'todoist'} app
 * @param {{ tasks: import('./importkit.js').ImportTask[], skipped: number, lost: import('./importkit.js').Lost, invalid?: string[] }} r
 */
async function preview(h, app, r) {
  const s = summarize(r.tasks);
  const n = h.fmtNum;
  const li = (text) => el('li', {}, text);
  const lost = [
    r.lost.repeats ? li(t('import.lost_repeats', { count: n(r.lost.repeats) })) : null,
    r.lost.dates ? li(t('import.lost_dates', { count: n(r.lost.dates) })) : null,
    r.lost.flattened ? li(t('import.lost_flattened', { count: n(r.lost.flattened) })) : null,
    r.lost.sections ? li(t('import.lost_sections', { count: n(r.lost.sections) })) : null,
    r.skipped ? li(t('import.lost_skipped', { count: n(r.skipped) })) : null,
    r.invalid?.length ? li(t('import.lost_invalid', { count: n(r.invalid.length) })) : null,
    li(t('import.priority_note')),
    app === 'todoist' ? li(t('import.todoist_done_note')) : null,
  ].filter(Boolean);
  const value = await h.modal({
    title: t('import.preview_title', { app: APPS[app] }),
    body: [el('div', { class: 'import-preview' },
      el('p', {}, t('import.preview_intro')),
      el('ul', {},
        li(t('import.tasks', { count: n(s.total), open: n(s.open), done: n(s.done) })),
        s.subtasks ? li(t('import.subtasks', { count: n(s.subtasks) })) : null,
        li(t('import.timed', { count: n(s.timed) })),
        s.repeating ? li(t('import.repeating', { count: n(s.repeating) })) : null,
        s.pinned ? li(t('import.pinned', { count: n(s.pinned) })) : null),
      el('h3', {}, t('import.lists')),
      el('ul', { class: 'import-lists' }, ...s.lists.map((l) => li(t('import.list_row', { name: l.name, count: n(l.count) })))),
      el('h3', {}, t('import.lost')),
      el('ul', {}, ...lost))],
    buttons: [{ label: t('import.button'), value: 'go' }, { label: t('set.cancel'), value: null, kind: 'ghost' }],
  });
  return value === 'go';
}

/** POST met een eigen body (de TickTick-CSV gaat als tekst). */
async function post(path, body, type) {
  let res;
  try { res = await fetch(path, { method: 'POST', headers: { 'content-type': type }, body }); } catch { throw new Offline(t('set.online_only')); }
  if (res.status === 401) { location.href = '/login'; return null; }
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(r, res.statusText));
  return r;
}

/** @param {Helpers} h @param {'ticktick' | 'todoist'} app @param {() => void} done */
async function importFrom(h, app, done) {
  const files = await pickFiles(app === 'ticktick' ? '.csv,text/csv' : '.csv,.zip,text/csv,application/zip', app === 'todoist');
  if (!files) return;
  try {
    let r, send;
    if (app === 'ticktick') {
      const text = await files[0].text();
      const rows = readTickTickText(text);
      if (!rows.length) { toast(t('err.ticktick_invalid')); return; }
      r = tickTickRows(rows, 'tt');
      send = () => post('/api/import/ticktick', text, 'text/csv');
    } else {
      let list;
      try { list = await todoistFiles(files); } catch { toast(t('err.todoist_invalid')); return; }
      r = todoistRows(list, 'td');
      if (!list.length || r.invalid.length === list.length) { toast(t('err.todoist_invalid')); return; }
      send = () => post('/api/import/todoist', JSON.stringify({ files: list.filter((f) => !r.invalid.includes(f.name)) }), 'application/json');
    }
    if (!r.tasks.length) { toast(t('import.nothing')); return; }
    if (!await preview(h, app, r)) return;
    const res = await send();
    if (!res) return;
    toast(t('import.done', { added: h.fmtNum(res.added), existing: h.fmtNum(res.existing) }), 'ok');
    load();
    done();
  } catch (e) { toast(t('import.failed', { reason: h.offlineText(e) })); }
}

/**
 * De rijen voor Instellingen → Gegevens: importeren (TickTick, Todoist) en, als er een is, de laatste import ongedaan maken.
 * @param {Helpers} h
 */
export function importRows(h) {
  const undo = el('div', {});
  const refresh = () => {
    if (h.off) { undo.replaceChildren(); return; }
    request('GET', '/api/import/last').then((r) => {
      const last = r?.last;
      if (!last) { undo.replaceChildren(); return; }
      const vars = { app: APPS[/** @type {'ticktick' | 'todoist'} */ (last.source)] ?? last.source, date: h.fmtDate(last.at), count: h.fmtNum(last.added) };
      undo.replaceChildren(h.row(t('set.import_undo'), h.btn(t('set.import_undo_button'), () => undoLast(vars)), t('set.import_undo_note', vars)));
    }).catch(() => undo.replaceChildren());
  };
  const undoLast = async (vars) => {
    const yes = await h.modal({
      title: t('import.undo_title'), body: [el('p', {}, t('import.undo_text', vars))],
      buttons: [{ label: t('set.import_undo_button'), value: 'yes', kind: 'danger' }, { label: t('set.cancel'), value: null, kind: 'ghost' }],
    });
    if (!yes) return;
    try {
      const r = await request('POST', '/api/import/undo');
      toast(t('import.undo_done', { count: h.fmtNum(r.removed) }), 'ok');
      load();
    } catch (e) { toast(t('import.failed', { reason: h.offlineText(e) })); }
    refresh();
  };
  refresh();
  const buttons = el('div', { class: 'set-btns' },
    h.btn(t('set.import_ticktick'), () => importFrom(h, 'ticktick', refresh), { disabled: h.off }),
    h.btn(t('set.import_todoist'), () => importFrom(h, 'todoist', refresh), { disabled: h.off }));
  return [h.row(t('set.import'), buttons, h.homeNote(t('set.import_note'))), undo];
}
