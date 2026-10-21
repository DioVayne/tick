import { ask } from './dialog.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';
import { load, state } from './store.js';

// Bijlagen: foto's en bestanden bij een taak, alleen online (net als delen). De server bewaart ze in R2; de lijst per
// taak komt mee in GET /api/tasks (`task.attachments`). Foto's worden hier eerst verkleind en opnieuw gecodeerd,
// wat ook de EXIF-gegevens (zoals de plek waar de foto gemaakt is) eruit haalt.

/** Lange kant van een verkleinde foto, en de JPEG-kwaliteit. */
const MAX_SIDE = 2560;
const QUALITY = 0.85;
/** Kleinere png's en webp's (en elke gif) blijven zoals ze zijn; een jpeg gaat altijd opnieuw, voor de EXIF. */
const KEEP_BELOW = 300 * 1024;
const RECODE = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Types die de server inline toont; de rest is een download. */
const VIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** Of deze Tick bijlagen heeft (een R2-bucket). */
export const attachmentsOn = () => !!CONFIG.attachments;

const src = (a, download) => `/api/attachments/${encodeURIComponent(a.id)}${download ? '?download=1' : ''}`;
const isImage = (a) => VIEWABLE.has(a.mime);

/** Grootte in B, kB of MB, in de taal van de app. */
export function fmtSize(n) {
  const nf = (v, d) => v.toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: d });
  if (n < 1024) return t('att.bytes', { n: nf(n, 0) });
  if (n < 1024 * 1024) return t('att.kb', { n: nf(n / 1024, 0) });
  return t('att.mb', { n: nf(n / 1024 / 1024, 1) });
}

// ---------- voorbereiden ----------

/**
 * Een foto verkleinen tot MAX_SIDE en als JPEG opslaan (op wit, voor een png met transparantie). Andere bestanden en
 * foto's die de browser niet kan lezen (HEIC buiten Safari) gaan ongewijzigd. Geeft het bestand en de afmetingen.
 * @param {File} file @returns {Promise<{ blob: Blob, name: string, width?: number, height?: number }>}
 */
export async function prepare(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return { blob: file, name: file.name };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, name: file.name };
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const recode = RECODE.has(file.type) && (file.type === 'image/jpeg' || file.size > KEEP_BELOW || scale < 1);
  if (!recode) { bitmap.close(); return { blob: file, name: file.name, width, height }; }
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = el('canvas', { width: String(w), height: String(h) });
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  // Een kleine png die als jpeg groter wordt, en geen EXIF kan hebben: dan het origineel.
  if (!blob || (file.type !== 'image/jpeg' && scale === 1 && blob.size >= file.size)) return { blob: file, name: file.name, width, height };
  return { blob, name: file.name.replace(/\.[^.]*$/, '') + '.jpg', width: w, height: h };
}

// ---------- uploaden ----------

/** Lopende uploads per taak-id: [{ key, name, progress (0–1) }]. */
/** @type {Map<string, { key: string, name: string, progress: number }[]>} */
const uploads = new Map();
/** Per taak een functie die het blok opnieuw tekent (het paneel van die taak, als het open is). */
/** @type {Map<string, () => void>} */
const redraw = new Map();

