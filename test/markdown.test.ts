import { describe, expect, it } from 'vitest';
import { parseMarkdown, plainText, renderMarkdown, safeHref, toggleTask } from '../public/markdown.js';

// De typen zijn een union; de tests weten welk blok ze verwachten.
const alinea = (src: string) => parseMarkdown(src)[0] as { lines: unknown[][] };

describe('markdown', () => {
  it('koppen, alinea met enkele regelovergang, en hr', () => {
    expect(parseMarkdown('# Titel\nregel 1\nregel 2\n\n---')).toEqual([
      { type: 'h', level: 1, inline: [{ t: 'text', v: 'Titel' }] },
      { type: 'p', lines: [[{ t: 'text', v: 'regel 1' }], [{ t: 'text', v: 'regel 2' }]] },
      { type: 'hr' },
    ]);
  });
  it('vet, cursief, doorgestreept en code', () => {
    expect(parseMarkdown('**a** *b* _c_ ~~d~~ `e`')[0]).toEqual({ type: 'p', lines: [[
      { t: 'b', c: [{ t: 'text', v: 'a' }] }, { t: 'text', v: ' ' }, { t: 'i', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'c' }] }, { t: 'text', v: ' ' }, { t: 's', c: [{ t: 'text', v: 'd' }] }, { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
    ]] });
  });
  it('checklist onthoudt het regelnummer, ook met \\r\\n', () => {
    const ul = parseMarkdown('intro\r\n\r\n- [ ] a\r\n- [x] b')[1];
    expect(ul).toMatchObject({ type: 'ul', items: [{ task: { checked: false, line: 2 } }, { task: { checked: true, line: 3 } }] });
  });
  it('toggleTask wisselt alleen die regel en laat \\r\\n staan', () => {
    expect(toggleTask('- [ ] a\r\n- [ ] b', 1)).toBe('- [ ] a\r\n- [x] b');
    expect(toggleTask('- [X] a', 0)).toBe('- [ ] a');
    expect(toggleTask('geen taak', 0)).toBe('geen taak');
  });
  it('genummerde lijst, één niveau inspringen, citaat en codeblok', () => {
    const blocks = parseMarkdown('1. een\n   - sub\n2. twee\n\n> citaat\n\n```\n**geen vet**\n```');
    expect(blocks.map((b) => b.type)).toEqual(['ol', 'quote', 'code']);
    expect(blocks[0]).toMatchObject({ items: [{ children: [{ inline: [{ t: 'text', v: 'sub' }] }] }, {}] });
    expect(blocks[2]).toEqual({ type: 'code', text: '**geen vet**' });
  });
  it('links: markdown en kaal, en alleen veilige schema\'s', () => {
    const p = alinea('[site](https://a.nl) en https://b.nl/x');
    expect(p.lines[0]).toEqual([
      { t: 'a', href: 'https://a.nl', c: [{ t: 'text', v: 'site' }] }, { t: 'text', v: ' en ' },
      { t: 'a', href: 'https://b.nl/x', c: [{ t: 'text', v: 'https://b.nl/x' }] },
    ]);
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('mailto:a@b.nl')).toBe('mailto:a@b.nl');
    expect(alinea('[x](javascript:alert(1))').lines[0]).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }]);
  });
  it('een kale url eindigt vóór leestekens en opmaaktekens', () => {
    expect(alinea('zie https://a.nl.').lines[0]).toEqual([
      { t: 'text', v: 'zie ' }, { t: 'a', href: 'https://a.nl', c: [{ t: 'text', v: 'https://a.nl' }] }, { t: 'text', v: '.' },
    ]);
    for (const end of ['!', '?', "'", '"', '*', ').', '!?']) {
      const line = alinea(`https://a.nl/x${end}`).lines[0];
      expect(line[0], end).toEqual({ t: 'a', href: 'https://a.nl/x', c: [{ t: 'text', v: 'https://a.nl/x' }] });
      expect(line[1], end).toEqual({ t: 'text', v: end });
    }
  });
  it('snake_case blijft gewone tekst', () => {
    expect(alinea('bel snake_case_naam op').lines[0]).toEqual([{ t: 'text', v: 'bel snake_case_naam op' }]);
  });
  it('een codehek zonder sluithek loopt tot het einde', () => {
    expect(parseMarkdown('voor\n\n```\n**a**\nb')).toEqual([
      { type: 'p', lines: [[{ t: 'text', v: 'voor' }]] },
      { type: 'code', text: '**a**\nb' },
    ]);
  });
  it('kapotte opmaak en HTML blijven gewone tekst', () => {
    expect(alinea('**open en * los').lines[0]).toEqual([{ t: 'text', v: '**open en * los' }]);
    expect(alinea('<script>x</script>').lines[0]).toEqual([{ t: 'text', v: '<script>x</script>' }]);
  });
  it('een taak in een citaat heeft een regelnummer en is te wisselen', () => {
    expect(parseMarkdown('> - [ ] a')[0]).toMatchObject({ type: 'quote', blocks: [{ type: 'ul', items: [{ task: { checked: false, line: 0 } }] }] });
    expect(toggleTask('> - [ ] a', 0)).toBe('> - [x] a');
  });
  it('renderMarkdown geeft alleen aangevinkte items class "done"', () => {
    // Minimale nep-DOM: de Workers-runtime heeft geen document.
    const node = (tag: string): any => ({
      tag, className: '', attrs: {} as Record<string, string>, kids: [] as any[],
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      addEventListener() {},
      append(...k: any[]) { this.kids.push(...k); },
    });
    (globalThis as any).document = { createElement: node, createDocumentFragment: () => node('#frag') };
    try {
      const frag: any = renderMarkdown('- [ ] a\n- [x] b\n- c');
      const lis = frag.kids[0].kids;
      expect(lis.map((li: any) => li.className)).toEqual(['', 'done', '']);
    } finally {
      delete (globalThis as any).document;
    }
  });
  it('plainText haalt de opmaak weg', () => {
    expect(plainText('# Agenda\n- [ ] **lunch** bestellen\n> [site](https://a.nl)')).toBe('Agenda\nlunch bestellen\nsite');
  });
  it('platte tekst zonder markdown blijft regel voor regel gelijk', () => {
    expect(plainText('Bellen met Jan\nnummer 06-123')).toBe('Bellen met Jan\nnummer 06-123');
  });
  it('plainText laat geen \\r achter bij \\r\\n', () => {
    expect(plainText('# Kop\r\nregel\r\n- [ ] taak')).toBe('Kop\nregel\ntaak');
  });
  it('een extreem diep citaat gooit niet en diepere > blijft tekst', () => {
    const src = '>'.repeat(5000) + ' x';
    expect(() => parseMarkdown(src)).not.toThrow();
    expect(() => plainText(src)).not.toThrow();
    let depth = 0;
    let b: any = parseMarkdown(src)[0];
    while (b?.type === 'quote') { depth++; b = b.blocks[0]; }
    expect(depth).toBe(20);
  });
});
