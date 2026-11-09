import { request, Offline } from './api.js';
import { ask } from './dialog.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';
import { load, sharedOf, state } from './store.js';
import { renderListInvites } from './sharedlist.js';
import { openReportDialog, reportsOn } from './report.js';
import { recipientField, verifyHint } from './verifybar.js';

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

/**
 * Een taak samen doen met iemand (de invoerkaart, na het aanmaken): `who` is { to_user } of { to } (naam of e-mailadres).
 * Een fout wordt een melding; geeft true als het lukte.
 */
export const inviteToTask = (taskId, who) => call('POST', '/api/shares', { task_id: taskId, mode: 'shared', ...who });

/** De andere accounts op deze Tick (id en naam), voor de keuzelijst; offline of bij een fout een lege lijst. */
export async function people() {
  try {
    return await request('GET', '/api/shares/people');
  } catch {
    return [];
  }
}

/**
 * Hoe `who` nu al op de taak zit, voor de deeldialoog: { mode, status } of null. Gedeeld en openstaand staan in
 * `task.share` (met id), kopieën in `task.copies` (alleen de naam, of het e-mailadres op een openbare Tick).
 * @param {{ id?: string, name: string }} who
 */
export function currentShare(task, who) {
  const same = (n) => typeof n === 'string' && n.trim().toLowerCase() === who.name.trim().toLowerCase();
  const m = task.share?.mine ? task.share.members.find((x) => (who.id && x.user_id === who.id) || same(x.name)) : null;
  if (m) return { mode: 'shared', status: m.status };
  if (task.copies?.pending?.some((x) => same(x.name))) return { mode: 'copy', status: 'pending' };
  if (task.copies?.members?.some((x) => same(x.name))) return { mode: 'copy', status: 'accepted' };
  return null;
}

/** POST naar /api/shares; { data } als het lukte, anders { status } (de fout is dan al gemeld, behalve een 428). */
async function postShare(body) {
  try {
    return { data: await request('POST', '/api/shares', body) };
  } catch (e) {
    if (e.status !== 428) toast(e instanceof Offline ? t('share.online_only') : e.message);
    return { status: e.status ?? 0 };
  }
}

/** Bevestiging voor een geaccepteerde gedeelde taak die een kopie wordt. */
const confirmToCopy = (task, name) => ask({
  title: t('share.to_copy_title'),
  text: t('share.to_copy_confirm', { name, title: task.title }),
  buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label: t('share.to_copy_button'), value: 'ok' }],
}).then((v) => v === 'ok');

/** De deeldialoog: iemand kiezen (of een naam of e-mailadres typen), en per keer gedeeld of kopie. */
export async function openShareDialog(task) {
  if (state.offline) { toast(t('share.online_only')); return; }
  const others = await people();
  /** @type {{ id: string, name: string } | null} */
  let chosen = others.length === 1 ? others[0] : null; // met maar één ander account staat die al klaar
  const input = recipientField('share-to', others.length > 0);
  const chips = others.map((p) => el('button', {
    type: 'button', class: 'ghost person', 'aria-pressed': String(chosen?.id === p.id),
    onclick: () => { chosen = chosen?.id === p.id ? null : p; input.value = ''; mark(); },
  }, p.name));
  // Zit de gekozen persoon al op de taak, dan zegt een regel hoe, en staat de andere vorm klaar.
  const now = el('p', { class: 'share-now', 'aria-live': 'polite', hidden: true });
  /** @type {{ mode: string, status: string } | null} */
  let current = null;
  const who = () => {
    const typed = input.value.trim();
    return typed ? { name: typed } : chosen ? { id: chosen.id, name: chosen.name } : null;
  };
  const radios = () => /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[name="share-mode"]')]);
  const modeOf = () => radios().find((r) => r.checked)?.value ?? 'shared';
  const label = () => {
    const send = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    send.textContent = current && current.mode !== modeOf() ? t('share.change') : t('share.send');
  };
  const showCurrent = () => {
    const w = who();
    current = w ? currentShare(task, w) : null;
    const key = !current ? null : current.mode === 'shared'
      ? (current.status === 'accepted' ? 'share.now_shared' : 'share.now_shared_pending')
      : (current.status === 'accepted' ? 'share.now_copy' : 'share.now_copy_pending');
    now.hidden = !key;
    now.textContent = key ? t(key, { name: w.name }) : '';
    // Een eigen kopie wordt niet gedeeld; anders staat de andere vorm klaar (als die er is).
    const other = !current || (current.mode === 'copy' && current.status === 'accepted') ? null : current.mode === 'shared' ? 'copy' : 'shared';
    const r = other && radios().find((x) => x.value === other);
    if (r) r.checked = true;
    label();
  };
  const mark = () => { chips.forEach((b, i) => b.setAttribute('aria-pressed', String(chosen?.id === others[i].id))); showCurrent(); };
  // Typen gaat boven een keuze uit de lijst.
  input.addEventListener('input', () => { if (input.value.trim()) { chosen = null; mark(); } else showCurrent(); });
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
      const to = typed ? { to: typed } : { to_user: chosen.id };
      const name = typed || chosen.name;
      // Een geaccepteerde gedeelde taak die een kopie wordt: eerst bevestigen. Weet de app het niet (getypt), dan vraagt de server erom (428).
      const convert = current?.mode === 'shared' && current.status === 'accepted' && mode === 'copy';
      if (convert && !(await confirmToCopy(task, name))) { send.disabled = false; return; }
      let res = await postShare({ task_id: task.id, mode, ...to, convert });
      if (res.status === 428 && await confirmToCopy(task, name)) res = await postShare({ task_id: task.id, mode, ...to, convert: true });
      load();
      if (res.data) {
        close();
        const done = res.data.changed === 'copy' ? 'share.converted' : res.data.changed === 'mode' ? 'share.changed' : 'share.sent';
        toast(t(done, { name }), 'ok');
      } else send.disabled = false;
    },
  },
  el('h2', { id: 'share-title' }, t('share.title', { title: task.title })),
  verifyHint(),
  el('label', { for: 'share-to' }, t('share.to_label')),
  chips.length ? el('div', { class: 'people', role: 'group', 'aria-label': t('share.to_label') }, ...chips) : null,
  input,
  now,
  // In een gedeelde lijst is de taak al van alle leden: alleen een kopie sturen kan.
  el('fieldset', { class: 'share-modes' },
    el('legend', {}, t('share.mode_label')),
    task.shared_list ? null : option('shared', t('share.mode_shared'), t('share.mode_shared_hint'), true),
    option('copy', t('share.mode_copy'), t('share.mode_copy_hint'), !!task.shared_list)),
  el('div', { class: 'dialog-buttons' },
    el('button', { type: 'button', class: 'ghost', onclick: close }, t('dialog.cancel')),
    el('button', { type: 'submit' }, t('share.send'))));
  dialog.append(form);
  form.addEventListener('change', (e) => { if (/** @type {HTMLInputElement} */ (e.target).name === 'share-mode') label(); });
  showCurrent();
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
 * Wie er op een gedeelde hoofdtaak zitten, voor de stap "Samen met" in het detailpaneel: eigenaar en deelnemers, met
 * status en Verwijderen of Verlaten. Namen voor in de zin geeft `shareNames`; uitnodigen gaat via de stap zelf
 * (openShareDialog). Leeg en hidden in een gedeelde lijst (daar staan de leden bij de lijst) en zonder deelnemers.
 * Bouwt alleen opnieuw op als er iets veranderde.
 * @param {HTMLElement} box
 */
