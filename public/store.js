import { Offline, request } from './api.js';
import * as db from './db.js';
import { t as tr } from './i18n.js'; // tr: t is hier meestal een taak
import { zonedParts, zonedToUtc, getDefaultTime, nextOccurrence, normalizeRule } from './repeat.js';
import { applyListOp, findList, mergeLists, normName } from './lists.js';
import { PUSH_OFF_KEY } from './push.js';

const STEP = 1_000_000;
const UNDO_MS = 3000;
const REPEAT_UNDO_MS = 15 * 60_000; // zo lang kan een doorgeschoven herhaling nog terug (zoals op de server)

// Oude stand van een doorgeschoven herhalende taak, alleen in het geheugen: id -> { next, at, remind_at, notified, location_notified, kids, ms }.
const undoRepeat = new Map();

// Net afgevinkte taken (justDone): blijven even zichtbaar (doorgestreept) zodat je ze kunt terugzetten en de lijst niet verspringt.
export const state = {
  open: [], done: [], showDone: false, list: null, selected: null, justDone: new Map(), query: '',
  // Prullenbak: alleen online opgehaald (null = nog niet geladen of offline).
  showTrash: false, trash: /** @type {any[] | null} */ (null),
  // Openstaande uitnodigingen om een taak te delen (alleen online opgehaald).
  invites: /** @type {any[]} */ ([]),
  serverLists: [], extraLists: /** @type {string[]} */ ([]), offline: false, pending: 0,
};

const listeners = { change: [], error: [] };
export const on = (event, fn) => listeners[event].push(fn);
const changed = () => listeners.change.forEach((fn) => fn());
const report = (msg) => listeners.error.forEach((fn) => fn(msg));

const find = (id) => state.open.find((t) => t.id === id) ?? state.done.find((t) => t.id === id);

export const lists = () => mergeLists(state.serverLists, state.open.concat(state.done), state.extraLists);
export const listNames = () => lists().map((l) => l.name);

/** Een nieuwe lijst bestaat tot de eerste taak erin pas in deze sessie; een bestaande schrijfwijze wint. */
export function createList(name) {
  const known = findList(listNames(), name);
  if (known) return known;
  const fresh = normName(name);
  state.extraLists.push(fresh);
  changed();
  return fresh;
}

// ---------- wijzigingen ----------
// Elke wijziging is een op: { type: 'create' | 'update' | 'delete', ... }. Die passen we meteen lokaal toe
// (optimistisch), zetten we in de outbox en spelen we op volgorde af zodra de server bereikbaar is.

