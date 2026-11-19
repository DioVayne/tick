// Ritme-engine: een kleine RRULE-subset, gerekend in de wandklok van de ingestelde tijdzone (TIMEZONE). Alleen
// i18n.js als import, zodat de Worker, de PWA en vitest dezelfde code gebruiken. 10:00 blijft 10:00 over
// zomer-/wintertijd heen.

import { KeyedError, ordinal, t } from './i18n.js';
const DAG_MS = 86400000;
const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/** Dag- en maandnamen in de taal van de app; `wd` 0 = maandag, `m` 1-12. */
export const shortDay = (wd) => t(`wd.short.${wd}`);
const longDay = (wd) => t(`wd.long.${wd}`);
const shortMonth = (m) => t(`month.short.${m - 1}`);

/** @typedef {{ wd: number, n: number | null }} ByDay  wd: 0 = maandag t/m 6 = zondag */
/** @typedef {{ y: number, m: number, d: number }} Day  een kalenderdag, `m` 1-12 */
/** @typedef {{ y: number, m: number, d: number, h?: number, mi?: number }} Until  laatste dag, eventueel met tijd (t/m, wandklok) */
/** @typedef {{ freq: 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY', interval: number, byday: ByDay[], bymonthday: number | null, until: Until | null }} Rule  until: laatste dag of moment (t/m, wandklok) */

/** @param {string} timeZone */
const formatter = (timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

let TZ = 'UTC';
let fmt = formatter(TZ);

/**
 * Zet de tijdzone voor alle berekeningen hieronder. Leeg of ongeldig wordt UTC (met een fout in de console),
 * zodat een tikfout in TIMEZONE de app niet laat crashen. Geeft de zone terug die nu geldt.
 * @param {string | undefined | null} tz
 * @returns {string}
 */
export function setTimeZone(tz) {
  const want = tz || 'UTC';
  if (want === TZ) return TZ;
  try {
    fmt = formatter(want);
    TZ = want;
  } catch {
    console.error(`onbekende tijdzone ${JSON.stringify(want)}, Tick rekent in UTC`);
    fmt = formatter('UTC');
    TZ = 'UTC';
  }
  return TZ;
}

/** @returns {string} */
export const getTimeZone = () => TZ;

// Net als TZ: globale staat voor de hele installatie, per request gezet uit de instellingen.
let DEFAULT_TIME = { h: 9, mi: 0 };

/**
 * Zet de standaardtijd (HH:MM) voor een datum zonder tijd. Leeg of ongeldig wordt 09:00.
 * @param {string | undefined | null} hhmm
 * @returns {void}
 */
export function setDefaultTime(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  DEFAULT_TIME = m ? { h: Number(m[1]), mi: Number(m[2]) } : { h: 9, mi: 0 };
}

/** @returns {{ h: number, mi: number }} */
export const getDefaultTime = () => DEFAULT_TIME;

/**
 * Volgorde van de weekdagen (0 = maandag) voor een weekstart.
 * @param {'mon' | 'sun'} weekStart
 * @returns {number[]}
 */
export const weekdayOrder = (weekStart) => (weekStart === 'sun' ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]);

// Week begint op: per apparaat/installatie, gezet door settings.js (net als de standaardtijd).
let WEEK_START = 'mon';

/** @param {string | undefined | null} weekStart 'mon' of 'sun'; al het andere wordt 'mon' */
export function setWeekStart(weekStart) { WEEK_START = weekStart === 'sun' ? 'sun' : 'mon'; }

/**
 * Volgorde van de dagknoppen in de ritmekiezer (0 = maandag).
 * @param {'mon' | 'sun'} [weekStart] standaard de ingestelde weekstart
 * @returns {number[]}
 */
export const chipDays = (weekStart = WEEK_START) => weekdayOrder(weekStart);

/** Hoeveel de wandklok op dit UTC-moment voorloopt. */
function offsetMs(utcMs) {
  const parts = fmt.formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * De wandklok op een UTC-moment. `m` is 1-12, `wd` 0 = maandag.
 * @param {number} ms
 * @returns {{ y: number, m: number, d: number, h: number, mi: number, wd: number }}
 */
export function zonedParts(ms) {
  const t = new Date(ms + offsetMs(ms));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), wd: (t.getUTCDay() + 6) % 7 };
}

/**
 * UTC-moment van een wandklok (`m` is 1-12).
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @param {number} h
 * @param {number} mi
 * @returns {number}
 */
export function zonedToUtc(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const utc = guess - offsetMs(guess);
  return guess - offsetMs(utc);
}

