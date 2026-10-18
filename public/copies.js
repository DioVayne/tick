import { t } from './i18n.js';
import { countTasks } from './markdown.js';
import { el, fmt } from './render.js';
import { state } from './store.js';

// Kopiegroep: van de andere exemplaren zie je alleen naam, klaar en voortgang. Nooit getallen, alleen een balkje of ✓.

/** Voortgang (0–1) in woorden, afgerond op een kwart; een klein beetje telt al als een kwart. */
function amount(p) {
  const q = p > 0 && p < 0.125 ? 25 : Math.min(75, Math.round(p * 4) * 25);
  return t('copy.amount_' + q);
}

/** Toegankelijke omschrijving van een lid: klaar, hoe ver, of alleen bezig als er niets te tellen is. */
const ariaOf = (name, done, progress) => done ? t('copy.aria_done', { name })
  : progress == null ? t('copy.aria_none', { name })
  : t('copy.aria_progress', { name, amount: amount(progress) });

/** Balkje met de voortgang; de breedte gaat via CSSOM (een style-attribuut houdt de CSP tegen). Met `label` leest een
 * schermlezer het als afbeelding met die tekst, anders slaat hij het over (het labeltje zelf heeft dan de tekst). */
function bar(progress, label) {
  const fill = el('i');
  fill.style.setProperty('--p', String(Math.max(0, Math.min(1, progress))));
  return el('span', label ? { class: 'copy-bar', role: 'img', 'aria-label': label } : { class: 'copy-bar', 'aria-hidden': 'true' }, fill);
}

/** Labeltjes per ander lid voor de meta-regel in de lijst. */
export function copyPills(task) {
  return (task.copies?.members ?? []).map((m) => {
    const label = ariaOf(m.name, m.done, m.progress);
    return m.done
      ? el('span', { class: 'copy-pill done', title: label, 'aria-label': label }, m.name + ' ✓')
      : el('span', { class: 'copy-pill', title: label, 'aria-label': label }, m.name, m.progress == null ? null : bar(m.progress));
  });
}

/**
 * Eigen voortgang: takenlijst-regels in de beschrijving (zoals de app hem kent) plus de subtaken. Afgevinkte subtaken
 * staan na herladen niet in `state.open` (en `state.done` is alleen geladen met Afgerond open), dus het totaal komt van
 * de server (`copies.self`). De open subtaken kent de app wel allemaal, met wat nog in de outbox staat erbij; daarmee
 * tellen lokaal afgevinkte, heropende en doorgeschoven subtaken meteen mee. Een lokaal toegevoegde of verwijderde
 * subtaak klopt pas na de volgende load.
 */
function ownProgress(task, self) {
  const n = countTasks(task.description ?? '');
  const open = state.open.filter((x) => x.parent_id === task.id && !x.done && !state.justDone.has(x.id)).length;
  const total = Math.max(self?.total ?? 0, open);
  const done = n.done + total - open;
  return n.total + total ? done / (n.total + total) : null;
}

/** Eén regel in het blok: naam, en klaar (met tijdstip) of een balkje. */
function row(name, done, doneAt, progress) {
  return el('li', {},
    el('span', { class: 'who' }, name),
    done ? el('span', { class: 'state done' }, doneAt ? t('copy.done_at', { when: fmt(doneAt) }) : t('copy.done'))
      : progress == null ? null : bar(progress, amount(progress)));
}

/**
 * Het blok "Kopieën" in het detailpaneel; leeg en hidden zonder copies. Bouwt alleen opnieuw op als er iets veranderde.
 * @param {HTMLElement} box
 */
export function fillCopiesBox(box, task) {
  const c = !task.parent_id ? task.copies : null;
  const me = c ? [!!(task.done || state.justDone.has(task.id)), task.done_at ?? null, ownProgress(task, c.self)] : null;
  const key = JSON.stringify([task.id, c, me]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = !c;
  if (!c) { box.replaceChildren(); return; }
  const [myDone, myDoneAt, myProgress] = me;
  box.replaceChildren(
    el('h3', {}, t('copy.heading')),
    el('ul', { class: 'copy-list' },
      ...c.members.map((m) => row(m.name, m.done, m.done_at, m.progress)),
      row(t('share.you'), myDone, myDoneAt, myProgress),
      ...c.pending.map((p) => el('li', {}, el('span', { class: 'who' }, p.name), el('span', { class: 'state' }, t('share.pending'))))));
}
