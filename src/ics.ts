// Een kleine ICS-lezer voor gekoppelde agenda's: alleen titel, begin, einde en hele dag, alleen binnen een venster.
// Herhalen gaat via public/repeat.js (dezelfde RRULE-subset als de taken); wat daarbuiten valt, wordt overgeslagen.
// Beschrijving, deelnemers, locatie en de rest worden nooit gelezen of bewaard.
import { getTimeZone, normalizeRule, occurrencesBetween, setTimeZone, zonedParts, zonedToUtc } from '../public/repeat.js';

export type CalEvent = { title: string; start: number; end: number; allDay: boolean };

type Prop = { value: string; params: Record<string, string> };
type Raw = {
  uid: string; summary: string; start?: Prop; end?: Prop; duration?: string; rrule?: string;
  exdates: Prop[]; recurrenceId?: Prop; cancelled: boolean; free: boolean;
};
type When = { ms: number; allDay: boolean; zone: string };

const DAY = 86_400_000;
const MAX_TITLE = 200;

// Windows-namen die Outlook als TZID gebruikt, naar IANA. Een onbekende naam valt terug op de zone van de gebruiker.
const WINDOWS: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul', UTC: 'UTC', 'Coordinated Universal Time': 'UTC',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'Atlantic Standard Time': 'America/Halifax', 'E. South America Standard Time': 'America/Sao_Paulo',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'Tokyo Standard Time': 'Asia/Tokyo', 'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai', 'Singapore Standard Time': 'Asia/Singapore', 'Arabian Standard Time': 'Asia/Dubai',
  'South Africa Standard Time': 'Africa/Johannesburg', 'New Zealand Standard Time': 'Pacific/Auckland',
};

const zoneOk = new Map<string, boolean>();
function validZone(z: string): boolean {
  let ok = zoneOk.get(z);
  if (ok === undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: z }); ok = true; } catch { ok = false; }
    zoneOk.set(z, ok);
  }
  return ok;
}

/** TZID naar een IANA-zone, of null als die onbekend is. */
export function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const z = tzid.replace(/^"|"$/g, '').trim();
  if (validZone(z)) return z;
  if (WINDOWS[z]) return WINDOWS[z];
  const parts = z.split('/').filter(Boolean); // bv. /mozilla.org/20050126_1/Europe/Amsterdam
  for (let i = 1; i < parts.length; i++) {
    const tail = parts.slice(i).join('/');
    if (validZone(tail)) return tail;
  }
  return null;
}

/** `fn` met de rekenmodule tijdelijk in zone `z` (synchroon; daarna de vorige zone terug). */
function inTz<T>(z: string, fn: () => T): T {
  const prev = getTimeZone();
  setTimeZone(z);
  try { return fn(); } finally { setTimeZone(prev); }
}

/** Een regel `NAME;P=V;P2="a:b":waarde` in naam, parameters en waarde. */
function splitLine(line: string): { name: string; prop: Prop } | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...rest] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), prop: { value: line.slice(colon + 1).trim(), params } };
}

const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();

/** Eén datum of datum-tijd. Hele dag en zwevende tijden in `fallback` (de zone van de gebruiker). */
function parseWhen(value: string, params: Record<string, string>, fallback: string): When | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (d) return { ms: inTz(fallback, () => zonedToUtc(+d[1], +d[2], +d[3], 0, 0)), allDay: true, zone: fallback };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [y, mo, da, h, mi, s] = m.slice(1, 7).map(Number);
  // Een tijd in UTC (…Z) negeert TZID, en een reeks met zo'n begin herhaalt op een vaste UTC-tijd (RFC 5545).
  if (m[7]) return { ms: Date.UTC(y, mo - 1, da, h, mi, s), allDay: false, zone: 'UTC' };
  const zone = resolveZone(params.TZID) ?? fallback;
  return { ms: inTz(zone, () => zonedToUtc(y, mo, da, h, mi)) + s * 1000, allDay: false, zone };
}

/** ISO-duur (P1D, PT1H30M, P1W) in ms, of null. */
function parseDuration(s: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s);
  if (!m || s === 'P' || s.endsWith('T')) return null;
  const [w, d, h, mi, sec] = m.slice(2).map((x) => Number(x ?? 0));
  return (m[1] === '-' ? -1 : 1) * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + sec) * 1000;
}

const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Een RRULE uit een agenda naar de subset van repeat.js, plus COUNT. null = niet te begrijpen (de reeks wordt
 * overgeslagen). `start` is het begin in de zone van het event.
 */
function translateRule(rrule: string, start: When): { rule: string; count: number | null } | null {
  const kv: Record<string, string> = {};
  for (const part of rrule.toUpperCase().split(';')) {
    const [k, v] = part.split('=');
    if (k && v) kv[k] = v;
  }
  delete kv.WKST;
  const p = inTz(start.zone, () => zonedParts(start.ms));
  let count: number | null = null;
  if (kv.COUNT) {
    count = Number(kv.COUNT);
    if (!Number.isInteger(count) || count < 1) return null;
    delete kv.COUNT;
  }
  if (kv.UNTIL) {
    const u = /^(\d{8})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(kv.UNTIL);
    if (!u) return null;
    if (u[5]) {
      const ms = Date.UTC(+u[1].slice(0, 4), +u[1].slice(4, 6) - 1, +u[1].slice(6, 8), +u[2], +u[3], +u[4]);
      const l = inTz(start.zone, () => zonedParts(ms));
      kv.UNTIL = `${l.y}${String(l.m).padStart(2, '0')}${String(l.d).padStart(2, '0')}`;
    } else kv.UNTIL = u[1];
  }
  if (kv.BYSETPOS) {
    // Outlook: "de tweede dinsdag" als BYDAY=TU;BYSETPOS=2.
    if (kv.FREQ !== 'MONTHLY' || !kv.BYDAY || kv.BYDAY.includes(',') || !/^(-1|[1-4])$/.test(kv.BYSETPOS)) return null;
    kv.BYDAY = kv.BYSETPOS + kv.BYDAY;
    delete kv.BYSETPOS;
  }
  if (kv.FREQ === 'DAILY' && kv.BYDAY) {
    if ((kv.INTERVAL ?? '1') !== '1' || /\d/.test(kv.BYDAY)) return null;
    kv.FREQ = 'WEEKLY';
  }
  if (kv.FREQ === 'YEARLY') {
    if (kv.BYMONTH && Number(kv.BYMONTH) === p.m) delete kv.BYMONTH;
    if (kv.BYMONTHDAY && Number(kv.BYMONTHDAY) === p.d) delete kv.BYMONTHDAY;
  }
  if (kv.FREQ === 'WEEKLY' && kv.BYDAY === CODES[p.wd]) delete kv.BYDAY;
  const rule = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(';');
  try { return { rule: normalizeRule(rule), count }; } catch { return null; }
}

