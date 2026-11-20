// Datum uit de tekst ("quickdate"): haalt een datum en tijd uit de titel die je typt ("tandarts bellen morgen 15:00"). De
// invoerkaart (composer.js) toont het als voorstel in de tijdlijn; met Niet blijft de titel zoals je hem typte. Deze module
// is puur (geen DOM): `findDate` krijgt de tekst en het moment van nu en rekent in de ingestelde zone (repeat.js).
// Nederlands en Engels werken altijd allebei, los van de taal van de app.
import { chipDays, getDefaultTime, zonedParts } from './repeat.js';

/** @typedef {{ y: number, m: number, d: number }} Day */
/** @typedef {{ h: number, mi: number }} Time */
/**
 * Een gevonden stuk tekst. `weak`: een tijd die alleen telt met "om"/"at" ervoor of direct naast een datum ("1500", "3 uur").
 * @typedef {{ start: number, end: number, kind: 'date' | 'time' | 'both', day?: Day, time?: Time, at?: number, evening?: boolean, weak?: boolean, pm?: boolean }} Hit
 */

const L = '[\\p{L}\\p{N}]';
const B = `(?<!${L})`; // geen letter of cijfer ervoor: "morgen" niet in "goedemorgen"
const E = `(?!${L})`;
const re = (src) => new RegExp(`${B}(?:${src})${E}`, 'giu');

const WEEKDAYS = [
  ['maandag', 'monday'], ['dinsdag', 'tuesday'], ['woensdag', 'wednesday'], ['donderdag', 'thursday'],
  ['vrijdag', 'friday'], ['zaterdag', 'saturday'], ['zondag', 'sunday'],
];
const MONTHS = [
  ['januari', 'january', 'jan'], ['februari', 'february', 'feb'], ['maart', 'march', 'mrt', 'mar'], ['april', 'apr'],
  ['mei', 'may'], ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['augustus', 'august', 'aug'],
  ['september', 'sept', 'sep'], ['oktober', 'october', 'okt', 'oct'], ['november', 'nov'], ['december', 'dec'],
];
const WD = WEEKDAYS.flat().join('|');
const MON = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
const weekdayOf = (word) => WEEKDAYS.findIndex((w) => w.includes(word.toLowerCase()));
const monthOf = (word) => MONTHS.findIndex((w) => w.includes(word.toLowerCase().replace(/\.$/, ''))) + 1;
const NUM = '\\d{1,3}|een|één|a|an|twee|two|drie|three';
const num = (s) => ({ een: 1, één: 1, a: 1, an: 1, twee: 2, two: 2, drie: 3, three: 3 })[s.toLowerCase()] ?? Number(s);
const ON = '(?:(?:op|on)\\s+)?'; // "op vrijdag", "on friday": het voorzetsel gaat mee weg
const AT = '(?:(om|at|@)\\s*)?'; // "om 15:00", "at 3pm"

