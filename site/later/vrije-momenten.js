// Bewaard voor later: script van de sectie Vrije momenten (uit site/public/site.js, 2026-11-10).
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
