import { ask } from './dialog.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { openListPicker } from './listpicker.js';
import { render, toast } from './render.js';
import { UNDO_MS, remove, state, update } from './store.js';

// Vegen over een taak (alleen met een vinger): naar links verwijderen, naar rechts in een andere lijst zetten.
// Verwijderen wacht UNDO_MS: zolang staat er onderin "Ongedaan maken" en is de taak alleen verborgen. Gaat de app
// naar de achtergrond, dan gaat het verwijderen meteen door, zodat het niet verloren gaat als de app dichtgaat.

const START = 10; // zoveel px opzij voordat het een veeg is (en geen tik of scroll)
const COMMIT = 0.35; // voorbij dit deel van de breedte gaat de actie door
const FLICK = 0.6; // of zo snel (px/ms) met minstens 60px

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const deleting = new Map();

/** Verborgen omdat de taak (of haar hoofdtaak) net is weggeveegd. */
export const swipedAway = (task) => deleting.has(task.id) || (!!task.parent_id && deleting.has(task.parent_id));

function finish(id) {
  clearTimeout(deleting.get(id));
  deleting.delete(id);
  if (state.open.some((x) => x.id === id)) remove(id);
}

// Geen klik op de titel vlak na een veeg: dat zou de taak openen.
let swallowUntil = 0;
addEventListener('click', (e) => {
  if (e.timeStamp < swallowUntil) { e.stopPropagation(); e.preventDefault(); }
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') for (const id of [...deleting.keys()]) finish(id);
});

/** Gedeeld met echte deelnemers: dan eerst vragen, want hij verdwijnt voor iedereen (zoals in het taakscherm). */
async function confirmShared(task) {
  const top = task.parent_id ? state.open.find((x) => x.id === task.parent_id) : task;
  const s = top?.share;
  if (!s || (s.mine && !s.members.some((m) => m.status === 'accepted'))) return true;
  const answer = await ask({
    title: t('detail.delete_title'),
    text: t('detail.confirm_delete_shared', { title: task.title }),
    buttons: [{ label: t('detail.delete'), value: 'delete', kind: 'danger' }, { label: t('dialog.cancel'), value: null, kind: 'ghost' }],
  });
  return answer === 'delete';
}

async function swipeDelete(task) {
  if (!(await confirmShared(task))) return false;
  if (state.selected === task.id) state.selected = null;
  deleting.set(task.id, setTimeout(() => finish(task.id), UNDO_MS));
  render();
  toast(t('swipe.deleted'), 'ok', {
    label: t('render.undo'), ms: UNDO_MS,
    run: () => {
      if (!deleting.has(task.id)) return;
      clearTimeout(deleting.get(task.id));
      deleting.delete(task.id);
      render();
    },
  });
  return true;
}

function swipeMove(task, li) {
  const from = task.list;
  openListPicker(li, from, (name) => {
    update(task.id, { list: name });
    toast(t('swipe.moved', { list: name }), 'ok', { label: t('render.undo'), ms: UNDO_MS, run: () => update(task.id, { list: from }) });
  });
}

/**
 * Vegen op een taakrij. Subtaken volgen de lijst van hun hoofdtaak: die kun je alleen wegvegen.
 * @param {HTMLLIElement} li
 * @param {any} task
 */
export function enableSwipe(li, task) {
  const canMove = !task.parent_id;
  let start = null; // { x, y, t, id } vanaf pointerdown
  let dx = 0;
  let active = false;
  let back = null; // gekleurde laag achter de taak

  const reset = () => {
    li.classList.remove('swiping', 'swipe-left', 'swipe-right', 'swipe-go');
    li.style.removeProperty('translate');
    back?.remove();
    back = null;
    start = null;
    active = false;
    dx = 0;
  };

  li.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary || start) return;
    // Niet vanaf het sleepgreepje of een titelveld, en niet in een subtaak (die heeft haar eigen li).
    if (e.target.closest('.grip, textarea, input') || e.target.closest('li.task') !== li) return;
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  });

  li.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const x = e.clientX - start.x;
    const y = e.clientY - start.y;
    if (!active) {
      if (Math.abs(y) > START && Math.abs(y) > Math.abs(x)) { reset(); return; } // scrollen
      if (Math.abs(x) < START || document.querySelector('.sortable-chosen')) return;
      active = true;
      try { li.setPointerCapture(e.pointerId); } catch { /* de vinger is al los */ }
      back = document.createElement('div');
      back.className = 'swipe-back';
      back.setAttribute('aria-hidden', 'true');
      back.append(icon('folder'), icon('trash'));
      back.style.top = li.offsetTop + 'px';
      back.style.height = li.offsetHeight + 'px';
      li.before(back);
      li.classList.add('swiping');
    }
    dx = canMove ? x : Math.min(0, x);
    const left = dx < 0;
    back.classList.toggle('left', left);
    back.classList.toggle('right', !left);
    back.classList.toggle('go', Math.abs(dx) > li.offsetWidth * COMMIT);
    li.style.translate = dx + 'px 0';
  });

  const end = async (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (!active) { start = null; return; }
    swallowUntil = e.timeStamp + 400;
    const speed = Math.abs(dx) / Math.max(1, e.timeStamp - start.t);
    const go = e.type === 'pointerup' && (Math.abs(dx) > li.offsetWidth * COMMIT || (speed > FLICK && Math.abs(dx) > 60));
    const width = li.offsetWidth;
    if (go && dx < 0) {
      li.classList.add('swipe-go');
      li.style.translate = -width + 'px 0';
      if (!(await swipeDelete(task))) reset();
      return;
    }
    const move = go && dx > 0;
    reset();
    if (move) swipeMove(task, li);
  };
  li.addEventListener('pointerup', end);
  li.addEventListener('pointercancel', end);
}
