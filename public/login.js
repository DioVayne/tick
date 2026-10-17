import { afterLogin, inAndroidApp } from './next.js';

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  const r = await fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: document.getElementById('pw').value }),
  });
  if (r.ok) location.href = afterLogin(new URLSearchParams(location.search).get('next'), inAndroidApp());
  // De server geeft de melding in de taal van de installatie.
  else err.textContent = (await r.json().catch(() => ({}))).error || r.statusText;
});
