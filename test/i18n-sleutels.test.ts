import { describe, expect, it } from 'vitest';
import { STRINGS, translate } from '../public/i18n.js';

// Elke letterlijke sleutel die de code aan t() of translate() geeft, moet in i18n.js staan; anders ziet de gebruiker
// de kale sleutel (zoals 'cal.from_calendar'). Alleen letterlijke strings: een sleutel die in delen wordt opgebouwd
// ('copy.amount_' + q, `wd.short.${n}`) kan een scan niet controleren.
const client = import.meta.glob<string>('../public/*.js', { query: '?raw', import: 'default', eager: true });
const server = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** Een hele letterlijke sleutel: 'a.b' of "a.b", direct gevolgd door , of ) (dus geen + of template). */
const LIT = String.raw`(['"])([a-z][\w-]*(?:\.[\w-]+)+)\1\s*[,)]`;
const PATTERNS = [
  // tr is t onder een andere naam (detail.js, render.js, store.js), waar t al een taak is.
  new RegExp(String.raw`(?<![\w.$])(?:t|tr)\(\s*` + LIT, 'g'),
  new RegExp(String.raw`(?<![\w.$])translate\(\s*[^,()]+,\s*` + LIT, 'g'),
  new RegExp(String.raw`new HttpError\(\s*\d+\s*,\s*` + LIT, 'g'),
];

function keysIn(source: string) {
  const found = new Set<string>();
  for (const re of PATTERNS) for (const m of source.matchAll(re)) found.add(m[2]);
  return found;
}

describe('i18n-sleutels in de code', () => {
  it('vindt sleutels in de vormen die de code gebruikt', () => {
    expect([...keysIn(`t('cal.busy'); t("a.b", { n }); tr('c.d'); translate(locale, 'err.x'); new HttpError(400, 'err.y', {})`)])
      .toEqual(['cal.busy', 'a.b', 'c.d', 'err.x', 'err.y']);
    expect([...keysIn("t('copy.amount_' + q); t(`wd.short.${n}`); el.t('x.y'); start('a.b')")]).toEqual([]);
  });

  it('opruimen in een gedeelde lijst heeft een enkelvoud (1 taak)', () => {
    expect(translate('en', 'slist.cleared_one')).toBe('1 task moved to the trash.');
    expect(translate('nl', 'slist.cleared_one')).toBe('1 taak naar de prullenbak.');
    expect(translate('en', 'slist.clear_text_one')).not.toContain('{n}');
    expect(translate('nl', 'slist.clear_text_one')).not.toContain('{n}');
  });

  it('elke letterlijke sleutel in public/ en src/ bestaat in en en nl', () => {
    const missing: string[] = [];
    const files = { ...client, ...server };
    expect(Object.keys(files).length).toBeGreaterThan(20);
    for (const [path, source] of Object.entries(files)) {
      if (path.endsWith('/i18n.js')) continue;
      for (const key of keysIn(source)) {
        if (!(key in STRINGS.en) || !(key in STRINGS.nl)) missing.push(`${path.replace('../', '')}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
