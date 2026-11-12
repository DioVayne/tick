import CONFIG from './settings.js'; // eerst: taal en tijdzone
import { initAndroidApp, offerAppSync, startLocationBar } from './androidapp.js';
import { t } from './i18n.js';
import { closeTask, detailReady, flushPending, onManagerStart, openWhenSoon, selectTask } from './detail.js';
import { openListMenu } from './listmenu.js';
import { initComposer, refreshComposer } from './composer.js';
import { $, el, render, status, toast } from './render.js';
import { closeCalendar, hideCalendar, isCalendarOpen, openCalendar, refreshCalendar } from './calendarview.js';
import { closeSettings, hideSettings, isSettingsOpen, openSettings, paintMe } from './settingsview.js';
import { closeHelp, hideHelp, isHelpOpen, openHelp } from './help.js';
import { closeManager, hideManager, isManagerOpen, openManager, refreshManager } from './manager.js';
import { closeDrawer, onListContext, selectDone, selectList, selectTrash, setupSidebar } from './sidebar.js';
import { init, lists, load, on, refreshInvites, state } from './store.js';
import { parseHash } from './route.js';
import { normName } from './lists.js';
import { startBadge, updateBadge } from './badge.js';
import { startDriveMode } from './driveview.js';
import { startVerifyBar } from './verifybar.js';
import { onAgenda, startAgenda } from './agenda.js';

on('change', () => { render(); refreshCalendar(); updateBadge(); });
// Gekoppelde agenda's: ophalen bij het openen (en na een kwartier weg), en de kalender toont de afspraken.
onAgenda(refreshCalendar);
startAgenda();
startBadge(() => state.open, render);
on('error', toast);
setupSidebar();
onListContext(openListMenu);

// De invoerkaart bovenaan (titel, en na de eerste letter de tijdlijn met herinnering, plek, lijst en meer).
initComposer();
on('change', refreshComposer);
// Tickmanager: de pagina telt mee met elke wijziging (niet een lopende kaart, zie refreshManager).
on('change', refreshManager);
// De ronde +-knop (mobiel): naar het invoerveld bovenaan en daar typen. Focus meteen in de klik, anders geen toetsenbord op iOS.
$('#fab').addEventListener('click', () => {
  $('#add-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/**
 * Van de ene pagina (Instellingen, Kalender, Help, Tickmanager) naar een andere: de nieuwe neemt de stap van de oude
 * over, anders komt terug of een lijst kiezen weer op de oude pagina uit. Geeft terug of er een nieuwe stap moet komen.
 * @param {'settings' | 'calendar' | 'help' | 'manager'} key
 */
function pageStep(key) {
  const hs = history.state;
  if (!(hs?.settings || hs?.calendar || hs?.help || hs?.manager)) return true;
  if (!hs[key]) history.replaceState({ [key]: true }, '');
  return false;
}

// Instellingen: een eigen pagina in de middenkolom (meldingen, thema en uitloggen staan daar).
$('#btn-settings').addEventListener('click', () => { const push = pageStep('settings'); hideCalendar(); hideHelp(); hideManager(); openSettings({ push }); });
// Je naam bovenaan de zijbalk: opent Instellingen met het blok Account open.
paintMe(CONFIG.userName);
$('#btn-account').addEventListener('click', () => { const push = pageStep('settings'); hideCalendar(); hideHelp(); hideManager(); openSettings({ push, section: 'account' }); });
// Kalender: maandraster en agenda van taken met een datum.
$('#btn-calendar').addEventListener('click', () => {
  if (isCalendarOpen()) { closeDrawer(); return; }
  const push = pageStep('calendar');
  hideSettings();
  hideHelp();
  hideManager();
  openCalendar({ push });
});
// Help: wat de knoppen doen.
$('#btn-help').addEventListener('click', () => {
  if (isHelpOpen()) { closeDrawer(); return; }
  const push = pageStep('help');
  hideSettings();
  hideCalendar();
  hideManager();
  openHelp({ push });
});
// Tickmanager: de oranje knop (mobiel), het item onder Inbox in de zijbalk en Opruimen starten in het lege paneel.
// openManager verbergt de andere pagina's niet zelf (zoals help.js), dus dat eerst.
function showManager(start = false) {
  const push = pageStep('manager');
  hideSettings();
  hideCalendar();
  hideHelp();
  openManager({ push, start }); // al open: geen nieuwe stap in de geschiedenis
}
$('#mgr-fab').addEventListener('click', () => showManager());
$('#side-lists').addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('#btn-manager')) showManager();
});
onManagerStart(() => showManager(true));