function applyLocal(op) {
  if (op.type === 'create') {
    if (!find(op.task.id)) state.open.push({ ...op.task });
    return;
  }
  if (op.type === 'delete') {
    const gone = (t) => t.id === op.id || t.parent_id === op.id;
    state.open = state.open.filter((t) => !gone(t));
    state.done = state.done.filter((t) => !gone(t));
    return;
  }
  if (op.type === 'list-rename' || op.type === 'list-delete') {
    state.open = applyListOp(state.open, op);
    state.done = applyListOp(state.done, op);
    const from = op.type === 'list-rename' ? op.from : op.name;
    const to = op.type === 'list-rename' ? op.to : 'Inbox';
    if (state.list === from) state.list = to; // na verwijderen ga je naar Inbox, ook als de taken mee zijn
    // Een lege sessielijst die hernoemd wordt blijft bestaan onder de nieuwe naam.
    const wasExtra = state.extraLists.includes(from);
    state.extraLists = state.extraLists.filter((n) => n !== from);
    if (wasExtra && op.type === 'list-rename') state.extraLists.push(to);
    state.serverLists = state.serverLists.filter((l) => l.name !== from);
    return;
  }
  const t = find(op.id);
  if (!t) return;
  const { done, occurrence, ...fields } = op.body;
  const { repeat, ...plain } = fields;
  Object.assign(t, plain);
  if ('remind_at' in fields) t.notified = false;
  if ('parent_id' in fields && fields.parent_id !== null) t.repeat = null;
  if ('remind_at' in fields || 'repeat' in fields) undoRepeat.delete(t.id); // een nieuwe tijd of ritme: niets meer om terug te draaien
  if (repeat === null || fields.remind_at === null) t.repeat = null; // zonder reminder bestaat geen ritme (ook niet als er een regel meekomt)
  else if (typeof repeat === 'string') {
    try {
      const rule = normalizeRule(repeat);
      const p = zonedParts(Date.now());
      const start = fields.remind_at ?? t.remind_at ?? new Date(zonedToUtc(p.y, p.m, p.d, getDefaultTime().h, getDefaultTime().mi)).toISOString();
      const at = nextOccurrence(rule, start, Date.now() - 1);
      if (at === null) throw new Error('einddatum voorbij');
      t.repeat = { rule, start, at };
      t.remind_at = at;
      t.notified = false;
    } catch { /* ongeldig ritme: de server weigert het en load() zet de stand recht */ }
  }
  if ('location' in fields) t.location_notified = false;
  if ('list' in fields) for (const x of state.open) if (x.parent_id === t.id) x.list = fields.list;
  // Herhalende taak: schuift door naar de volgende keer en blijft open (alleen als dit de verwachte keer is).
  // Na de einddatum is er geen volgende keer en rondt afvinken de taak gewoon af.
  const rolling = done === true && !t.done && t.repeat && !t.parent_id;
  if (rolling && occurrence !== undefined && occurrence !== t.repeat.at) return;
  const now = Date.parse(op.at);
  const next = rolling ? nextOccurrence(t.repeat.rule, t.repeat.start, Math.max(now, Date.parse(t.repeat.at))) : null;
  if (rolling && next !== null) {
    const kids = [...state.open, ...state.done].filter((x) => x.parent_id === t.id && x.done);
    // Elke stap overschrijft de stand: ongedaan maken draait de laatste stap terug (zoals op de server).
    undoRepeat.set(t.id, {
      next, at: t.repeat.at, remind_at: t.remind_at, notified: t.notified, location_notified: t.location_notified,
      kids: kids.map((x) => ({ id: x.id, done_at: x.done_at })), ms: now,
    });
    t.remind_at = next;
    t.repeat = { ...t.repeat, at: next };
    t.notified = false;
    if (t.location) t.location_notified = false;
    for (const x of kids) {
      x.done = false;
      x.done_at = null;
      if (!state.open.includes(x)) state.open.push(x);
    }
    state.done = state.done.filter((x) => x.done);
  } else if (done === false && !t.done && t.repeat) {
    // Alleen als het verzoek over de huidige keer gaat: een oud ongedaan maken draait een nieuwere stap niet terug.
    if (occurrence !== undefined && occurrence !== t.repeat.at) return;
    const prev = undoRepeat.get(t.id);
    undoRepeat.delete(t.id);
    if (prev && prev.next === t.repeat.at && Date.parse(op.at) - prev.ms < REPEAT_UNDO_MS) {
      t.remind_at = prev.remind_at;
      t.repeat = { ...t.repeat, at: prev.at };
      t.notified = prev.notified;
      t.location_notified = prev.location_notified;
      for (const k of prev.kids) {
        const x = find(k.id);
        if (x) { x.done = true; x.done_at = k.done_at; }
      }
    }
  } else if (done === true && !t.done) {
    // Net als de server: open subtaken gaan mee, met hetzelfde done_at.
    for (const x of [t, ...state.open.filter((x) => x.parent_id === t.id && !x.done)]) {
      x.done = true;
      x.done_at = op.at;
    }
  } else if (done === false && t.done) {
    // Heropenen zet precies die subtaken terug, en een heropende subtaak opent ook haar parent.
    const kids = [...state.open, ...state.done].filter((x) => x.parent_id === t.id && x.done && x.done_at === t.done_at);
    const parent = t.parent_id ? find(t.parent_id) : null;
    for (const x of [t, ...kids, ...(parent?.done ? [parent] : [])]) {
      x.done = false;
      x.done_at = null;
      if (!state.open.includes(x)) state.open.push(x);
    }
    state.done = state.done.filter((x) => x.done);
  }
}

