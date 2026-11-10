// Tick hero demo "Loop naar de winkel" / "Walk to the shop".
// Drag (or walk) the little figure into the circle around the supermarket and
// a Tick notification appears, just like a place reminder in the Android app.
// No dependencies, no build step, CSP-safe (no inline styles or scripts).
// Usage: <div class="tdemo" data-tick-demo data-hint="…" …></div> + this module.

// Map geometry in SVG units (viewBox 0 0 560 340). Everything else derives from this.
const G = {
  w: 560, h: 340,
  start: { x: 114, y: 220 },  // on the grass beside the house, not on its door
  door: { x: 470, y: 220 },   // in front of the shop window (beside the dark door)
  walkY: 220,                 // the pavement the walker follows
  fence: { x: 440, y: 178 },  // centre of the place
  rWalk: 80, rBike: 128,      // circle radius on foot / by bike
  min: { x: 12, y: 44 }, max: { x: 548, y: 334 },
  speedWalk: 130, speedBike: 260, // units per second
};

// English fallbacks; the page supplies its own texts via data-* attributes.
const DEFAULTS = {
  hint: 'Drag me to the shop',
  walk: 'Walk there',
  ride: 'Ride there',
  // Same wording as the Android app (android/.../values/strings.xml: loc_arrived, loc_almost, done).
  arrived: '📍 Arrived at the supermarket',
  arrivedBike: '📍 Almost at the supermarket',
  task: 'Buy milk',
  doneLabel: 'Complete',
  dismissLabel: 'Swipe away notification',
  afterDone: 'Milk in the bag. Ticked off.',
  afterDismiss: 'Swiped away? It comes back as soon as you are there again.',
  bike: 'By bike',
  bikeNote: 'By bike: a heads-up a little earlier',
  radius: '200 m',
  radiusBike: '400 m',
  reset: 'Start over',
  footnote: 'Notifications at a place work in the Android app.',
  app: 'Tick',
  now: 'now',
  icon: 'img/icon.svg',
  ariaMap: 'Small map with a house, a street and a supermarket with a circle around it.',
  ariaWalker: 'Walker. Use the arrow keys or drag to walk into the circle; Enter walks to the shop.',
  ariaNotification: 'Notification from Tick',
};