// ---------- zoeken ----------
// Een vergrootglas in de kop; het zoekveld verschijnt pas bij gebruik (ook met /) en neemt dan de plek van de titel.
let searchTimer;
const search = /** @type {HTMLInputElement} */ ($('#search'));
function openSearch() {
  search.hidden = false;
  document.body.classList.add('search-open');
  $('#btn-search').setAttribute('aria-expanded', 'true');
  search.focus();
}
function closeSearch() {
  if (search.value) {
    search.value = '';
    search.dispatchEvent(new Event('input'));
  }
  search.hidden = true;
  document.body.classList.remove('search-open');
  $('#btn-search').setAttribute('aria-expanded', 'false');
}
$('#btn-search').addEventListener('click', () => {
  if (search.hidden) openSearch();
  else { closeSearch(); $('#btn-search').focus(); }
});
search.addEventListener('input', () => {
  state.query = search.value;
  clearTimeout(searchTimer);
  // Open taken filteren we direct; afgeronde zoekt de server, met een korte pauze na het typen (ook buiten Afgerond:
  // die treffers komen onder de open taken).
  if (!state.showDone) render();
  if (state.showDone || state.query.trim()) searchTimer = setTimeout(load, 250);
});
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation(); // niet ook het paneel sluiten
  if (search.value) {
    search.value = '';
    search.dispatchEvent(new Event('input'));
  } else { closeSearch(); $('#btn-search').focus(); }
});
// Leeg en weggeklikt: het veld klapt weer in. Niet als je op het vergrootglas klikt, dat sluit zelf.
search.addEventListener('blur', (e) => {
  if (!search.value && e.relatedTarget !== $('#btn-search')) closeSearch();
});
// / zoekt, N maakt een nieuwe taak (niet als je al in een veld typt).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.key !== '/' && e.key !== 'n' && e.key !== 'N') return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
  if (document.body.matches('.settings-open, .calendar-open, .help-open, .manager-open, .map-open')) return;
  e.preventDefault();
  if (e.key === '/') openSearch();
  else $('#add-title').focus();
});

// Het lijstmenu (hernoemen, verplaatsen, verwijderen) zit ook achter de titel van de lijst.
$('#title').addEventListener('click', (e) => {
  if (state.list && state.list !== 'Inbox') openListMenu(state.list, /** @type {HTMLElement} */ (e.currentTarget));
});

// ---------- start ----------
const params = new URLSearchParams(location.search);
initAndroidApp(params, { openDevices: () => openSettings() }); // haalt ?app en ?pair uit de adresbalk
const updateLocationBar = startLocationBar({ hasLocationTasks: () => state.open.some((t) => t.location), openDevices: () => openSettings() });
on('change', updateLocationBar);
startVerifyBar();
startDriveMode();
if (params.has('add')) $('#add-title').focus();
// Uit een uitnodigingsmelding: de balk met Accepteren en Weigeren in beeld.
const openShare = params.get('share');
const openListInvite = params.get('listInvite');
if (openShare || openListInvite) history.replaceState(null, '', '/');
// Uit de kop van een Android-widget met één lijst: meteen op die lijst.
const openList = params.get('list');
if (openList) {
  state.list = normName(openList);
  history.replaceState(null, '', '/');
}
const openTask = params.get('task');
if (openTask && params.get('geo') === '1') offerAppSync();
// Uit de melding "Botst met je agenda": meteen de herinneringskiezer van de taak.
if (openTask && params.get('when') === '1') openWhenSoon(openTask);
if (openTask) {
  state.selected = openTask;
  history.replaceState(null, '', '/');
  // Mobiel: het taakscherm als eigen stap, zodat terug naar de lijst gaat en niet de app uit.
  if (matchMedia('(max-width: 1023.98px)').matches) history.pushState({ task: openTask }, '');
}
// Een bladwijzer (#/list/…, #/task/…; zie route.js), als er geen ?list of ?task was. Herladen houdt de stap zoals hij
// was; een nieuw geopend adres krijgt een eerste stap zonder adres, zodat terug na een taak of pagina naar de lijst gaat.
let ready = false; // de lijsten zijn geladen (eerst lokaal, dan van de server)
let pendingList = /** @type {string | null} */ (null); // lijst-id uit het adres, nog niet bekend: na het laden opnieuw
const startRoute = openList || openTask ? null : parseHash(location.hash);
const reloaded = !!location.hash && history.state?.hash === location.hash;
if (startRoute && !reloaded) history.replaceState(null, '', location.pathname);
if (startRoute) goTo(startRoute, { push: !reloaded });
// Herladen op de instellingen (bijvoorbeeld na een taalwissel): daar weer verder.
if (history.state?.settings) openSettings({ push: false });
init(CONFIG.userId, CONFIG.userName).then(() => {
  detailReady();
  ready = true;
  if (pendingList) goTo({ page: 'list', id: pendingList });
  if (openTask) document.querySelector(`li.task[data-id="${CSS.escape(openTask)}"]`)?.scrollIntoView({ block: 'center' });
  if (openShare) document.querySelector(`.invite[data-id="${CSS.escape(openShare)}"]`)?.scrollIntoView({ block: 'center' });
  if (openListInvite) document.querySelector(`.invite[data-list-invite="${CSS.escape(openListInvite)}"]`)?.scrollIntoView({ block: 'center' });
});

