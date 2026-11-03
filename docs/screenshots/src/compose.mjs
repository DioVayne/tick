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
const tile = (img, x, y) => crop(img, x, y, 330, 198, 280) + '&r=16';

export const IMAGES = {
  'hero.png': 'type=hero&img=m-home-light&img2=m-groceries-light&img3=m-shared-list-light',

  'feature-places.png': crop('m-location-light', 0, 130, 390, 477, 340),
  'feature-sharing.png': crop('m-shared-list-light', 0, 130, 390, 560, 340),
  'feature-tickmanager.png': crop('m-manager-round-light', 0, 50, 390, 262, 340),

  'tile-attachments.png': tile('m-bathroom-light', 0, 680),
  'tile-group-tasks.png': crop('m-potluck-light', 40, 332, 348, 209, 280) + '&r=16',
  'tile-subtasks.png': tile('m-home-light', 60, 548),
  'tile-reminders.png': crop('m-remind-light', 0, 588, 390, 234, 280) + '&r=16',
  'tile-repeat.png': tile('m-repeat-light', 0, 425),
  'tile-swipe.png': tile('m-swipe-light', 60, 150),
  'tile-drag.png': tile('m-drag-light', 0, 400),
  'tile-calendar.png': tile('m-calendar-light', 0, 150),
  'tile-agenda.png': tile('m-agenda-light', 0, 165),
  'tile-driving.png': crop('m-driving-light', 0, 62, 390, 234, 280) + '&r=16',
  'tile-offline.png': tile('m-offline-light', 12, 55),
  'tile-dark-mode.png': tile('m-home-dark', 0, 0),

  // For docs/sharing.md
  'shared-list.png': 'type=phone&img=m-shared-list-light&w=250',
  'sharing.png': 'type=phone&img=m-share-light&w=250',
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
  const bars = query.startsWith('type=crop') ? [] : await Promise.all(shots.map(topColour));
  await p.goto(`${page}?${query}${bars.length ? '&bar=' + bars.join(',') : ''}`);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const png = await p.locator('#stage').screenshot({ omitBackground: true });
  // A palette PNG (with alpha) is a quarter of the size and looks the same at README size
  const small = await sharp(png).png({ palette: true, quality: 92, effort: 10 }).toBuffer();
  writeFileSync(`${dir}/${name}`, small);
  console.log(name, Math.round(small.length / 1024) + ' KB');
}
await browser.close();