function toHttp(op) {
  if (op.type === 'create') return ['POST', '/api/tasks', op.body];
  if (op.type === 'delete') return ['DELETE', `/api/tasks/${op.id}`];
  if (op.type === 'list-rename') return ['POST', '/api/lists/rename', { from: op.from, to: op.to }];
  if (op.type === 'list-delete') return ['POST', '/api/lists/delete', { name: op.name, tasks: op.tasks }];
  return ['PATCH', `/api/tasks/${op.id}`, op.body];
}

async function mutate(op) {
  await enqueue(op);
  return load();
}

/** Lokaal toepassen en in de outbox zetten. Resolvet zodra de wijziging veilig in IndexedDB staat (nog niet verstuurd). */
async function enqueue(op) {
  op.at = new Date().toISOString();
  applyLocal(op);
  state.pending++;
  changed();
  try {
    // Niet in de outbox van de vorige gebruiker schrijven terwijl die nog gewist wordt. Mislukte de controle, dan
    // kan de outbox van een ander zijn: dan niet erin schrijven (sync speelt hem dan toch niet af).
    if (!(await ownerReady)) return;
    await db.outboxAdd(op);
  } catch (e) {
    report(tr('store.save_failed', { reason: e.message }));
  }
}

let syncing = null;
/**
 * Speelt de outbox op volgorde af. Geeft false als er nog iets wacht (offline of serverfout).
 * Wacht eerst op de eigenaarscontrole van init; mislukte die, dan speelt hij niets af (de outbox kan van een ander zijn).
 */
export function sync() {
  syncing ??= (async () => {
    try {
      if (!(await ownerReady)) return false;
      for (let ops = await db.outboxAll(); ops.length; ops = await db.outboxAll()) {
        for (const op of ops) {
          try {
            await request(...toHttp(op));
          } catch (e) {
            if (e instanceof Offline) {
              state.offline = true;
              return false;
            }
            if (!e.status || e.status === 401 || e.status >= 500) return false; // later opnieuw
            // 404: de taak is elders al verwijderd, dan vervalt de wijziging stil. Andere 4xx lukken nooit meer.
            if (e.status !== 404) report(tr('store.change_refused', { reason: e.message }));
          }
          await db.outboxDelete(op.seq);
        }
      }
      state.offline = false;
      return true;
    } finally {
      syncing = null;
      state.pending = (await ownerReady) ? (await db.outboxAll().catch(() => [])).length : 0;
    }
  })();
  return syncing;
}

let loadSeq = 0;
/** Eerst de outbox versturen, dan de lijst van de server halen. Offline blijft de lokale lijst staan. */
export async function load() {
  const seq = ++loadSeq;
  await sync();
  try {
    const open = await request('GET', '/api/tasks');
    // Afgeronde taken laden we maar tot 200, dus daarin zoekt de server.
    const q = state.query.trim();
    const done = state.showDone ? await request('GET', '/api/tasks?done=1&limit=200' + (q ? '&q=' + encodeURIComponent(q) : '')) : state.done;
    // Een fout in de lijsten mag het verversen van de taken niet tegenhouden; de oude lijsten blijven dan staan.
    let serverLists = null;
    try {
      serverLists = await request('GET', '/api/lists');
    } catch (e) {
      if (e instanceof Offline) throw e;
    }
    // Net als de lijsten: een fout bij de uitnodigingen houdt de taken niet tegen.
    let invites = state.invites;
    try {
      invites = await request('GET', '/api/shares/incoming');
    } catch (e) {
      if (e instanceof Offline) throw e;
    }
    const owned = await ownerReady; // false: de lokale gegevens kunnen van een ander zijn, dan niet lezen of schrijven
    const queued = owned ? await db.outboxAll() : [];
    if (seq !== loadSeq) return; // inmiddels is er een nieuwere load gestart
    state.open = open;
    state.done = done;
    if (serverLists) state.serverLists = serverLists;
    state.invites = invites;
    state.offline = false;
    state.pending = queued.length;
    if (owned) {
      db.kvSet('open', open).catch(() => {});
      if (serverLists) db.kvSet('lists', serverLists).catch(() => {});
    }
    queued.forEach(applyLocal); // wat de server nog niet heeft, bijvoorbeeld na een serverfout
  } catch (e) {
    if (seq !== loadSeq) return;
    if (e instanceof Offline) state.offline = true;
    else report(tr('store.load_failed', { reason: e.message }));
  }
  changed();
}

