// Raw screenshots of a local Tick with the demo data from seed.mjs.
// node shots.mjs <out-dir> [scene ...]   (no scenes: all of them)
import { chromium } from 'playwright';

const B = 'http://localhost:8801';
const KEY = 'tick_demorobin000000000000';
const out = process.argv[2];
const only = process.argv.slice(3);
const CLOCK = new Date('2026-11-03T16:20:00+01:00');
const AMSTERDAM = { latitude: 52.3770, longitude: 4.8840 };

async function api(path) {
  const r = await fetch(B + path, { headers: { authorization: 'Bearer ' + KEY, origin: B } });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}
const tasks = await api('/api/tasks');
const lists = await api('/api/lists');
const taskId = (title) => {
  const t = tasks.find((x) => x.title === title);
  if (!t) throw new Error('no task ' + title);
  return t.id;
};
const listId = (name) => {
  const l = lists.find((x) => x.name === name);
  if (!l) throw new Error('no list ' + name);
  return l.id;
};

/**
 * One scene = one raw PNG. `m` is a phone (390×844), `d` a desktop (1280×800), both at 2×.
 * `go` runs on the page after the hash has loaded; `init` runs before the page loads.
 * @type {{ name: string, kind: 'm' | 'd', scheme: 'light' | 'dark', hash: string,
 *   go?: (page: import('playwright').Page) => Promise<void>, init?: string, geo?: boolean, offline?: boolean }[]}
 */
export const SCENES = [];
const scene = (s) => SCENES.push(s);

for (const scheme of ['light', 'dark']) {
  scene({ name: 'm-all', kind: 'm', scheme, hash: '#/all' });
  scene({ name: 'm-home', kind: 'm', scheme, hash: () => '#/list/' + listId('Home') });
  scene({ name: 'm-groceries', kind: 'm', scheme, hash: () => '#/task/' + taskId('Buy groceries') });
  scene({ name: 'm-shared-list', kind: 'm', scheme, hash: () => '#/list/' + listId('Weekend in the Ardennes') });
  scene({ name: 'm-manager', kind: 'm', scheme, hash: '#/manager' });
  scene({ name: 'm-calendar', kind: 'm', scheme, hash: '#/calendar' });
  scene({ name: 'm-bathroom', kind: 'm', scheme, hash: () => '#/task/' + taskId('Paint the bathroom') });
  scene({ name: 'm-potluck', kind: 'm', scheme, hash: () => '#/task/' + taskId('Bring something for the potluck') });
  scene({ name: 'd-all', kind: 'd', scheme, hash: '#/all' });
  scene({ name: 'd-shared-list', kind: 'd', scheme, hash: () => '#/list/' + listId('Weekend in the Ardennes') });

  // Pickers and dialogs, opened the way a person would
  const tap = (text) => async (page) => { await page.getByText(text).locator('visible=true').first().click({ timeout: 8000 }); await page.waitForTimeout(1200); };
  scene({ name: 'm-location', kind: 'm', scheme, geo: true, hash: () => '#/task/' + taskId('Buy groceries'), go: tap('When I arrive at') });
  scene({ name: 'm-remind', kind: 'm', scheme, hash: () => '#/task/' + taskId('Buy groceries'), go: tap('Remind me') });
  scene({ name: 'm-repeat', kind: 'm', scheme, hash: () => '#/task/' + taskId('Water the plants'), go: tap('Every') });
  scene({ name: 'm-share', kind: 'm', scheme, hash: () => '#/task/' + taskId('Renew passport'), go: tap('Do it together with') });
  scene({ name: 'm-manager-round', kind: 'm', scheme, hash: '#/manager', go: tap('Start tidying up') });
  scene({ name: 'm-agenda', kind: 'm', scheme, hash: '#/calendar', go: tap('Agenda') });
  scene({ name: 'm-offline', kind: 'm', scheme, hash: () => '#/list/' + listId('Home'),
    go: async (page) => {
      // Without a connection: add a task, which Tick keeps until it is back online
      await page.locator('#add-title').click({ force: true });
      await page.context().setOffline(true);
      await page.keyboard.type('Pick up the dry cleaning');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    } });

  // Swipe: a finger halfway to the left over a task, not let go
  scene({ name: 'm-swipe', kind: 'm', scheme, hash: () => '#/list/' + listId('Home'), go: async (page) => {
    await page.evaluate(async (title) => {
      const li = [...document.querySelectorAll('li.task')].find((x) => x.textContent.includes(title));
      const r = li.getBoundingClientRect();
      const at = (x) => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: r.top + 30 });
      li.dispatchEvent(new PointerEvent('pointerdown', at(r.right - 40)));
      for (let x = r.right - 40; x > r.right - 200; x -= 20) {
        li.dispatchEvent(new PointerEvent('pointermove', at(x)));
        await new Promise((ok) => setTimeout(ok, 16));
      }
    }, 'Clean out the shed');
  } });

  // Drag: hold the grip and move a task halfway down the list
  scene({ name: 'm-drag', kind: 'm', scheme, hash: () => '#/list/' + listId('Home'), go: async (page) => {
    const grip = page.locator('li.task', { hasText: 'Fix the bike light' }).locator('.grip').first();
    const b = await grip.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(b.x + b.width / 2 + i, b.y + b.height / 2 + i * 14); await page.waitForTimeout(30); }
  } });

  // Driving mode: the browser reports a car at 45 km/h for a minute
  scene({ name: 'm-driving', kind: 'm', scheme, geo: true, hash: '#/all', init: `(() => {
    let n = 0;
    const fix = () => ({ coords: { latitude: 52.37 + n * 0.0004, longitude: 4.88, accuracy: 10, speed: 12.5 }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = (ok) => { const id = setInterval(() => { n++; ok(fix()); }, 2000); return id; };
    navigator.geolocation.getCurrentPosition = (ok) => ok(fix());
    navigator.geolocation.clearWatch = (id) => clearInterval(id);
  })()`, go: async (page) => { await page.clock.runFor(60_000); await page.waitForTimeout(1500); } });
}

const browser = await chromium.launch();
for (const s of SCENES) {
  if (only.length && !only.includes(s.name) && !only.includes(`${s.name}-${s.scheme}`)) continue;
  const mobile = s.kind === 'm';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 2, colorScheme: s.scheme, isMobile: mobile, hasTouch: mobile,
    locale: 'en-GB', timezoneId: 'Europe/Amsterdam',
    geolocation: AMSTERDAM, permissions: s.geo ? ['geolocation'] : [],
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: CLOCK });
  if (s.init) await page.addInitScript(s.init);
  await page.goto(B + '/');
  await page.waitForTimeout(1500);
  const hash = typeof s.hash === 'function' ? s.hash() : s.hash;
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(2000);
  if (s.offline) await ctx.setOffline(true);
  try {
    if (s.go) await s.go(page);
  } catch (e) {
    console.error('FAIL', s.name, s.scheme, e.message.split('\n')[0]);
    await ctx.close();
    continue;
  }
  await page.waitForTimeout(800);
  const file = `${out}/${s.name}-${s.scheme}.png`;
  await page.screenshot({ path: file });
  console.log(file);
  await ctx.close();
}
await browser.close();
