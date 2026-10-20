import CONFIG from './settings.js'; // eerst: taal en tijdzone
import { initAndroidApp, offerAppSync, startLocationBar } from './androidapp.js';
import { t } from './i18n.js';
import { closeTask, detailReady, flushPending, selectTask } from './detail.js';
import { openListMenu } from './listmenu.js';
import { $, el, fromLocalInput, prefillOnOpen, render, status, toast } from './render.js';
import { closeCalendar, hideCalendar, isCalendarOpen, openCalendar, refreshCalendar } from './calendarview.js';
import { closeSettings, hideSettings, isSettingsOpen, openSettings } from './settingsview.js';
import { closeDrawer, onListContext, setupSidebar } from './sidebar.js';
import { addTask, init, load, on, state } from './store.js';

on('change', () => { render(); refreshCalendar(); });
on('error', toast);
setupSidebar();
onListContext(openListMenu);

prefillOnOpen($('#add-remind'));
$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#add-title').value.trim();
  if (!title) return;
  addTask(title, fromLocalInput($('#add-remind').value), (!state.showDone && !state.showTrash && state.list) || 'Inbox');
  $('#add-title').value = '';
  $('#add-remind').value = '';
});

// Instellingen: een eigen pagina in de middenkolom (meldingen, thema en uitloggen staan daar).
$('#btn-settings').addEventListener('click', () => { hideCalendar(); openSettings({ push: true }); });
// Kalender: maandraster en agenda van taken met een datum.
$('#btn-calendar').addEventListener('click', () => {
  if (isCalendarOpen()) { closeDrawer(); return; }
  hideSettings();
  openCalendar({ push: true });
});

// ---------- zoeken ----------
let searchTimer;
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  clearTimeout(searchTimer);
  // Open taken filteren we direct; in afgerond zoekt de server, met een korte pauze na het typen.
  if (state.showDone) searchTimer = setTimeout(load, 250);
  else render();
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.value) {
    e.target.value = '';
    e.target.dispatchEvent(new Event('input'));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  $('#search').focus();
});

// ---------- start ----------
const params = new URLSearchParams(location.search);
initAndroidApp(params, { openDevices: () => openSettings() }); // haalt ?app en ?pair uit de adresbalk
const updateLocationBar = startLocationBar({ hasLocationTasks: () => state.open.some((t) => t.location), openDevices: () => openSettings() });
on('change', updateLocationBar);
if (params.has('add')) $('#add-title').focus();
// Uit een uitnodigingsmelding: de balk met Accepteren en Weigeren in beeld.
const openShare = params.get('share');
if (openShare) history.replaceState(null, '', '/');
const openTask = params.get('task');
if (openTask && params.get('geo') === '1') offerAppSync();
if (openTask) {
  state.selected = openTask;
  history.replaceState(null, '', '/');
  // Mobiel: het taakscherm als eigen stap, zodat terug naar de lijst gaat en niet de app uit.
  if (matchMedia('(max-width: 1023.98px)').matches) history.pushState({ task: openTask }, '');
}
// Herladen op de instellingen (bijvoorbeeld na een taalwissel): daar weer verder.
if (history.state?.settings) openSettings({ push: false });
init(CONFIG.userId).then(() => {
  detailReady();
  if (openTask) document.querySelector(`li.task[data-id="${CSS.escape(openTask)}"]`)?.scrollIntoView({ block: 'center' });
  if (openShare) document.querySelector(`.invite[data-id="${CSS.escape(openShare)}"]`)?.scrollIntoView({ block: 'center' });
});

// ---------- detailpaneel ----------
// Terug (ook de Android-terugknop) sluit het taakscherm; vooruit opent de taak weer.
// De kaart heeft een eigen history-item; die popstate is van de kaart (deze listener loopt vóór die van de kaart).
// De instellingen hebben ook een eigen history-item: terug sluit ze, vooruit opent ze weer (zonder de taak te raken).
window.addEventListener('popstate', (e) => {
  if (document.body.classList.contains('map-open')) return;
  if (e.state?.settings) { hideCalendar(); openSettings({ push: false }); return; }
  if (e.state?.calendar) {
    hideSettings();
    if (!isCalendarOpen()) openCalendar({ push: false });
    selectTask(null, { push: false }); // terug vanuit een taak die over de kalender lag
    return;
  }
  if (isSettingsOpen()) { hideSettings(); return; }
  if (isCalendarOpen() && !e.state?.task) { hideCalendar(); return; }
  selectTask(e.state?.task ?? null, { push: false });
});

// Esc buiten een veld sluit het paneel; in een veld hoort Esc bij dat veld.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state.selected) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (document.body.classList.contains('map-open')) return;
  closeTask();
});

