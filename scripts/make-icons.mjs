// Genereert de PNG-iconen van Tick (geen dependencies). public/icon.svg (het favicon) is dezelfde speld,
// maar groter, zonder achtergrond en met een dikker vinkje, zodat hij op 16 px nog leesbaar is.
// public/badge-96.png (wit vinkje op transparant, voor meldingen) maakt dit script niet. Wel het meldingsicoon van de
// Android-app als PNG per dichtheid (ic_notify_bitmap): Chrome valt daarop terug als de badge van de site niet laadt,
// en Browser Helper geeft Chrome alleen een bitmap door, geen vector.
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// De vormen in het 512-raster: gele speld met een vinkje erin, op leisteenblauw.
const BG = [0x1e, 0x29, 0x3b];
const PIN = [0xfc, 0xd3, 0x4d];
const PIN_CURVES = [
  [[256, 104], [184, 104], [132, 158], [132, 226]],
  [[132, 226], [132, 312], [256, 416], [256, 416]],
  [[256, 416], [256, 416], [380, 312], [380, 226]],
  [[380, 226], [380, 158], [328, 104], [256, 104]],
];
const CHECK = [[204, 226], [242, 264], [314, 184]];
const CHECK_HALF = 18;

const bezier = ([a, b, c, d], t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]);
};
const pinPoly = PIN_CURVES.flatMap((curve) => Array.from({ length: 64 }, (_, i) => bezier(curve, i / 64)));

// Snijpunten van een horizontale lijn met de speld (even-odd), in 512-coördinaten.
function pinSpans(y) {
  const xs = [];
  for (let i = 0; i < pinPoly.length; i++) {
    const [ax, ay] = pinPoly[i], [bx, by] = pinPoly[(i + 1) % pinPoly.length];
    if ((ay <= y) !== (by <= y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
  }
  return xs.sort((a, b) => a - b);
}

// Bedekking per pixel (0..1) van de speld met het vinkje uitgespaard. toGrid zet een pixelcoördinaat om naar het 512-raster.
function coverage(size, toGrid) {
  const SS = 4; // 4×4 monsters per pixel voor gladde randen
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let sy = 0; sy < SS; sy++) {
      const py = toGrid(y + (sy + 0.5) / SS);
      const xs = pinSpans(py);
      for (let x = 0; x < size; x++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = toGrid(x + (sx + 0.5) / SS);
          let inPin = false;
          for (let i = 0; i < xs.length; i += 2) if (px >= xs[i] && px < xs[i + 1]) inPin = true;
          if (!inPin) continue;
          const d = Math.min(distToSeg(px, py, ...CHECK[0], ...CHECK[1]), distToSeg(px, py, ...CHECK[1], ...CHECK[2]));
          if (d > CHECK_HALF) out[y * size + x] += 1 / (SS * SS);
        }
      }
    }
  }
  return out;
}

// colorType 2 = RGB, 6 = RGBA; pixel(a) geeft de kanalen bij bedekking a.
function encode(size, colorType, cover, pixel) {
  const channels = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(size * (size * channels + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) for (const v of pixel(cover[y * size + x])) raw[o++] = v;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// App-icoon: de speld over het hele vlak, op leisteenblauw.
const png = (size) =>
  encode(size, 2, coverage(size, (p) => (p * 512) / size), (a) => BG.map((b, c) => Math.round(b + (PIN[c] - b) * a)));

// Meldingsicoon (24 dp): wit op transparant, met de schaal en verschuiving van drawable/ic_notify.xml.
const notifyPng = (size) =>
  encode(size, 6, coverage(size, (p) => ((p * 24) / size + 4.41) / 0.0641), (a) => [255, 255, 255, Math.round(255 * a)]);

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size));
}
for (const [density, size] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  const dir = new URL(`../android/app/src/main/res/drawable-${density}/`, import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(new URL('ic_notify_bitmap.png', dir), notifyPng(size));
}
