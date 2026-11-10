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
// Both phones work. Shared: one task, ticking it on either phone ticks it on both, and the other phone gets a
// notification. Copy: each phone has its own copy; the pill on each phone shows the other person's progress.
function mountShare(root) {
  const state = {
    mode: 'shared',
    done: false, by: '', // shared: done, and who ticked it ('me' or 'her')
    me: [false, false, false], her: [true, false, false], // copy: each person's subtasks
    touched: false,
  };
  const modeBtns = root.querySelectorAll('[data-set-mode]');
  const myMain = root.querySelector('[data-tick="main"]');
  const mySubs = [...root.querySelectorAll('.box.sub[data-tick]')];
  const herMain = root.querySelector('[data-her="main"]');
  const herSubs = [...root.querySelectorAll('[data-her-sub]')];
  const myTitle = myMain?.closest('.task-row')?.querySelector('.task-title');
  const herTitle = root.querySelector('[data-her-title]');
  const pills = { me: root.querySelector('[data-pill="me"]'), her: root.querySelector('[data-pill="her"]') };
  const pushes = [...root.querySelectorAll('[data-push]')];
  if (!myMain || !herMain) return;

  const paint = (box, on) => {
    box.classList.toggle('is-on', on);
    box.setAttribute('aria-pressed', String(on));
  };

  function render() {
    const shared = state.mode === 'shared';
    const allMe = state.me.every(Boolean);
    const allHer = state.her.every(Boolean);
    root.dataset.mode = state.mode;
    root.classList.toggle('shared-done', shared && state.done);
    root.classList.toggle('copy-touched', !shared && state.touched);
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setMode === state.mode)));

    const mine = shared ? state.done : allMe;
    const hers = shared ? state.done : allHer;
    paint(myMain, mine);
    paint(herMain, hers);
    myTitle?.classList.toggle('is-done-title', mine);
    herTitle?.classList.toggle('is-done-title', hers);
    mySubs.forEach((b, i) => { paint(b, state.me[i]); b.closest('.sub-row')?.classList.toggle('is-done', state.me[i]); });
    herSubs.forEach((b, i) => { paint(b, state.her[i]); b.closest('.sub-row')?.classList.toggle('is-done', state.her[i]); });

    for (const [who, subs] of [['me', state.me], ['her', state.her]]) {
      const pill = pills[who];
      if (!pill) continue;
      pill.style.setProperty('--pct', Math.round((subs.filter(Boolean).length / subs.length) * 100) + '%');
      pill.classList.toggle('is-done', subs.every(Boolean));
    }

    // A notification on the other person's phone, right after the change that caused it.
    const show = {
      'shared-me': shared && state.done && state.by === 'me',
      'shared-her': shared && state.done && state.by === 'her',
      'copy-me': !shared && allMe && state.touched,
      'copy-her': !shared && allHer && state.touched,
    };
    pushes.forEach((p) => p.classList.toggle('is-shown', !!show[p.dataset.push]));
  }

  modeBtns.forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.setMode;
    render();
  }));
  const tickMain = (who) => {
    if (state.mode === 'shared') {
      state.done = !state.done;
      state.by = state.done ? who : '';
    } else {
      const v = !state[who].every(Boolean);
      state[who] = state[who].map(() => v);
      state.touched = true;
    }
    render();
  };
  const tickSub = (who, i) => {
    state[who][i] = !state[who][i];
    state.touched = true;
    render();
  };
  myMain.addEventListener('click', () => tickMain('me'));
  herMain.addEventListener('click', () => tickMain('her'));
  mySubs.forEach((b, i) => b.addEventListener('click', () => tickSub('me', i)));
  herSubs.forEach((b, i) => b.addEventListener('click', () => tickSub('her', i)));
  render();
}
document.querySelectorAll('.share').forEach(mountShare);

// ---------- What works where: the fade on the right says "there is more"; it goes once you reach the end ----------
document.querySelectorAll('.table-wrap').forEach((wrap) => {
  const box = wrap.querySelector('.table-card');
  if (!box) return;
  const update = () => {
    const more = box.scrollWidth - box.clientWidth - box.scrollLeft > 4;
    wrap.classList.toggle('has-more', more);
  };
  box.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
});

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
