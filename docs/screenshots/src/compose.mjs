// Renders compose.html into the transparent PNGs in docs/screenshots/.
// node compose.mjs <docs/screenshots dir> [name ...]   (no names: all of them)
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const dir = process.argv[2];
const only = process.argv.slice(3);
const page = `${pathToFileURL(dir).href}/src/compose.html`;

// Crops are in the CSS pixels of a 390×844 phone screen: x, y, cw (width), ch (height).
const crop = (img, x, y, cw, ch, w) => `type=crop&img=${img}&x=${x}&y=${y}&cw=${cw}&ch=${ch}&w=${w}`;
// Tiles show a 330×198 part of the screen at 280 px wide, so the text stays readable in a three-column table.
const tile = (img, x, y, cw = 330, ch = 198) => crop(img, x, y, cw, ch, 280) + '&r=14&flat=1';
// A feature card: the phone on a coloured card, a ring around one detail (x,y,w,h[,round]) and that detail magnified (x,y,w,h)
const card = (img, bg, accent, pill, ring, cropAt, extra = '') =>
  `type=card&img=${img}&bg=${bg}&accent=${accent}&pill=${encodeURIComponent(pill)}&ring=${ring}&crop=${cropAt}${extra}`;

export const IMAGES = {
  'hero.png': 'type=banner&bg=1e293b&img=m-home-dark&img2=m-groceries-dark&img3=m-shared-list-dark',

  'feature-places.png': card('m-location-dark', '0f3633', '5eead4', 'Android app', '122,217,145,145,round', '45,180,300,224'),
  'feature-sharing.png': card('m-shared-list-dark', '1f2352', 'a5b4fc', 'Web and Android', '8,140,282,150', '2,134,294,156', '&flip=1'),
  'feature-tickmanager.png': card('m-manager-round-dark', '3b2a12', 'fbbf24', 'Web and Android', '8,118,374,186', '2,112,386,198', '&h=340'),

  'tile-attachments.png': tile('m-bathroom-dark', 0, 690, 300, 180),
  'tile-group-tasks.png': tile('m-potluck-dark', 0, 318, 390, 234),
  'tile-subtasks.png': tile('m-home-dark', 60, 548),
  'tile-reminders.png': tile('m-remind-dark', 0, 597, 390, 234),
  'tile-repeat.png': tile('m-repeat-dark', 0, 425),
  'tile-swipe.png': tile('m-swipe-dark', 0, 130),
  'tile-drag.png': tile('m-drag-dark', 0, 412),
  'tile-calendar.png': tile('m-calendar-dark', 0, 150),
  'tile-agenda.png': tile('m-agenda-dark', 0, 150),
  'tile-driving.png': tile('m-driving-dark', 0, 62, 390, 234),
  'tile-offline.png': tile('m-offline-dark', 0, 55),
  'tile-light-mode.png': tile('m-home-light', 0, 0),

  // For docs/sharing.md
  'shared-list.png': 'type=phone&img=m-shared-list-dark&w=250',
  'sharing.png': 'type=phone&img=m-share-dark&w=250',
};

async function topColour(shot) {
  const { data } = await sharp(`${dir}/src/raw/${shot}.png`).extract({ left: 700, top: 4, width: 1, height: 1 }).raw()
    .toBuffer({ resolveWithObject: true });
  return [...data].slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
for (const [name, query] of Object.entries(IMAGES)) {
  if (only.length && !only.includes(name)) continue;
  // The status bar above a phone screen takes the colour of the top of that screen (dimmed behind a dialog, dark in dark mode)
  const shots = [...new URLSearchParams(query)].filter(([k]) => /^img\d?$/.test(k)).map(([, v]) => v);
  const bars = await Promise.all(shots.map(topColour));
  await p.goto(`${page}?${query}${bars.length ? '&bar=' + bars.join(',') : ''}`);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const png = await p.locator('#stage').screenshot({ omitBackground: true });
  // A palette PNG (with alpha) is a quarter of the size and looks the same at README size
  const small = await sharp(png).png({ palette: true, quality: 88, effort: 10 }).toBuffer();
  writeFileSync(`${dir}/${name}`, small);
  console.log(name, Math.round(small.length / 1024) + ' KB');
}
await browser.close();
