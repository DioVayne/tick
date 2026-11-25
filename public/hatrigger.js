import { request } from './api.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { el, fmt, toast } from './render.js';
import { openMenu, step } from './steps.js';

// Home Assistant-triggers (src/hatrigger.ts): bij een taak triggers uit Home Assistant kiezen ("Meld als Sam komt thuis").
// De eerste die afgaat, geeft één melding; daarna "Al gemeld · Opnieuw melden", net als een plek. Alleen voor je eigen
// hoofdtaak, en alleen online (de keuze gaat direct naar de server, niet via de outbox).

/** @type {{ triggers: { id: string, name: string, entity: string | null, last: string | null }[], tasks: Record<string, { ids: string[], fired: string | null, rep: string | null, by?: string | null }> }} */
let data = { triggers: [], tasks: {} };
let loading = null;
/** @type {Set<() => void>} */
const waiting = new Set();

/**
 * Haalt de triggers en koppelingen op (bij het openen van een taak of de invoerkaart); `done` loopt als er iets nieuws
 * is. Loopt er al een verzoek, dan wacht `done` daarop mee.
 * @param {() => void} done
 */
export function refreshHa(done) {
  waiting.add(done);
  if (loading) return;
  loading = request('GET', '/api/hatrigger')
    .then((next) => {
      const changed = JSON.stringify(next) !== JSON.stringify(data);
      data = next;
      if (changed) for (const fn of waiting) fn();
    })
    .catch(() => {}) // offline of uit: de stap blijft zoals hij was
    .finally(() => { loading = null; waiting.clear(); });
}

/** Wat de stap toont; verandert dit, dan tekent het paneel de tijdlijn opnieuw. @param {{ id: string }} task */
export const haKey = (task) => JSON.stringify([data.tasks[task.id] ?? null, data.triggers.map((x) => [x.id, x.name, x.last])]);

/** Wacht de taak op een trigger? Nog niet gemeld, of een herhalende taak die sindsdien doorschoof (zoals de server). */
const armed = (link, task) => !link.fired || (!!task.repeat?.at && task.repeat.at !== link.rep);

/**
 * @param {string} taskId
 * @param {string[]} ids
 * @param {() => void} done
 */
async function save(taskId, ids, done = () => {}) {
  try {
    const res = await request('PUT', `/api/hatrigger/tasks/${encodeURIComponent(taskId)}`, { ids });
    if (res.link) data.tasks[taskId] = res.link;
    else delete data.tasks[taskId];
    done();
  } catch (e) {
    toast(/** @type {Error} */ (e).message, 'error');
  }
}

/**
 * Het menu met triggers om aan en uit te vinken; elke tik geeft de nieuwe keuze aan `onToggle`. Klaar sluit alleen.
 * @param {HTMLElement} anchor
 * @param {string[]} current
 * @param {(ids: string[]) => void} onToggle
 * @param {() => void} [onDismiss]
 */
export function pickTriggers(anchor, current, onToggle, onDismiss) {
  openMenu(anchor, t('hatrigger.menu'), (choose) => {
    const ids = new Set(current);
    const items = data.triggers.map((trig) => {
      const item = el('button', {
        class: 'menu-item ha-item' + (ids.has(trig.id) ? ' on' : ''), type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(ids.has(trig.id)),
        onclick: () => {
          if (ids.has(trig.id)) ids.delete(trig.id); else ids.add(trig.id);
          item.classList.toggle('on', ids.has(trig.id));
          item.setAttribute('aria-checked', String(ids.has(trig.id)));
          onToggle([...ids]);
        },
      }, icon('bolt'), el('span', {}, trig.name), el('small', {}, trig.owner ? t('hatrigger.from', { name: trig.owner.name }) : trig.last ? t('hatrigger.last', { when: fmt(trig.last) }) : t('hatrigger.never')));
      return item;
    });
    return [
      el('div', { class: 'when-head', role: 'presentation' }, t('hatrigger.menu_hint')),
      ...items,
      el('button', { class: 'menu-item when-pick', type: 'button', role: 'menuitem', onclick: () => choose(null, onDismiss) },
        icon('done'), el('span', {}, t('hatrigger.done'))),
    ];
  }, onDismiss);
}

/**
 * Invoerkaart (composer.js): de triggers om uit te kiezen, de namen van een keuze, en de keuze opslaan zodra de nieuwe
 * taak op de server staat (zoals delen).
 */
export const haChoices = () => data.triggers;
/** @param {string[]} ids @param {{ id: string, name: string }[]} [triggers] */
export const haNames = (ids, triggers = data.triggers) => {
  const names = ids.map((id) => triggers.find((x) => x.id === id)?.name).filter(Boolean);
  return names.length ? names.join(t('hatrigger.or')) : null;
};
/** @param {string} taskId @param {string[]} ids */
export const linkTriggers = (taskId, ids) => save(taskId, ids.filter((id) => data.triggers.some((x) => x.id === id)));

/**
 * "Gemeld wo 25 nov 18:42 · Sam komt thuis". Zonder tijd (oudere gegevens) "Al gemeld"; een trigger die er niet meer is
 * laat de naam weg.
 * @param {{ fired: string | null, by?: string | null }} link
 */
export function firedText(link) {
  if (!link.fired) return t('detail.already_notified');
  const name = data.triggers.find((x) => x.id === link.by)?.name;
  return name ? t('hatrigger.notified_by', { when: fmt(link.fired), name }) : t('hatrigger.notified', { when: fmt(link.fired) });
}

/**
 * De stap in de tijdlijn van het detailpaneel, of null (subtaak, niet je eigen taak, geen triggers).
 * @param {any} task
 * @param {{ done: boolean, owner: boolean, opener: (kind: string, fn: (anchor: HTMLElement) => void) => ((anchor: HTMLElement) => void) | null, onChange: () => void }} o
 */
export function haStep(task, { done, owner, opener, onChange }) {
  if (task.parent_id || !owner) return null;
  const link = data.tasks[task.id];
  const chosen = (link?.ids ?? []).map((id) => data.triggers.find((x) => x.id === id)).filter(Boolean);
  if (!chosen.length && (done || !data.triggers.length)) return null;

  // Elke tik slaat meteen op (ook als je daarna naast het menu tikt); Klaar sluit alleen.
  const pick = (anchor) => pickTriggers(anchor, link?.ids ?? [], (ids) => save(task.id, ids, onChange));

  // Al gemeld: een regel eronder met wanneer en door welke trigger, en "Opnieuw melden" (zelfde triggers opnieuw
  // opslaan zet hem klaar).
  const fired = !!link && chosen.length > 0 && !armed(link, task);
  const sub = fired && !done ? el('div', { class: 'loc-sub' }, el('span', {}, firedText(link), ' · ',
    el('button', { class: 'linkbtn', type: 'button', onclick: () => save(task.id, link.ids, onChange) }, t('detail.rearm_location')))) : null;

  return step({
    kind: 'hatrigger', icon: 'bolt', on: chosen.length > 0,
    lead: t(chosen.length ? 'hatrigger.lead' : 'hatrigger.add'),
    value: chosen.length ? chosen.map((x) => x.name).join(t('hatrigger.or')) : null,
    sub, open: opener('hatrigger', pick),
    actions: done || !chosen.length ? [] : [{ label: t('detail.clear'), run: () => save(task.id, [], onChange) }],
  });
}
