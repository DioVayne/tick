// Tick draait in de Android-app (een Trusted Web Activity die /?app=android opent). Hier: koppelen met de app via een
// eenmalige code in een intent-link (ook vanuit de browser op de telefoon), web push aanzetten en dubbele meldingen
// signaleren.
import { request } from './api.js';
import { OFFICIAL_PACKAGE, RELEASES_URL, locationProblems, packageFromReferrer, pairIntent, problemKey, pushAction, settingsIntent, showLocationBar, startPushAction } from './applink.js';
import { t } from './i18n.js';
import { enablePush, pushState, pushTurnedOff } from './push.js';
import { wakeAndroidApp } from './places.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';

const APP_KEY = 'tick.app';
const DUP_KEY = 'tick.dupHint';
const PKG_KEY = 'tick.appPkg';
const LOC_KEY = 'tick.locBarDismissed';
const POLL_MS = 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const PUSH_WAIT_MS = 60 * 1000;

/** Draait deze pagina in de Android-app? Onthouden per sessie, ook als de adresbalk al is opgeschoond. */
export function isInApp() {
  try { return sessionStorage.getItem(APP_KEY) === 'android'; } catch { return false; }
}

/**
 * Het package van de Android-app op deze telefoon: zoals gezien bij de laatste start in de app (de TWA deelt
 * localStorage met Chrome, dus de browser weet het ook), anders ANDROID_PACKAGE van een eigen build, anders null.
 */
export function knownAppPackage() {
  try {
    const pkg = localStorage.getItem(PKG_KEY);
    if (pkg) return pkg;
  } catch { /* geen opslag */ }
  return CONFIG.androidPackage || null;
}

/** Het package om een intent naar te sturen; zonder bekende app de officiële. */
const appPackage = () => knownAppPackage() ?? OFFICIAL_PACKAGE;

/** Opent de instellingen van de app (meldingen, locatie). */
export function openPhoneSettings() {
  location.href = settingsIntent(appPackage());
}

/**
 * Leest ?app=android en ?pair=1 uit de adresbalk, haalt ze eruit en start zo nodig het koppelen.
 * @param {URLSearchParams} params
 * @param {{ openDevices?: () => void }} [hooks] openDevices: opent Instellingen › Apparaten
 */
