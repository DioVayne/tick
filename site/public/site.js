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

// ---------- Feature stories: open and close smoothly ----------
// The story grows from its tile (height, padding, fade) and its screenshot settles in with a soft zoom. Closing runs
// the same in reverse before the <details> really closes. To animate the old story closed while the new one opens,
// this takes over the one-open-per-group rule from the name attribute (the HTML keeps it for when this file can't run).
// Web Animations only (CSSOM), so the CSP needs no 'unsafe-inline'. With reduced motion nothing changes.
const featAnim = new WeakMap(); // details -> { anim, closing }
function storyAnimating(d) { return featAnim.has(d); }
function featGap(d) {
  // Modern layout: the story is its own row in the grid, so the row gap above it appears at once; fold it in.
  if (!CSS.supports('selector(::details-content)')) return 0;
  const grid = d.parentElement;
  return grid ? parseFloat(getComputedStyle(grid).rowGap) || 0 : 0;
}
function animateStory(d, opening) {
  const story = d.querySelector(':scope > .story');
  if (!story) { d.open = opening; return; }
  const prev = featAnim.get(d);
  // From where it is now, also when the other direction was still running.
  const fromH = prev ? story.getBoundingClientRect().height : null;
  if (prev) { prev.anim.cancel(); prev.img?.cancel(); }
  if (opening) d.open = true;
  const cs = getComputedStyle(story);
  const full = { height: story.offsetHeight + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, opacity: 1 };
  const gap = featGap(d);
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: `calc(${cs.marginTop} - ${gap}px)`, opacity: 0 };
  const from = opening ? { ...shut } : { ...full };
  if (fromH != null) Object.assign(from, { height: fromH + 'px', opacity: opening ? 0.4 : 1 });
  story.classList.add('is-anim');
  const anim = story.animate([from, opening ? full : shut], {
    duration: opening ? 420 : 300,
    easing: opening ? 'cubic-bezier(.2, .8, .2, 1)' : 'cubic-bezier(.4, 0, .6, 1)',
    fill: 'forwards', // closing: stay shut until the <details> is really closed
  });
  const shot = story.querySelector('.story-shot img');
  const img = opening && shot ? shot.animate(
    [{ opacity: 0, transform: 'translateY(12px) scale(.94)' }, { opacity: 1, transform: 'none' }],
    { duration: 520, delay: 90, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' },
  ) : null;
  const entry = { anim, img, closing: !opening };
  featAnim.set(d, entry);
  anim.onfinish = () => {
    if (featAnim.get(d) !== entry) return;
    featAnim.delete(d);
    if (!opening) d.open = false;
    anim.cancel();
    story.classList.remove('is-anim');
  };
  return anim;
}
// Keep the clicked tile where it is on the screen while a story above it closes.
function holdInPlace(el, ms) {
  const top0 = el.getBoundingClientRect().top;
  const end = performance.now() + ms + 50;
  document.documentElement.classList.add('no-anchor');
  const step = () => {
    const dy = el.getBoundingClientRect().top - top0;
    if (Math.abs(dy) > 0.5) window.scrollBy(0, dy);
    if (performance.now() < end) requestAnimationFrame(step);
    else document.documentElement.classList.remove('no-anchor');
  };
  requestAnimationFrame(step);
}
if (!reduceMotion.matches && 'animate' in Element.prototype) {
  const feats = [...document.querySelectorAll('details.feat')];
  feats.forEach((d) => {
    const group = d.getAttribute('name');
    if (group) { d.dataset.group = group; d.removeAttribute('name'); }
  });
  const others = (d) => feats.filter((o) => o !== d && o.open && o.dataset.group && o.dataset.group === d.dataset.group);
  feats.forEach((d) => {
    const summary = d.querySelector(':scope > summary');
    summary?.addEventListener('click', (e) => {
      if (reduceMotion.matches) return; // switched on while the page was open: let the browser toggle
      e.preventDefault();
      const entry = featAnim.get(d);
      const opening = entry ? entry.closing : !d.open;
      if (opening) {
        const closing = others(d).filter((o) => !featAnim.get(o)?.closing);
        const above = closing.some((o) => o.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
        closing.forEach((o) => animateStory(o, false));
        if (above) holdInPlace(summary, 300);
      }
      animateStory(d, opening);
    });
    // Opened another way (a #link, find-in-page): still only one open per group, without the animation.
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      others(d).forEach((o) => { if (!storyAnimating(o)) o.open = false; });
    });
  });
}

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

// ---------- Buttons per device ----------
// The HTML has three buttons for a computer (and for no JS): the demo, an account in the browser, the app on Google Play.
// On a phone there is one real way to start plus the demo, so the account button goes (you make it in the app, or
// after the demo):
// - iPhone/iPad: the demo stays first, the app button explains the home screen instead.
// - Android: the app from Google Play becomes the yellow button, the demo comes second.
// iPadOS presents itself as a Mac, so a Mac with a touch screen counts as iOS too.
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const android = /Android/i.test(navigator.userAgent);
if (ios || android) {
  document.querySelectorAll('[data-ctas]').forEach((row) => {
    const play = row.querySelector('[data-cta="play"]');
    const demo = row.querySelector('[data-cta="demo"]');
    row.querySelector('[data-cta="signup"]')?.remove();
    if (!play || !demo) return;
    if (ios) {
      play.textContent = play.dataset.iosText;
      play.href = play.dataset.iosHref;
      return;
    }
    const arrow = demo.querySelector('svg');
    demo.textContent = demo.dataset.androidText;
    play.textContent = play.dataset.androidText;
    demo.classList.replace('btn-pin', 'btn-ghost');
    play.classList.replace('btn-ghost', 'btn-pin');
    if (arrow) play.append(' ', arrow);
    row.prepend(play);
  });
}
