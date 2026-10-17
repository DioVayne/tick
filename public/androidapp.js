// Tick draait in de Android-app (een Trusted Web Activity die /?app=android opent). Hier: koppelen met de app via een
// eenmalige code in een intent-link, web push aanzetten en dubbele meldingen signaleren.
import { request } from './api.js';
import { pairIntent, settingsIntent } from './applink.js';
import { t } from './i18n.js';
import { enablePush, pushState } from './push.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';

const APP_KEY = 'tick.app';
const DUP_KEY = 'tick.dupHint';
const POLL_MS = 1000;
const BAR_AFTER_MS = 3000;
const CODE_TTL_MS = 2 * 60 * 1000;

/** Draait deze pagina in de Android-app? Onthouden per sessie, ook als de adresbalk al is opgeschoond. */
export function isInApp() {
  try { return sessionStorage.getItem(APP_KEY) === 'android'; } catch { return false; }
}

/** Opent de instellingen van de app (meldingen, locatie). */
export function openPhoneSettings() {
  if (CONFIG.androidPackage) location.href = settingsIntent(CONFIG.androidPackage);
}

/**
 * Leest ?app=android en ?pair=1 uit de adresbalk, haalt ze eruit en start zo nodig het koppelen.
 * @param {URLSearchParams} params
 * @param {{ openDevices?: () => void }} [hooks] openDevices: opent Instellingen › Apparaten
 */
export function initAndroidApp(params, { openDevices } = {}) {
  if (params.get('app') === 'android') {
    try { sessionStorage.setItem(APP_KEY, 'android'); } catch { /* geen opslag */ }
  }
  const pair = params.get('pair') === '1';
  if (params.has('app') || params.has('pair')) {
    const url = new URL(location.href);
    url.searchParams.delete('app');
    url.searchParams.delete('pair');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  if (!isInApp() || !CONFIG.androidPackage) return;
  if (pair) pairApp(CONFIG.androidPackage, openDevices).catch(() => { /* de knop in Instellingen blijft de terugvalroute */ });
  else hintDuplicates(openDevices).catch(() => { /* alleen een tip */ });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bar(text, label, onClick) {
  const b = el('div', { class: 'appbar', role: 'status' }, el('span', {}, text), el('button', { type: 'button', onclick: onClick }, label));
  document.body.append(b);
  return b;
}

async function pairApp(pkg, openDevices) {
  const { id, code, expires_at: expires } = await request('POST', '/api/pair');
  const intent = pairIntent(pkg, code);
  location.href = intent;
  const started = Date.now();
  const deadline = Math.min(Date.parse(expires) || Infinity, started + CODE_TTL_MS);
  let notice = null;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      let used = false;
      try { used = (await request('GET', `/api/pair/${id}`)).used; } catch { /* offline of 404: blijven peilen tot het verloopt */ }
      if (used) { await enableAppPush(); await hintDuplicates(openDevices); return; }
      if (!notice && Date.now() - started >= BAR_AFTER_MS) notice = bar(t('app.pair_hint'), t('app.pair_button'), () => { location.href = intent; });
    }
    toast(t('app.pair_failed'));
  } finally {
    notice?.remove();
  }
}

/** Zet web push aan in deze (app-)browser; fouten slikken we in, de schakelaar in Instellingen blijft over. */
async function enableAppPush() {
  try {
    const reg = await Promise.race([navigator.serviceWorker?.ready, sleep(5000).then(() => null)]) ?? null;
    if (reg && !(await pushState(reg)).subscribed) await enablePush(reg);
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