/**
 * Een taak die na een verversing uit de open lijst verdween: elders afgevinkt of elders verwijderd. Kijkt bij de
 * laatst afgeronde taken (nieuwste eerst). Gevonden: hij komt in state.done en wordt teruggegeven; anders null.
 */
export async function findDone(id) {
  try {
    const recent = await request('GET', '/api/tasks?done=1&limit=50');
    const t = recent.find((x) => x.id === id);
    if (!t) return null;
    if (!find(id)) state.done.push(t);
    return t;
  } catch {
    return null; // niet na te gaan: dan als verwijderd behandelen, zoals voorheen
  }
}

export const SETTINGS_CACHE = 'tick.settings-cache';

/**
 * Uitkomst van de eigenaarscontrole die init start: true als de lokale gegevens van de ingelogde gebruiker zijn
 * (of gewist zijn), false als de controle mislukte. sync, load en de outbox wachten hierop.
 * @type {Promise<boolean>}
 */
let ownerReady = Promise.resolve(true);

const PUSH_TIMEOUT_MS = 2000;

/**
 * Meldt het push-abonnement van deze browser af, als dat er is. Faalt nooit en wacht hoogstens PUSH_TIMEOUT_MS
 * (een service worker die niet klaar wordt, mag het opstarten niet ophouden). De push-dienst geeft daarna 410 en
 * de server ruimt de rij op bij de volgende verzending.
 */
async function unsubscribePush() {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) return;
  let timer;
  const work = (async () => {
    const reg = await sw.ready;
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  })().catch(() => {});
  await Promise.race([work, new Promise((r) => { timer = setTimeout(r, PUSH_TIMEOUT_MS); })]);
  clearTimeout(timer);
}

/**
 * De lokale kopie hoort bij één gebruiker. Hoort hij bij een ander (of bij niemand: een cache van vóór de accounts),
 * dan wissen we kopie, outbox en de cache van de instellingen, zodat een gedeelde browser niets van de vorige laat zien.
 * Geeft true als er gewist is.
 * @param {string} userId
 */
export async function ensureOwner(userId) {
  const previous = await db.kvGet('owner');
  if (previous === userId) return false;
  // Een sessie kan eindigen zonder de knop Uitloggen (cookie verlopen, elders uitgelogd, resetlink). Het push-abonnement
  // van de browser hoort dan nog bij de vorige gebruiker: afmelden, anders krijgt deze browser diens herinneringen.
  // Zonder vorige eigenaar (cache van vóór de accounts) niet, anders verliest elke browser na de update zijn meldingen.
  if (previous) await unsubscribePush();
  await db.clearAll();
  try { localStorage.removeItem(SETTINGS_CACHE); localStorage.removeItem(PUSH_OFF_KEY); } catch { /* geen opslag */ }
  await db.kvSet('owner', userId);
  return true;
}

/**
 * Start: eerst de lokale kopie tonen (ook offline), dan verversen vanaf het netwerk.
 * @param {string} userId de ingelogde gebruiker (CONFIG.userId)
 */
export async function init(userId) {
  ownerReady = ensureOwner(userId).then(() => true, () => false);
  // Fail-closed: zonder geslaagde controle geen lokale kopie en geen outbox, alleen wat de server geeft.
  if (await ownerReady) {
    try {
      state.open = (await db.kvGet('open')) ?? [];
      state.serverLists = (await db.kvGet('lists')) ?? [];
      const queued = await db.outboxAll();
      state.pending = queued.length;
      queued.forEach(applyLocal);
    } catch { /* geen lokale kopie */ }
  }
  changed();
  return load();
}

// ---------- acties ----------
const newTask = (fields) => ({
  id: crypto.randomUUID(), description: '', remind_at: null, notified: false, location: null, location_notified: false, done: false, done_at: null, source: 'app', ...fields,
});

