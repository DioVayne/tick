// Tick draait in de Android-app (een Trusted Web Activity die /?app=android opent). Hier: koppelen met de app via een
// eenmalige code in een intent-link (ook vanuit de browser op de telefoon), web push aanzetten en dubbele meldingen
// signaleren.
import { request } from './api.js';
import { OFFICIAL_PACKAGE, RELEASES_URL, packageFromReferrer, pairIntent, pushAction, settingsIntent, startPushAction } from './applink.js';
import { t } from './i18n.js';
import { enablePush, pushState, pushTurnedOff } from './push.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';

const APP_KEY = 'tick.app';
const DUP_KEY = 'tick.dupHint';
const PKG_KEY = 'tick.appPkg';
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

function bar(text, label, onClick) {
  const b = el('div', { class: 'appbar', role: 'status' }, el('span', {}, text), el('button', { type: 'button', onclick: onClick }, label));
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
  const notice = bar(t('app.pair_hint'), t('app.pair_button'), () => { location.href = intent; });
  try {
    if (await waitForPair(id, expires)) { await enableAppPush(); await hintDuplicates(openDevices); return; }
    toast(t('app.pair_failed'));
  } finally {
    notice.remove();
  }
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
