import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, el, fmt, fromLocalInput, toast } from './render.js';
import { openRepeatPicker } from './repeatpicker.js';
import { openListPicker } from './listpicker.js';
import { openMap } from './map.js';
import { describeRule } from './repeat.js';
import { closeStepMenu, menuOpen, openMenu, openWhenMenu, step as railStep } from './steps.js';
import { addFiles, attachmentsOn } from './attachments.js';
import { inviteToTask, people } from './share.js';
import { selectTask } from './detail.js';
import { addSubtask, addTask, load, sharedOf, state } from './store.js';

// De invoerkaart bovenaan de lijst. In rust de blauwe balk; na de eerste letter klapt eronder een tijdlijn open met per
// eigenschap een zin ("Herinner me morgen 09:00", "Als ik aankom bij …", "In Inbox"). Een stap opent één kiezer (de
// bestaande datum-, ritme- en lijstkiezer, de kaart, of een menu met mensen); omschrijving en subtaken typ je in de kaart.
// Alles gaat in één keer mee met het aanmaken. Delen en bijlagen kunnen pas als de server de taak kent: na de eerste load.

const blank = () => ({
  remind: '', // 'YYYY-MM-DDTHH:MM' zoals de datumkiezer, of leeg
  repeat: /** @type {string | null} */ (null),
  location: /** @type {any} */ (null),
  list: /** @type {string | null} */ (null), // null: de lijst waar je naar kijkt (of Inbox)
  share: /** @type {{ who: { to_user: string } | { to: string }, name: string } | null} */ (null),
  description: '',
  subtasks: /** @type {string[]} */ ([]),
  files: /** @type {File[]} */ ([]),
});

let v = blank();
let more = false; // omschrijving, subtaken en bijlage in beeld
let editing = /** @type {'description' | 'subtasks' | null} */ (null);
let focusEditor = false; // het tekstvak van `editing` krijgt bij de volgende draw de focus
let form, input, rail, moreButton, fileInput;
let peek = false; // het veld heeft de focus: de rij icoontjes staat (zolang de kaart nog niet open is)

const defaultList = () => (!state.showDone && !state.showTrash && state.list) || 'Inbox';
const listOf = () => v.list ?? defaultList();
const remindIso = () => fromLocalInput(v.remind);
const filled = () => !!(v.remind || v.repeat || v.location || v.list || v.share || v.description.trim() || v.subtasks.length || v.files.length);
const isOpen = () => input.value !== '' || filled() || more || !!editing;

