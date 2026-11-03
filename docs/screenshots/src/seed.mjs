const B = 'http://localhost:8801';
const K = { robin: 'tick_demorobin000000000000', sanne: 'tick_demosanne000000000000', alex: 'tick_demoalex0000000000000' };
async function api(path, method = 'GET', body, who) {
  const h = { 'content-type': 'application/json', origin: B };
  h.authorization = 'Bearer ' + K[who || 'robin'];
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const task = (b, who) => api('/api/tasks', 'POST', b, who);
const SANNE = '00000000-0000-4000-8000-0000000000a1', ALEX = '00000000-0000-4000-8000-0000000000a2';
const superm = { name: 'Albert Heijn Westerstraat', lat: 52.3787, lng: 4.8822, radius: 200, trigger: 'enter' };
const home = { name: 'Home', lat: 52.3731, lng: 4.8796, radius: 200, trigger: 'exit' };
const hw = { name: 'Hardware store', lat: 52.3664, lng: 4.8737, radius: 500, trigger: 'enter' };
for (const p of [{ name: 'Supermarket', lat: superm.lat, lng: superm.lng, radius: 200 }, { name: 'Home', lat: home.lat, lng: home.lng, radius: 200 }, { name: 'Hardware store', lat: hw.lat, lng: hw.lng, radius: 500 }]) await api('/api/places', 'POST', p);

const g = await task({ title: 'Buy groceries', list: 'Home', remind_at: '2026-10-27T17:30', location: superm,
  description: '- [x] Oat milk\n- [ ] Bread\n- [ ] Apples\n- [ ] Coffee beans\n- [ ] Pasta' });
await api('/api/tasks/' + g.id, 'PATCH', { pinned: true });
await api('/api/shares', 'POST', { task_id: g.id, to_user: SANNE, mode: 'shared' });
const inc = await api('/api/shares/incoming', 'GET', null, 'sanne');
for (const s of inc) await api(`/api/shares/${s.id}/accept`, 'POST', {}, 'sanne');
await task({ title: 'Return the parcel', list: 'Home', location: home });
await task({ title: 'Buy screws', list: 'Home', location: hw });
const w = await task({ title: 'Water the plants', list: 'Home', remind_at: '2026-10-28T09:00', repeat: 'FREQ=WEEKLY;BYDAY=WE' });
const bath = await task({ title: 'Paint the bathroom', list: 'Home', remind_at: '2026-10-31T10:00' });
const subs = [];
for (const t of ['Choose a colour', 'Buy paint and tape', 'Sand the walls', 'Paint']) subs.push(await task({ title: t, parent_id: bath.id }));
await api(`/api/tasks/${subs[0].id}/done`, 'POST', {}); await api(`/api/tasks/${subs[1].id}/done`, 'POST', {});
await task({ title: 'Call the dentist', list: 'Personal', remind_at: '2026-10-26T10:00' });
await task({ title: 'Birthday present for Mia', list: 'Personal', remind_at: '2026-11-02T12:00' });
await task({ title: 'Renew passport', list: 'Personal' });
await task({ title: 'Send the quarterly report', list: 'Work', remind_at: '2026-10-27T15:00' });
await task({ title: 'Prepare Thursday meeting', list: 'Work', remind_at: '2026-10-29T09:30' });
await task({ title: 'Book train tickets', list: 'Inbox' });

// Shared list
const trip = 'Weekend in the Ardennes';
await api('/api/lists', 'POST', { name: trip });
const items = ['Book the cabin', 'Rent a car', 'Firewood', 'Hiking map', 'Board games', 'Groceries for Friday', 'Beach towels'];
const ids = {};
for (const t of items) ids[t] = (await task({ title: t, list: trip })).id;
for (const u of [SANNE, ALEX]) await api('/api/shared-lists', 'POST', { name: trip, to_user: u });
for (const who of ['sanne', 'alex']) for (const l of await api('/api/shared-lists/incoming', 'GET', null, who)) await api(`/api/shared-lists/${l.id}/accept`, 'POST', {}, who);
await api(`/api/tasks/${ids['Book the cabin']}/done`, 'POST', {});
await api(`/api/tasks/${ids['Beach towels']}/done`, 'POST', {}, 'sanne');
await api('/api/tasks/' + ids['Rent a car'], 'PATCH', { claimed: true }, 'alex');
await api('/api/tasks/' + ids['Board games'], 'PATCH', { claimed: true }, 'sanne');
await api('/api/tasks/' + ids['Firewood'], 'PATCH', { claimed: true });

// Calendar and agenda: reminders spread over the weeks around the fixed clock (2026-10-27)
for (const [title, list, at] of [
  ['Dinner with Mia', 'Personal', '2026-10-30T19:00'], ['Dentist check-up', 'Personal', '2026-11-04T08:45'],
  ['Car to the garage', 'Home', '2026-11-06T08:00'], ['Team offsite', 'Work', '2026-11-12T09:00'],
  ['Pick up the new glasses', 'Personal', '2026-11-14T11:00'], ['Book the flights', 'Personal', '2026-11-18T20:00'],
  ['Window cleaner', 'Home', '2026-11-20T10:00'], ['Year planning', 'Work', '2026-11-25T13:00'],
]) await task({ title, list, remind_at: at });
await task({ title: 'Pay the rent', list: 'Home', remind_at: '2026-11-01T09:00', repeat: 'FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270701' });

// Attachment: a colour card for the bathroom, made here so it contains nothing personal
const { chromium } = await import('playwright');
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 600, height: 400 } });
await pg.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(3,1fr);height:400px;font:600 22px Segoe UI,sans-serif">
  ${[['#cfe0d8', 'Sage mist'], ['#e9dcc7', 'Oat'], ['#9db7c9', 'Harbour blue']].map(([c, n]) => `<div style="background:${c};display:flex;align-items:flex-end;padding:20px;color:#334">${n}</div>`).join('')}</body>`);
const png = await pg.screenshot();
await br.close();
const r = await fetch(`${B}/api/tasks/${bath.id}/attachments?name=colour-card.png&w=600&h=400`, { method: 'POST', body: png,
  headers: { 'content-type': 'image/png', origin: B, authorization: 'Bearer ' + K.robin } });
if (!r.ok) throw new Error('attachment ' + r.status + ' ' + await r.text());

// Group task: linked copies for Sanne and Alex; Sanne already ticked hers off
const gt = await task({ title: 'Bring something for the potluck', list: 'Personal', remind_at: '2026-10-31T18:00' });
for (const u of [SANNE, ALEX]) await api('/api/shares', 'POST', { task_id: gt.id, to_user: u, mode: 'copy' });
for (const who of ['sanne', 'alex']) for (const s of await api('/api/shares/incoming', 'GET', null, who)) {
  const a = await api(`/api/shares/${s.id}/accept`, 'POST', {}, who);
  if (who === 'sanne' && a.task_id) await api(`/api/tasks/${a.task_id}/done`, 'POST', {}, 'sanne');
}

// Tickmanager: tasks nobody looked at for weeks (created_at is set in seed-old.sql)
for (const [title, list] of [['Fix the bike light', 'Home'], ['Sort out the old photos', 'Personal'], ['Learn to bake sourdough', 'Personal'],
  ['Return the library books', 'Personal'], ['Clean out the shed', 'Home'], ['Update the team wiki', 'Work']]) await task({ title, list });
console.log('ok');
