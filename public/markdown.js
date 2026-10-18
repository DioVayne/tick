// Kleine markdown-parser voor taakomschrijvingen. Bewust DOM-vrij (parseMarkdown,
// toggleTask, plainText), zodat hij ook in de Workers-tests draait; alleen
// renderMarkdown raakt `document` aan, en pas binnen de functie.

/**
 * @typedef {{ t: 'text', v: string } | { t: 'code', v: string } | { t: 'b' | 'i' | 's', c: Inline[] } | { t: 'a', href: string, c: Inline[] }} Inline
 * @typedef {{ inline: Inline[], task: null | { checked: boolean, line: number }, children: Item[] }} Item
 * @typedef {{ type: 'h', level: 1 | 2 | 3, inline: Inline[] } | { type: 'p', lines: Inline[][] } | { type: 'ul' | 'ol', items: Item[] } | { type: 'quote', blocks: Block[] } | { type: 'code', text: string } | { type: 'hr' }} Block
 */

// Alleen schema's die niets kunnen uitvoeren.
/** @param {string} url @returns {string | null} */
export function safeHref(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? url : null;
  } catch {
    return null;
  }
}

const WORD = /[\p{L}\p{N}]/u;
// Eén niveau haakjes in de url toegestaan, zodat javascript:alert(1) in zijn geheel herkend (en geweigerd) wordt.
const LINK = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const BARE = /^https?:\/\/[^\s<]+/;

/** @param {Inline[]} out @param {string} v */
function pushText(out, v) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

// Sluitend teken zoeken; een los teken dat de opmaak kapot maakt telt niet mee.
/** @param {string} s @param {number} from @param {string} mark @returns {number} */
function findClose(s, from, mark) {
  for (let j = s.indexOf(mark, from); j !== -1; j = s.indexOf(mark, j + 1)) {
    if (/\s/.test(s[j - 1])) continue;
    if (mark.length === 1 && (s[j + 1] === mark || s[j - 1] === mark)) continue;
    if (mark === '_' && WORD.test(s[j + 1] ?? '')) continue;
    return j;
  }
  return -1;
}

