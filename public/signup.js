// Pagina /signup (openbare Tick): maakt het account en gaat bij succes naar de app.
import { afterLogin, forgetCachedConfig, inAndroidApp } from './next.js';

const MIN_PASSWORD = 8;
const err = document.getElementById('err');
const taken = document.getElementById('taken');

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  if (taken) taken.hidden = true;
  const password = document.getElementById('pw').value;
  if (password.length < MIN_PASSWORD) {
    err.textContent = document.body.dataset.short;
    return;
  }
  const body = { name: document.getElementById('name').value.trim(), email: document.getElementById('email').value.trim(), password };
  // Via de link uit een uitnodigingsmail: de code gaat mee, zodat de uitnodiging de link volgt.
  if (document.body.dataset.join) body.join = document.body.dataset.join;
  const r = await fetch('/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => null);
  if (!r) { err.textContent = document.body.dataset.offline; return; }
  if (r.ok) {
    await forgetCachedConfig();
    location.href = afterLogin('/', inAndroidApp());
    return;
  }
  // De server geeft de melding in de taal van de pagina; bij een bestaand adres ook de link "Wachtwoord vergeten?".
  err.textContent = (await r.json().catch(() => ({}))).error || r.statusText;
  if (r.status === 409 && taken) taken.hidden = false;
});