/** POST met voortgang (fetch heeft geen uploadvoortgang). Geeft de metadata, of gooit een Error met de melding. */
function send(taskId, prepared, onProgress) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ name: prepared.name });
    if (prepared.width) q.set('w', String(prepared.width));
    if (prepared.height) q.set('h', String(prepared.height));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${encodeURIComponent(taskId)}/attachments?${q}`);
    xhr.setRequestHeader('content-type', prepared.blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error(t('att.offline')));
    xhr.onload = () => {
      if (xhr.status === 401) { location.href = '/login'; return; }
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* geen JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || xhr.statusText));
    };
    xhr.send(prepared.blob);
  });
}

/** Uploadt de bestanden na elkaar naar taak `taskId`; fouten worden een melding, daarna een verversing. */
export async function addFiles(taskId, files) {
  if (!files.length) return;
  if (state.offline || !navigator.onLine) { toast(t('att.offline')); return; }
  const max = (CONFIG.maxUploadMb || 10) * 1024 * 1024;
  const list = uploads.get(taskId) ?? [];
  uploads.set(taskId, list);
  const items = [...files].map((f) => ({ file: f, key: crypto.randomUUID(), name: f.name, progress: 0 }));
  list.push(...items);
  redraw.get(taskId)?.();
  try {
    for (const item of items) {
      try {
        const prepared = await prepare(item.file);
        if (prepared.blob.size > max) throw new Error(t('err.file_too_big', { max: CONFIG.maxUploadMb || 10 }));
        await send(taskId, prepared, (p) => { item.progress = p; redraw.get(taskId)?.(); });
      } catch (e) {
        toast(t('att.failed', { name: item.name, reason: /** @type {Error} */ (e).message }));
      } finally {
        list.splice(list.indexOf(item), 1);
        redraw.get(taskId)?.();
      }
    }
  } finally {
    if (!list.length) uploads.delete(taskId);
    await load();
  }
}

async function removeAttachment(a) {
  if (state.offline) { toast(t('att.offline')); return false; }
  const ok = await ask({
    title: t('att.delete_title'), text: t('att.delete_confirm', { name: a.name }),
    buttons: [{ label: t('dialog.cancel'), value: null, kind: 'ghost' }, { label: t('detail.delete'), value: 'yes', kind: 'danger' }],
  });
  if (ok !== 'yes') return false;
  try {
    const res = await fetch(src(a), { method: 'DELETE' });
    if (res.status === 401) { location.href = '/login'; return false; }
    if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return true;
  } catch (e) {
    toast(e instanceof TypeError ? t('att.offline') : /** @type {Error} */ (e).message);
    return false;
  } finally {
    await load();
  }
}

// ---------- grote weergave ----------

let viewer = null; // { close }
/** De volgende popstate komt van onze eigen history.back() bij het sluiten. */
let ownPop = false;

/** Toont de foto's van een taak groot, vanaf `start`, met vorige/volgende. Terug (Android) en Esc sluiten. */
function openViewer(images, start, readOnly) {
  if (viewer) return;
  let i = start;
  const img = el('img', { class: 'att-big', alt: '' });
  const caption = el('span', { class: 'att-cap' });
  const download = el('a', { class: 'pill', download: '' }, icon('download'), t('att.download'));
  const prev = el('button', { type: 'button', class: 'att-nav prev', 'aria-label': t('att.prev'), onclick: () => show(i - 1) }, '‹');
  const next = el('button', { type: 'button', class: 'att-nav next', 'aria-label': t('att.next'), onclick: () => show(i + 1) }, '›');
  const del = readOnly ? null : el('button', {
    type: 'button', class: 'pill att-viewer-del',
    onclick: async () => {
      const a = images[i];
      if (!(await removeAttachment(a))) return;
      images.splice(i, 1);
      if (!images.length) close();
      else show(Math.min(i, images.length - 1));
    },
  }, icon('trash'), t('detail.delete'));
  const closeBtn = el('button', { type: 'button', class: 'att-close', 'aria-label': t('att.close'), onclick: () => close() }, '✕');
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'att-viewer', 'aria-label': t('att.title') },
    closeBtn, prev, img, next,
    el('div', { class: 'att-bar' }, caption, download, del)));
  function show(n) {
    i = (n + images.length) % images.length;
    const a = images[i];
    img.src = src(a);
    img.alt = a.name;
    caption.textContent = `${a.name} · ${fmtSize(a.size)}`;
    download.href = src(a, true);
    prev.hidden = next.hidden = images.length < 2;
  }
  // Een eigen stap in de geschiedenis: de terugknop van Android sluit de foto, niet de taak eronder.
  let pushed = false;
  function close(fromHistory = false) {
    if (!viewer) return;
    viewer = null;
    document.body.classList.remove('viewer-open');
    if (dialog.open) dialog.close();
    dialog.remove();
    if (pushed && !fromHistory) { ownPop = true; history.back(); }
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.stopPropagation(); // niet ook het paneel sluiten
    if (e.key === 'ArrowLeft' && images.length > 1) show(i - 1);
    if (e.key === 'ArrowRight' && images.length > 1) show(i + 1);
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  viewer = { close };
  document.body.classList.add('viewer-open');
  history.pushState({ ...history.state, viewer: true }, '');
  pushed = true;
  document.body.append(dialog);
  dialog.showModal();
  show(i);
}

// Terug sluit de weergave, en de popstate van de weergave is nooit voor app.js: die zou hem lezen als "geen taak
// gekozen" (op desktop heeft de taak geen eigen stap) en het paneel sluiten. Deze module laadt vóór app.js, dus deze
// listener loopt eerst en kan de rest tegenhouden.
window.addEventListener('popstate', (e) => {
  if (ownPop) ownPop = false;
  else if (viewer) viewer.close(true);
  else return;
  e.stopImmediatePropagation();
});

// ---------- het blok in het detailpaneel ----------

/**
 * Vult het blok Bijlagen voor taak `task`: miniaturen voor foto's, een regel per ander bestand, lopende uploads en
 * (niet bij een afgeronde taak) de knop om iets toe te voegen. Tekent alleen opnieuw als er iets veranderde.
 * @param {HTMLElement} box @param {any} task @param {boolean} readOnly
 */
export function fillAttachmentsBox(box, task, readOnly) {
  if (!attachmentsOn()) { box.hidden = true; return; }
  const list = task.attachments ?? [];
  const busy = uploads.get(task.id) ?? [];
  redraw.set(task.id, () => { if (box.isConnected && box.dataset.task === task.id) draw(); });
  box.dataset.task = task.id;
  box.hidden = readOnly && !list.length && !busy.length;
  draw();

  function draw() {
    const cur = uploads.get(task.id) ?? [];
    const key = JSON.stringify([readOnly, state.offline, list.map((a) => a.id), cur.map((u) => [u.key, Math.round(u.progress * 20)])]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const images = list.filter(isImage);
    const files = list.filter((a) => !isImage(a));
    const input = /** @type {HTMLInputElement} */ (el('input', {
      type: 'file', multiple: true, hidden: true,
      onchange: () => { const chosen = [...(input.files ?? [])]; input.value = ''; addFiles(task.id, chosen); },
    }));
    box.replaceChildren(...[
      el('h3', {}, t('att.title')),
      images.length ? el('ul', { class: 'att-grid' }, ...images.map((a, n) => {
        const thumb = el('img', { src: src(a), alt: a.name, loading: 'lazy', decoding: 'async' });
        // Met de afmetingen van de server houdt het raster zijn vorm terwijl de foto laadt (CSSOM, geen style-attribuut).
        if (a.width && a.height) thumb.style.aspectRatio = `${a.width} / ${a.height}`;
        return el('li', {},
          el('button', { type: 'button', class: 'att-thumb', title: a.name, onclick: () => openViewer(images.slice(), n, readOnly) }, thumb),
          readOnly ? null : el('button', {
            type: 'button', class: 'att-del', title: t('att.delete_title'), 'aria-label': t('att.delete_named', { name: a.name }),
            onclick: () => removeAttachment(a),
          }, '✕'));
      })) : null,
      files.length ? el('ul', { class: 'att-files' }, ...files.map((a) => el('li', {},
        el('a', { href: src(a, true), download: a.name, class: 'att-name' }, icon('file'), a.name),
        el('span', { class: 'att-size' }, fmtSize(a.size)),
        readOnly ? null : el('button', {
          type: 'button', class: 'pill mini', title: t('att.delete_title'), 'aria-label': t('att.delete_named', { name: a.name }),
          onclick: () => removeAttachment(a),
        }, '✕')))) : null,
      cur.length ? el('ul', { class: 'att-busy' }, ...cur.map((u) => {
        const bar = el('i');
        bar.style.setProperty('--p', String(u.progress));
        return el('li', {}, el('span', {}, t('att.uploading', { name: u.name })), el('span', { class: 'copy-bar', 'aria-hidden': 'true' }, bar));
      })) : null,
      readOnly ? null : el('div', { class: 'att-add' },
        el('button', {
          type: 'button', class: 'pill secbtn', disabled: state.offline,
          title: state.offline ? t('att.offline') : false,
          onclick: () => input.click(),
        }, icon('clip'), t('att.add')),
        input),
    ].filter(Boolean));
  }
}

/**
 * Plakken en slepen op het detailpaneel voegt bestanden toe aan de taak die open staat. `taskId` geeft die taak, of
 * null als er geen open is of ze afgerond is.
 * @param {HTMLElement} root @param {() => string | null} taskId
 */
export function bindDrop(root, taskId) {
  root.addEventListener('paste', (e) => {
    const id = taskId();
    const files = [...(e.clipboardData?.files ?? [])];
    if (!id || !attachmentsOn() || !files.length) return;
    e.preventDefault();
    addFiles(id, files);
  });
  root.addEventListener('dragover', (e) => {
    if (!taskId() || !attachmentsOn() || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    root.classList.add('drop');
  });
  root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('drop'); });
  root.addEventListener('drop', (e) => {
    root.classList.remove('drop');
    const id = taskId();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!id || !attachmentsOn() || !files.length) return;
    e.preventDefault();
    addFiles(id, files);
  });
}