/** Alle VEVENTs als ruwe velden; geneste onderdelen (VALARM) worden overgeslagen. */
function readEvents(text: string): Raw[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: Raw[] = [];
  let cur: Raw | null = null;
  let nested = 0;
  for (const line of lines) {
    if (line.startsWith('BEGIN:')) {
      if (line === 'BEGIN:VEVENT' && !cur) cur = { uid: '', summary: '', exdates: [], cancelled: false, free: false };
      else if (cur) nested++;
      continue;
    }
    if (line.startsWith('END:')) {
      if (cur && nested) nested--;
      else if (cur && line === 'END:VEVENT') { out.push(cur); cur = null; }
      continue;
    }
    if (!cur || nested) continue;
    const s = splitLine(line);
    if (!s) continue;
    const { name, prop } = s;
    switch (name) {
      case 'UID': cur.uid = prop.value; break;
      case 'SUMMARY': cur.summary = unescape(prop.value).slice(0, MAX_TITLE); break;
      case 'DTSTART': cur.start = prop; break;
      case 'DTEND': cur.end = prop; break;
      case 'DURATION': cur.duration = prop.value; break;
      case 'RRULE': cur.rrule = prop.value; break;
      case 'EXDATE': cur.exdates.push(prop); break;
      case 'RECURRENCE-ID': cur.recurrenceId = prop; break;
      case 'STATUS': cur.cancelled = prop.value.toUpperCase() === 'CANCELLED'; break;
      case 'TRANSP': cur.free = prop.value.toUpperCase() === 'TRANSPARENT'; break;
      default: break; // DESCRIPTION, ATTENDEE, LOCATION en de rest: nooit gelezen
    }
  }
  return out;
}

/** Begin en duur van een event, of null als het begin onleesbaar is. */
function timing(r: Raw, zone: string): { start: When; dur: number } | null {
  if (!r.start) return null;
  const start = parseWhen(r.start.value, r.start.params, zone);
  if (!start) return null;
  let dur = start.allDay ? DAY : 0;
  if (r.end) {
    const end = parseWhen(r.end.value, r.end.params, zone);
    if (end && end.ms >= start.ms) dur = end.ms - start.ms;
  } else if (r.duration) {
    const d = parseDuration(r.duration);
    if (d !== null && d >= 0) dur = d;
  }
  return { start, dur };
}

/**
 * De events die [from, to) raken, gesorteerd op begin, hoogstens `max`. `zone` is de zone van de gebruiker, voor hele
 * dagen en tijden zonder zone. Geannuleerde en "vrij"-events (TRANSP:TRANSPARENT) tellen niet.
 */
export function parseIcs(text: string, o: { from: number; to: number; zone: string; max?: number }): CalEvent[] {
  const zone = validZone(o.zone) ? o.zone : 'UTC';
  const raws = readEvents(text);
  // Uitzonderingen per reeks: welke keren vervangen of geschrapt zijn.
  const replaced = new Map<string, Set<number>>();
  for (const r of raws) {
    if (!r.recurrenceId) continue;
    const w = parseWhen(r.recurrenceId.value, r.recurrenceId.params, zone);
    if (!w) continue;
    let set = replaced.get(r.uid);
    if (!set) replaced.set(r.uid, (set = new Set()));
    set.add(w.ms);
  }
  const out: CalEvent[] = [];
  const add = (title: string, start: number, dur: number, allDay: boolean) => {
    if (start < o.to && start + Math.max(dur, 1) > o.from) out.push({ title, start, end: start + dur, allDay });
  };
  for (const r of raws) {
    if (r.cancelled || r.free) continue;
    const tm = timing(r, zone);
    if (!tm) continue;
    const { start, dur } = tm;
    if (!r.rrule || r.recurrenceId) {
      add(r.summary, start.ms, dur, start.allDay);
      continue;
    }
    if (start.ms >= o.to) continue;
    const tr = translateRule(r.rrule, start);
    if (!tr) continue;
    const skip = new Set(replaced.get(r.uid) ?? []);
    for (const ex of r.exdates) {
      for (const v of ex.value.split(',')) {
        const w = parseWhen(v.trim(), ex.params, start.zone);
        if (w) skip.add(w.ms);
      }
    }
    const iso = new Date(start.ms).toISOString();
    const times = inTz(start.zone, () => (tr.count === null
      ? occurrencesBetween(tr.rule, iso, o.from - dur, o.to, 400)
      : occurrencesBetween(tr.rule, iso, start.ms, o.to, Math.min(tr.count, 1000))));
    for (const ms of times) if (!skip.has(ms)) add(r.summary, ms, dur, start.allDay);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out.slice(0, o.max ?? 500);
}
