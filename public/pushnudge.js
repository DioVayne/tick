// Balk "Zet meldingen aan": na het opslaan van een herinnering op tijd of plek, als meldingen op dit apparaat (en in dit
// werkprofiel: dat heeft zijn eigen opslag en toestemming) nog uit staan. Anders zie je "Opgeslagen ✓" en komt er nooit
// iets. De knop gebruikt dezelfde route als "Aanzetten en testmelding sturen" in Instellingen (turnOnAndTest).
// "Niet nu" geeft 30 dagen rust (NUDGE_PAUSE_MS); staan meldingen aan, dan gaat de balk vanzelf weg.
import { isInApp } from './androidapp.js';
import { t } from './i18n.js';
import { nudgeFor } from './nudge.js';
import { pushState, pushTurnedOff, turnOnAndTest } from './push.js';
import { el, toast } from './render.js';
import { on } from './store.js';

const KEY = 'tick.pushNudgeDismissed';

const dismissedAt = () => {
  try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : null; } catch { return null; }
};

/** De service worker, hooguit 5 s wachten (eerste start). */
const getReg = () => ('serviceWorker' in navigator
  ? navigator.serviceWorker.getRegistration()
    .then((r) => r ?? Promise.race([navigator.serviceWorker.ready, new Promise((ok) => { setTimeout(() => ok(null), 5000); })]))
    .then((r) => r ?? null).catch(() => null)
  : Promise.resolve(null));

export function startPushNudge() {
  /** @type {HTMLElement | null} */
  let node = null;
  let busy = false;

  const remove = () => { node?.remove(); node = null; };
  const later = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* geen opslag: alleen nu weg */ }
    remove();
  };

  /** @param {'ask' | 'app' | 'blocked' | 'ios'} kind @param {ServiceWorkerRegistration | null} reg */
  const show = (kind, reg) => {
    // Alleen 'ask' heeft een knop; bij de andere is uitleg het enige wat werkt (zoals in Instellingen › Meldingen).
    const text = { ask: t('nudge.off'), app: t('nudge.app'), blocked: t('set.push_blocked'), ios: t('push.ios_hint') }[kind];
    const main = kind === 'ask' ? el('button', { type: 'button', class: 'small', onclick: () => turnOn(reg) }, t('nudge.turn_on')) : null;
    const bar = el('div', { class: `locbar pushnudge ${kind}`, role: 'alert' },
      el('p', {}, el('strong', {}, t('nudge.title')), ' ', text),
      el('div', { class: 'locbar-actions' }, main,
        el('button', { type: 'button', class: 'small ghost', onclick: later }, t('nudge.later'))));
    remove();
    node = bar;
    document.getElementById('net')?.after(bar);
  };

  /** @param {ServiceWorkerRegistration | null} reg */
  const turnOn = async (reg) => {
    if (busy) return;
    busy = true;
    node?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (await turnOnAndTest(reg, isInApp())) toast(t('set.push_on_test'), 'ok'); else toast(t('push.enabled_test_missing'));
      remove();
    } catch (e) {
      // Geweigerd of geen antwoord: dezelfde uitleg als in Instellingen.
      const ps = await pushState(reg);
      if (isInApp() && ps.permission !== 'granted') show('app', reg);
      else if (ps.permission === 'denied') show('blocked', reg);
      else { toast(t('push.setup_failed', { reason: e.message })); node?.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    } finally {
      busy = false;
    }
  };

  on('reminder', async ({ place }) => {
    if (node || busy) return;
    const reg = await getReg();
    const ps = await pushState(reg);
    const kind = nudgeFor({ ...ps, inApp: isInApp(), place, turnedOff: pushTurnedOff(), dismissedAt: dismissedAt(), now: Date.now() });
    if (kind && !node) show(kind, reg);
  });

  // Opnieuw kijken als je terugkomt in Tick (bijvoorbeeld uit de telefooninstellingen) of na een wijziging (ook via
  // Instellingen › Meldingen): staan meldingen nu aan, dan is de balk klaar; is er nu toestemming, dan de aanzetknop.
  const recheck = async () => {
    if (document.hidden || !node || busy) return;
    const reg = await getReg();
    const ps = await pushState(reg);
    if (!node || busy) return;
    if (ps.permission === 'granted' && ps.subscribed) remove();
    else if (ps.permission === 'granted' && !node.classList.contains('ask')) show('ask', reg);
  };
  document.addEventListener('visibilitychange', recheck);
  on('change', recheck);
}