export function fillShareBox(box, task, readOnly) {
  const s = task.share;
  const owner = !s || s.mine;
  const key = JSON.stringify([task.id, readOnly, s, task.shared_list && !!sharedOf(task.list)]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const rows = [];
  if (!(task.shared_list && sharedOf(task.list))) {
    if (s && !s.mine) rows.push(el('li', {}, el('span', { class: 'who' }, s.owner.name), el('span', { class: 'state' }, t('share.owner'))));
    for (const m of s?.members ?? []) {
      const self = m.user_id === CONFIG.userId;
      // Een ontvanger ziet de andere deelnemers, maar kan alleen zichzelf eraf halen.
      const action = !readOnly && (owner || self)
        ? el('button', { class: 'step-act', type: 'button', onclick: () => removeMember(task, m) }, self ? t('share.leave') : t('share.remove'))
        : null;
      rows.push(el('li', {},
        el('span', { class: 'who' }, self ? t('share.you') : m.name),
        el('span', { class: 'state' }, m.status === 'pending' ? t('share.pending') : t('share.accepted')),
        action));
    }
  }
  box.hidden = !rows.length;
  box.replaceChildren(...(rows.length ? [el('p', { class: 'step-hint' }, t('share.hint')), el('ul', { class: 'share-list' }, ...rows)] : []));
}

/** De namen in de zin "Samen met …": de eigenaar (als jij het niet bent) en de deelnemers, behalve jijzelf. */
export const shareNames = (task) => [
  task.share && !task.share.mine ? task.share.owner.name : null,
  ...(task.share?.members ?? []).filter((m) => m.user_id !== CONFIG.userId).map((m) => m.name),
].filter(Boolean);

/** Balk per openstaande uitnodiging bovenaan de takenlijst, met Accepteren en Weigeren; lijstuitnodigingen eerst. */
export function renderInvites(root) {
  renderListInvites(root);
  // Offline niet: accepteren en weigeren gaan alleen online, en de lijst kan verouderd zijn.
  if (state.offline || !state.invites.length) return;
  root.append(el('div', { class: 'invites' }, ...state.invites.map((inv) => el('div', { class: 'invite', 'data-id': inv.id, role: 'group' },
    el('p', {}, t(inv.mode === 'copy' ? 'share.invite_copy' : 'share.invite_shared', { name: inv.from.name, title: inv.task.title })),
    el('div', { class: 'invite-buttons' },
      reportsOn() ? el('button', { type: 'button', class: 'ghost', onclick: () => openReportDialog({ share_id: inv.id }, inv.task.title, inv.from.name) }, t('report.button')) : null,
      el('button', { type: 'button', class: 'ghost', onclick: () => call('POST', `/api/shares/${inv.id}/decline`) }, t('share.decline')),
      el('button', { type: 'button', onclick: async () => { if (await call('POST', `/api/shares/${inv.id}/accept`)) toast(t('share.accepted_toast'), 'ok'); } }, t('share.accept')))))));
}
