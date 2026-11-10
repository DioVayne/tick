import { describe, expect, it } from 'vitest';
// site/cms-sync.mjs: the write-back that puts the texts saved via /beheer (KV) into the HTML. Only the pure part.
import { applyContent, clearSynced, compact, diffStart, findBlocks } from '../site/cms-sync.mjs';

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
  }
}

const pages = import.meta.glob<string>('../site/public/**/index.html', { query: '?raw', import: 'default', eager: true });
const NL = pages['../site/public/index.html'];
const EN = pages['../site/public/en/index.html'];

const PAGE = [
  '<main>',
  '  <h1 class="titel" data-edit="titel" data-edit-label="Titel">Oud <em>kop</em></h1>',
  '  <!-- <p data-edit="weg">uitgezet</p> -->',
  '  <div data-edit="blok" data-edit-label="Blok"><div class="a"><div>binnen</div></div><br><img src="x.png" alt=""><p>na</p></div>',
  '  <p data-edit="kort" data-edit-type="tekst" data-edit-label="Kort">Tekst &amp; meer</p>',
  '  <div class="eind">niet van mij</div>',
  '</main>',
].join('\n');

describe('website CMS write-back', () => {
  it('finds every block with its inner HTML, also with nested tags of the same name', () => {
    const blocks = findBlocks(PAGE);
    expect([...blocks.keys()]).toEqual(['titel', 'blok', 'kort']); // the commented-out block does not count
    expect(blocks.get('titel')?.inner).toBe('Oud <em>kop</em>');
    expect(blocks.get('blok')?.inner).toBe('<div class="a"><div>binnen</div></div><br><img src="x.png" alt=""><p>na</p>');
    expect(blocks.get('blok')?.label).toBe('Blok');
    expect(blocks.get('kort')?.type).toBe('tekst');
  });

  it('replaces only the inner HTML and keeps the tag, attributes and the rest of the page', () => {
    const { pages: out, results } = applyContent({ 'index.html': PAGE }, {
      blok: '<div>Nieuw</div>',
      titel: 'Nieuwe <strong>kop</strong>',
    });
    const html = out['index.html'];
    expect(html).toContain('<h1 class="titel" data-edit="titel" data-edit-label="Titel">Nieuwe <strong>kop</strong></h1>');
    expect(html).toContain('<div data-edit="blok" data-edit-label="Blok"><div>Nieuw</div></div>\n  <p data-edit="kort"');
    expect(html).toContain('<div class="eind">niet van mij</div>');
    expect(html.replace('Nieuwe <strong>kop</strong>', 'Oud <em>kop</em>').replace('<div>Nieuw</div>', '<div class="a"><div>binnen</div></div><br><img src="x.png" alt=""><p>na</p>')).toBe(PAGE);
    expect(results.map((r: { key: string; status: string }) => [r.key, r.status])).toEqual([['blok', 'gewijzigd'], ['titel', 'gewijzigd']]);
  });

  it('puts a tekst value in as stored (already escaped), like the Worker does', () => {
    const { pages: out } = applyContent({ 'index.html': PAGE }, { kort: 'A &lt;b&gt; &amp; c' });
    expect(out['index.html']).toContain('data-edit-label="Kort">A &lt;b&gt; &amp; c</p>');
  });

  it('reports orphans and unchanged keys and leaves the page alone', () => {
    const input = { 'index.html': PAGE };
    const { pages: out, results } = applyContent(input, { weg: 'x', titel: 'Oud <em>kop</em>' });
    expect(out['index.html']).toBe(PAGE);
    expect(input['index.html']).toBe(PAGE);
    expect(results).toEqual([
      { key: 'titel', page: 'index.html', label: 'Titel', status: 'gelijk', before: 'Oud <em>kop</em>', after: 'Oud <em>kop</em>' },
      { key: 'weg', page: null, label: '', status: 'verweesd', before: null, after: 'x' },
    ]);
  });

  it('finds keys across pages and lists NL/EN drift', () => {
    const en = '<h1 data-edit="en-titel">Old</h1><p data-edit="en-kort">Short</p>';
    const { pages: out, results, drift } = applyContent({ 'index.html': PAGE, 'en/index.html': en }, {
      titel: 'Nieuw', 'en-titel': 'New', kort: 'Kort', 'en-blok-bestaat-niet': 'x',
    });
    expect(out['en/index.html']).toBe('<h1 data-edit="en-titel">New</h1><p data-edit="en-kort">Short</p>');
    expect(results.find((r: { key: string }) => r.key === 'en-titel')?.page).toBe('en/index.html');
    expect(drift).toEqual([{ key: 'kort', other: 'en-kort', only: 'NL' }]);
  });

  it('refuses a key that appears twice', () => {
    expect(() => findBlocks('<p data-edit="a">1</p><p data-edit="a">2</p>')).toThrow(/twice/);
  });

  it('clears only keys whose value equals the HTML; newer edits and orphans stay', () => {
    const { pages: out } = applyContent({ 'index.html': PAGE }, { titel: 'Nieuw' });
    const { kept, removed } = clearSynced(out, { titel: 'Nieuw', kort: 'Later aangepast', weg: 'x' });
    expect(removed).toEqual(['titel']);
    expect(kept).toEqual({ kort: 'Later aangepast', weg: 'x' });
  });

  it('applying the HTML of the real pages to themselves changes nothing', () => {
    const real = { 'index.html': NL, 'en/index.html': EN };
    const content: Record<string, string> = {};
    for (const html of Object.values(real)) for (const [key, b] of findBlocks(html)) content[key] = b.inner;
    expect(Object.keys(content).length).toBeGreaterThan(300);
    const { pages: out, results } = applyContent(real, content);
    expect(out).toEqual(real);
    expect(results.every((r: { status: string }) => r.status === 'gelijk')).toBe(true);
  });

  it('shortens text for the list', () => {
    expect(compact('  a\n  b  ')).toBe('a b');
    expect(compact('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    const a = 'Een lange gedeelde zin die hetzelfde begint, en dan anders eindigt';
    const b = 'Een lange gedeelde zin die hetzelfde begint, maar nu met iets nieuws';
    const from = diffStart(a, b, 5);
    expect(compact(a, 90, from)).toBe('…int, en dan anders eindigt');
    expect(compact(b, 90, from)).toBe('…int, maar nu met iets nieuws');
  });
});
