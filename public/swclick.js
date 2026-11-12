'use strict';

// Klassiek script voor de service worker (importScripts): waar een tik op een melding heen gaat.
// Los van sw.js, zodat de test het kan uitvoeren zonder service worker.
// data: de gegevens van de melding; wins: de open vensters van Tick.
// Een url als /?task=<id> (zoals bij "is klaar ✓") werkt in een open venster net als taskId; &geo=1 (een plek die een
// ander op een gedeelde taak zette) gaat mee, zodat de app kan aanbieden de Android-app te wekken; &when=1 ook, zodat
// de app de herinneringskiezer van de taak opent.
self.tickClickTarget = (data, wins) => {
  const { taskId, url } = data || {};
  let id = taskId;
  let geo = false;
  let when = false; // &when=1 (botsing met de agenda): de taak openen met de herinneringskiezer open
  if (url) {
    try {
      const params = new URL(url, 'https://tick.invalid').searchParams;
      if (!id) {
        id = params.get('task');
        geo = params.get('geo') === '1';
      }
      when = params.get('when') === '1';
    } catch { /* geen geldige url */ }
  }
  if (wins[0]) {
    if (!id) return { focus: wins[0] };
    const message = { type: 'open-task', id };
    if (geo) message.geo = true;
    if (when) message.when = true;
    return { focus: wins[0], message };
  }
  return { open: taskId ? `/?task=${encodeURIComponent(taskId)}${when ? '&when=1' : ''}` : url || '/' };
};
