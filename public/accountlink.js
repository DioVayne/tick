// Pagina's /invite/<code> en /reset/<code>: post naar de eigen URL en gaat bij succes naar de app.
import { afterLogin, forgetCachedConfig, inAndroidApp } from './next.js';

const MIN_PASSWORD = 8;
const kind = document.body.dataset.kind;
const err = document.getElementById('err');

document.getElementById('f').addEventListener('submit', async (e) => {
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
  const r = await fetch(location.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.ok) {
    await forgetCachedConfig();
    location.href = afterLogin('/', inAndroidApp());
  }
  // De server geeft de melding in de taal van de installatie.
  else err.textContent = (await r.json().catch(() => ({}))).error || r.statusText;
});
