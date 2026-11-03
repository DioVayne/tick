// Rijmodus op het scherm: kijkt naar je locatie zolang Tick open is (nooit naar de server), en als je rijdt een balk
// bovenin, de taken van vandaag en vlakbij groot, en alles groter (data-drive op <html>, zie style.css).
// Alleen met de instelling aan (CONFIG.driveMode, per account) en als Tick je locatie al mag gebruiken: geen vraag om
// toestemming uit het niets; die komt alleen als je de rijmodus in de instellingen aanzet.
import { request } from './api.js';
import { selectTask } from './detail.js';
import { startOfDay } from './calendar.js';
import { createDetector, driveTasks, snoozeValid } from './drive.js';
import { dateLocale, t } from './i18n.js';
import { icon } from './icons.js';
import { $, checkOff, el, fmt, toast } from './render.js';
import { zonedParts } from './repeat.js';
import CONFIG from './settings.js';
import { on, state } from './store.js';

const SNOOZE_KEY = 'tick.driveSnooze';
const TICK_MS = 15_000;
/** Zo lang (ms) zichtbaar kijken zonder één locatie, en Tick zegt dat de rijmodus zo niet kan werken. */
const NO_FIX_MS = 60_000;

const S = {
  detector: createDetector(),
  watch: /** @type {number | null} */ (null),
  timer: /** @type {any} */ (null),
  pos: /** @type {{ lat: number, lng: number } | null} */ (null),
  allowed: false, // Tick mag je locatie gebruiken
  snoozed: false,
  watchedSince: 0, // sinds wanneer Tick zichtbaar kijkt (0: niet)
  gotFix: false, // er kwam deze keer al een locatie binnen
  warned: false, // de melding "geen locatie" is al getoond
};

const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storeSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* geen opslag */ } };

const active = () => CONFIG.driveMode !== false && S.detector.driving && !S.snoozed;

// ---------- locatie ----------

function onFix(p) {
  const { latitude: lat, longitude: lng, accuracy, speed } = p.coords;
  S.gotFix = true;
  if (accuracy <= 100) S.pos = { lat, lng };
  const changed = S.detector.update({ lat, lng, accuracy, speed, at: p.timestamp || Date.now() });
  if (S.snoozed && S.detector.driving) storeSet(SNOOZE_KEY, String(Date.now()));
  if (changed) stateChanged();
  else if (active()) paint(); // vlakbij verandert onderweg
}

function startWatch() {
  if (S.watch !== null || !S.allowed || CONFIG.driveMode === false || document.hidden || !navigator.geolocation) return;
  S.watch = navigator.geolocation.watchPosition(onFix, () => null, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60_000 });
  S.watchedSince = Date.now();
  // Stilstaan geeft vaak geen nieuwe locatie: zo merkt de detector toch dat de rit voorbij is.
  S.timer = setInterval(() => {
    if (S.detector.tick(Date.now())) stateChanged();
    checkNoFix();
  }, TICK_MS);
}

function stopWatch() {
  if (S.watch !== null) navigator.geolocation.clearWatch(S.watch);
  clearInterval(S.timer);
  S.watch = null;
  S.watchedSince = 0;
}

/**
 * Toestemming wel, maar nooit een locatie (zo ging het in een oude Android-app zonder locatie-doorgifte): één keer
 * zeggen, want anders lijkt de rijmodus stuk terwijl hij niets kan zien.
 */
function checkNoFix() {
  if (S.gotFix || S.warned || !S.watchedSince || Date.now() - S.watchedSince < NO_FIX_MS) return;
  S.warned = true;
  toast(t('drive.no_fix'), undefined, { label: t('drive.no_fix_ok'), run: () => null, ms: 15_000 });
}

function stateChanged() {
  if (S.detector.driving) {
    S.snoozed = snoozeValid(Number(storeGet(SNOOZE_KEY)), Date.now());
  } else {
    S.snoozed = false;
    storeSet(SNOOZE_KEY, null);
  }
  apply();
}

// ---------- scherm ----------

function apply() {
  const on = active();
  const root = document.documentElement;
  if (on) root.dataset.drive = '';
  else delete root.dataset.drive;
  for (const id of ['#drive-bar', '#drive']) {
    $(id).hidden = !on;
    if (!on) $(id).replaceChildren();
  }
  if (on) paint();
}