/** @param {string} s @param {boolean} [inLink] @returns {Inline[]} */
function parseInline(s, inLink = false) {
  /** @type {Inline[]} */
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const rest = s.slice(i);
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out.push({ t: 'code', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    } else if (ch === '[' && !inLink) {
      const m = LINK.exec(rest);
      if (m) {
        const href = safeHref(m[2]);
        // Een onveilig schema blijft zichtbaar als gewone tekst.
        if (href) out.push({ t: 'a', href, c: parseInline(m[1], true) });
        else pushText(out, m[0]);
        i += m[0].length;
        continue;
      }
    } else if (ch === 'h' && !inLink && !WORD.test(s[i - 1] ?? '')) {
      const m = BARE.exec(rest);
      if (m) {
        // Leestekens en opmaaktekens aan het eind horen bij de zin, niet bij de url.
        const url = m[0].replace(/[.,;:!?'")*]+$/, '');
        if (safeHref(url)) {
          out.push({ t: 'a', href: url, c: [{ t: 'text', v: url }] });
          i += url.length;
          continue;
        }
      }
    } else if (ch === '*' || ch === '_' || ch === '~') {
      const mark = ch !== '_' && s[i + 1] === ch ? ch + ch : ch;
      const start = i + mark.length;
      // Een enkele ~ is geen opmaak; verder alleen als er direct tekst volgt en een sluitend teken bestaat.
      const open = mark !== '~' && start < s.length && !/\s/.test(s[start]) && !(ch === '_' && WORD.test(s[i - 1] ?? ''));
      const j = open ? findClose(s, start + 1, mark) : -1;
      if (j > start) {
        const t = mark === '~~' ? 's' : mark.length === 2 ? 'b' : 'i';
        out.push({ t, c: parseInline(s.slice(start, j), inLink) });
        i = j + mark.length;
        continue;
      }
      // Geen sluitend teken: de tekens blijven gewone tekst.
      pushText(out, mark);
      i += mark.length;
      continue;
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

const FENCE = /^```/;
const HEADING = /^(#{1,3}) +(.*)$/;
const HR = /^(-{3,}|\*{3,})\s*$/;
const QUOTE = /^> ?/;
const ITEM = /^( *)([-*+]|\d+\.) (.*)$/;
const TASK = /^\[([ xX])\](?: +(.*))?$/;

/** @param {string} line @param {boolean} quotes */
const startsBlock = (line, quotes) => FENCE.test(line) || HEADING.test(line) || HR.test(line) || (quotes && QUOTE.test(line)) || ITEM.test(line);

// Dieper geneste > blijft tekst, zodat een rare regel de stack niet laat overlopen.
const MAX_QUOTE_DEPTH = 20;

/** @param {string} text @param {number} line @returns {Item} */
function makeItem(text, line) {
  const t = TASK.exec(text);
  return {
    inline: parseInline(t ? (t[2] ?? '') : text),
    task: t ? { checked: t[1] !== ' ', line } : null,
    children: [],
  };
}

/** @param {string[]} lines @param {number} base regelnummer van lines[0] in de volledige tekst @param {number} depth citaatdiepte @returns {Block[]} */
function parseBlocks(lines, base, depth) {
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (FENCE.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // sluithek; ontbreekt het, dan loopt het blok tot het einde
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ type: 'h', level: /** @type {1 | 2 | 3} */ (h[1].length), inline: parseInline(h[2].trimEnd()) });
      i++;
      continue;
    }
    if (HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    const quotes = depth < MAX_QUOTE_DEPTH;
    if (quotes && QUOTE.test(line)) {
      const from = i;
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
      // Regel voor regel hetzelfde, dus het regelnummer van een taak in een citaat klopt nog.
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, base + from, depth + 1) });
      continue;
    }
    const first = ITEM.exec(line);
    if (first) {
      const indent = first[1].length;
      const type = /\d/.test(first[2]) ? 'ol' : 'ul';
      /** @type {Item[]} */
      const items = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (!m) break;
        if (m[1].length >= indent + 2 && items.length) {
          // Twee spaties of meer dieper dan het eerste item: kind (maar één niveau).
          items[items.length - 1].children.push(makeItem(m[3], base + i));
        } else if ((/\d/.test(m[2]) ? 'ol' : 'ul') === type) {
          items.push(makeItem(m[3], base + i));
        } else break;
        i++;
      }
      blocks.push({ type, items });
      continue;
    }
    // Alinea: elke regelovergang blijft behouden.
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i], quotes))) {
      para.push(parseInline(lines[i].trimEnd()));
      i++;
    }
    blocks.push({ type: 'p', lines: para });
  }
  return blocks;
}

/** @param {string} src @returns {Block[]} */
export function parseMarkdown(src) {
  return parseBlocks(String(src ?? '').replace(/\r\n/g, '\n').split('\n'), 0, 0);
}

// Wisselt [ ] en [x] op precies één regel (ook in een citaat); de rest (ook \r\n) blijft byte-voor-byte gelijk.
/** @param {string} src @param {number} line @returns {string} */
export function toggleTask(src, line) {
  const lines = src.split('\n');
  if (!(line >= 0 && line < lines.length)) return src;
  lines[line] = lines[line].replace(/^((?:\s*>)*\s*(?:[-*+]|\d+\.) \[)([ xX])(\])/, (_, a, c, b) => a + (c === ' ' ? 'x' : ' ') + b);
  return lines.join('\n');
}

/** @param {Inline[]} nodes @returns {string} */
function inlineText(nodes) {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
}

/** @param {Block[]} blocks @returns {string[]} */
function blockLines(blocks) {
  /** @type {string[]} */
  const out = [];
  for (const b of blocks) {
    if (b.type === 'h') out.push(inlineText(b.inline));
    else if (b.type === 'p') for (const l of b.lines) out.push(inlineText(l));
    else if (b.type === 'ul' || b.type === 'ol') {
      for (const it of b.items) {
        out.push(inlineText(it.inline));
        for (const c of it.children) out.push(inlineText(c.inline));
      }
    } else if (b.type === 'quote') out.push(...blockLines(b.blocks));
    else if (b.type === 'code') out.push(...b.text.split('\n'));
  }
  return out;
}

// Voor het fragment in de takenlijst: de tekst zonder markdowntekens.
/** @param {string} src @returns {string} */
export function plainText(src) {
  return blockLines(parseMarkdown(src)).join('\n');
}

// Takenlijst-regels (- [ ] en - [x]), ook in citaten en geneste items; regels in een codeblok tellen niet.
/** @param {string} src @returns {{ done: number, total: number }} */
export function countTasks(src) {
  const n = { done: 0, total: 0 };
  /** @param {Item} it */
  const item = (it) => {
    if (it.task) { n.total++; if (it.task.checked) n.done++; }
    it.children.forEach(item);
  };
  /** @param {Block[]} blocks */
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.type === 'ul' || b.type === 'ol') b.items.forEach(item);
      else if (b.type === 'quote') walk(b.blocks);
    }
  };
  walk(parseMarkdown(src));
  return n;
}

// Eigen kleine bouwer; render.js importeren geeft een kringverwijzing.
/** @param {string} tag @param {Record<string, any>} [props] @param {...any} kids */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') { if (v) e.className = v; }
    else if (k === 'checked') /** @type {HTMLInputElement} */ (e).checked = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

/** @param {Inline[]} nodes @returns {(Node | string)[]} */
function renderInline(nodes) {
  return nodes.map((n) => {
    if (n.t === 'text') return n.v;
    if (n.t === 'code') return h('code', {}, n.v);
    if (n.t === 'a') return h('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer' }, renderInline(n.c));
    return h({ b: 'strong', i: 'em', s: 's' }[n.t], {}, renderInline(n.c));
  });
}

/** @param {Item} it @param {(line: number) => void} [onToggle] */
function renderItem(it, onToggle) {
  const kids = [];
  const task = it.task;
  if (task) {
    kids.push(h('input', {
      type: 'checkbox', checked: task.checked, 'data-line': task.line,
      onchange: () => onToggle?.(task.line),
    }));
  }
  kids.push(...renderInline(it.inline));
  if (it.children.length) kids.push(h('ul', {}, it.children.map((c) => renderItem(c, onToggle))));
  return h('li', { class: task?.checked ? 'done' : null }, kids);
}

/** @param {Block[]} blocks @param {(line: number) => void} [onToggle] @returns {HTMLElement[]} */
function renderBlocks(blocks, onToggle) {
  return blocks.map((b) => {
    if (b.type === 'h') return h('h' + b.level, {}, renderInline(b.inline));
    if (b.type === 'p') return h('p', {}, b.lines.flatMap((l, i) => (i ? [h('br'), ...renderInline(l)] : renderInline(l))));
    if (b.type === 'ul' || b.type === 'ol') return h(b.type, {}, b.items.map((it) => renderItem(it, onToggle)));
    if (b.type === 'quote') return h('blockquote', {}, renderBlocks(b.blocks, onToggle));
    if (b.type === 'code') return h('pre', {}, h('code', {}, b.text));
    return h('hr');
  });
}

/** @param {string} src @param {{ onToggle?: (line: number) => void }} [opts] @returns {DocumentFragment} */
export function renderMarkdown(src, { onToggle } = {}) {
  const frag = document.createDocumentFragment();
  for (const n of renderBlocks(parseMarkdown(src), onToggle)) frag.append(n);
  return frag;
}
