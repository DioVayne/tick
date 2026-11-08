// Beheerpagina meldingen: een bevestiging voor de zware knoppen (data-confirm). Geen inline code (CSP).
for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', (e) => {
    if (!confirm(/** @type {HTMLFormElement} */ (form).dataset.confirm ?? '')) e.preventDefault();
  });
}