/**
 * UTC-moment van een wandklok die iemand kiest (`m` is 1-12), zoals een browser lokale tijd leest: een tijd in het gat
 * van de zomertijd schuift de lengte van het gat op (02:30 wordt 03:30), en een tijd die twee keer bestaat (de nacht naar
 * wintertijd) is de eerste. Zo geeft de app precies wat hij gaf toen hij met de klok van het apparaat rekende, als die
 * in dezelfde zone staat. (zonedToUtc kiest bij een dubbele tijd de tweede; de ritme-engine blijft daarbij.)
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @param {number} h
 * @param {number} mi
 * @returns {number}
 */
export function wallToUtc(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const before = offsetMs(guess - DAG_MS);
  const after = offsetMs(guess + DAG_MS);
  const hits = [before, after].map((o) => guess - o).filter((u) => offsetMs(u) === guess - u);
  return hits.length ? Math.min(...hits) : guess - before;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Een UTC-tijd als wandklok 'YYYY-MM-DDTHH:MM' in de ingestelde zone (de vorm van de datumkiezer en van
 * <input type="datetime-local">). Leeg of onleesbaar wordt ''.
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function toWallInput(iso) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (isNaN(ms)) return '';
  const p = zonedParts(ms);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.h)}:${pad2(p.mi)}`;
}

/**
 * Een gekozen wandklok 'YYYY-MM-DDTHH:MM' in de ingestelde zone als ISO UTC; leeg of onleesbaar wordt null.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function fromWallInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const ms = wallToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();
/**
 * Een datumopmaak in de ingestelde zone (een `timeZone` in `opts` wint, bijvoorbeeld 'UTC' voor een kale kalenderdag).
 * Bewaard per zone, taal en opties: een nieuwe Intl.DateTimeFormat per taak is merkbaar traag.
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} opts
 * @returns {Intl.DateTimeFormat}
 */
export function zonedFormat(locale, opts) {
  const key = `${TZ}|${locale}|${JSON.stringify(opts)}`;
  let f = formats.get(key);
  if (!f) {
    if (formats.size > 50) formats.clear();
    f = new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });
    formats.set(key, f);
  }
  return f;
}

const bad = (s) => new KeyedError('err.invalid_rule', { value: String(s) });

/**
 * @param {string} s
 * @returns {Rule}
 */
export function parseRule(s) {
  if (typeof s !== 'string' || !s.trim()) throw bad(s);
  /** @type {Record<string, string>} */
  const kv = {};
  for (const part of s.trim().toUpperCase().split(';')) {
    const m = /^([A-Z]+)=([^=]+)$/.exec(part);
    if (!m || m[1] in kv) throw bad(s);
    kv[m[1]] = m[2];
  }
  const freq = kv.FREQ;
  if (!['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw bad(s);
  for (const k of Object.keys(kv)) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL'].includes(k)) throw bad(s);
  let interval = 1;
  if ('INTERVAL' in kv) {
    if (!/^\d{1,2}$/.test(kv.INTERVAL)) throw bad(s);
    interval = Number(kv.INTERVAL);
    if (interval < 1 || interval > 99) throw bad(s);
  }
  /** @type {ByDay[]} */
  const byday = [];
  if ('BYDAY' in kv) {
    if (freq !== 'WEEKLY' && freq !== 'MONTHLY') throw bad(s);
    const items = kv.BYDAY.split(',');
    if (freq === 'MONTHLY' && items.length !== 1) throw bad(s);
    for (const item of items) {
      const m = /^(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!m) throw bad(s);
      const n = m[1] === undefined ? null : Number(m[1]);
      if ((freq === 'WEEKLY') !== (n === null)) throw bad(s);
      const wd = CODES.indexOf(m[2]);
      if (!byday.some((b) => b.wd === wd)) byday.push({ wd, n });
    }
    byday.sort((a, b) => a.wd - b.wd);
  }
  /** @type {number | null} */
  let bymonthday = null;
  if ('BYMONTHDAY' in kv) {
    if (freq !== 'MONTHLY' || byday.length || !/^\d{1,2}$/.test(kv.BYMONTHDAY)) throw bad(s);
    bymonthday = Number(kv.BYMONTHDAY);
    if (bymonthday < 1 || bymonthday > 31) throw bad(s);
  }
  /** @type {Until | null} */
  let until = null;
  if ('UNTIL' in kv) {
    // Een dag (YYYYMMDD) of een moment (YYYYMMDDTHHMMSS, seconden 00), allebei wandklok in TIMEZONE.
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})00)?$/.exec(kv.UNTIL);
    if (!m) throw bad(s);
    until = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    if (until.m < 1 || until.m > 12 || until.d < 1 || until.d > daysIn(until.y, until.m)) throw bad(s);
    if (m[4] !== undefined) {
      until.h = Number(m[4]);
      until.mi = Number(m[5]);
      if (until.h > 23 || until.mi > 59) throw bad(s);
    }
  }
  return { freq, interval, byday, bymonthday, until };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Een ritme met een ander einde: YYYY-MM-DD (t/m die dag) of YYYY-MM-DDTHH:MM (t/m dat moment), of zonder (null/leeg).
 * @param {string} rule
 * @param {string | null | undefined} untilValue
 * @returns {string}
 */
export function withUntil(rule, untilValue) {
  const r = parseRule(rule);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(untilValue || '');
  r.until = m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), ...(m[4] !== undefined ? { h: Number(m[4]), mi: Number(m[5]) } : {}) } : null;
  return normalizeRule(formatRule(r));
}

/**
 * Het einde van een ritme als YYYY-MM-DD of YYYY-MM-DDTHH:MM (de vorm van een datum- of datum-tijdveld), of '' zonder einde.
 * @param {string | null | undefined} rule
 * @returns {string}
 */
export function untilOf(rule) {
  try {
    const u = rule ? parseRule(rule).until : null;
    if (!u) return '';
    const day = `${pad(u.y, 4)}-${pad(u.m)}-${pad(u.d)}`;
    return u.h === undefined ? day : `${day}T${pad(u.h)}:${pad(/** @type {number} */ (u.mi))}`;
  } catch { return ''; }
}

/**
 * Of een ritme binnen een dag herhaalt (per uur of minuut): dan krijgt het einde ook een tijd.
 * @param {string | null | undefined} rule
 * @returns {boolean}
 */
export function isSubDay(rule) {
  try { return !!rule && !!STEP_MS[parseRule(rule).freq]; } catch { return false; }
}

/**
 * Canonieke tekst: FREQ;INTERVAL (alleen >1);BYDAY;BYMONTHDAY;UNTIL (YYYYMMDD).
 * @param {Rule} r
 * @returns {string}
 */
export function formatRule(r) {
  const out = ['FREQ=' + r.freq];
  if (r.interval > 1) out.push('INTERVAL=' + r.interval);
  if (r.byday.length) out.push('BYDAY=' + [...r.byday].sort((a, b) => a.wd - b.wd).map((b) => (b.n ?? '') + CODES[b.wd]).join(','));
  if (r.bymonthday !== null) out.push('BYMONTHDAY=' + r.bymonthday);
  if (r.until) {
    const u = r.until;
    out.push('UNTIL=' + pad(u.y, 4) + pad(u.m) + pad(u.d) + (u.h === undefined ? '' : 'T' + pad(u.h) + pad(/** @type {number} */ (u.mi)) + '00'));
  }
  return out.join(';');
}

/** @param {string} s */
export const normalizeRule = (s) => formatRule(parseRule(s));

/** Het laatste toegestane moment van een einde met tijd (t/m die minuut); zonder tijd: geen grens binnen de dag. */
const untilMs = (u) => (u.h === undefined ? Infinity : zonedToUtc(u.y, u.m, u.d, u.h, u.mi) + 59999);

/** Ritmes binnen een dag: een vaste stap in milliseconden. */
const STEP_MS = { MINUTELY: 60000, HOURLY: 3600000 };

const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAG_MS);
const fromDayNum = (n) => {
  const t = new Date(n * DAG_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const wdOf = (n) => (new Date(n * DAG_MS).getUTCDay() + 6) % 7;

/** Index van de periode (dag, week vanaf maandag, maand, jaar) waarin een datum (wandklok) valt. */
function periodIndex(freq, p) {
  if (freq === 'DAILY') return dayNum(p.y, p.m, p.d);
  if (freq === 'WEEKLY') return (dayNum(p.y, p.m, p.d) - p.wd) / 7;
  if (freq === 'MONTHLY') return p.y * 12 + p.m - 1;
  return p.y;
}

/** De kandidaat-dagen (dagnummers) van een periode. */
function candidates(rule, idx, s) {
  switch (rule.freq) {
    case 'DAILY': return [idx];
    case 'WEEKLY': return (rule.byday.length ? rule.byday.map((b) => b.wd) : [s.wd]).map((wd) => idx * 7 + wd);
    case 'MONTHLY': {
      const y = Math.floor(idx / 12), m = (idx % 12) + 1, dim = daysIn(y, m);
      if (rule.byday.length) {
        const { wd, n } = rule.byday[0];
        const first = 1 + ((wd - wdOf(dayNum(y, m, 1)) + 7) % 7);
        const d = n === -1 ? first + 7 * Math.floor((dim - first) / 7) : first + 7 * (/** @type {number} */ (n) - 1);
        return d <= dim ? [dayNum(y, m, d)] : [];
      }
      return [dayNum(y, m, Math.min(rule.bymonthday ?? s.d, dim))];
    }
    default: return [dayNum(idx, s.m, Math.min(s.d, daysIn(idx, s.m)))];
  }
}

/**
 * Eerste keer van het schema die op of na `startIso` valt en strikt later is dan `afterMs`, als ISO UTC.
 * null als die na de einddatum (UNTIL) zou vallen: de reeks is dan klaar.
 * @param {string} rule
 * @param {string} startIso
 * @param {number} afterMs
 * @returns {string | null}
 */
export function nextOccurrence(rule, startIso, afterMs) {
  const r = parseRule(rule);
  const parsed = Date.parse(startIso);
  if (isNaN(parsed)) throw new Error('invalid start: ' + startIso);
  // Op de hele minuut: een start met seconden (bijvoorbeeld via de API) slaat anders de eerste keer over.
  const startMs = Math.floor(parsed / 60000) * 60000;
  const step = STEP_MS[r.freq];
  if (step) {
    // Per uur of minuut: vaste stappen in echte tijd vanaf de start (ook over zomer-/wintertijd heen).
    const every = step * r.interval;
    const k = afterMs < startMs ? 0 : Math.floor((afterMs - startMs) / every) + 1;
    const ms = startMs + k * every;
    if (r.until) {
      const p = zonedParts(ms);
      if (dayNum(p.y, p.m, p.d) > dayNum(r.until.y, r.until.m, r.until.d)) return null;
      if (ms > untilMs(r.until)) return null;
    }
    return new Date(ms).toISOString();
  }
  const s = zonedParts(startMs);
  const startIdx = periodIndex(r.freq, s);
  const first = periodIndex(r.freq, zonedParts(Math.max(startMs, afterMs)));
  const last = r.until ? dayNum(r.until.y, r.until.m, r.until.d) : Infinity;
  for (let i = 0; i < 1000; i++) {
    const idx = first + i;
    if ((idx - startIdx) % r.interval !== 0) continue;
    for (const dn of candidates(r, idx, s).sort((a, b) => a - b)) {
      if (dn > last) return null;
      const c = fromDayNum(dn);
      const ms = zonedToUtc(c.y, c.m, c.d, s.h, s.mi);
      if (r.until && ms > untilMs(r.until)) return null;
      if (ms >= startMs && ms > afterMs) return new Date(ms).toISOString();
    }
  }
  throw new Error('no next occurrence found for rule: ' + rule);
}

/**
 * Alle keren van het schema in [fromMs, toMs), als UTC-milliseconden, hoogstens `cap` stuks.
 * @param {string} rule
 * @param {string} startIso
 * @param {number} fromMs
 * @param {number} toMs
 * @param {number} [cap]
 * @returns {number[]}
 */
export function occurrencesBetween(rule, startIso, fromMs, toMs, cap = 400) {
  const out = [];
  let after = fromMs - 1;
  while (out.length < cap) {
    let next;
    try { next = nextOccurrence(rule, startIso, after); } catch { break; }
    if (next === null) break;
    const ms = Date.parse(next);
    if (ms >= toMs) break;
    out.push(ms);
    after = ms;
  }
  return out;
}

/** Sleutel `<base>_one` of `<base>_many`, met n ingevuld. */
const every = (base, n, vars = {}) => t(`${base}_${n === 1 ? 'one' : 'many'}`, { n, ...vars });

/**
 * Korte tekst voor de pil.
 * @param {string} rule
 * @param {string} startIso
 * @returns {string}
 */
export function describeRule(rule, startIso) {
  const r = parseRule(rule);
  const text = describeRhythm(r, startIso);
  if (!r.until) return text;
  const u = r.until;
  const vars = { rule: text, d: u.d, month: shortMonth(u.m), y: u.y };
  return u.h === undefined ? t('rep.until', vars) : t('rep.until_time', { ...vars, time: `${pad(u.h)}:${pad(/** @type {number} */ (u.mi))}` });
}

/** @param {Rule} r @param {string} startIso */
function describeRhythm(r, startIso) {
  const s = zonedParts(Date.parse(startIso));
  const i = r.interval;
  switch (r.freq) {
    case 'MINUTELY': return every('rep.minutely', i);
    case 'HOURLY': return every('rep.hourly', i);
    case 'DAILY': return every('rep.daily', i);
    case 'WEEKLY': {
      const days = r.byday.length ? r.byday.map((b) => shortDay(b.wd)) : [shortDay(s.wd)];
      return every('rep.weekly', i, { days: days.join(', ') });
    }
    case 'MONTHLY': {
      const on = r.byday.length
        ? t('rep.the_nth_weekday', { ord: ordinal(/** @type {number} */ (r.byday[0].n)), wd: shortDay(r.byday[0].wd) })
        : t('rep.the_day', { ord: ordinal(r.bymonthday ?? s.d) });
      return every('rep.monthly', i, { on });
    }
    default: return every('rep.yearly', i, { date: t('rep.date', { d: s.d, month: shortMonth(s.m) }) });
  }
}

/**
 * De snelkeuzes (zonder "Niet herhalen" en "Aangepast…"), volgens de startdatum.
 * @param {string} startIso
 * @returns {{ label: string, rule: string }[]}
 */
export function quickRules(startIso) {
  const s = zonedParts(Date.parse(startIso));
  return [
    { label: every('rep.daily', 1), rule: 'FREQ=DAILY' },
    { label: every('rep.weekly', 1, { days: longDay(s.wd) }), rule: `FREQ=WEEKLY;BYDAY=${CODES[s.wd]}` },
    { label: every('rep.weekly', 2, { days: longDay(s.wd) }), rule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${CODES[s.wd]}` },
    { label: every('rep.monthly', 1, { on: t('rep.the_day', { ord: ordinal(s.d) }) }), rule: `FREQ=MONTHLY;BYMONTHDAY=${s.d}` },
    { label: every('rep.yearly', 1, { date: t('rep.date', { d: s.d, month: shortMonth(s.m) }) }), rule: 'FREQ=YEARLY' },
  ];
}