// Een andere lijst (of Afgerond) kiezen sluit het paneel en de instellingen. Capture: vóór de zijbalk zelf rendert.
$('#side').addEventListener('click', (e) => {
  if (!(e.target instanceof Element)) return;
  if (isSettingsOpen() && e.target.closest('button[data-list], #btn-done, #btn-trash')) closeSettings();
  if (isCalendarOpen() && e.target.closest('button[data-list], #btn-done, #btn-trash')) closeCalendar();
  if (!state.selected) return;
  const b = e.target.closest('button[data-list], #btn-done, #btn-trash');
  if (!b) return;
  const other = b.id === 'btn-trash' || (b.id === 'btn-done' ? !state.showDone : state.showDone || (b.dataset.list || null) !== state.list);
  if (other) closeTask();
}, true);
$('#newlist-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  if (isSettingsOpen()) closeSettings();
  if (isCalendarOpen()) closeCalendar();
  if (state.selected) closeTask();
}, true);

// De breedte van het paneel versleep je met de streep ertussen; hij blijft per apparaat bewaard.
(() => {
  const KEY = 'tick.panelWidth';
  const app = $('#app');
  const resizer = $('#resizer');
  const clamp = (w) => Math.min(700, Math.max(300, Math.round(w)));
  let width = 380;
  const apply = (w) => { width = clamp(w); app.style.setProperty('--panel-w', width + 'px'); };
  try { const saved = Number(localStorage.getItem(KEY)); if (saved) apply(saved); } catch { /* geen opslag */ }
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    apply(app.getBoundingClientRect().right - e.clientX - resizer.offsetWidth / 2);
  });
  const end = () => {
    if (!document.body.classList.contains('resizing')) return;
    document.body.classList.remove('resizing');
    try { localStorage.setItem(KEY, String(width)); } catch { /* geen opslag */ }
  };
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);
  resizer.addEventListener('lostpointercapture', end);
})();

// De service worker cachet de app voor offline gebruik en ontvangt pushmeldingen.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => null);
// Een tik op een melding terwijl Tick al open is: de service worker vraagt ons de taak te tonen.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'open-task' || !e.data.id) return;
  if (e.data.geo) offerAppSync();
  if (isSettingsOpen()) hideSettings();
  hideCalendar();
  selectTask(e.data.id);
  document.querySelector(`li.task[data-id="${CSS.escape(e.data.id)}"]`)?.scrollIntoView({ block: 'center' });
});

// Wachtende wijzigingen versturen zodra het weer kan.
// Verborgen: getypte tekst meteen opslaan, de app kan zo worden afgesloten.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); else load(); });
window.addEventListener('pagehide', flushPending);
window.addEventListener('online', () => load());

// ---------- pull to refresh ----------
(() => {
  const THRESHOLD = 70;
  const ind = el('div', { class: 'ptr', 'aria-hidden': 'true' }, '↓');
  document.body.append(ind);
  let startY = null, startX = 0, pull = 0, busy = false;

  const reset = () => {
    startY = null; pull = 0;
    ind.style.transition = '';
    ind.style.transform = 'translate(-50%, -60px)';
    ind.classList.remove('ready');
  };
  reset();

  document.addEventListener('touchstart', (e) => {
    // Alleen vanaf de bovenkant, en niet tijdens het slepen van een taak, in een invoerveld, op de kaart of in de taak.
    // Op brede schermen scrolt #main zelf (window.scrollY blijft 0); zijbalk en detailpaneel scrollen apart.
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || $('#main').scrollTop > 0) return;
    if (e.target.closest('input, textarea, select, .sortable-chosen, .mapscreen, #detail, #side')) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || Math.abs(e.touches[0].clientX - startX) > dy || window.scrollY > 0 || $('#main').scrollTop > 0 || document.querySelector('.sortable-chosen')) { reset(); return; }
    pull = Math.min(dy * 0.5, 100);
    ind.style.transition = 'none';
    ind.style.transform = `translate(-50%, ${pull - 60}px)`;
    ind.classList.toggle('ready', pull >= THRESHOLD);
    ind.textContent = pull >= THRESHOLD ? '↻' : '↓';
  }, { passive: true });

  const offlineMsg = () => status(t('app.offline_refresh'));

  const end = async () => {
    if (startY === null) return;
    const go = pull >= THRESHOLD;
    reset();
    if (!go) return;
    if (navigator.onLine === false) { offlineMsg(); return; }
    busy = true;
    ind.style.transition = 'transform .2s';
    ind.style.transform = 'translate(-50%, 10px)';
    ind.textContent = '↻';
    ind.classList.add('spin');
    await load();
    if (state.offline) offlineMsg(); else status('');
    ind.classList.remove('spin');
    busy = false;
    reset();
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', reset);
})();
