// Pagina /demo: start meteen een demo (POST /demo vanaf deze site) en gaat dan naar de app. Mislukt het, dan een
// melding en een knop om het opnieuw te proberen. Zie src/demo.ts.
import { afterLogin, forgetCachedConfig, inAndroidApp } from './next.js';

const err = document.getElementById('err');
const status = document.getElementById('demo-status');
const again = document.getElementById('demo-start');

async function start() {
  err.textContent = '';
  again.hidden = true;
  let timeZone = null;
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* zonder: de zone van de Tick */ }
  const r = await fetch('/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeZone }) })
    .catch(() => null);
  if (r?.ok) {
    await forgetCachedConfig();
    location.replace(afterLogin('/', inAndroidApp()));
    return;
  }
  status.hidden = true;
  err.textContent = r ? (await r.json().catch(() => ({}))).error || r.statusText : document.body.dataset.offline;
  again.hidden = false;
}

again.addEventListener('click', start);
start();
