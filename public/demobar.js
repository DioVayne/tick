// Balk bovenaan in een demo zonder account (src/demo.ts): hoe lang hij nog loopt, en op een openbare Tick een knop om
// er een echt account van te maken. Elk verzoek verlengt de demo; de balk haalt de stand op bij het openen en daarna
// elke paar minuten. Verlopen: terug naar het inlogscherm.
import { request, Offline } from './api.js';
import { t } from './i18n.js';
import { el } from './render.js';
import CONFIG from './settings.js';

/** "45 min", "1 u" of "1 u 20 min" tot `until` (minstens 1 minuut). */
export function demoTimeLeft(until, now = Date.now()) {
  const m = Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000));
  if (m < 60) return t('demo.time_min', { m });
  return m % 60 ? t('demo.time_hours', { h: Math.floor(m / 60), m: m % 60 }) : t('demo.time_h', { h: m / 60 });
}

/** De dialoog "Je taken houden": naam, adres en wachtwoord, zoals bij aanmelden. Gelukt: de app opnieuw laden. */
function keepDialog() {
  const input = (type, id, placeholder, autocomplete) => el('input', { type, id, placeholder, autocomplete, required: true });
  const name = input('text', 'demo-name', t('link.name'), 'name');
  const email = input('email', 'demo-email', t('login.email'), 'username');
  const pw = input('password', 'demo-pw', t('login.password'), 'new-password');
  const err = el('p', { class: 'error', role: 'alert' });
  const submit = el('button', { type: 'submit' }, t('demo.keep'));
  const cancel = el('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, t('dialog.cancel'));
  const form = el('form', { class: 'demo-keep', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      await request('POST', '/api/demo/keep', { name: name.value.trim(), email: email.value.trim(), password: pw.value });
      location.reload();
    } catch (x) {
      err.textContent = x instanceof Offline ? t('app.you_are_offline') : x.message;
      submit.disabled = false;
    }
  } }, el('p', {}, t('demo.keep_text')), name, email, pw, err, el('div', { class: 'dialog-buttons' }, cancel, submit));
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog', 'aria-labelledby': 'demo-keep-title' },
    el('h2', { id: 'demo-keep-title' }, t('demo.keep_title')), form));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}

export function startDemoBar() {
  if (!CONFIG.demo) return;
  const text = el('p', {}, t('demo.bar_nodate'));
  const actions = el('div', { class: 'locbar-actions' });
  document.getElementById('net')?.after(el('div', { class: 'locbar demobar', role: 'status' }, text, actions));
  let until = null;
  const paint = () => {
    if (until && Date.parse(until) <= Date.now()) location.reload(); // weg: de server stuurt naar het inlogscherm
    else text.textContent = until ? t('demo.bar', { time: demoTimeLeft(until) }) : t('demo.bar_nodate');
  };
  const refresh = async () => {
    try {
      const r = await request('GET', '/api/demo');
      until = r.until;
      if (r.canKeep && !actions.childElementCount) actions.append(el('button', { type: 'button', class: 'small', onclick: keepDialog }, t('demo.keep')));
    } catch (e) {
      if (e?.status === 401) location.reload();
    }
    paint();
  };
  refresh();
  setInterval(refresh, 5 * 60_000);
  setInterval(paint, 30_000);
}
