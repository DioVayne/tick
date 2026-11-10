// ticktodo.nl: small enhancements. The page is complete without this file; it only adds the demos and deep links.
// CSP-safe: no inline styles; only CSS custom properties through el.style.setProperty.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Deep links: #anchor opens its <details> (feature story or FAQ) ----------
function openFromHash(scroll) {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  const details = el.tagName === 'DETAILS' ? el : el.closest('details');
  if (details && !details.open) details.open = true;
  // A feature <details> has display: contents (no box of its own), so scroll to its tile.
  const target = el === details ? details.querySelector('summary') || el : el;
  // Instant: opening the story can close another one above it, which moves everything during a smooth scroll.
  if (scroll) target.scrollIntoView({ block: 'start', behavior: 'instant' });
}
openFromHash('instant');
// The browser's own jump to the fragment can land elsewhere (a display: contents target, lazy images); redo it once
// everything has loaded.
if (location.hash) window.addEventListener('load', () => setTimeout(() => openFromHash('instant'), 0), { once: true });
window.addEventListener('hashchange', () => openFromHash(true));

// Keep the address bar in step with the open feature story, so the URL can be shared.
document.querySelectorAll('details.feat').forEach((d) => {
  d.addEventListener('toggle', () => {
    if (d.open) {
      if (location.hash !== '#' + d.id) history.replaceState(null, '', '#' + d.id);
    } else if (location.hash === '#' + d.id) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });
});

// Browsers without the name attribute on <details>: keep one open per group by hand.
if (!('name' in HTMLDetailsElement.prototype)) {
  document.querySelectorAll('details[name]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      document.querySelectorAll(`details[name="${d.getAttribute('name')}"]`).forEach((o) => {
        if (o !== d) o.open = false;
      });
    });
  });
}

// ---------- Shared or copy: two phones ----------
function mountShare(root) {
  const state = { mode: 'shared', done: false, subs: [false, false, false] };
  const modeBtns = root.querySelectorAll('[data-set-mode]');
  const mainBox = root.querySelector('[data-tick="main"]');
  const subBoxes = [...root.querySelectorAll('.box.sub[data-tick]')];
  const herBox = root.querySelector('[data-her="main"]');
  const herTitle = root.querySelector('[data-her-title]');
  const myTitle = mainBox?.closest('.task-row')?.querySelector('.task-title');
  const herBar = root.querySelector('.copy-pill.hers');
  if (!mainBox || !herBox) return;

  function render() {
    const shared = state.mode === 'shared';
    const n = state.subs.filter(Boolean).length;
    const all = n === state.subs.length;
    root.dataset.mode = state.mode;
    root.classList.toggle('shared-done', shared && state.done);
    root.classList.toggle('copy-some', !shared && n > 0);
    root.classList.toggle('copy-all', !shared && all);
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setMode === state.mode)));

    const mine = shared ? state.done : all;
    mainBox.classList.toggle('is-on', mine);
    mainBox.setAttribute('aria-pressed', String(mine));
    myTitle?.classList.toggle('is-done-title', mine);
    subBoxes.forEach((b, i) => {
      b.classList.toggle('is-on', state.subs[i]);
      b.setAttribute('aria-pressed', String(state.subs[i]));
      b.closest('.sub-row')?.classList.toggle('is-done', state.subs[i]);
    });

    const hers = shared && state.done; // a copy: her own copy stays open
    herBox.classList.toggle('is-on', hers);
    herTitle?.classList.toggle('is-done-title', hers);
    herBar?.style.setProperty('--pct', Math.round((n / state.subs.length) * 100) + '%');
  }

  modeBtns.forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.setMode;
    render();
  }));
  mainBox.addEventListener('click', () => {
    if (state.mode === 'shared') state.done = !state.done;
    else {
      const v = !state.subs.every(Boolean);
      state.subs = state.subs.map(() => v);
    }
    render();
  });
  subBoxes.forEach((b, i) => b.addEventListener('click', () => {
    state.subs[i] = !state.subs[i];
    render();
  }));
  render();
}
document.querySelectorAll('.share').forEach(mountShare);

// ---------- Free moments: the suggestions in the menu light up their slot in turn ----------
function mountWeek(root) {
  const items = [...root.querySelectorAll('.mi[data-slot]')];
  const slots = [...root.querySelectorAll('.blk.free[data-slot]')];
  if (!items.length) return;
  let i = 0;
  const show = (k) => {
    const key = items[k].dataset.slot;
    items.forEach((it) => it.classList.toggle('is-active', it.dataset.slot === key));
    slots.forEach((s) => s.classList.toggle('is-active', s.dataset.slot === key));
  };
  items.forEach((it, k) => it.addEventListener('mouseenter', () => { i = k; show(k); }));
  if (reduceMotion.matches) return;
  let timer = null;
  const start = () => { if (!timer) timer = setInterval(() => { i = (i + 1) % items.length; show(i); }, 2600); };
  const stop = () => { clearInterval(timer); timer = null; };
  // Only cycle while the week is on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? start() : stop()))).observe(root);
  } else start();
}
document.querySelectorAll('.week-wrap').forEach(mountWeek);

// ---------- Tickmanager: one old task at a time ----------
function mountTickmanager(root) {
  const queue = [...root.querySelectorAll('.tm-queue li')].map((li) => ({ title: li.textContent, sub: li.dataset.sub || '' }));
  const ofEl = root.querySelector('.tm-of');
  const stopBtn = root.querySelector('.tm-stop');
  const taskEl = root.querySelector('.tm-task');
  const titleEl = root.querySelector('.tm-title');
  const subEl = root.querySelector('.tm-sub');
  const countEl = root.querySelector('.bolt .count');
  const summaryEl = root.querySelector('.tm-summary');
  const actions = [...root.querySelectorAll('.tm-actions button')];
  if (!queue.length || !ofEl || !taskEl) return;
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  let pos = 0;
  let tally = { s: 0, t: 0, d: 0, l: 0 };

  function render() {
    const done = pos >= queue.length;
    const left = queue.length - pos;
    countEl.textContent = String(left);
    ofEl.textContent = done ? '' : fill(root.dataset.of, { n: pos + 1, total: queue.length });
    titleEl.textContent = done ? root.dataset.done : queue[pos].title;
    subEl.textContent = done ? '' : queue[pos].sub;
    subEl.hidden = done;
    actions.forEach((b) => { b.disabled = done; });
    stopBtn.textContent = done ? root.dataset.again : root.dataset.stop;
    if (pos > 0) summaryEl.textContent = fill(root.dataset.summary, tally);
    if (!reduceMotion.matches) {
      taskEl.classList.remove('is-next');
      void taskEl.offsetWidth; // restart the slide-in
      taskEl.classList.add('is-next');
    }
  }
  actions.forEach((b) => b.addEventListener('click', () => {
    if (pos >= queue.length) return;
    tally[b.dataset.act] += 1;
    pos += 1;
    render();
  }));
  stopBtn.addEventListener('click', () => {
    pos = 0;
    tally = { s: 0, t: 0, d: 0, l: 0 };
    render();
  });
}
document.querySelectorAll('.tm').forEach(mountTickmanager);
