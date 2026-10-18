'use strict';

// Klassiek script voor de service worker (importScripts): waar een tik op een melding heen gaat.
// Los van sw.js, zodat de test het kan uitvoeren zonder service worker.
// data: de gegevens van de melding; wins: de open vensters van Tick.
// Een url als /?task=<id> (zoals bij "is klaar ✓") werkt in een open venster net als taskId.
self.tickClickTarget = (data, wins) => {
  const { taskId, url } = data || {};
  if (wins[0]) {
    let id = taskId;
    if (!id && url) try { id = new URL(url, 'https://tick.invalid').searchParams.get('task'); } catch { /* geen geldige url */ }
    return id ? { focus: wins[0], message: { type: 'open-task', id } } : { focus: wins[0] };
  }
  return { open: taskId ? `/?task=${encodeURIComponent(taskId)}` : url || '/' };
};
