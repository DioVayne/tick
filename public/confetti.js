// Een korte confettiregen vanaf het vinkje als je een taak afvinkt. Eén canvas over het scherm dat zichzelf opruimt;
// bij "beweging beperken" in het systeem gebeurt er niets. Easter egg: een taak die alleen Dio en Medy delen krijgt hartjes.

const COLORS = ['#3d6cf2', '#f85149', '#fbbf24', '#2da44e', '#a371f7', '#ff7eb6'];
const COUNT = 40;
const DURATION_MS = 1100;
const GRAVITY = 0.0012; // px per ms²

const HEART_COLORS = ['#f85149', '#ff7eb6', '#d1242f', '#ff9bb3'];
const COUPLE = 'dio,medy';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/** Is `share` (van een hoofdtaak) gedeeld tussen precies Dio en Medy? Op voornaam, zonder hoofdlettergevoeligheid. */
export function isCouple(share) {
  if (!share) return false;
  const people = [share.owner, ...share.members.filter((m) => m.status === 'accepted')];
  return people.map((p) => p.name.trim().split(/\s+/)[0].toLowerCase()).sort().join(',') === COUPLE;
}

/** Een hartje met het midden op (0, 0), `size` breed. */
function heart(ctx, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.7);
  ctx.bezierCurveTo(-s * 1.2, -s * 0.1, -s * 0.6, -s * 1.1, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.2, -s * 0.1, 0, s * 0.7);
  ctx.fill();
}

/** Laat confetti (of met `hearts` hartjes) opspringen vanuit het midden van `from` (het vinkje). */
export function confetti(from, hearts = false) {
  if (reduced.matches || !from?.getBoundingClientRect) return;
  const box = from.getBoundingClientRect();
  const x0 = box.left + box.width / 2, y0 = box.top + box.height / 2;
  const ratio = devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(ratio, ratio);

  const bits = Array.from({ length: COUNT }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2; // vooral omhoog, waaierend
    const speed = 0.25 + Math.random() * 0.35; // px per ms
    return {
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 4, h: 3 + Math.random() * 3,
      spin: (Math.random() - 0.5) * (hearts ? 0.004 : 0.02), turn: hearts ? (Math.random() - 0.5) * 0.6 : Math.random() * Math.PI,
      size: 9 + Math.random() * 7,
      color: (hearts ? HEART_COLORS : COLORS)[Math.floor(Math.random() * (hearts ? HEART_COLORS : COLORS).length)],
    };
  });

  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    if (t >= DURATION_MS) return canvas.remove();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.min(1, (DURATION_MS - t) / 300); // vervaagt aan het eind
    for (const b of bits) {
      const x = x0 + b.vx * t, y = y0 + b.vy * t + GRAVITY * t * t / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.turn + b.spin * t);
      ctx.fillStyle = b.color;
      if (hearts) heart(ctx, b.size);
      else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
