// Login form of /beheer. After logging in you go to the home page, where the editor appears.
document.getElementById('login').addEventListener('submit', function (e) {
  e.preventDefault();
  var knop = document.getElementById('knop');
  var melding = document.getElementById('melding');
  knop.disabled = true;
  melding.textContent = '';
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wachtwoord: document.getElementById('wachtwoord').value })
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) { throw new Error(data.fout || 'Inloggen is niet gelukt.'); }
      location.href = '/';
    });
  }).catch(function (err) {
    knop.disabled = false;
    melding.textContent = err.message;
  });
});