export function initAndroidApp(params, { openDevices } = {}) {
  // Een TWA-start (ook vanuit een melding, zonder ?app=android) heeft android-app:// als referrer.
  if (params.get('app') === 'android' || document.referrer.startsWith('android-app://')) {
    try { sessionStorage.setItem(APP_KEY, 'android'); } catch { /* geen opslag */ }
  }
  // Welke app (officieel of een eigen build): alleen bij onze eigen start-URL, niet bij een link uit een andere app.
  const pkg = params.get('app') === 'android' ? packageFromReferrer(document.referrer) : null;
  if (pkg) {
    try { localStorage.setItem(PKG_KEY, pkg); } catch { /* geen opslag */ }
  }
  const pair = params.get('pair') === '1';
  if (params.has('app') || params.has('pair')) {
    const url = new URL(location.href);
    url.searchParams.delete('app');
    url.searchParams.delete('pair');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  if (!isInApp()) return;
  if (pair) pairApp(appPackage(), openDevices).catch(() => { /* de knop in Instellingen blijft de terugvalroute */ });
  else {
    // Al gekoppeld (ook na een update van de app): meldingen aanzetten als de app toestemming heeft en ze nog uit staan.
    startAppPush().catch(() => { /* de schakelaar in Instellingen blijft over */ });
    hintDuplicates(openDevices).catch(() => { /* alleen een tip */ });
  }
}

/** Zet web push aan bij een gewone start in de app, zonder te wachten; zie startPushAction. */
async function startAppPush() {
  const reg = await Promise.race([navigator.serviceWorker?.ready, sleep(5000).then(() => null)]) ?? null;
  if (!reg) return;
  const { supported, permission, subscribed } = await pushState(reg);
  if (supported && startPushAction(permission, subscribed, pushTurnedOff()) === 'subscribe') await enablePush(reg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bar(text, label, onClick, kind = '') {
  const b = el('div', { class: `appbar ${kind}`.trim(), role: 'status' }, el('span', {}, text), el('button', { type: 'button', onclick: onClick }, label));
  document.body.append(b);
  return b;
}

/**
 * Koppelen gaat via een knop, nooit vanzelf: Chrome ziet een intent zonder tik als redirect van de vorige
 * navigatie en zet na het openen van de app de geschiedenis terug van vóór die keten. Na het inloggen
 * (loginpagina → / → intent) stond je dan weer op de loginpagina.
 */
async function pairApp(pkg, openDevices) {
  const { id, code, expires_at: expires } = await request('POST', '/api/pair');
  const intent = pairIntent(pkg, code, location.origin);
  const notice = bar(t('app.pair_hint'), t('app.pair_button'), () => { location.href = intent; }, 'pair');
  let used;
  try {
    used = await waitForPair(id, expires);
  } finally {
    // Meteen weg zodra de app gekoppeld is; niet pas na het wachten op de meldingstoestemming.
    notice.remove();
  }
  if (!used) { toast(t('app.pair_failed')); return; }
  await enableAppPush();
  await hintDuplicates(openDevices);
}

/**
 * Vanuit de browser op een Android-telefoon (Instellingen › Apparaten): geeft de Tick-app het adres van deze Tick en
 * een koppelcode in één link. Zonder app opent Chrome de downloadpagina. Alleen na een tik op een knop: dan mag de
 * navigatie naar het intent meteen.
 * @param {() => void} [onDone] na het koppelen, bijvoorbeeld de lijst met apparaten opnieuw tonen
 */
export async function connectApp(onDone) {
  const { id, code, expires_at: expires } = await request('POST', '/api/pair');
  location.href = pairIntent(appPackage(), code, location.origin, RELEASES_URL);
  if (await waitForPair(id, expires)) {
    toast(t('app.connected'));
    onDone?.();
  }
}

/** Peilt tot de app de code heeft ingewisseld (true) of tot hij verloopt (false). */
async function waitForPair(id, expires) {
  const deadline = Math.min(Date.parse(expires) || Infinity, Date.now() + CODE_TTL_MS);
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      if ((await request('GET', `/api/pair/${id}`)).used) return true;
    } catch { /* offline of 404: blijven peilen tot het verloopt */ }
  }
  return false;
}

/**
 * Zet web push aan in deze (app-)browser. De app vraagt zelf om de meldingstoestemming; wij vragen niet, maar wachten
 * (max. 60 s) tot hij gegeven is. Fouten slikken we in, de schakelaar in Instellingen blijft over.
 */
async function enableAppPush() {
  try {
    const reg = await Promise.race([navigator.serviceWorker?.ready, sleep(5000).then(() => null)]) ?? null;
    if (!reg) return;
    const subscribed = (await pushState(reg)).subscribed;
    let action = pushAction(Notification.permission, subscribed);
    if (action === 'wait') {
      const until = Date.now() + PUSH_WAIT_MS;
      let wake = () => {};
      const onWake = () => { if (document.visibilityState !== 'hidden') wake(); };
      document.addEventListener('visibilitychange', onWake);
      window.addEventListener('focus', onWake);
      try {
        while (action === 'wait' && Date.now() < until) {
          await Promise.race([sleep(POLL_MS), new Promise((r) => { wake = r; })]);
          action = pushAction(Notification.permission, subscribed);
        }
      } finally {
        document.removeEventListener('visibilitychange', onWake);
        window.removeEventListener('focus', onWake);
      }
    }
    if (action === 'subscribe') await enablePush(reg);
  } catch { /* zie boven */ }
}

/** Heeft een tweede Android-browser ook meldingen aan, dan krijg je ze dubbel: eenmalig een tip. */
async function hintDuplicates(openDevices) {
  try { if (localStorage.getItem(DUP_KEY)) return; } catch { return; }
  const { browsers } = await request('GET', '/api/devices');
  if (browsers.filter((b) => /Android/i.test(b.user_agent ?? '')).length < 2) return;
  try { localStorage.setItem(DUP_KEY, '1'); } catch { /* geen opslag: dan nog eenmaal per sessie */ }
  const b = bar(t('app.duplicate_hint'), t('app.duplicate_open'), () => { b.remove(); openDevices?.(); });
}

/**
 * Balk bovenin de lijst als locatiemeldingen op een gekoppelde telefoon niet werken (geen locatie "altijd" of
 * meldingen uit). Wegklikken kan; bij een andere status of na een paar dagen komt hij terug.
 * Peilt bij de start en elke keer dat Tick weer in beeld komt (bijvoorbeeld terug uit de telefooninstellingen).
 * @param {{ hasLocationTasks: () => boolean, openDevices?: () => void }} opts
 * @returns {() => void} opnieuw beoordelen, zonder op te halen (na een wijziging in de taken)
 */
export function startLocationBar({ hasLocationTasks, openDevices }) {
  let problems = [];
  let fetchedAt = 0;
  /** @type {HTMLElement | null} */
  let node = null;
  let shown = '';

  const dismissed = () => {
    try { return JSON.parse(localStorage.getItem(LOC_KEY) ?? 'null'); } catch { return null; }
  };
  const update = () => {
    const show = showLocationBar({ problems, inApp: isInApp(), hasLocationTasks: hasLocationTasks(), dismissed: dismissed(), now: Date.now() });
    const key = show ? JSON.stringify(problems) : '';
    if (key === shown) return; // ongewijzigd: niet opnieuw opbouwen (een knop houdt zijn focus)
    shown = key;
    node?.remove();
    node = show ? locationBar(problems) : null;
    if (node) document.getElementById('net')?.after(node);
  };
  const locationBar = (list) => {
    const names = [...new Set(list.map((p) => p.status.name || p.name || t('set.phone_install')))].join(', ');
    const noLoc = list.some((p) => p.status.location !== 'always');
    const noNotif = list.some((p) => !p.status.notifications);
    const why = noLoc && noNotif ? t('locbar.why_both') : noLoc ? t('locbar.why_location') : t('locbar.why_notifications');
    const fix = () => {
      if (isInApp()) openPhoneSettings();
      else openDevices?.();
    };
    const hide = () => {
      try { localStorage.setItem(LOC_KEY, JSON.stringify({ key: problemKey(problems), at: Date.now() })); } catch { /* geen opslag: alleen nu weg */ }
      node?.remove();
      node = null;
      shown = '';
    };
    return el('div', { class: 'locbar', role: 'alert' },
      el('p', {}, el('strong', {}, t('locbar.title', { phone: names })), ' ', why),
      el('div', { class: 'locbar-actions' },
        el('button', { type: 'button', class: 'small', onclick: fix }, t('locbar.fix')),
        el('button', { type: 'button', class: 'small ghost', onclick: hide }, t('locbar.hide'))));
  };
  const refresh = async () => {
    if (Date.now() - fetchedAt < 5000) return;
    fetchedAt = Date.now();
    try {
      problems = locationProblems((await request('GET', '/api/devices')).phones);
      update();
    } catch { /* offline: de laatst bekende stand blijft staan */ }
  };
  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refresh();
    // Terug uit de instellingen van de app: die meldt de nieuwe status pas na een sync, dus even later nog eens.
    setTimeout(refresh, 8000);
  });
  return update;
}

/**
 * Een ander zette een plek op een gedeelde taak (melding met geo=1). De Android-app hoort dat anders pas bij zijn
 * volgende verversing; met een tik (een intent zonder tik ziet Chrome als redirect) wekken we hem nu.
 */
export function offerAppSync() {
  // Niet alleen isInApp(): een tik op een melding opent een nieuw venster zonder ?app=android. Zonder app opent de
  // fallback gewoon Tick.
  if (!/Android/i.test(navigator.userAgent) || !knownAppPackage() || document.querySelector('.appbar.geo')) return;
  const b = bar(t('geo.wake_hint'), t('geo.wake_button'), () => { b.remove(); wakeAndroidApp(null); });
  b.classList.add('geo');
  setTimeout(() => b.remove(), 60_000);
}
