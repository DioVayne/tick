import { afterLogin, forgetCachedConfig, inAndroidApp } from './next.js';

const form = document.getElementById('f');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  // Uit tijdens het versturen: twee keer klikken logt niet twee keer in.
  const button = form.querySelector('button');
  button.disabled = true;
  const r = await fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: document.getElementById('pw').value }),
  }).catch(() => null);
  if (r?.ok) {
    await forgetCachedConfig();
    location.href = afterLogin(new URLSearchParams(location.search).get('next'), inAndroidApp());
    return;
  }
  // Geen verbinding: de melding uit de pagina (data-offline). Anders geeft de server de melding in de taal van de
  // pagina (cookie tick_lang, anders Accept-Language).
  err.textContent = r ? (await r.json().catch(() => ({}))).error || r.statusText : document.body.dataset.offline;
  button.disabled = false;
});