const MAP = `
<rect class="tdemo-ground" width="560" height="340"/>
<rect class="tdemo-block" x="16" y="16" width="92" height="96" rx="10"/>
<rect class="tdemo-park" x="124" y="16" width="92" height="196" rx="14"/>
<circle class="tdemo-tree" cx="150" cy="52" r="16"/><circle class="tdemo-tree" cx="190" cy="90" r="13"/>
<circle class="tdemo-tree" cx="152" cy="130" r="14"/><circle class="tdemo-tree" cx="192" cy="170" r="15"/>
<circle class="tdemo-tree" cx="300" cy="44" r="14"/><circle class="tdemo-tree" cx="334" cy="60" r="10"/>
<circle class="tdemo-tree" cx="528" cy="44" r="12"/>
<rect class="tdemo-block" x="16" y="284" width="128" height="44" rx="10"/>
<rect class="tdemo-block" x="160" y="284" width="170" height="44" rx="10"/>
<rect class="tdemo-block" x="346" y="284" width="198" height="44" rx="10"/>
<circle class="tdemo-tree" cx="196" cy="306" r="10"/><circle class="tdemo-tree" cx="520" cy="306" r="10"/>
<rect class="tdemo-road" x="0" y="232" width="560" height="36"/>
<rect class="tdemo-road" x="230" y="0" width="32" height="232"/>
<path class="tdemo-edge" d="M0 232H230M262 232H560M0 268H560M230 0V232M262 0V232"/>
<path class="tdemo-dash" d="M0 250H560M246 0V232"/>
<rect class="tdemo-lot" x="278" y="128" width="78" height="86" rx="8"/>
<path class="tdemo-mark" d="M290 150h30M290 172h30M290 194h30"/>
<path class="tdemo-roof" d="M26 162L65 130L104 162Z"/>
<rect class="tdemo-house" x="34" y="158" width="62" height="46" rx="3"/>
<rect class="tdemo-door" x="58" y="180" width="14" height="24" rx="2"/>
<rect class="tdemo-window" x="78" y="168" width="12" height="10" rx="2"/>
<rect class="tdemo-shop" x="370" y="92" width="140" height="110" rx="6"/>
<rect class="tdemo-roof" x="364" y="84" width="152" height="18" rx="5"/>
<rect class="tdemo-sign" x="410" y="106" width="60" height="18" rx="9"/>
<path class="tdemo-glyph" d="M425 110h4l3 8h11l2-6h-15"/>
<circle class="tdemo-glyph-dot" cx="433" cy="121" r="1.7"/><circle class="tdemo-glyph-dot" cx="442" cy="121" r="1.7"/>
<rect class="tdemo-awn-a" x="380" y="130" width="20" height="12"/><rect class="tdemo-awn-b" x="400" y="130" width="20" height="12"/>
<rect class="tdemo-awn-a" x="420" y="130" width="20" height="12"/><rect class="tdemo-awn-b" x="440" y="130" width="20" height="12"/>
<rect class="tdemo-awn-a" x="460" y="130" width="20" height="12"/><rect class="tdemo-awn-b" x="480" y="130" width="20" height="12"/>
<rect class="tdemo-window" x="382" y="152" width="38" height="30" rx="3"/>
<rect class="tdemo-window" x="460" y="152" width="38" height="30" rx="3"/>
<rect class="tdemo-doorway" x="428" y="154" width="24" height="48" rx="3"/>
<path class="tdemo-door-split" d="M440 156V202"/>
<g transform="translate(440 178)"><circle class="tdemo-fence" r="128"/></g>
<path class="tdemo-route" d="M114 220H470"/>
<g class="tdemo-walker" tabindex="0" role="button" transform="translate(114 220)">
  <circle class="tdemo-hit" cy="-16" r="28"/>
  <g transform="translate(0 -16)"><circle class="tdemo-ring" r="20"/></g>
  <circle class="tdemo-focus" cy="-16" r="25"/>
  <ellipse class="tdemo-shadow" rx="9" ry="2.5"/>
  <g class="tdemo-bikepart"><circle cx="-9" cy="-6" r="6"/><circle cx="9" cy="-6" r="6"/><path d="M-9 -6L-2 -14H6L9 -6M-2 -14L0 -6"/></g>
  <g transform="translate(0 -12)"><line class="tdemo-leg tdemo-leg-a" x1="0" y1="0" x2="-2" y2="11"/><line class="tdemo-leg tdemo-leg-b" x1="0" y1="0" x2="2" y2="11"/></g>
  <rect class="tdemo-body" x="-5" y="-27" width="10" height="17" rx="5"/>
  <circle class="tdemo-head" cy="-32" r="5.5"/>
  <rect class="tdemo-milk" x="6.5" y="-25" width="4" height="7" rx="1"/>
  <path class="tdemo-bag" d="M5 -20h7l1 9h-9z"/>
</g>`;

