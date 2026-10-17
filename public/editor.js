// Omschrijving-editor, variant A: opgemaakte leesweergave, klik om de ruwe markdown te bewerken.
// Bij 2b (WYSIWYG) vervang je alleen dit bestand; de export blijft gelijk.
import { t } from './i18n.js';
import { renderMarkdown, toggleTask } from './markdown.js';

/** Maakt een textarea precies zo hoog als zijn tekst. Ook gebruikt voor de titel in het detailpaneel. */
export function autoGrow(ta) {
  if (!ta.getClientRects().length) return; // niet zichtbaar: geen maat; het volgende grow() zet het recht
  ta.style.height = 'auto';
  // scrollHeight telt de rand niet mee, de hoogte (box-sizing: border-box) wel.
  ta.style.height = ta.scrollHeight + ta.offsetHeight - ta.clientHeight + 'px';
}

/**
 * @param {HTMLElement} container
 * @param {{ value: string, onChange: (text: string) => void, onCommit: (text: string) => void, placeholder: string }} opts
 * @returns {{ setValue: (text: string) => void, focus: () => void, destroy: () => void, isEditing: () => boolean }}
 */
export function createEditor(container, { value, onChange, onCommit, placeholder }) {
  let text = value ?? '';
  /** @type {HTMLTextAreaElement | null} */
  let area = null;

  function showRead() {
    area = null;
    const view = document.createElement('div');
    view.className = 'md' + (text.trim() ? '' : ' empty');
    if (text.trim()) {
      view.append(renderMarkdown(text, {
        onToggle: (line) => {
          text = toggleTask(text, line);
          showRead();
          onCommit(text);
        },
      }));
    } else {
      view.textContent = placeholder;
    }
    // Een link of vinkje bedient zichzelf; elke andere klik gaat naar de bewerkmodus.
    view.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('a, input')) return;
      showEdit();
    });
    // Met het toetsenbord bereikbaar: Enter of spatie opent de editor (maar niet vanuit een link of vinkje).
    view.tabIndex = 0;
    view.addEventListener('keydown', (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== view) return;
      e.preventDefault();
      showEdit();
    });
    container.replaceChildren(view);
  }

  function grow() {
    if (area) autoGrow(area);
  }

  // Terug naar lezen; `area = null` eerst, zodat de blur van het weggehaalde veld niet nog eens vastlegt.
  function finish() {
    if (!area) return;
    text = area.value;
    showRead();
    onCommit(text);
  }

  function showEdit() {
    const ta = document.createElement('textarea');
    ta.className = 'editor';
    ta.value = text;
    ta.placeholder = placeholder;
    ta.maxLength = 10000; // zelfde grens als de server (MAX_DESCRIPTION)
    ta.setAttribute('aria-label', t('detail.description'));
    ta.addEventListener('input', () => { grow(); onChange(ta.value); });
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // Alleen de editor sluiten, niet het paneel eromheen.
      e.stopPropagation();
      finish();
    });
    area = ta;
    container.replaceChildren(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    grow();
  }

  showRead();

  return {
    // Tijdens het typen mag een verversing de tekst niet overschrijven.
    setValue(next) {
      if (area && document.activeElement === area) return;
      text = next ?? '';
      if (area) { area.value = text; grow(); }
      else showRead();
    },
    focus() { if (!area) showEdit(); else area.focus(); },
    destroy() {
      if (area) { const ta = area; area = null; ta.remove(); }
      container.replaceChildren();
    },
    isEditing: () => area !== null,
  };
}
