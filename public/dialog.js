import { el } from './render.js';

/**
 * Bevestigingsdialoog. Geeft de `value` van de gekozen knop, of null bij Esc, klik ernaast of een knop met value null.
 * @param {{ title: string, text: string, buttons: { label: string, value: string | null, kind?: 'primary' | 'danger' | 'ghost' }[] }} opts
 * @returns {Promise<string | null>}
 */
export function ask({ title, text, buttons }) {
  return new Promise((resolve) => {
    // Direct afronden in plaats van op het close-event te wachten: dat komt in een verborgen tabblad soms niet.
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      el('h2', { id: 'dialog-title' }, title),
      el('p', {}, text),
      el('div', { class: 'dialog-buttons' }, ...buttons.map((b) => el('button', {
        type: 'button',
        // primary is de standaardstijl van een knop
        class: b.kind === 'danger' ? 'danger' : b.kind === 'ghost' ? 'ghost' : '',
        onclick: () => finish(b.value),
      }, b.label)))));
    // Klik op de achtergrond (het dialog-element zelf, niet de inhoud) is annuleren.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(null); });
    // Esc sluit alleen de dialoog, niet ook het paneel of de zijbalk eronder.
    dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
    dialog.addEventListener('close', () => finish(null)); // Esc
    document.body.append(dialog);
    dialog.showModal();
    /** @type {HTMLElement | null} */ (dialog.querySelector('button'))?.focus();
  });
}
