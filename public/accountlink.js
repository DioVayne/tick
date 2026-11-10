// Pagina's /invite/<code> en /reset/<code>: post naar de eigen URL en gaat bij succes naar de app.
import { afterLogin, forgetCachedConfig, inAndroidApp } from './next.js';

const MIN_PASSWORD = 8;
const kind = document.body.dataset.kind;
const err = document.getElementById('err');
const form = document.getElementById('f');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const password = document.getElementById('pw').value;
  if (password.length < MIN_PASSWORD) {
    err.textContent = document.body.dataset.short;
    return;
  }
  const body = kind === 'invite'
    ? { name: document.getElementById('name').value.trim(), email: document.getElementById('email').value.trim(), password }
    : { password };
  // Uit tijdens het versturen: twee keer klikken verstuurt niet twee keer.
  const button = form.querySelector('button');
  button.disabled = true;
  const r = await fetch(location.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (r?.ok) {
    await forgetCachedConfig();
    location.href = afterLogin('/', inAndroidApp());
    return;
  }
  // Geen verbinding: de melding uit de pagina (data-offline). Anders geeft de server de melding in de taal van de
  // pagina (cookie tick_lang, anders Accept-Language).
  err.textContent = r ? (await r.json().catch(() => ({}))).error || r.statusText : document.body.dataset.offline;
  button.disabled = false;
});

// Na succes blijft de knop uit (we gaan weg); komt de pagina terug uit de back-forward cache, dan weer bruikbaar.
window.addEventListener('pageshow', () => { form.querySelector('button').disabled = false; });