function taskRow(task, meta) {
  return el('li', { class: 'drive-task' },
    el('button', { type: 'button', class: 'drive-check', 'aria-label': t('drive.check', { title: task.title }), onclick: () => checkOff(task) }),
    el('button', { type: 'button', class: 'drive-title', onclick: () => selectTask(task.id) },
      el('span', {}, task.title), meta ? el('span', { class: 'drive-meta' }, meta) : null));
}

function section(title, tasks, meta) {
  if (!tasks.length) return null;
  return el('section', { class: 'drive-sec', 'aria-label': title },
    el('h2', {}, title), el('ul', {}, ...tasks.map((x) => taskRow(x, meta(x)))));
}

/** Tijd van vandaag; te laat met de datum erbij (fmt). */
function when(iso) {
  const p = zonedParts(Date.now());
  if (Date.parse(iso) < startOfDay(p.y, p.m, p.d)) return fmt(iso);
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.timeZone }).format(new Date(iso));
}

function paint() {
  const { near, today, rest } = driveTasks(state.open, Date.now(), S.pos);
  $('#drive-bar').replaceChildren(
    el('p', {}, icon('car'), ' ', t('drive.detected')),
    el('div', { class: 'drive-actions' },
      el('button', { type: 'button', class: 'ghost', onclick: notNow }, t('drive.not_now')),
      el('button', { type: 'button', class: 'ghost', onclick: never }, t('drive.never'))));
  $('#drive').replaceChildren(...[
    section(t('drive.near'), near, (x) => x.location.name),
    section(t('drive.today'), today, (x) => when(x.remind_at)),
    !near.length && !today.length ? el('p', { class: 'drive-empty' }, t('drive.empty')) : null,
    rest > 0 ? el('p', { class: 'drive-rest' }, t('drive.rest', { n: String(rest) })) : null,
    el('button', { type: 'button', class: 'drive-add', onclick: addTask }, icon('plus'), ' ', t('drive.add')),
  ].filter(Boolean));
}

/** Naar het invoerveld bovenaan (in de rijmodus ook groot); met Details kom je bij alle opties. */
function addTask() {
  $('#add-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#main').scrollTo?.({ top: 0, behavior: 'smooth' });
}

/** Voor deze rit uit; bij de volgende rit komt hij terug. */
function notNow() {
  S.snoozed = true;
  storeSet(SNOOZE_KEY, String(Date.now()));
  apply();
}

/** De hele functie uit, voor dit account (weer aan in de instellingen). */
async function never() {
  notNow();
  try {
    await request('PATCH', '/api/settings', { driveMode: false });
    setDriveMode(false);
    toast(t('drive.off_done'), 'ok');
  } catch (e) {
    toast(t('drive.off_failed', { reason: e.message }));
  }
}

// ---------- aan en uit ----------

/**
 * Na een wijziging in de instellingen. Aanzetten vraagt zo nodig om je locatie (dit is de enige plek waar dat
 * gebeurt); geeft false als Tick hem niet mag gebruiken.
 * @param {boolean} enabled
 */
export async function setDriveMode(enabled) {
  CONFIG.driveMode = enabled;
  if (!enabled) { stopWatch(); apply(); return true; }
  if (!S.allowed && navigator.geolocation) {
    S.allowed = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve(true), (e) => resolve(e.code !== e.PERMISSION_DENIED), { timeout: 30_000 }));
  }
  startWatch();
  return S.allowed;
}

/** Bij het starten van de app: kijken zolang Tick zichtbaar is, als de locatie al mag. */
export async function startDriveMode() {
  on('change', () => { if (active()) paint(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopWatch(); else startWatch(); });
  let perm = null;
  try { perm = await navigator.permissions.query({ name: 'geolocation' }); } catch { /* geen Permissions API: niet vanzelf */ }
  S.allowed = perm?.state === 'granted';
  startWatch();
  perm?.addEventListener('change', () => {
    S.allowed = perm.state === 'granted';
    if (S.allowed) { startWatch(); return; }
    stopWatch();
    S.detector = createDetector();
    apply();
  });
}