// ---------- adres ----------

/**
 * Naar het scherm van een adres. push: taak of pagina als eigen stap in de geschiedenis (alleen bij het starten).
 * @param {import('./route.js').Route} route
 */
function goTo(route, { push = false } = {}) {
  pendingList = null;
  if (route.page !== 'settings') hideSettings();
  if (route.page !== 'calendar') hideCalendar();
  if (route.page !== 'help') hideHelp();
  if (route.page !== 'manager') hideManager();
  if (route.page !== 'task') selectTask(null, { push: false });
  if (route.page === 'all') selectList(null);
  else if (route.page === 'inbox') selectList('Inbox');
  else if (route.page === 'list') {
    const name = lists().find((l) => l.id === route.id)?.name;
    if (!name && !ready) pendingList = route.id;
    selectList(name ?? null); // weg of niet van jou: Alle
  } else if (route.page === 'done') selectDone();
  else if (route.page === 'trash') selectTrash();
  else if (route.page === 'calendar') openCalendar({ push });
  else if (route.page === 'settings') openSettings({ push });
  else if (route.page === 'help') openHelp({ push });
  else if (route.page === 'manager') openManager({ push }); // uitgezet: doet niets, de gewone lijst blijft
  else if (route.page === 'task') selectTask(route.id, { push });
}

// Afgerond en de prullenbak als eigen stap in de geschiedenis (zie de klik op #side hieronder).
let viewStep = false; // er staat een stap { view: true } voor Afgerond of de prullenbak
let viewFrom = /** @type {string | null} */ (null); // de lijst waar terug naartoe gaat
let leavingView = false; // de volgende popstate komt van onze eigen history.go bij het kiezen van een lijst
let afterPop = /** @type {(() => void) | null} */ (null); // wacht op de popstate van een pagina die net dichtging

