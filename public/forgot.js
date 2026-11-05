// Pagina /forgot: vraagt een herstellink aan en toont daarna altijd dezelfde melding (data-sent op <body>).
// Teksten komen uit data-attributen: de pagina heeft geen i18n.js nodig.
const form = document.getElementById('f');
const err = document.getElementById('err');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const r = await fetch('/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value.trim() }),
    });
    if (r.ok) {
      const done = document.createElement('p');
      done.className = 'ok';
      done.setAttribute('role', 'status');
      done.textContent = document.body.dataset.sent;
      form.querySelector('.intro').replaceWith(done);
      form.querySelector('#email').remove();
      button.remove();
      return;
    }
    // De server geeft de melding in de taal van de pagina.
    err.textContent = (await r.json().catch(() => ({}))).error || r.statusText;
  } catch {
    err.textContent = document.body.dataset.offline;
  }
  button.disabled = false;
});
