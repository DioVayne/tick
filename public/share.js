import { request, Offline } from './api.js';
import { icon } from './icons.js';
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

/** De andere accounts op deze Tick (id en naam), voor de keuzelijst; offline of bij een fout een lege lijst. */
async function people() {
  try {
    return await request('GET', '/api/shares/people');
  } catch {
    return [];
  }
}

/** De deeldialoog: iemand kiezen (of een naam of e-mailadres typen), en per keer gedeeld of kopie. */
export async function openShareDialog(task) {
  if (state.offline) { toast(t('share.online_only')); return; }
  const others = await people();
  /** @type {{ id: string, name: string } | null} */
  let chosen = others.length === 1 ? others[0] : null; // met maar één ander account staat die al klaar
  const input = el('input', {
    id: 'share-to', type: 'text', autocomplete: 'off', maxlength: '254', enterkeyhint: 'send',
    placeholder: t(others.length ? 'share.to_placeholder_other' : 'share.to_placeholder'),
  });
  const chips = others.map((p) => el('button', {
    type: 'button', class: 'ghost person', 'aria-pressed': String(chosen?.id === p.id),
    onclick: () => { chosen = chosen?.id === p.id ? null : p; input.value = ''; mark(); },
  }, p.name));
  const mark = () => chips.forEach((b, i) => b.setAttribute('aria-pressed', String(chosen?.id === others[i].id)));
  // Typen gaat boven een keuze uit de lijst.
  input.addEventListener('input', () => { if (input.value.trim()) { chosen = null; mark(); } });
  const option = (value, label, hint, checked) => el('label', { class: 'share-mode' },
    el('input', { type: 'radio', name: 'share-mode', value, checked }),
    el('span', {}, el('strong', {}, label), el('small', {}, hint)));
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog share-dialog', 'aria-labelledby': 'share-title' }));
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const form = el('form', {
    method: 'dialog',
    onsubmit: async (e) => {
      e.preventDefault();
      const typed = input.value.trim();
      if (!typed && !chosen) { (chips[0] ?? input).focus(); return; }
      const mode = /** @type {HTMLInputElement} */ (form.querySelector('input[name="share-mode"]:checked')).value;
      const send = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
      send.disabled = true;
      const who = typed ? { to: typed } : { to_user: chosen.id };
      if (await call('POST', '/api/shares', { task_id: task.id, mode, ...who })) {
        close();
        toast(t('share.sent', { name: typed || chosen.name }), 'ok');
      } else send.disabled = false;
    },
  },
  el('h2', { id: 'share-title' }, t('share.title', { title: task.title })),
  el('label', { for: 'share-to' }, t('share.to_label')),
  chips.length ? el('div', { class: 'people', role: 'group', 'aria-label': t('share.to_label') }, ...chips) : null,
  input,
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
  // Met een keuzelijst geen toetsenbord openklappen: dat duwt de namen op een telefoon uit beeld.
  (chips.find((b) => b.getAttribute('aria-pressed') === 'true') ?? chips[0] ?? input).focus();
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
    el('h3', {}, rows.length ? t('share.members') : t('share.heading')),
    rows.length ? el('ul', { class: 'share-list' }, ...rows) : null,
    owner && !readOnly ? el('button', { class: 'ghost secbtn', type: 'button', onclick: () => openShareDialog(task) }, icon('users'), t(rows.length ? 'share.button' : 'share.with_someone')) : null,
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