const p2 = (n) => String(n).padStart(2, '0');
/** @param {Day} day @param {number} n @returns {Day} */
const addDays = (day, n) => {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
/** @param {Day} day */
const wdOf = (day) => (new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay() + 6) % 7;
/** @param {Day} a @param {Day} b */
const before = (a, b) => Date.UTC(a.y, a.m - 1, a.d) < Date.UTC(b.y, b.m - 1, b.d);
/** Een kalenderdag die bestaat (geen 31 februari). */
const real = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
/** Dag + maand zonder jaar: dit jaar, of volgend jaar als die dag al voorbij is. */
function dayMonth(today, d, m, yearText) {
  let y = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : today.y;
  if (!real(y, m, d)) return null;
  if (!yearText && before({ y, m, d }, today)) y += 1;
  return real(y, m, d) ? { y, m, d } : null;
}
/** Begin van volgende week (de ingestelde eerste dag van de week), zoals de snelkeuze "Volgende week". */
const nextWeek = (today) => addDays(today, 7 - ((wdOf(today) - chipDays()[0] + 7) % 7));
/** De eerstvolgende `wd` na vandaag (1 tot 7 dagen verder). */
const nextWeekday = (today, wd) => addDays(today, ((wd - wdOf(today) + 6) % 7) + 1);
/** Uren zonder am/pm in "3 uur", "15u", "half 4": 1 tot en met 6 is 's middags. */
const guessPm = (h) => (h >= 1 && h <= 6 ? h + 12 : h);
const ampm = (h, suffix) => {
  if (!suffix) return h;
  const pm = /^p/i.test(suffix);
  if (h < 1 || h > 12) return -1;
  return pm ? (h % 12) + 12 : h % 12;
};

/**
 * De regels. Elke regel geeft voor een treffer een Hit (of null: lijkt erop, maar klopt niet, zoals 25:00).
 * @type {{ re: RegExp, hit: (m: RegExpMatchArray, today: Day, now: number) => Omit<Hit, 'start' | 'end'> | null }[]}
 */
const RULES = [
  // Over een tijd: "over 2 uur", "in 20 minutes", "over een kwartier", "over een half uur".
  { re: re(`(?:over|in)\\s+(${NUM})\\s+(half\\s+)?(uur|uren|hours?|minuten|minuut|minutes?|min|kwartier)`), hit: (m, _, now) => {
    const n = num(m[1]) * (m[2] ? 0.5 : 1);
    const unit = m[3].toLowerCase();
    const mins = unit === 'kwartier' ? n * 15 : /^(uur|uren|hour)/.test(unit) ? n * 60 : n;
    return mins > 0 && mins <= 60 * 24 * 7 ? { kind: 'both', at: now + mins * 60_000 } : null;
  } },
  { re: re('over\\s+een\\s+half\\s+uur|in\\s+half\\s+an\\s+hour'), hit: (_, __, now) => ({ kind: 'both', at: now + 30 * 60_000 }) },
  // Over dagen, weken of maanden: "over 3 dagen", "in a week", "over twee weken".
  { re: re(`(?:over|in)\\s+(${NUM})\\s+(dagen|dag|days?|weken|week|weeks|maanden|maand|months?)`), hit: (m, today) => {
    const n = num(m[1]);
    const unit = m[2].toLowerCase();
    if (!(n > 0 && n <= 366)) return null;
    if (/^(maand|month)/.test(unit)) {
      const t = new Date(Date.UTC(today.y, today.m - 1 + n, 1));
      const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1;
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return { kind: 'date', day: { y, m: mo, d: Math.min(today.d, last) } };
    }
    return { kind: 'date', day: addDays(today, /^(week|weken|weeks)$/.test(unit) ? n * 7 : n) };
  } },
  { re: re('overmorgen|(?:the\\s+)?day\\s+after\\s+tomorrow'), hit: (_, today) => ({ kind: 'date', day: addDays(today, 2) }) },
  { re: re('vandaag|today'), hit: (_, today) => ({ kind: 'date', day: today }) },
  { re: re('vanavond|tonight'), hit: (_, today) => ({ kind: 'date', day: today, evening: true }) },
  { re: re('morgen|tomorrow'), hit: (_, today) => ({ kind: 'date', day: addDays(today, 1) }) },
  // "volgende week vrijdag", "next week friday": die dag in de volgende week.
  { re: re(`(?:volgende|next)\\s+week\\s+(?:op\\s+|on\\s+)?(${WD})`), hit: (m, today) => {
    const start = nextWeek(today);
    return { kind: 'date', day: addDays(start, (weekdayOf(m[1]) - wdOf(start) + 7) % 7) };
  } },
  { re: re('volgende\\s+week|next\\s+week'), hit: (_, today) => ({ kind: 'date', day: nextWeek(today) }) },
  { re: re(`${ON}(?:(?:volgende|komende|aanstaande|next|this)\\s+)?(${WD})`), hit: (m, today) => ({ kind: 'date', day: nextWeekday(today, weekdayOf(m[1])) }) },
  // "24 nov", "24 november 2027", "1e mei", "nov 24", "November 24th, 2027".
  { re: re(`${ON}(\\d{1,2})(?:e|ste|st|nd|rd|th)?\\s+(${MON})\\.?(?:\\s+(\\d{4}))?`), hit: (m, today) => {
    const day = dayMonth(today, Number(m[1]), monthOf(m[2]), m[3]);
    return day ? { kind: 'date', day } : null;
  } },
  { re: re(`${ON}(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`), hit: (m, today) => {
    const day = dayMonth(today, Number(m[2]), monthOf(m[1]), m[3]);
    return day ? { kind: 'date', day } : null;
  } },
  // "24-11", "24/11/2027": eerst de dag, dan de maand.
  { re: re(`${ON}(\\d{1,2})[-/](\\d{1,2})(?:[-/](\\d{4}|\\d{2}))?`), hit: (m, today) => {
    const day = dayMonth(today, Number(m[1]), Number(m[2]), m[3]);
    return day ? { kind: 'date', day } : null;
  } },
  // Tijden. "15:00", "3:30pm", "3pm" zijn altijd een tijd; de rest alleen met "om"/"at" of naast een datum.
  { re: re(`${AT}(\\d{1,2}):(\\d{2})(?:\\s*([ap]\\.?m\\.?))?`), hit: (m) => clock(ampm(Number(m[2]), m[4]), Number(m[3]), false) },
  { re: re(`${AT}(\\d{1,2})\\s*([ap]\\.?m\\.?)`), hit: (m) => clock(ampm(Number(m[2]), m[3]), 0, false) },
  { re: re(`${AT}(\\d{1,2})\\.(\\d{2})`), hit: (m) => clock(Number(m[2]), Number(m[3]), !m[1]) },
  { re: re(`${AT}(\\d{2})(\\d{2})`), hit: (m) => clock(Number(m[2]), Number(m[3]), !m[1]) },
  { re: re(`${AT}(\\d{1,2})\\s*(?:uur|u)`), hit: (m) => clock(Number(m[2]), 0, !m[1], true) },
  { re: re(`${AT}half\\s+(\\d{1,2})`), hit: (m) => clock(Number(m[2]) - 1, 30, !m[1], true) },
];

/** @returns {Omit<Hit, 'start' | 'end'> | null} */
function clock(h, mi, weak, pm = false) {
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  return { kind: 'time', time: { h, mi }, weak, pm };
}

/**
 * Zoekt een moment in de tekst. Geeft de waarde voor de datumkiezer ('YYYY-MM-DDTHH:MM' in de ingestelde zone), de titel
 * zonder de gevonden woorden, en de gevonden woorden zelf (om een afgewezen voorstel te herkennen). Niets gevonden: null.
 * @param {string} text
 * @param {number} [now]
 * @returns {{ value: string, title: string, match: string } | null}
 */
export function findDate(text, now = Date.now()) {
  const p = zonedParts(now);
  const today = { y: p.y, m: p.m, d: p.d };
  /** @type {Hit[]} */
  const hits = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const h = rule.hit(m, today, now);
      if (h) hits.push({ ...h, start: /** @type {number} */ (m.index), end: /** @type {number} */ (m.index) + m[0].length });
    }
  }
  // Overlappen twee treffers, dan wint de vroegste, en bij gelijke start de langste ("over 2 uur" boven "2 uur").
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  /** @type {Hit[]} */
  const kept = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);

  const both = kept.find((h) => h.kind === 'both');
  const date = kept.find((h) => h.kind === 'date');
  const next = (a, b) => /^[\s,]*$/.test(text.slice(Math.min(a.end, b.end), Math.max(a.start, b.start)));
  const time = kept.find((h) => h.kind === 'time' && (!h.weak || (date && next(date, h))));

  /** @type {Hit[]} */
  let used;
  let value;
  if (both && !date && !time) {
    const z = zonedParts(/** @type {number} */ (both.at));
    used = [both];
    value = `${z.y}-${p2(z.m)}-${p2(z.d)}T${p2(z.h)}:${p2(z.mi)}`;
  } else if (date || time) {
    used = [date, time].filter((h) => !!h);
    let day = date?.day ?? today;
    let at = time?.time;
    if (at && date?.evening && at.h < 12) at = { h: at.h + 12, mi: at.mi };
    else if (at && time?.pm) at = { h: guessPm(at.h), mi: at.mi };
    if (!at && date?.evening) at = { h: 20, mi: 0 };
    if (!at) {
      const def = getDefaultTime();
      at = { h: def.h, mi: def.mi };
      // Vandaag zonder tijd, en de standaardtijd is al geweest: het volgende hele uur (zoals de datumkiezer).
      if (!date || (day.y === today.y && day.m === today.m && day.d === today.d)) {
        if (def.h * 60 + def.mi <= p.h * 60 + p.mi) at = p.h < 23 ? { h: p.h + 1, mi: 0 } : at;
      }
    } else if (!date && at.h * 60 + at.mi <= p.h * 60 + p.mi) {
      day = addDays(today, 1); // alleen een tijd, en die is vandaag al geweest: morgen
    }
    value = `${day.y}-${p2(day.m)}-${p2(day.d)}T${p2(at.h)}:${p2(at.mi)}`;
  } else return null;

  used.sort((a, b) => a.start - b.start);
  let title = '';
  let from = 0;
  for (const h of used) { title += text.slice(from, h.start) + ' '; from = h.end; }
  title = (title + text.slice(from)).replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
  return { value, title, match: used.map((h) => text.slice(h.start, h.end).trim().toLowerCase()).join(' ') };
}
