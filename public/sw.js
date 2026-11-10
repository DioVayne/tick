'use strict';

// App-shell voor offline gebruik. Network-first: online krijg je altijd de nieuwste versie (geen mix van oude en
// nieuwe modules na een deploy), offline de laatst bewaarde. Verhoog de versie als de lijst hieronder verandert.
const CACHE = 'tick-shell-v83';
const SHELL = [
  '/', '/app.js', '/api.js', '/db.js', '/store.js', '/render.js', '/review.js', '/planner.js', '/agenda.js', '/ics.js', '/manager.js', '/push.js', '/style.css', '/sortable.min.js',
  '/markdown.js', '/lists.js', '/editor.js', '/sidebar.js', '/detail.js', '/listpicker.js', '/listmenu.js', '/dialog.js',
  '/repeat.js', '/i18n.js', '/config.js', '/settings.js', '/repeatpicker.js', '/places.js', '/map.js', '/leaflet.js', '/leaflet.css',
  '/theme.js', '/settingsview.js', '/androidapp.js', '/applink.js', '/swclick.js', '/next.js', '/trash.js', '/share.js', '/sharedlist.js', '/copies.js', '/confetti.js', '/attachments.js', '/calendar.js', '/calendarview.js', '/help.js', '/datepicker.js', '/timepicker.js', '/icons.js', '/popover.js', '/swipe.js', '/badge.js', '/duestrip.js', '/route.js', '/drive.js', '/driveview.js', '/composer.js', '/steps.js', '/verifybar.js', '/report.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/badge-96.png',
];
importScripts('/swclick.js'); // zet self.tickClickTarget
const NETWORK_TIMEOUT_MS = 4000;

// De bestanden staan achter de inlog: een redirect naar /login mag nooit in de cache belanden.
const cacheable = (res) => res.ok && !res.redirected && res.type === 'basic';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((path) =>
    fetch(path).then((res) => cacheable(res) && cache.put(path, res)).catch(() => {})))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // API-data regelt de app zelf (IndexedDB); inlog en de worker zelf altijd via het netwerk.
  if (req.mode === 'navigate') {
    if (url.pathname === '/') event.respondWith(networkFirst(req, '/'));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(networkFirst(req, url.pathname));
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (cacheable(res)) cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'));
  const first = await Promise.race([network.catch(() => 'failed'), timeout]);
  if (first instanceof Response) return first;
  const hit = await cache.match(key);
  if (hit) return hit;
  // Niets in de cache: bij een trage verbinding toch op het netwerk wachten.
  return first === 'timeout' ? network : Response.error();
}

self.addEventListener('push', (event) => {
  let data = { title: 'Tick', body: '' };
  try { data = event.data.json(); } catch { /* gewone tekst */ }
  // Een open Tick laat de melding meteen zien (bijvoorbeeld een nieuwe deeluitnodiging), zonder te verversen.
  const refresh = self.clients.matchAll({ type: 'window' })
    .then((wins) => wins.forEach((w) => w.postMessage({ type: 'refresh' })))
    .catch(() => {});
  event.waitUntil(Promise.all([
    refresh,
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-96.png', // wit op transparant: Android tekent de badge als silhouet
      tag: data.tag || data.taskId || (data.shareId ? 'share-' + data.shareId : data.listInviteId ? 'slist-' + data.listInviteId : 'tick'),
      renotify: !!data.tag, // een groepsmelding vervangt de vorige onder dezelfde tag, maar moet wel opnieuw afgaan
      data,
      // De server stuurt de knoppen vertaald mee; zonder taak geen knoppen.
      actions: data.taskId || data.shareId || data.listInviteId ? (data.actions ?? (data.taskId ? [{ action: 'done', title: '✓' }, { action: 'snooze', title: 'In 1 hour' }] : [])) : [],
    }),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const { taskId, url, occurrence, shareId, listInviteId } = n.data || {};
  n.close();
  // Mislukt de actie (geen verbinding, sessie verlopen, serverfout), dan komt dezelfde melding met dezelfde knoppen
  // terug: anders denk je dat de taak is afgevinkt of verzet terwijl er niets gebeurde. Een andere 4xx (taak of
  // uitnodiging weg, op naam van een ander) lukt ook later niet: dan niet terug, zoals sync() in store.js.
  const showAgain = () => self.registration.showNotification(n.title, {
    body: n.body, icon: n.icon, badge: n.badge, tag: n.tag, data: n.data, actions: n.actions ?? [],
  }).catch(() => {});
  // Na de actie een open Tick laten verversen: het meldingenpaneel maakt de app niet onzichtbaar, dus zonder
  // dit bericht ziet hij de wijziging pas bij de volgende keer laden.
  const call = (path, method, body) =>
    fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => { if (res.redirected || res.status === 401 || res.status >= 500) return showAgain(); }, showAgain)
      .finally(() => self.clients.matchAll({ type: 'window' })
        .then((wins) => wins.forEach((w) => w.postMessage({ type: 'refresh' }))));
  // Uitnodiging om een taak te delen: Accepteren of Weigeren zonder de app te openen.
  if (shareId && (event.action === 'accept' || event.action === 'decline')) {
    event.waitUntil(call(`/api/shares/${shareId}/${event.action}`, 'POST', {}));
    return;
  }
  // Uitnodiging voor een gedeelde lijst: net zo.
  if (listInviteId && (event.action === 'accept' || event.action === 'decline')) {
    event.waitUntil(call(`/api/shared-lists/${listInviteId}/${event.action}`, 'POST', {}));
    return;
  }
  if (taskId && event.action === 'done') {
    event.waitUntil(call(`/api/tasks/${taskId}`, 'PATCH', { done: true, ...(occurrence ? { occurrence } : {}) }));
    return;
  }
  if (taskId && event.action === 'tomorrow') {
    event.waitUntil(call(`/api/tasks/${taskId}/tomorrow`, 'POST', {}));
    return;
  }
  if (taskId && event.action === 'snooze') {
    event.waitUntil(call(`/api/tasks/${taskId}/snooze`, 'POST', { minutes: 60 }));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const go = self.tickClickTarget({ taskId, url }, wins);
      if (!go.focus) return self.clients.openWindow(go.open);
      if (go.message) go.focus.postMessage(go.message);
      return go.focus.focus();
    }),
  );
});
