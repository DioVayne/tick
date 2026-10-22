'use strict';

// App-shell voor offline gebruik. Network-first: online krijg je altijd de nieuwste versie (geen mix van oude en
// nieuwe modules na een deploy), offline de laatst bewaarde. Verhoog de versie als de lijst hieronder verandert.
const CACHE = 'tick-shell-v45';
const SHELL = [
  '/', '/app.js', '/api.js', '/db.js', '/store.js', '/render.js', '/push.js', '/style.css', '/sortable.min.js',
  '/markdown.js', '/lists.js', '/editor.js', '/sidebar.js', '/detail.js', '/listpicker.js', '/listmenu.js', '/dialog.js',
  '/repeat.js', '/i18n.js', '/config.js', '/settings.js', '/repeatpicker.js', '/places.js', '/map.js', '/leaflet.js', '/leaflet.css',
  '/theme.js', '/settingsview.js', '/androidapp.js', '/applink.js', '/swclick.js', '/next.js', '/trash.js', '/share.js', '/copies.js', '/confetti.js', '/attachments.js', '/calendar.js', '/calendarview.js', '/help.js', '/datepicker.js', '/timepicker.js', '/icons.js', '/popover.js', '/swipe.js', '/badge.js', '/route.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/badge-96.png',
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
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-96.png', // wit op transparant: Android tekent de badge als silhouet
      tag: data.tag || data.taskId || (data.shareId ? 'share-' + data.shareId : 'tick'),
      renotify: !!data.tag, // een groepsmelding vervangt de vorige onder dezelfde tag, maar moet wel opnieuw afgaan
      data,
      // De server stuurt de knoppen vertaald mee; zonder taak geen knoppen.
      actions: data.taskId || data.shareId ? (data.actions ?? (data.taskId ? [{ action: 'done', title: '✓' }, { action: 'snooze', title: '+1h' }] : [])) : [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const { taskId, url, occurrence, shareId } = event.notification.data || {};
  event.notification.close();
  const call = (path, method, body) =>
    fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Uitnodiging om een taak te delen: Accepteren of Weigeren zonder de app te openen.
  if (shareId && (event.action === 'accept' || event.action === 'decline')) {
    event.waitUntil(call(`/api/shares/${shareId}/${event.action}`, 'POST', {}));
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
