import { ask } from './dialog.js';
import { dateLocale, t } from './i18n.js';
import { el } from './render.js';
import { emptyTrash, purgeTask, restoreTask, state } from './store.js';

const when = (iso) => new Date(iso).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Bevestigt "definitief verwijderen" of "prullenbak legen"; true als de gebruiker doorgaat. */
async function sure(title, text, label) {
  return (await ask({ title, text, buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label, value: 'ok', kind: 'danger' }] })) === 'ok';
}

function trashItem(task) {
  const shared = task.share && !task.share.mine;
  return el('li', { class: 'task trashed', 'data-id': task.id },
    el('div', { class: 'row' },
      el('span', { class: 'title' }, task.title),
      el('span', { class: 'trash-actions' },
        el('button', { class: 'ghost', type: 'button', onclick: () => restoreTask(task.id) }, t('trash.restore')),
        el('button', {
          class: 'danger', type: 'button',
          onclick: async () => {
            // Bij andermans taak verdwijnt hij alleen uit jouw prullenbak; dat zegt de bevestiging.
            const text = shared ? t('trash.purge_shared_text', { title: task.title }) : t('trash.purge_text', { title: task.title });
            if (await sure(t('trash.purge'), text, t('trash.purge'))) purgeTask(task.id);
          },
        }, t('trash.purge')))),
    el('div', { class: 'meta' },
      el('span', {}, t('trash.deleted_at', { when: when(task.deleted_at) })),
      task.list !== 'Inbox' ? el('span', {}, task.list) : null,
      task.share ? el('span', { class: 'shared' }, t('share.with', { names: shareNames(task) })) : null));
}

/** Namen van de anderen op een gedeelde taak, voor "Gedeeld met …". */
export function shareNames(task) {
  const s = task.share;
  if (!s) return '';
  const others = s.mine ? s.members.filter((m) => m.status === 'accepted').map((m) => m.name) : [s.owner.name];
  return others.join(', ');
}

/** De prullenbak in de middenkolom: uitleg, legen, en per taak terugzetten of definitief verwijderen. */
export function renderTrash(root) {
  if (state.trash === null) {
    root.append(el('p', { class: 'empty' }, state.offline ? t('trash.offline') : t('trash.loading')));
    return;
  }
  const q = state.query.trim().toLowerCase();
  const items = state.trash.filter((x) => !q || x.title.toLowerCase().includes(q));
  const head = el('div', { class: 'trash-head' },
    el('p', { class: 'muted' }, t('trash.hint')),
    state.trash.length ? el('button', {
      class: 'danger', type: 'button',
      onclick: async () => { if (await sure(t('trash.empty'), t('trash.empty_text'), t('trash.empty'))) emptyTrash(); },
    }, t('trash.empty')) : null);
  root.append(head);
  if (!items.length) {
    root.append(el('p', { class: 'empty' }, q ? t('render.nothing_found') : t('trash.nothing')));
    return;
  }
  root.append(el('ul', { class: 'tasks' }, ...items.map(trashItem)));
}
