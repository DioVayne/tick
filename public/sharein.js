// Delen naar Tick: de webapp staat (geïnstalleerd) in het deelmenu van de telefoon of computer via `share_target` in
// manifest.webmanifest. Het deelmenu opent /?shared_title=…&shared_text=…&shared_url=… (GET, dus ook offline: de
// service worker geeft gewoon de app). Dit maakt daar een voorstel van voor de invoerkaart; je kijkt het na en
// tikt zelf op Toevoegen.

const PARAMS = ['shared_title', 'shared_text', 'shared_url'];
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const MAX_TITLE = 200;

/**
 * Titel en omschrijving uit wat er gedeeld werd. De paginatitel (of anders de tekst zonder links) wordt de titel;
 * de links en de overige tekst gaan in de omschrijving. Null als er niets gedeeld is.
 * @param {URLSearchParams} params
 * @returns {{ title: string, description: string } | null}
 */
export function fromShare(params) {
  if (!PARAMS.some((p) => params.has(p))) return null;
  const rawTitle = (params.get('shared_title') || '').trim();
  const text = (params.get('shared_text') || '').trim();
  /** @type {string[]} */
  const urls = [];
  /** @param {string} u */
  const addUrl = (u) => { u = u.replace(/[.,;:!?)\]]+$/, ''); if (u && !urls.includes(u)) urls.push(u); };
  const sharedUrl = (params.get('shared_url') || '').trim();
  if (/^https?:\/\//i.test(sharedUrl)) addUrl(sharedUrl);
  for (const m of text.match(URL_RE) || []) addUrl(m);
  // De tekst zonder de links; een losse regel met alleen leestekens (bijv. " - ") valt weg.
  const rest = text.replace(URL_RE, '').split('\n').map((l) => l.trim()).filter((l) => /[\p{L}\p{N}]/u.test(l)).join('\n');

  /** @param {string} s */
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
  let title = oneLine(rawTitle);
  let restLeft = rest;
  // Sommige apps sturen de link ook als titel: dat geen titel van maken.
  if (/^https?:\/\/\S+$/i.test(title)) title = '';
  if (!title && rest) {
    // Geen paginatitel: de eerste regel van de tekst, de rest gaat in de omschrijving.
    const [first, ...more] = rest.split('\n');
    title = oneLine(first);
    restLeft = more.join('\n');
  } else if (rest && oneLine(rest) === title) {
    restLeft = '';
  }
  if (title.length > MAX_TITLE) {
    restLeft = [title, restLeft].filter(Boolean).join('\n');
    title = title.slice(0, MAX_TITLE - 1).trimEnd() + '…';
  }
  if (!title && urls.length) title = urls[0];
  const description = [restLeft, ...urls].filter(Boolean).join('\n');
  if (!title && !description) return null;
  return { title, description };
}

/** Haalt de deelparameters uit de adresbalk, zodat verversen de kaart niet opnieuw vult. */
export function clearShareParams() {
  const url = new URL(location.href);
  for (const p of PARAMS) url.searchParams.delete(p);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