/** Nieuwe taak bovenaan; de server bepaalt bij het versturen de definitieve positie. */
export function addTask(title, remind_at, list) {
  const tops = state.open.filter((t) => !t.done);
  const position = tops.length ? Math.min(...tops.map((t) => t.position)) - STEP : 0;
  const task = newTask({ title, remind_at, list, parent_id: null, position });
  return mutate({ type: 'create', task, body: { id: task.id, title, remind_at, list } });
}

/** Nieuwe subtaak onderaan, in de lijst van de parent. Werkt ook als de parent zelf nog offline is aangemaakt. */
export function addSubtask(parent, title) {
  const sibs = state.open.filter((t) => t.parent_id === parent.id && !t.done);
  const position = sibs.length ? Math.max(...sibs.map((t) => t.position)) + STEP : 0;
  const task = newTask({ title, list: parent.list, parent_id: parent.id, position });
  return mutate({ type: 'create', task, body: { id: task.id, title, parent_id: parent.id } });
}

export const update = (id, body) => mutate({ type: 'update', id, body });

/** Als update, maar wacht alleen tot de wijziging in de outbox staat. Voor vlak voor een navigatie (Android-app wekken). */
export async function updateQueued(id, body) {
  await enqueue({ type: 'update', id, body });
  load();
}

// Absolute tijd in plaats van minuten: een offline uitgestelde reminder schuift dan niet op tot het moment van versturen.
export const snooze = (id, minutes) => update(id, { remind_at: new Date(Date.now() + minutes * 60_000).toISOString() });

export function remove(id) {
  if (state.selected === id) state.selected = null;
  return mutate({ type: 'delete', id });
}

// Een lijst zonder taken die de server kent (een sessielijst) bestaat alleen hier: dan geen serverop.
const knownToServer = (name) => state.serverLists.some((l) => l.name === name)
  || state.open.some((t) => t.list === name) || state.done.some((t) => t.list === name);

function listOp(op, name) {
  if (knownToServer(name)) return mutate(op);
  applyLocal(op);
  changed();
  return Promise.resolve();
}

export const renameList = (from, to) => listOp({ type: 'list-rename', from, to }, from);
export const deleteList = (name, tasks) => listOp({ type: 'list-delete', name, tasks }, name);

export function toggleDone(t) {
  const pending = state.justDone.get(t.id);
  if (pending) { // opnieuw tikken binnen de periode: ongedaan maken
    clearTimeout(pending.timer);
    state.justDone.delete(t.id);
    // Herhalende taak: de keer waar hij nu (na het lokale doorschuiven) op staat, zodat de server de juiste stap terugdraait.
    return update(t.id, t.repeat && !t.parent_id ? { done: false, occurrence: t.repeat.at } : { done: false });
  }
  if (t.done) return update(t.id, { done: false }); // tab "Afgerond": direct heropenen
  const timer = setTimeout(() => {
    state.justDone.delete(t.id);
    changed();
  }, UNDO_MS);
  state.justDone.set(t.id, { timer, task: t });
  return update(t.id, t.repeat && !t.parent_id ? { done: true, occurrence: t.repeat.at } : { done: true });
}

// ---------- prullenbak (alleen online) ----------

/** Haalt de prullenbak op; offline blijft state.trash null en toont de weergave dat. */
export async function loadTrash() {
  try {
    state.trash = await request('GET', '/api/tasks?deleted=1&limit=200');
  } catch (e) {
    state.trash = null;
    if (!(e instanceof Offline)) report(tr('store.load_failed', { reason: e.message }));
  }
  changed();
}

/** Een prullenbakactie op de server, daarna prullenbak en takenlijst opnieuw ophalen. */
async function trashAction(method, path) {
  try {
    await request(method, path, method === 'POST' ? {} : undefined);
  } catch (e) {
    report(e instanceof Offline ? tr('trash.offline') : tr('store.change_refused', { reason: e.message }));
    return;
  }
  await Promise.all([loadTrash(), load()]);
}

export const restoreTask = (id) => trashAction('POST', `/api/tasks/${id}/restore`);
export const purgeTask = (id) => trashAction('DELETE', `/api/tasks/${id}?purge=1`);
export const emptyTrash = () => trashAction('POST', '/api/trash/empty');
