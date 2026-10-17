'use strict';

// Klassiek script voor de service worker (importScripts): waar een tik op een melding heen gaat.
// Los van sw.js, zodat de test het kan uitvoeren zonder service worker.
// data: de gegevens van de melding; wins: de open vensters van Tick.
self.tickClickTarget = (data, wins) => {
  const { taskId, url } = data || {};
  if (wins[0]) return taskId ? { focus: wins[0], message: { type: 'open-task', id: taskId } } : { focus: wins[0] };
  return { open: taskId ? `/?task=${encodeURIComponent(taskId)}` : url || '/' };
};
