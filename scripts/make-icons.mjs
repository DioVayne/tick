// Genereert de PNG-iconen van Tick (geen dependencies). public/icon.svg (het favicon) is dezelfde speld,
// maar groter, zonder achtergrond en met een dikker vinkje, zodat hij op 16 px nog leesbaar is.
// public/badge-96.png (wit vinkje op transparant, voor meldingen) maakt dit script niet.
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

function png(size) {
  const SS = 4; // 4×4 monsters per pixel voor gladde randen
  const s = 512 / (size * SS);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const cover = new Float32Array(size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    cover.fill(0);
    for (let sy = 0; sy < SS; sy++) {
      const py = (y * SS + sy + 0.5) * s;
      const xs = pinSpans(py);
      for (let x = 0; x < size; x++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x * SS + sx + 0.5) * s;
          let inPin = false;
          for (let i = 0; i < xs.length; i += 2) if (px >= xs[i] && px < xs[i + 1]) inPin = true;
          if (!inPin) continue;
          const d = Math.min(distToSeg(px, py, ...CHECK[0], ...CHECK[1]), distToSeg(px, py, ...CHECK[1], ...CHECK[2]));
          if (d > CHECK_HALF) cover[x]++;
        }
      }
    }
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const a = cover[x] / (SS * SS);
      for (let c = 0; c < 3; c++) raw[o++] = Math.round(BG[c] + (PIN[c] - BG[c]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size));
}
