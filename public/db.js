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
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
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

export async function outboxDelete(seq) {
  if (await open()) return tx('outbox', 'readwrite', (s) => s.delete(seq));
  memory.outbox.delete(seq);
}
