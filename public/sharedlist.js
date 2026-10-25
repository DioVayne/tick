import { request } from './api.js';
import { selectTask } from './detail.js';
import { ask } from './dialog.js';
import { icon } from './icons.js';
import { dateLocale, t } from './i18n.js';
import { el, fmt, toast } from './render.js';
import CONFIG from './settings.js';
import {
  answerListInvite, claim, claimedByOther, clearDone, doneInList, removeListMember, sharedOf, shareList, state, toggleDone,
} from './store.js';

// Gedeelde lijsten in de app: de deeldialoog van een lijst, de uitnodigingsbalk, "ik pak het op" en het blok Afgevinkt.
// Delen, accepteren, eruit halen en opruimen gaan alleen online (zoals delen per taak); op naam zetten en afvinken via de outbox.

/** Offline: melden en false. De acties op een gedeelde lijst zijn directe verzoeken aan de server. */
function online() {
  if (!state.offline) return true;
  toast(t('share.online_only'));
  return false;
}

const self = (id) => id === CONFIG.userId;
const nameOf = (person) => (self(person.id ?? person.user_id) ? t('share.you') : person.name);

/** Namen als lijstje voor een zin ("Bob, Carla en Dirk"), in de taal van de app. */
export function joinNames(names) {
  try {
    return new Intl.ListFormat(dateLocale(), { type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** De andere accounts op deze Tick (id en naam), voor de keuzelijst; bij een fout een lege lijst. */
async function people() {
  try {
    return await request('GET', '/api/shares/people');
  } catch {
    return [];
  }
}

/**
 * De deeldialoog van lijst `name`: wie erin zit (met status) en, voor de eigenaar, Verwijderen per lid en iemand
 * uitnodigen. Een gewone lijst wordt bij de eerste uitnodiging een gedeelde lijst met jou als eigenaar.
 */
export async function openListShareDialog(name) {
  if (!online()) return;
  const everyone = await people();
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog share-dialog slist-dialog', 'aria-labelledby': 'slist-title' }));
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const members = el('ul', { class: 'share-list' });
  const chipBox = el('div', { class: 'people', role: 'group', 'aria-label': t('share.to_label') });
  const input = el('input', { id: 'slist-to', type: 'text', autocomplete: 'off', maxlength: '254', enterkeyhint: 'send' });
  /** @type {{ id: string, name: string } | null} */
  let chosen = null;
  let chips = [];
  let others = [];

  // Na elke wijziging opnieuw uit sharedOf: de leden en wie je nog kunt uitnodigen.
  const fill = () => {
    const s = sharedOf(name);
    const owner = !s || s.mine;
    const rows = [];
    if (s) {
      rows.push(el('li', {}, el('span', { class: 'who' }, nameOf(s.owner)), el('span', { class: 'state' }, t('share.owner'))));
      for (const m of s.members) {
        rows.push(el('li', {},
          el('span', { class: 'who' }, nameOf(m)),
          el('span', { class: 'state' }, m.status === 'pending' ? t('share.pending') : t('share.accepted')),
          s.mine ? el('button', { class: 'ghost small', type: 'button', onclick: () => removeMember(s, m) }, t('share.remove')) : null));
      }
    }
    members.replaceChildren(...rows);
    members.hidden = !rows.length;
    const taken = new Set([s?.owner.id, ...(s?.members ?? []).map((m) => m.user_id)]);
    others = everyone.filter((p) => !taken.has(p.id));
    if (chosen && taken.has(chosen.id)) chosen = null;
    if (!chosen && others.length === 1 && !input.value.trim()) chosen = others[0];
    chips = others.map((p) => el('button', {
      type: 'button', class: 'ghost person', 'aria-pressed': String(chosen?.id === p.id),
      onclick: () => { chosen = chosen?.id === p.id ? null : p; input.value = ''; mark(); },
    }, p.name));
    chipBox.replaceChildren(...chips);
    chipBox.hidden = !chips.length;
    input.placeholder = t(chips.length ? 'share.to_placeholder_other' : 'share.to_placeholder');
    invite.hidden = !owner;
  };
  const mark = () => chips.forEach((b, i) => b.setAttribute('aria-pressed', String(chosen?.id === others[i].id)));
  input.addEventListener('input', () => { if (input.value.trim()) { chosen = null; mark(); } });

  /** Iemand eruit halen (eigenaar), na een bevestiging; de dialoog blijft open. */
  async function removeMember(s, m) {
    const pending = m.status === 'pending';
    const ok = await ask({
      title: t('share.remove'),
      text: t(pending ? 'slist.withdraw_confirm' : 'slist.remove_confirm', { name: m.name, list: name }),
      buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label: t('share.remove'), value: 'ok', kind: 'danger' }],
    });
    if (ok !== 'ok' || !online()) return;
    await removeListMember(s.id, m.user_id);
    fill();
  }

  const send = el('button', { type: 'submit' }, t('share.send'));
  const invite = el('form', {
    class: 'slist-invite',
    onsubmit: async (e) => {
      e.preventDefault();
      const typed = input.value.trim();
      if (!typed && !chosen) { (chips[0] ?? input).focus(); return; }
      if (!online()) return;
      send.disabled = true;
      const who = typed ? { to: typed } : { to_user: chosen.id };
      const res = await shareList(name, who);
      send.disabled = false;
      if (!res) return;
      toast(t('share.sent', { name: typed || chosen.name }), 'ok');
      // Open laten: in een groep nodig je vaak meer mensen uit.
      input.value = '';
      chosen = null;
      fill();
      (chips[0] ?? input).focus();
    },
  },
  el('label', { for: 'slist-to' }, t('slist.invite_label')),
  chipBox,
  input,
  el('p', { class: 'slist-hint' }, t('slist.share_hint')),
  el('div', { class: 'dialog-buttons' }, send));

  dialog.append(
    el('h2', { id: 'slist-title' }, t('slist.share_title', { list: name })),
    members,
    invite,
    el('div', { class: 'dialog-buttons' }, el('button', { type: 'button', class: 'ghost', onclick: close }, t('slist.close'))),
  );
  fill();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', close);
  document.body.append(dialog);
  dialog.showModal();
  // Met een keuzelijst geen toetsenbord openklappen (zoals bij delen per taak).
  const first = invite.hidden ? null : chips.find((b) => b.getAttribute('aria-pressed') === 'true') ?? chips[0] ?? input;
  (first ?? /** @type {HTMLElement} */ (dialog.querySelector('button')))?.focus();
}

/** Balk per openstaande lijstuitnodiging bovenaan de takenlijst, met Accepteren en Weigeren. */
export function renderListInvites(root) {
  // Offline niet: accepteren en weigeren gaan alleen online, en de lijst kan verouderd zijn.
  if (state.offline || !state.listInvites.length) return;
  root.append(el('div', { class: 'invites' }, ...state.listInvites.map((inv) => el('div', { class: 'invite', 'data-list-invite': inv.id, role: 'group' },
    el('p', {}, t('slist.invite', { name: inv.from.name, list: inv.name, n: inv.open })),
    el('div', { class: 'invite-buttons' },
      el('button', { type: 'button', class: 'ghost', onclick: () => { if (online()) answerListInvite(inv.id, false); } }, t('share.decline')),
      el('button', {
        type: 'button',
        onclick: async () => {
          if (!online()) return;
          const res = await answerListInvite(inv.id, true);
          if (res) toast(t('slist.accepted_toast', { list: res.name ?? inv.name }), 'ok');
        },
      }, t('share.accept')))))));
}

/**
 * Op naam in de metaregel van een open hoofdtaak in een gedeelde lijst: "Jij pakt het op" (tik: loslaten), "{name} pakt
 * het op", of de knop "Ik pak het op". Gaat via de outbox, dus ook offline.
 */
export function claimControl(task) {
  const by = task.claimed_by;
  if (by && self(by.id)) {
    return el('button', {
      type: 'button', class: 'claim mine', 'aria-pressed': 'true', title: t('slist.release'),
      onclick: () => claim(task.id, false),
    }, icon('user', 'sm'), t('slist.you_take'));
  }
  if (by) return el('span', { class: 'claim other' }, icon('user', 'sm'), t('slist.takes', { name: by.name }));
  return el('button', { type: 'button', class: 'claim free', onclick: () => claim(task.id, true) }, t('slist.i_take'));
}

/** Het blok "Afgevinkt" onder de open taken van gedeelde lijst `name`, of null als er niets afgevinkt is. */
export function doneBlock(name) {
  const tasks = doneInList(name);
  if (!tasks.length) return null;
  const clear = async () => {
    const answer = await ask({
      title: t('slist.clear_title'),
      text: t('slist.clear_text', { n: tasks.length }),
      buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label: t('slist.clear'), value: 'ok', kind: 'danger' }],
    });
    if (answer !== 'ok' || !online()) return;
    const res = await clearDone(name);
    if (res) toast(t('slist.cleared', { n: res.deleted }), 'ok');
  };
  return el('section', { class: 'done-block', 'aria-labelledby': 'done-block-h' },
    el('div', { class: 'done-head' },
      el('h2', { class: 'list-head', id: 'done-block-h' }, t('slist.done_head', { n: tasks.length })),
      el('button', { type: 'button', class: 'ghost small', onclick: clear }, t('slist.clear'))),
    el('ul', { class: 'tasks done-list' }, ...tasks.map(doneRow)));
}

/** Een afgevinkte taak: doorgestreept, met wie en wanneer. Het vinkje heropent (niet bij een taak op naam van een ander). */
function doneRow(task) {
  const locked = claimedByOther(task);
  const when = task.done_at ? fmt(task.done_at) : '';
  const who = task.done_by ? nameOf(task.done_by) : '';
  return el('li', { class: 'task done', 'data-id': task.id },
    el('div', { class: 'row' },
      el('button', {
        class: 'check', role: 'checkbox', 'aria-checked': 'true', disabled: locked,
        'aria-label': locked ? t('slist.claimed_by', { name: task.claimed_by.name }) : t('render.reopen_named', { title: task.title }),
        onclick: () => toggleDone(task),
      }),
      el('button', { class: 'title', 'aria-current': state.selected === task.id ? 'true' : false, onclick: () => selectTask(task.id) }, task.title)),
    el('div', { class: 'meta' }, el('span', {}, who && when ? t('slist.done_by', { name: who, when }) : who || when)));
}
