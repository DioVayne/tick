// Klein IndexedDB-wrappertje: `kv` voor de lokale kopie van de lijst, `outbox` voor wijzigingen die nog naar de server moeten.
// Zonder IndexedDB (bijv. sommige privévensters) valt het terug op geheugen; offline werken overleeft dan geen herstart.

let dbp;
function open() {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open('tick', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

const memory = { kv: new Map(), outbox: new Map(), seq: 0 };

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    let t, req;
    try {
      t = db.transaction(store, mode);
      req = fn(t.objectStore(store));
    } catch (e) {
      // Verbinding kwijt (de browser sloot hem, opslag gewist, versiewissel): de volgende aanroep opent opnieuw.
      if (e?.name === 'InvalidStateError') dbp = undefined;
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export async function kvGet(key) {
  return (await open()) ? tx('kv', 'readonly', (s) => s.get(key)) : memory.kv.get(key);
}

export async function kvSet(key, value) {
  if (await open()) return tx('kv', 'readwrite', (s) => s.put(value, key));
  memory.kv.set(key, value);
}

/** Alle wachtende wijzigingen, oudste eerst. */
export async function outboxAll() {
  return (await open()) ? tx('outbox', 'readonly', (s) => s.getAll()) : [...memory.outbox.values()];
}

export async function outboxAdd(op) {
  if (await open()) return tx('outbox', 'readwrite', (s) => s.add(op));
  op.seq = ++memory.seq;
  memory.outbox.set(op.seq, op);
}

/**
 * Schrijft een wachtende wijziging terug onder dezelfde `seq`, bijvoorbeeld met het aantal mislukte pogingen. Alleen als
 * hij er nog staat (lezen en schrijven in één transactie): heeft een ander tabblad hem intussen verstuurd en gewist, dan
 * zou terugzetten hem nog eens laten versturen, over een nieuwere wijziging heen.
 */
export async function outboxPut(op) {
  if (await open()) {
    return tx('outbox', 'readwrite', (s) => {
      const req = s.get(op.seq);
      req.onsuccess = () => { if (req.result) s.put(op); };
      return req;
    });
  }
  if (memory.outbox.has(op.seq)) memory.outbox.set(op.seq, op);
}

export async function outboxDelete(seq) {
  if (await open()) return tx('outbox', 'readwrite', (s) => s.delete(seq));
  memory.outbox.delete(seq);
}

/** Wist de lokale kopie en de outbox, bijvoorbeeld bij uitloggen of als er iemand anders inlogt. */
export async function clearAll() {
  if (await open()) {
    await tx('kv', 'readwrite', (s) => s.clear());
    await tx('outbox', 'readwrite', (s) => s.clear());
    return;
  }
  memory.kv.clear();
  memory.outbox.clear();
}