// ---------- detailpaneel ----------
// Terug (ook de Android-terugknop) sluit het taakscherm; vooruit opent de taak weer.
// De instellingen hebben ook een eigen history-item: terug sluit ze, vooruit opent ze weer (zonder de taak te raken).
window.addEventListener('popstate', (e) => {
  // De kaart en een kiezer-sheet hebben een eigen history-item (zie backCloses in popover.js); die stap is van hen.
  if (document.body.classList.contains('map-open') || document.body.classList.contains('sheet-open')) return;
  // Een pagina ging dicht door een klik in de zijbalk; nu de stap van Afgerond of de prullenbak (zie hieronder).
  if (afterPop) {
    const run = afterPop;
    afterPop = null;
    hideSettings(); hideCalendar(); hideHelp(); hideManager(); // hun close-functie liet het verbergen aan deze popstate
    run();
    return;
  }
  if (leavingView) { leavingView = false; render(); return; } // van Afgerond of de prullenbak naar een lijst gekozen
  // Een bladwijzer of getypt adres in de open app: een nieuwe stap met een adres dat render.js niet schreef.
  const route = location.hash && e.state?.hash !== location.hash ? parseHash(location.hash) : null;
  if (route) { viewStep = false; goTo(route); return; }
  // Terug vanuit Afgerond of de prullenbak: naar de lijst waar je vandaan kwam.
  if (viewStep && !e.state?.view && !e.state?.task) {
    viewStep = false;
    hideSettings(); hideCalendar(); hideHelp(); hideManager();
    selectTask(null, { push: false });
    selectList(viewFrom === 'Inbox' || lists().some((l) => l.name === viewFrom) ? viewFrom : null);
    return;
  }
  if (e.state?.settings) { hideCalendar(); hideHelp(); hideManager(); openSettings({ push: false }); return; }
  if (e.state?.help) {
    hideSettings();
    hideCalendar();
    hideManager();
    if (!isHelpOpen()) openHelp({ push: false });
    selectTask(null, { push: false });
    return;
  }
  if (e.state?.manager) {
    hideSettings();
    hideCalendar();
    hideHelp();
    if (!isManagerOpen()) openManager({ push: false });
    selectTask(null, { push: false });
    return;
  }
  if (e.state?.calendar) {
    hideSettings();
    hideHelp();
    hideManager();
    if (!isCalendarOpen()) openCalendar({ push: false });
    selectTask(null, { push: false }); // terug vanuit een taak die over de kalender lag
    return;
  }
  if (isSettingsOpen()) { hideSettings(); return; }
  if (isHelpOpen()) { hideHelp(); return; }
  if (isManagerOpen()) { hideManager(); return; }
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
  const b = e.target.closest('button[data-list], #btn-done, #btn-trash');
  if (!b) return;
  // Een open pagina met een eigen stap gaat hieronder met terug dicht; wat de weergave met de geschiedenis doet, wacht daarop.
  const hs = history.state;
  const popping = !!(hs?.settings || hs?.calendar || hs?.help || hs?.manager);
  if (isSettingsOpen()) closeSettings();
  if (isCalendarOpen()) closeCalendar();
  if (isHelpOpen()) closeHelp();
  if (isManagerOpen()) closeManager();
  const toView = b.id === 'btn-trash' || b.id === 'btn-done';
  // Afgerond en de prullenbak zijn een eigen stap: terug (ook de Android-terugknop) gaat naar de lijst ervoor, niet de app uit.
  if (toView && !viewStep) {
    viewFrom = state.list;
    viewStep = true;
    const onTask = !popping && !!history.state?.task; // mobiel taakscherm: die stap wordt de stap van de weergave
    if (state.selected) selectTask(null, { push: false });
    const push = () => { history.pushState({ view: true }, ''); render(); };
    if (popping) afterPop = push;
    else if (onTask) history.replaceState({ view: true }, '');
    else push();
    return;
  }
  if (!toView && viewStep) {
    viewStep = false;
    if (state.selected) selectTask(null, { push: false });
    const steps = !popping && history.state?.task ? 2 : 1;
    const leave = () => { leavingView = true; history.go(-steps); };
    if (popping) afterPop = leave;
    else leave();
    return;
  }
  const other = b.id === 'btn-trash' || (b.id === 'btn-done' ? !state.showDone : state.showDone || (b.dataset.list || null) !== state.list);
  if (state.selected && other) closeTask();
}, true);
$('#newlist-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  if (isSettingsOpen()) closeSettings();
  if (isCalendarOpen()) closeCalendar();
  if (isHelpOpen()) closeHelp();
  if (isManagerOpen()) closeManager();
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
// Na Klaar, Morgen of Snooze in een melding: de taak is op de server gewijzigd, dus opnieuw laden.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'refresh') return load();
  if (e.data?.type !== 'open-task' || !e.data.id) return;
  if (e.data.geo) offerAppSync();
  if (isSettingsOpen()) hideSettings();
  hideCalendar();
  hideHelp();
  hideManager();
  if (e.data.when) openWhenSoon(e.data.id);
  selectTask(e.data.id);
  document.querySelector(`li.task[data-id="${CSS.escape(e.data.id)}"]`)?.scrollIntoView({ block: 'center' });
});

// Wachtende wijzigingen versturen zodra het weer kan.
// Verborgen: getypte tekst meteen opslaan, de app kan zo worden afgesloten.
// Terug in Tick: opnieuw laden. Ook bij focus, want een venster dat naast een ander al zichtbaar was, krijgt geen
// visibilitychange. Komen beide kort na elkaar (tabblad terug), dan één ronde.
let lastWake = 0;
const wake = () => {
  if (document.hidden || Date.now() - lastWake < 3000) return;
  lastWake = Date.now();
  load();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); else wake(); });
window.addEventListener('focus', wake);
// Zolang Tick zichtbaar open staat: elke twee minuten alleen de uitnodigingen ophalen (twee lichte verzoeken), zodat
// een nieuwe deeluitnodiging ook zonder pushmelding verschijnt.
const INVITE_POLL_MS = 2 * 60 * 1000;
setInterval(() => { if (!document.hidden && navigator.onLine) refreshInvites(); }, INVITE_POLL_MS);
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