/**
 * Het ritme uit de keuzes van het Aangepast-paneel. `unit`: minuut | uur | dag | week | maand | jaar. `days`: weekdagen
 * (0 = ma) bij weken, minstens één. `monthMode`: 'dag' (op de <d>e) of 'weekdag' (de n-de/laatste <dag>).
 * @param {{ interval: number, unit: 'minuut'|'uur'|'dag'|'week'|'maand'|'jaar', days?: number[], monthMode?: 'dag'|'weekdag' }} k
 * @param {string} startIso
 * @returns {string}
 */
export function buildRule(k, startIso) {
  const s = zonedParts(Date.parse(startIso));
  const interval = Math.min(99, Math.max(1, Math.round(Number(k.interval)) || 1));
  /** @type {Rule} */
  const r = { freq: 'DAILY', interval, byday: [], bymonthday: null, until: null };
  if (k.unit === 'week') {
    r.freq = 'WEEKLY';
    const days = [...new Set(k.days?.length ? k.days : [s.wd])];
    r.byday = days.map((wd) => ({ wd, n: null }));
  } else if (k.unit === 'maand') {
    r.freq = 'MONTHLY';
    if (k.monthMode === 'weekdag') r.byday = [{ wd: s.wd, n: s.d > 28 ? -1 : Math.ceil(s.d / 7) }];
    else r.bymonthday = s.d;
  } else if (k.unit === 'jaar') r.freq = 'YEARLY';
  else if (k.unit === 'uur') r.freq = 'HOURLY';
  else if (k.unit === 'minuut') r.freq = 'MINUTELY';
  return normalizeRule(formatRule(r));
}

/**
 * Beginstand van het Aangepast-paneel: uit het huidige ritme, anders elke week op de dag van de start.
 * @param {string | null | undefined} rule
 * @param {string} startIso
 * @returns {{ interval: number, unit: 'minuut'|'uur'|'dag'|'week'|'maand'|'jaar', days: number[], monthMode: 'dag'|'weekdag' }}
 */
export function customState(rule, startIso) {
  const s = zonedParts(Date.parse(startIso));
  const base = { interval: 1, unit: /** @type {'week'} */ ('week'), days: [s.wd], monthMode: /** @type {'dag'} */ ('dag') };
  if (!rule) return base;
  try {
    const r = parseRule(rule);
    const unit = { MINUTELY: 'minuut', HOURLY: 'uur', DAILY: 'dag', WEEKLY: 'week', MONTHLY: 'maand', YEARLY: 'jaar' }[r.freq];
    return {
      interval: r.interval, unit: /** @type {any} */ (unit),
      days: r.freq === 'WEEKLY' && r.byday.length ? r.byday.map((b) => b.wd) : [s.wd],
      monthMode: r.freq === 'MONTHLY' && r.byday.length ? 'weekdag' : 'dag',
    };
  } catch { return base; }
}
