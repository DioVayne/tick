import { request, Offline } from './api.js';
import { ask } from './dialog.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';
import { load, state } from './store.js';

// Delen gaat alleen online: uitnodigen, accepteren, weigeren en stoppen zijn directe verzoeken, daarna een load().

/** Verzoek naar /api/shares; een fout wordt een melding. Geeft true als het lukte. */
async function call(method, path, body) {
  try {
    await request(method, path, body);
    return true;
  } catch (e) {
    toast(e instanceof Offline ? t('share.online_only') : e.message);
    return false;
  } finally {
    load();
  }
}

/** Namen van mensen met wie je al eerder deelde, als suggestie in het veld. */
function earlierPeople() {
  const names = new Set();
  for (const task of [...state.open, ...state.done]) {
    if (task.share?.mine) for (const m of task.share.members) names.add(m.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** De deeldialoog: naam of e-mailadres, en per keer gedeeld of kopie. */
export function openShareDialog(task) {
  if (state.offline) { toast(t('share.online_only')); return; }
  const input = el('input', {
    id: 'share-to', type: 'text', required: true, autocomplete: 'off', list: 'share-people', maxlength: '254',
    placeholder: t('share.to_placeholder'), enterkeyhint: 'send',
  });
  const option = (value, label, hint, checked) => el('label', { class: 'share-mode' },
    el('input', { type: 'radio', name: 'share-mode', value, checked }),
    el('span', {}, el('strong', {}, label), el('small', {}, hint)));
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog share-dialog', 'aria-labelledby': 'share-title' }));
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const form = el('form', {
    method: 'dialog',
    onsubmit: async (e) => {
      e.preventDefault();
      const to = input.value.trim();
      if (!to) return;
      const mode = /** @type {HTMLInputElement} */ (form.querySelector('input[name="share-mode"]:checked')).value;
      const send = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
      send.disabled = true;
      if (await call('POST', '/api/shares', { task_id: task.id, to, mode })) {
        close();
        toast(t('share.sent', { name: to }), 'ok');
      } else send.disabled = false;
    },
  },
  el('h2', { id: 'share-title' }, t('share.title', { title: task.title })),
  el('label', { for: 'share-to' }, t('share.to_label')),
  input,
  el('datalist', { id: 'share-people' }, ...earlierPeople().map((n) => el('option', { value: n }))),
  el('fieldset', { class: 'share-modes' },
    el('legend', {}, t('share.mode_label')),
    option('shared', t('share.mode_shared'), t('share.mode_shared_hint'), true),
    option('copy', t('share.mode_copy'), t('share.mode_copy_hint'), false)),
  el('div', { class: 'dialog-buttons' },
    el('button', { type: 'button', class: 'ghost', onclick: close }, t('dialog.cancel')),
    el('button', { type: 'submit' }, t('share.send'))));
  dialog.append(form);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', close);
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

/** Stoppen met delen (jezelf) of iemand eraf halen (als eigenaar), na een bevestiging. */
async function removeMember(task, member) {
  const self = member.user_id === CONFIG.userId;
  const text = self ? t('share.leave_confirm', { title: task.title }) : t('share.remove_confirm', { name: member.name, title: task.title });
  const label = self ? t('share.leave') : t('share.remove');
  const ok = await ask({ title: label, text, buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label, value: 'ok', kind: 'danger' }] });
  if (ok === 'ok') await call('DELETE', `/api/shares/${member.share_id}`);
}

/**
 * Het deelblok in het detailpaneel van een hoofdtaak: wie er op zitten (met status en acties) en de knop Delen
 * (alleen voor de eigenaar). Bouwt alleen opnieuw op als er iets veranderde.
 * @param {HTMLElement} box
 */
export function fillShareBox(box, task, readOnly) {
  const s = task.share;
  const owner = !s || s.mine;
  const key = JSON.stringify([task.id, readOnly, s]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = !!task.parent_id || (!s && readOnly);
  if (box.hidden) { box.replaceChildren(); return; }
  const rows = [];
  if (s && !s.mine) rows.push(el('li', {}, el('span', { class: 'who' }, s.owner.name), el('span', { class: 'state' }, t('share.owner'))));
  for (const m of s?.members ?? []) {
    const self = m.user_id === CONFIG.userId;
    // Een ontvanger ziet de andere deelnemers, maar kan alleen zichzelf eraf halen.
    const action = !readOnly && (owner || self)
      ? el('button', { class: 'ghost small', type: 'button', onclick: () => removeMember(task, m) }, self ? t('share.leave') : t('share.remove'))
      : null;
    rows.push(el('li', {},
      el('span', { class: 'who' }, self ? t('share.you') : m.name),
      el('span', { class: 'state' }, m.status === 'pending' ? t('share.pending') : t('share.accepted')),
      action));
  }
  box.replaceChildren(...[
    el('h3', {}, t('share.members')),
    rows.length ? el('ul', { class: 'share-list' }, ...rows) : null,
    owner && !readOnly ? el('button', { class: 'ghost', type: 'button', onclick: () => openShareDialog(task) }, '👥 ' + t('share.button')) : null,
  ].filter(Boolean));
}

/** Balk per openstaande uitnodiging bovenaan de takenlijst, met Accepteren en Weigeren. */
export function renderInvites(root) {
  // Offline niet: accepteren en weigeren gaan alleen online, en de lijst kan verouderd zijn.
  if (state.offline || !state.invites.length) return;
  root.append(el('div', { class: 'invites' }, ...state.invites.map((inv) => el('div', { class: 'invite', 'data-id': inv.id, role: 'group' },
    el('p', {}, t(inv.mode === 'copy' ? 'share.invite_copy' : 'share.invite_shared', { name: inv.from.name, title: inv.task.title })),
    el('div', { class: 'invite-buttons' },
      el('button', { type: 'button', class: 'ghost', onclick: () => call('POST', `/api/shares/${inv.id}/decline`) }, t('share.decline')),
      el('button', { type: 'button', onclick: async () => { if (await call('POST', `/api/shares/${inv.id}/accept`)) toast(t('share.accepted_toast'), 'ok'); } }, t('share.accept')))))));
}
