import CONFIG from './settings.js';
import { request } from './api.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { el, fmt, toast } from './render.js';
import { openMenu, step } from './steps.js';

// Testfeature "hatrigger" (src/hatrigger.ts): bij een taak triggers uit Home Assistant kiezen ("Meld als Sam komt thuis").
// De eerste die afgaat, geeft één melding; daarna "Al gemeld · Opnieuw melden", net als een plek. Alleen voor je eigen
// hoofdtaak, en alleen online (de keuze gaat direct naar de server, niet via de outbox).

/** @type {{ triggers: { id: string, name: string, entity: string | null, last: string | null }[], tasks: Record<string, { ids: string[], fired: string | null, rep: string | null }> }} */
let data = { triggers: [], tasks: {} };
let loading = null;

export const haOn = () => !!CONFIG.testFeatures?.includes('hatrigger');

/**
 * Haalt de triggers en koppelingen op (bij het openen van een taak); `done` loopt als er iets nieuws is.
 * @param {() => void} done
 */
export function refreshHa(done) {
  if (!haOn() || loading) return;
  loading = request('GET', '/api/hatrigger')
    .then((next) => { const changed = JSON.stringify(next) !== JSON.stringify(data); data = next; if (changed) done(); })
    .catch(() => {}) // offline of uit: de stap blijft zoals hij was
    .finally(() => { loading = null; });
}

/** Wat de stap toont; verandert dit, dan tekent het paneel de tijdlijn opnieuw. @param {{ id: string }} task */
export const haKey = (task) => (haOn() ? JSON.stringify([data.tasks[task.id] ?? null, data.triggers.map((x) => [x.id, x.name, x.last])]) : '');

/** Wacht de taak op een trigger? Nog niet gemeld, of een herhalende taak die sindsdien doorschoof (zoals de server). */
const armed = (link, task) => !link.fired || (!!task.repeat?.at && task.repeat.at !== link.rep);

/**
 * @param {string} taskId
 * @param {string[]} ids
 * @param {() => void} done
 */
async function save(taskId, ids, done) {
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
 * De stap in de tijdlijn van het detailpaneel, of null (testfeature uit, subtaak, niet je eigen taak, geen triggers).
 * @param {any} task
 * @param {{ done: boolean, owner: boolean, opener: (kind: string, fn: (anchor: HTMLElement) => void) => ((anchor: HTMLElement) => void) | null, onChange: () => void }} o
 */
export function haStep(task, { done, owner, opener, onChange }) {
  if (!haOn() || task.parent_id || !owner) return null;
  const link = data.tasks[task.id];
  const chosen = (link?.ids ?? []).map((id) => data.triggers.find((x) => x.id === id)).filter(Boolean);
  if (!chosen.length && (done || !data.triggers.length)) return null;

  // Elke tik slaat meteen op (ook als je daarna naast het menu tikt); Klaar sluit alleen.
  const pick = (anchor) => openMenu(anchor, t('hatrigger.menu'), (choose) => {
    const ids = new Set(link?.ids ?? []);
    const items = data.triggers.map((trig) => {
      const item = el('button', {
        class: 'menu-item ha-item' + (ids.has(trig.id) ? ' on' : ''), type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(ids.has(trig.id)),
        onclick: () => {
          if (ids.has(trig.id)) ids.delete(trig.id); else ids.add(trig.id);
          item.classList.toggle('on', ids.has(trig.id));
          item.setAttribute('aria-checked', String(ids.has(trig.id)));
          save(task.id, [...ids], onChange);
        },
      }, icon('bolt'), el('span', {}, trig.name), el('small', {}, trig.owner ? t('hatrigger.from', { name: trig.owner.name }) : trig.last ? t('hatrigger.last', { when: fmt(trig.last) }) : t('hatrigger.never')));
      return item;
    });
    return [
      el('div', { class: 'when-head', role: 'presentation' }, t('hatrigger.menu_hint')),
      ...items,
      el('button', { class: 'menu-item when-pick', type: 'button', role: 'menuitem', onclick: () => choose(null) },
        icon('done'), el('span', {}, t('hatrigger.done'))),
    ];
  });

  // Al gemeld: een regel eronder met "Opnieuw melden" (zelfde triggers opnieuw opslaan zet hem klaar).
  const fired = !!link && chosen.length > 0 && !armed(link, task);
  const sub = fired && !done ? el('div', { class: 'loc-sub' }, el('span', {}, t('detail.already_notified'), ' · ',
    el('button', { class: 'linkbtn', type: 'button', onclick: () => save(task.id, link.ids, onChange) }, t('detail.rearm_location')))) : null;

  return step({
    kind: 'hatrigger', icon: 'bolt', on: chosen.length > 0,
    lead: t(chosen.length ? 'hatrigger.lead' : 'hatrigger.add'),
    value: chosen.length ? chosen.map((x) => x.name).join(t('hatrigger.or')) : null,
    sub, open: opener('hatrigger', pick),
    actions: done || !chosen.length ? [] : [{ label: t('detail.clear'), run: () => save(task.id, [], onChange) }],
  });
}
