import { request, Offline } from './api.js';
import { ask } from './dialog.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';
import { load, sharedOf } from './store.js';

// Melden en blokkeren op een openbare Tick (OPEN_SIGNUP). De server bepaalt wie de gemelde persoon is; de app geeft
// alleen aan wat er gemeld wordt: { share_id } (uitnodiging), { list_id }, { task_id } of { attachment_id }.

const REASONS = ['spam', 'inappropriate', 'illegal', 'other'];

/** Melden en blokkeren bestaan alleen op een openbare Tick. */
export const reportsOn = () => !!CONFIG.openSignup;

/**
 * Of je een (hoofd)taak van een ander kunt melden, en zo ja de naam van wie (als de app die kent): een taak die met
 * jou gedeeld is, of een taak in een gedeelde lijst die een ander erin zette. Anders null.
 * @returns {{ name: string | null } | null}
 */
export function reportableTask(top) {
  if (!reportsOn() || !top || top.parent_id) return null;
  const me = CONFIG.userId;
  const list = top.shared_list ? sharedOf(top.list) : null;
  if (list) {
    const by = top.added_by ?? list.owner.id;
    if (by === me) return null;
    const person = by === list.owner.id ? list.owner : list.members.find((m) => m.user_id === by);
    return { name: person?.name ?? null };
  }
  if (top.share && !top.share.mine) return { name: top.share.owner.name };
  return null;
}

/** Of een bijlage van een ander is in een taak die echt gedeeld is (een eigen kopie meld je niet). */
export function reportableAttachment(task, top, a) {
  if (!reportsOn() || !a.user_id || a.user_id === CONFIG.userId) return false;
  if (!top) return false;
  if (top.shared_list && sharedOf(top.list)) return true;
  return !!top.share && (!top.share.mine || top.share.members.some((m) => m.status === 'accepted'));
}

/** Verzoek; een fout wordt een melding. Geeft true als het lukte. */
async function send(method, path, body) {
  try {
    await request(method, path, body);
    return true;
  } catch (e) {
    toast(e instanceof Offline ? t('share.online_only') : e.message);
    return false;
  }
}

/**
 * Het meldvenster: reden, toelichting en "Blokkeer ook …" (standaard aan); "Alleen blokkeren" blokkeert zonder
 * melding. Na melden verdwijnt de inhoud (de server zegt het delen op) en ververst de app.
 * @param {{ share_id?: string, list_id?: string, task_id?: string, attachment_id?: string }} target
 * @param {string} title @param {string | null} name
 */
export function openReportDialog(target, title, name) {
  const who = name || t('report.this_person');
  const radios = REASONS.map((r, i) => el('label', { class: 'share-mode' },
    el('input', { type: 'radio', name: 'report-reason', value: r, checked: i === 0 }),
    el('span', {}, el('strong', {}, t(`report.reason_${r}`)), el('small', {}, t(`report.reason_${r}_hint`)))));
  const note = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'report-note', maxlength: '500', rows: '3' }));
  const block = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', id: 'report-block', checked: true }));
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog share-dialog report-dialog', 'aria-labelledby': 'report-title' }));
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const done = (key) => { close(); toast(t(key, { name: who }), 'ok'); load(); };
  const form = el('form', {
    method: 'dialog',
    onsubmit: async (e) => {
      e.preventDefault();
      const reason = /** @type {HTMLInputElement} */ (form.querySelector('input[name="report-reason"]:checked')).value;
      const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
      button.disabled = true;
      if (await send('POST', '/api/reports', { ...target, reason, note: note.value.trim(), block: block.checked })) done('report.thanks');
      else button.disabled = false;
    },
  },
  el('h2', { id: 'report-title' }, t('report.title', { title })),
  el('p', {}, t('report.intro')),
  el('fieldset', { class: 'share-modes' }, el('legend', {}, t('report.reason_label')), ...radios),
  el('label', { for: 'report-note' }, t('report.note_label')),
  note,
  el('label', { class: 'report-block', for: 'report-block' }, block, el('span', {}, t('report.also_block', { name: who }))),
  el('div', { class: 'dialog-buttons' },
    el('button', { type: 'button', class: 'ghost', onclick: close }, t('dialog.cancel')),
    el('button', {
      type: 'button', class: 'ghost',
      onclick: async () => {
        const ok = await ask({ title: t('report.block_title', { name: who }), text: t('report.block_text', { name: who }), buttons: [
          { label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label: t('report.block_button'), value: 'ok', kind: 'danger' }] });
        if (ok === 'ok' && await send('POST', '/api/blocks', target)) done('report.blocked');
      },
    }, t('report.block_only')),
    el('button', { type: 'submit', class: 'danger' }, t('report.send'))));
  dialog.append(form);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', close);
  document.body.append(dialog);
  dialog.showModal();
  /** @type {HTMLElement | null} */ (dialog.querySelector('input[type="radio"]'))?.focus();
}

/** Je geblokkeerde mensen (Instellingen › Account); offline of bij een fout een lege lijst. */
export async function blockedPeople() {
  try {
    return /** @type {{ id: string, name: string }[]} */ (await request('GET', '/api/blocks'));
  } catch {
    return [];
  }
}

/** Een blokkade opheffen; true als het lukte. */
export const unblock = (id) => send('DELETE', `/api/blocks/${id}`);
