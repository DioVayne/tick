// "Zet in je agenda": een taak als afspraak van 30 minuten op de tijd van de herinnering. Een link voor Google Agenda en
// een .ics-bestand (Outlook, Apple en de rest). Alleen de titel gaat mee. Geen imports: de Worker gebruikt dit ook.

/** Hoe lang de afspraak duurt. */
export const EVENT_MS = 30 * 60_000;

/** @param {number} ms */
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** @param {{ remind_at: string }} task */
const times = (task) => {
  const start = Date.parse(task.remind_at);
  return { start, end: start + EVENT_MS };
};

/**
 * Link naar het "nieuwe afspraak"-scherm van Google Agenda, met titel en tijd ingevuld.
 * @param {{ title: string, remind_at: string }} task
 * @returns {string}
 */
export function googleCalendarUrl(task) {
  const { start, end } = times(task);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: task.title, dates: `${stamp(start)}/${stamp(end)}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Tekst volgens RFC 5545: \ ; , en regeleinden (ook een losse \r) ge-escaped. @param {string} s */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** UTF-8-lengte van één teken (code point). @param {number} cp */
const utf8Len = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/**
 * Een regel van hooguit 75 bytes (UTF-8), de rest op vervolgregels die met een spatie beginnen (die telt mee).
 * Alleen tussen tekens geknipt, nooit midden in een teken of surrogaatpaar.
 * @param {string} line
 */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = utf8Len(/** @type {number} */ (ch.codePointAt(0)));
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

/**
 * Een .ics-bestand met één afspraak.
 * @param {{ id: string, title: string, remind_at: string }} task
 * @param {number} [now]
 * @returns {string}
 */
export function taskIcs(task, now = Date.now()) {
  const { start, end } = times(task);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tick//Tick//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${task.id}@tick`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(task.title)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
