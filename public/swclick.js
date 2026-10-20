'use strict';

// Klassiek script voor de service worker (importScripts): waar een tik op een melding heen gaat.
// Los van sw.js, zodat de test het kan uitvoeren zonder service worker.
// data: de gegevens van de melding; wins: de open vensters van Tick.
// Een url als /?task=<id> (zoals bij "is klaar ✓") werkt in een open venster net als taskId; &geo=1 (een plek die een
// ander op een gedeelde taak zette) gaat mee, zodat de app kan aanbieden de Android-app te wekken.
self.tickClickTarget = (data, wins) => {
  const { taskId, url } = data || {};
  if (wins[0]) {
    let id = taskId;
    let geo = false;
    if (!id && url) {
      try {
        const params = new URL(url, 'https://tick.invalid').searchParams;
        id = params.get('task');
        geo = params.get('geo') === '1';
      } catch { /* geen geldige url */ }
    }
    return id ? { focus: wins[0], message: geo ? { type: 'open-task', id, geo } : { type: 'open-task', id } } : { focus: wins[0] };
  }
  return { open: taskId ? `/?task=${encodeURIComponent(taskId)}` : url || '/' };
};