export function initComposer() {
  form = $('#add');
  input = /** @type {HTMLInputElement} */ ($('#add-title'));
  rail = el('div', { class: 'add-rail' });
  moreButton = el('button', { type: 'button', class: 'add-more-btn', onclick: () => { more = true; draw(); } }, icon('plus'), t('add.more'));
  fileInput = el('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addLocalFiles(fileInput.files); fileInput.value = ''; } });
  // Bij focus, nog voor de eerste letter: één rij icoontjes. Elk opent meteen zijn kiezer, zodat je ook eerst een tijd
  // of plek kunt kiezen en daarna de titel typt. Na de eerste letter (of een keuze) staat de volledige tijdlijn er.
  const peekButton = (kind, ico, label, onOpen) => el('button', {
    type: 'button', class: `add-peek-btn step-${kind}`, 'aria-label': label, title: label, onclick: (e) => onOpen(e.currentTarget),
  }, icon(ico));
  const peekRow = el('div', { class: 'add-peek' },
    peekButton('when', 'bell', t('add.when'), pickWhen),
    peekButton('repeat', 'repeat', t('add.repeat'), pickRepeat),
    peekButton('place', 'place', t('add.place'), pickPlace),
    peekButton('list', 'folder', t('add.list'), pickList),
    peekButton('share', 'users', t('add.share'), pickShare),
    peekButton('more', 'plus', t('add.more'), () => { more = true; done(); }));
  form.append(peekRow, el('div', { class: 'add-fold' }, el('div', {}, rail, moreButton)), fileInput);
  form.addEventListener('focusin', () => { peek = true; sync(); });
  // Weg uit de kaart (en geen kiezer open): de rij verdwijnt weer. Een kiezer staat buiten het formulier in body.
  form.addEventListener('focusout', () => setTimeout(() => {
    if (form.contains(document.activeElement) || document.querySelector('.menu, dialog[open], body.map-open')) return;
    peek = false;
    sync();
  }));

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  // ✕: alles weg en dicht, ook het toetsenbord.
  $('#add-cancel').addEventListener('click', () => { reset(); input.blur(); });
  input.addEventListener('input', sync);
  // Terug in de titel: een open tekstvak klapt dicht (de tekst blijft), en de lijst waar je naar kijkt kan veranderd zijn.
  input.addEventListener('focus', () => { editing = null; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); submit(true); }
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); reset(); }
  });
  // Een foto plakken of op de kaart slepen: wordt een bijlage.
  form.addEventListener('paste', (e) => {
    const files = e.clipboardData?.files;
    if (!attachmentsOn() || !files?.length) return;
    e.preventDefault();
    addLocalFiles(files);
  });
  form.addEventListener('dragover', (e) => { if (attachmentsOn() && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  form.addEventListener('drop', (e) => {
    if (!attachmentsOn() || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    addLocalFiles(e.dataTransfer.files);
  });
  draw();
}

/** Na een verversing van de lijst: opnieuw tekenen, maar niet terwijl je in de omschrijving of een subtaak typt. */
export function refreshComposer() {
  if (!rail || rail.contains(document.activeElement)) return;
  draw();
}

function addLocalFiles(files) {
  v.files.push(...files);
  more = true;
  draw();
  input.focus();
}

function reset() {
  input.value = '';
  peek = false;
  v = blank();
  more = false;
  editing = null;
  draw();
}

const back = () => input.focus({ preventScroll: true });
const done = () => { draw(); back(); };

/**
 * Eén stap in de tijdlijn (steps.js), met Wissen als er iets gekozen is.
 * @param {string} kind
 * @param {Parameters<typeof icon>[0]} ico
 * @param {boolean} on
 * @param {string} lead
 * @param {string | null} value
 * @param {(anchor: HTMLElement) => void} onOpen
 * @param {(() => void) | null} onClear
 * @param {HTMLElement | null} [body]
 */
function step(kind, ico, on, lead, value, onOpen, onClear, body = null) {
  const clear = on && onClear ? { label: t('detail.clear'), run: () => { onClear(); done(); } } : null;
  return railStep({ kind, icon: ico, on, lead, value, open: onOpen, actions: [clear], body, expanded: body ? true : undefined });
}

function sync() {
  const open = isOpen();
  form.classList.toggle('open', open);
  form.classList.toggle('peek', peek && !open);
}

function draw() {
  if (!form) return;
  const loc = v.location;
  const list = listOf();
  const steps = [
    step('when', 'bell', !!v.remind, t(v.remind ? 'add.when_set' : 'add.when'), v.remind ? fmt(remindIso()) : null, pickWhen, () => { v.remind = ''; }),
    step('repeat', 'repeat', !!v.repeat, v.repeat ? '' : t('add.repeat'), v.repeat ? describeRule(v.repeat, remindIso() ?? new Date().toISOString()) : null, pickRepeat, () => { v.repeat = null; }),
    step('place', 'place', !!loc, loc ? t(loc.trigger === 'exit' ? 'add.leave' : 'add.arrive') : t('add.place'), loc?.name ?? null, pickPlace, () => { v.location = null; }),
    step('list', 'folder', list !== defaultList(), t('add.in'), list, pickList, v.list ? () => { v.list = null; } : null),
    // In een gedeelde lijst doet iedereen in de lijst al mee.
    sharedOf(list) ? null : step('share', 'users', !!v.share, t(v.share ? 'add.share_set' : 'add.share'), v.share?.name ?? null, pickShare, () => { v.share = null; }),
  ];
  if (more) {
    const text = v.description.trim();
    steps.push(
      step('note', 'file', !!text, text ? '' : t('add.description'), text ? text.split('\n')[0] : null, () => toggle('description'), () => { v.description = ''; editing = null; }, editing === 'description' ? descriptionBox() : null),
      step('subs', 'all', v.subtasks.length > 0, v.subtasks.length ? '' : t('add.subtasks'), v.subtasks.length ? t(v.subtasks.length === 1 ? 'add.subtasks_one' : 'add.subtasks_many', { n: v.subtasks.length }) : null,
        () => toggle('subtasks'), () => { v.subtasks = []; editing = null; }, editing === 'subtasks' ? subtasksBox() : null),
      attachmentsOn() ? step('file', 'clip', v.files.length > 0, v.files.length ? '' : t('add.attach'), v.files.length ? v.files.map((f) => f.name).join(', ') : null, () => fileInput.click(), () => { v.files = []; }) : null,
    );
  }
  rail.replaceChildren(...steps.filter(Boolean));
  moreButton.hidden = more;
  sync();
}

function toggle(which) {
  editing = editing === which ? null : which;
  focusEditor = !!editing;
  draw();
  if (!editing) back();
}

function focusSoon(field) {
  if (!focusEditor) return;
  focusEditor = false;
  queueMicrotask(() => field.focus());
}

function descriptionBox() {
  const ta = el('textarea', { class: 'step-input', rows: '3', placeholder: t('add.description_placeholder'), 'aria-label': t('add.description') });
  ta.value = v.description;
  ta.addEventListener('input', () => { v.description = ta.value; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; done(); } });
  focusSoon(ta);
  return el('div', { class: 'step-body' }, ta);
}

function subtasksBox() {
  const field = el('input', { class: 'step-input', placeholder: t('add.subtask_placeholder'), 'aria-label': t('add.subtasks'), maxlength: '500', enterkeyhint: 'next' });
  field.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; done(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault(); // niet de hele kaart versturen
    const value = field.value.trim();
    if (!value) return;
    v.subtasks.push(value);
    focusEditor = true;
    draw(); // tekent een nieuw veld, dat de focus krijgt
  });
  focusSoon(field);
  const items = v.subtasks.map((s, i) => el('li', {}, el('span', { class: 'step-box' }), el('span', {}, s),
    el('button', { type: 'button', class: 'step-x', 'aria-label': t('add.remove_subtask', { title: s }), onclick: () => { v.subtasks.splice(i, 1); draw(); } }, '×')));
  return el('div', { class: 'step-body' }, items.length ? el('ul', { class: 'step-sublist' }, ...items) : null, field);
}

/** Herinnering: het korte menu uit steps.js, dan pas de datumkiezer. */
function pickWhen(anchor) {
  openWhenMenu(anchor, v.remind, (value) => { v.remind = value; done(); }, { onDismiss: back });
}

function pickRepeat(anchor) {
  const at = remindIso();
  const task = { remind_at: at, repeat: v.repeat ? { rule: v.repeat, start: at ?? new Date().toISOString() } : null };
  openRepeatPicker(anchor, task, (rule) => { v.repeat = rule; done(); }, at);
}

async function pickPlace() {
  const loc = await openMap({ location: v.location });
  if (loc) v.location = loc;
  done();
}

function pickList(anchor) {
  openListPicker(anchor, listOf(), (name) => { v.list = name === defaultList() ? null : name; done(); });
}

/** Menu met de andere accounts op deze Tick en een veld voor een naam of e-mailadres. Alleen online. */
async function pickShare(anchor) {
  if (menuOpen()) { closeStepMenu(); return; }
  if (state.offline || navigator.onLine === false) { toast(t('share.online_only')); return; }
  const others = await people();
  openMenu(anchor, t('share.to_label'), (choose) => {
    const other = el('input', { class: 'menu-input', placeholder: t(others.length ? 'share.to_placeholder_other' : 'share.to_placeholder'), 'aria-label': t('share.to_label'), maxlength: '254', autocomplete: 'off' });
    other.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const typed = other.value.trim();
      if (typed) choose(() => { v.share = { who: { to: typed }, name: typed }; done(); });
    });
    return [
      ...others.map((p) => el('button', {
        class: 'menu-item' + (v.share?.name === p.name ? ' on' : ''), type: 'button', role: 'menuitem',
        onclick: () => choose(() => { v.share = { who: { to_user: p.id }, name: p.name }; done(); }),
      }, p.name)),
      others.length ? el('div', { class: 'menu-sep' }) : null,
      other,
    ];
  }, back);
}

/** Maakt de taak; met open=true gaat hij meteen open in het detailpaneel. De kaart blijft open en leeg voor de volgende. */
function submit(open) {
  const title = input.value.trim();
  if (!title) { back(); return; }
  const card = v;
  const id = addTask(title, remindIso(), listOf(), { description: card.description.trim(), repeat: card.repeat, location: card.location });
  const parent = state.open.find((x) => x.id === id);
  if (parent) for (const s of card.subtasks) addSubtask(parent, s);
  reset();
  if (card.share || card.files.length) afterCreate(id, card);
  if (open) {
    input.blur();
    selectTask(id);
  }
}

/** Delen en bijlagen: pas als de taak op de server staat. Lukt dat nu niet (offline), dan een melding: doe het later in de taak. */
async function afterCreate(id, card) {
  await load();
  if (state.offline || state.pending) { toast(t('add.later_offline')); return; }
  if (card.share) await inviteToTask(id, card.share.who);
  if (card.files.length) await addFiles(id, card.files);
}