const TEMPLATE = `
<div class="tdemo-stage">
  <svg class="tdemo-map" viewBox="0 0 560 340" role="group" focusable="false">${MAP}</svg>
  <span class="tdemo-fence-label" aria-hidden="true"></span>
  <div class="tdemo-notif" role="group" inert>
    <div class="tdemo-notif-head">
      <img class="tdemo-notif-icon" alt="" width="18" height="18">
      <span class="tdemo-notif-app"></span><span aria-hidden="true">·</span>
      <span class="tdemo-notif-now"></span>
      <button type="button" class="tdemo-close"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
    </div>
    <p class="tdemo-notif-title"><span class="tdemo-notif-task"></span></p>
    <p class="tdemo-notif-text"></p>
    <div class="tdemo-notif-actions">
      <button type="button" class="tdemo-btn tdemo-done"></button>
    </div>
  </div>
</div>
<p class="tdemo-status" aria-live="polite"></p>
<p class="tdemo-sr" aria-live="polite"></p>
<div class="tdemo-controls">
  <button type="button" class="tdemo-walk"></button>
  <label class="tdemo-bike">
    <input type="checkbox" role="switch">
    <span class="tdemo-switch" aria-hidden="true"></span>
    <span class="tdemo-bike-text"></span>
  </label>
  <button type="button" class="tdemo-reset"></button>
</div>
<p class="tdemo-foot"></p>`;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function mountDemo(root) {
  if (root.dataset.tdemoReady) return;
  root.dataset.tdemoReady = '1';
  const t = (key) => root.dataset[key] || DEFAULTS[key];

  // Replace the no-JS fallback image with the live component.
  root.classList.add('tdemo', 'is-live', 'is-fresh');
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);
  const svg = $('.tdemo-map');
  const walker = $('.tdemo-walker');
  const fence = $('.tdemo-fence');
  const fenceLabel = $('.tdemo-fence-label');
  const notif = $('.tdemo-notif');
  const status = $('.tdemo-status');
  const sr = $('.tdemo-sr');
  const walkBtn = $('.tdemo-walk');
  const bikeInput = $('.tdemo-bike input');
  const doneBtn = $('.tdemo-done');
  const closeBtn = $('.tdemo-close');
  const notifText = $('.tdemo-notif-text');

  // Texts: always via textContent / attributes, never into markup.
  svg.setAttribute('aria-label', t('ariaMap'));
  walker.setAttribute('aria-label', t('ariaWalker'));
  notif.setAttribute('aria-label', t('ariaNotification'));
  $('.tdemo-notif-icon').src = t('icon');
  $('.tdemo-notif-app').textContent = t('app');
  $('.tdemo-notif-now').textContent = t('now');
  $('.tdemo-notif-task').textContent = t('task');
  doneBtn.textContent = t('doneLabel');
  closeBtn.setAttribute('aria-label', t('dismissLabel'));
  closeBtn.title = t('dismissLabel');
  $('.tdemo-bike-text').textContent = t('bike');
  $('.tdemo-reset').textContent = t('reset');
  $('.tdemo-foot').textContent = t('footnote');

  const s = { x: G.start.x, y: G.start.y, facing: 1, inside: false, done: false, bike: false, open: false, anim: 0, drag: null };
  let closeTimer = 0, stepTimer = 0, checkTimer = 0;

  const radius = () => (s.bike ? G.rBike : G.rWalk);
  const setStatus = (text) => { status.textContent = text; };
  const announce = (text) => { sr.textContent = ''; setTimeout(() => { sr.textContent = text; }, 60); };

  // Circle size and label position live in custom properties (CSP-safe).
  function drawFence() {
    const r = radius();
    fence.style.setProperty('--tdemo-fs', String(r / G.rBike));
    fenceLabel.style.setProperty('--tdemo-lx', `${((G.fence.x - r) / G.w) * 100}%`);
    fenceLabel.style.setProperty('--tdemo-ly', `${(G.fence.y / G.h) * 100}%`);
    fenceLabel.textContent = s.bike ? t('radiusBike') : t('radius');
  }

  function place(x, y) {
    x = clamp(x, G.min.x, G.max.x);
    y = clamp(y, G.min.y, G.max.y);
    if (Math.abs(x - s.x) > 0.5) s.facing = x < s.x ? -1 : 1;
    s.x = x; s.y = y;
    walker.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${s.facing < 0 ? ' scale(-1 1)' : ''}`);
    check();
  }

  // Geofence: fire on entering, re-arm on leaving (a little slack against jitter).
  function check() {
    const d = Math.hypot(s.x - G.fence.x, s.y - G.fence.y);
    const r = radius();
    if (!s.inside && d <= r) {
      s.inside = true;
      root.classList.add('is-inside');
      if (!s.done) openNotif();
    } else if (s.inside && d > r + 6) {
      s.inside = false;
      root.classList.remove('is-inside');
    }
  }

  function openNotif() {
    clearTimeout(closeTimer);
    if (s.open) {
      // Already showing: give it a little nudge, like a fresh notification.
      notif.classList.remove('is-bump');
      void notif.offsetWidth;
      notif.classList.add('is-bump');
    }
    // On the road (bike) the app says "Almost at …", on foot "Arrived at …".
    notifText.textContent = s.bike ? t('arrivedBike') : t('arrived');
    s.open = true;
    notif.inert = false;
    root.classList.add('is-notified');
    announce(`${t('app')}: ${t('task')}. ${notifText.textContent}`);
  }

  // instant: hide without the slide (after a sideways swipe it is already off-screen).
  function closeNotif(instant = false) {
    clearTimeout(closeTimer);
    const hadFocus = notif.contains(document.activeElement);
    s.open = false;
    notif.inert = true;
    if (instant) notif.classList.add('is-instant');
    root.classList.remove('is-notified');
    notif.style.setProperty('--tdemo-swipe', '0px');
    notif.style.setProperty('--tdemo-swipe-o', '1');
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => notif.classList.remove('is-instant')));
    if (hadFocus) walker.focus({ preventScroll: true });
  }

  // Swiping away (or ×): gone for now, back on the next arrival, like the real app.
  function dismiss(instant = false) {
    closeNotif(instant);
    setStatus(t('afterDismiss'));
  }

  function interacted() {
    root.classList.remove('is-fresh');
  }

  // Leg swing while moving; stops shortly after the last move.
  function stepping() {
    root.classList.add('is-walking');
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => { if (!s.anim) root.classList.remove('is-walking'); }, 180);
  }

  function cancelWalk() {
    if (s.anim) cancelAnimationFrame(s.anim);
    s.anim = 0;
    root.classList.remove('is-walking');
  }

  // Walk along the pavement to the shop door at a steady pace.
  function walkToShop() {
    cancelWalk();
    interacted();
    const pts = [{ x: s.x, y: G.walkY }, { x: G.door.x, y: G.walkY }, { x: G.door.x, y: G.door.y }]
      .filter((p, i, a) => i === 0 ? Math.hypot(p.x - s.x, p.y - s.y) > 1 : Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1);
    if (!pts.length) return;
    if (reduceMotion.matches) { const p = pts[pts.length - 1]; place(p.x, p.y); return; }
    let i = 0;
    let last = performance.now();
    root.classList.add('is-walking');
    const frame = (now) => {
      let dist = (s.bike ? G.speedBike : G.speedWalk) * (Math.min(50, now - last) / 1000);
      last = now;
      while (dist > 0 && i < pts.length) {
        const p = pts[i];
        const dx = p.x - s.x, dy = p.y - s.y, len = Math.hypot(dx, dy);
        if (len <= dist) { place(p.x, p.y); dist -= len; i++; }
        else { place(s.x + (dx / len) * dist, s.y + (dy / len) * dist); dist = 0; }
      }
      if (i < pts.length) s.anim = requestAnimationFrame(frame);
      else cancelWalk();
    };
    s.anim = requestAnimationFrame(frame);
  }

  // Button and circle follow the mode: "Walk there" on foot, "Ride there" by bike.
  function applyMode() {
    root.classList.toggle('is-bike', s.bike);
    walkBtn.textContent = s.bike ? t('ride') : t('walk');
    drawFence();
  }

  // A fresh trip from home: notification gone, milk not yet bought.
  function newTrip() {
    cancelWalk();
    clearTimeout(checkTimer);
    closeNotif();
    s.done = false;
    s.inside = false;
    s.facing = 1;
    doneBtn.disabled = false;
    notif.classList.remove('is-done', 'is-bump');
    root.classList.remove('is-inside', 'has-milk', 'is-dragging');
    applyMode();
    // Jump home facing the shop (place() would otherwise turn it towards home).
    s.x = G.start.x; s.y = G.start.y;
    place(G.start.x, G.start.y);
  }

  function reset() {
    s.bike = false;
    bikeInput.checked = false;
    newTrip();
    root.classList.add('is-fresh');
    setStatus(t('hint'));
  }

  // Pointer dragging (mouse, touch, pen). touch-action: none is set on the walker only.
  const toSvg = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  walker.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    cancelWalk();
    interacted();
    walker.setPointerCapture(e.pointerId);
    const p = toSvg(e);
    s.drag = { id: e.pointerId, dx: s.x - p.x, dy: s.y - p.y };
    root.classList.add('is-dragging');
    walker.focus({ preventScroll: true });
  });
  walker.addEventListener('pointermove', (e) => {
    if (!s.drag || e.pointerId !== s.drag.id) return;
    const p = toSvg(e);
    place(p.x + s.drag.dx, p.y + s.drag.dy);
    stepping();
  });
  const endDrag = (e) => {
    if (!s.drag || e.pointerId !== s.drag.id) return;
    s.drag = null;
    root.classList.remove('is-dragging');
  };
  walker.addEventListener('pointerup', endDrag);
  walker.addEventListener('pointercancel', endDrag);

  // Keyboard: arrows move (Shift for bigger steps), Enter/Space walks to the shop.
  const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  walker.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); walkToShop(); return; }
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    cancelWalk();
    interacted();
    const step = e.shiftKey ? 40 : 14;
    place(s.x + k[0] * step, s.y + k[1] * step);
    stepping();
  });

  walkBtn.addEventListener('click', walkToShop);
  $('.tdemo-reset').addEventListener('click', reset);

  doneBtn.addEventListener('click', () => {
    s.done = true;
    doneBtn.disabled = true;
    notif.classList.add('is-done');
    root.classList.add('has-milk');
    setStatus(t('afterDone'));
    closeTimer = setTimeout(closeNotif, reduceMotion.matches ? 1200 : 1700);
  });

  closeBtn.addEventListener('click', () => dismiss());

  // Sideways swipe on the notification. touch-action: pan-y keeps vertical page scroll.
  let swipe = null;
  notif.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !s.open || s.done || e.target.closest('button')) return;
    swipe = { id: e.pointerId, x0: e.clientX, dx: 0, w: notif.offsetWidth };
    notif.setPointerCapture(e.pointerId);
    notif.classList.add('is-swiping');
  });
  notif.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    swipe.dx = e.clientX - swipe.x0;
    notif.style.setProperty('--tdemo-swipe', `${swipe.dx}px`);
    notif.style.setProperty('--tdemo-swipe-o', String(Math.max(0.2, 1 - Math.abs(swipe.dx) / swipe.w)));
  });
  const endSwipe = (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const { dx, w } = swipe;
    swipe = null;
    notif.classList.remove('is-swiping');
    if (Math.abs(dx) > w * 0.3) {
      // Let it fly out the way it was going, then hide.
      notif.style.setProperty('--tdemo-swipe', `${Math.sign(dx) * w * 1.3}px`);
      notif.style.setProperty('--tdemo-swipe-o', '0');
      closeTimer = setTimeout(() => dismiss(true), reduceMotion.matches ? 0 : 220);
    } else {
      notif.style.setProperty('--tdemo-swipe', '0px');
      notif.style.setProperty('--tdemo-swipe-o', '1');
    }
  };
  notif.addEventListener('pointerup', endSwipe);
  notif.addEventListener('pointercancel', endSwipe);

  // By bike: bigger circle, so the reminder comes earlier. Switching mode starts a
  // new trip from home, so you see the notification arrive (earlier) on the way.
  bikeInput.addEventListener('change', () => {
    s.bike = bikeInput.checked;
    newTrip();
    setStatus(s.bike ? t('bikeNote') : t('hint'));
  });

  applyMode();
  place(G.start.x, G.start.y);
  setStatus(t('hint'));
}

function init() {
  document.querySelectorAll('[data-tick-demo]').forEach(mountDemo);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
