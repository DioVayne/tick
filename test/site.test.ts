import { describe, expect, it } from 'vitest';

// The marketing site (site/public) is plain static files. Vite reads them at build time, so this test also runs
// inside the Workers test pool, which has no file system.
declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
  }
}

const ROOT = '../site/public/';
const html = import.meta.glob<string>('../site/public/**/*.html', { query: '?raw', import: 'default', eager: true });
// '_header[s]', not '_headers': Vite's glob refuses a pattern without any wildcard.
const headers = import.meta.glob<string>('../site/public/_header[s]', { query: '?raw', import: 'default', eager: true });
// Not eager: only the list of paths is used, nothing is loaded.
const files = new Set(Object.keys(import.meta.glob('../site/public/**/*')).map((p) => p.slice(ROOT.length)));

const page = (rel: string) => {
  const text = html[ROOT + rel];
  if (text === undefined) throw new Error(`site/public/${rel} is missing`);
  return text;
};

const sectionIds = (text: string) => [...text.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const detailsIds = (text: string) => [...text.matchAll(/<details\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

// The anchors are in the page's own language; this is the one-to-one translation between the two pages.
const NL_TO_EN: Record<string, string> = {
  top: 'top', maker: 'maker', 'op-de-juiste-plek': 'in-the-right-place', 'samen-of-kopie': 'shared-or-copy',
  'oude-taken': 'old-tasks', functies: 'features', 'wat-werkt-waar': 'what-works-where', vergelijken: 'compare',
  privacy: 'privacy', kost: 'cost', vragen: 'faq',
  invoerkaart: 'entry-card', herinneringen: 'reminders', herhalen: 'repeating', vandaag: 'due-today', kalender: 'calendar',
  'agenda-koppelen': 'link-calendar', subtaken: 'subtasks', notities: 'notes', bijlagen: 'attachments', offline: 'offline',
  themas: 'themes', widget: 'widget', plekken: 'places', 'meerdere-plekken': 'more-places', rijmodus: 'driving-mode', 'op-tijd-onderweg': 'on-time-on-the-road',
  tickmanager: 'tickmanager', delen: 'sharing', 'gedeelde-lijsten': 'shared-lists', 'melden-en-blokkeren': 'reporting-and-blocking',
  ticktick: 'ticktick', 'back-up': 'backup', koppelingen: 'integrations', account: 'account', talen: 'languages',
};
for (let i = 1; i <= 18; i++) NL_TO_EN[`faq-${i}`] = `faq-${i}`;
const toEn = (id: string) => NL_TO_EN[id] ?? `(no translation for ${id})`;

describe('website ticktodo.nl', () => {
  it('has the NL and EN home pages', () => {
    expect(page('index.html')).toContain('<html lang="nl">');
    expect(page('en/index.html')).toContain('<html lang="en">');
  });

  it('NL and EN have the same sections, in the same order', () => {
    const nl = sectionIds(page('index.html'));
    expect(nl.length).toBeGreaterThan(8);
    expect(sectionIds(page('en/index.html'))).toEqual(nl.map(toEn));
  });

  it('NL and EN have the same feature stories and questions, in the same order', () => {
    const nl = detailsIds(page('index.html'));
    expect(nl.length).toBe(25 + 18);
    expect(detailsIds(page('en/index.html'))).toEqual(nl.map(toEn));
  });

  it('every id on a page is unique, and every #link points to one', () => {
    for (const rel of ['index.html', 'en/index.html']) {
      const text = page(rel);
      const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, rel).toBe(ids.length);
      for (const [, target] of text.matchAll(/\bhref="#([^"]+)"/g)) expect(ids, `${rel} #${target}`).toContain(target);
    }
  });

  it('no inline scripts, style tags or style attributes (CSP)', () => {
    expect(Object.keys(html).length).toBeGreaterThanOrEqual(5);
    for (const [path, text] of Object.entries(html)) {
      expect(text, path).not.toMatch(/<style\b/i);
      expect(text, path).not.toMatch(/\sstyle\s*=/i);
      expect(text, path).not.toMatch(/\son[a-z]+\s*=/i);
      for (const [, attrs, body] of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        expect(attrs, path).toMatch(/\bsrc=/);
        expect(body.trim(), path).toBe('');
      }
    }
  });

  it('every local href and src points to a file in site/public', () => {
    for (const [path, text] of Object.entries(html)) {
      const base = new URL(path.slice(ROOT.length), 'https://ticktodo.nl/');
      for (const [, url] of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        if (/^(#|https?:|mailto:)/.test(url)) continue;
        const target = decodeURIComponent(new URL(url, base).pathname.slice(1));
        // Cloudflare's html_handling serves /privacy from privacy.html and /en/ from en/index.html.
        const candidates = [target, `${target}.html`, `${target}index.html`, `${target}/index.html`].filter(Boolean);
        expect(candidates.some((c) => files.has(c)), `${path}: ${url}`).toBe(true);
      }
    }
  });

  // The mini-CMS (/beheer): data-edit marks the blocks Dio can edit live; edits are stored per key in KV.
  const editKeys = (text: string) => [...text.matchAll(/\sdata-edit="([^"]*)"/g)].map((m) => m[1]);

  it('data-edit keys: valid, unique per page, with a label', () => {
    for (const rel of ['index.html', 'en/index.html']) {
      const text = page(rel);
      const keys = editKeys(text);
      expect(keys.length, rel).toBeGreaterThan(100);
      expect(new Set(keys).size, rel).toBe(keys.length);
      for (const k of keys) expect(k, rel).toMatch(/^[a-z0-9-]{1,60}$/);
      const tags = [...text.matchAll(/<[a-z0-9]+\b[^>]*\sdata-edit="[^"]*"[^>]*>/g)].map((m) => m[0]);
      expect(tags.length, rel).toBe(keys.length);
      for (const tag of tags) expect(tag, rel).toMatch(/\sdata-edit-label="[^"]+"/);
    }
  });

  it('EN has the same data-edit keys as NL, with an en- prefix', () => {
    const nl = editKeys(page('index.html'));
    for (const k of nl) expect(k).not.toMatch(/^en-/);
    expect(editKeys(page('en/index.html'))).toEqual(nl.map((k) => `en-${k}`));
  });

  it('data-edit blocks are not nested', () => {
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    for (const rel of ['index.html', 'en/index.html']) {
      const stack: { tag: string; edit: boolean }[] = [];
      for (const [tag, close, name, attrs] of page(rel).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
        const lower = name.toLowerCase();
        if (close) {
          const i = stack.map((s) => s.tag).lastIndexOf(lower);
          if (i >= 0) stack.length = i;
          continue;
        }
        const edit = /\sdata-edit="/.test(attrs);
        if (edit) expect(stack.some((s) => s.edit), `${rel}: ${tag}`).toBe(false);
        if (!VOID.has(lower) && !attrs.trimEnd().endsWith('/')) stack.push({ tag: lower, edit });
      }
    }
  });

  it('the CMS files exist and follow the CSP', () => {
    for (const f of ['beheer/index.html', 'beheer/login.js', 'beheer/beheer.css', 'beheer/editor.js', 'beheer/editor.css']) {
      expect(files.has(f), f).toBe(true);
    }
    const scripts = import.meta.glob<string>('../site/public/beheer/*.js', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(scripts).length).toBe(2);
    for (const [path, text] of Object.entries(scripts)) {
      // No style elements or attributes and no inline handlers in the HTML the scripts build; el.style.x is fine.
      expect(text, path).not.toMatch(/<style\b|createElement\(\s*['"]style['"]|\sstyle\s*=|setAttribute\(\s*['"]style['"]|cssText/i);
      expect(text, path).not.toMatch(/\son[a-z]+\s*=\s*\\?['"]|<script\b|\beval\(|new Function\(/i);
    }
  });

  it('_headers sets the CSP and the other security headers', () => {
    const text = Object.values(headers)[0] ?? '';
    expect(text).toContain(
      "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(text).toContain('X-Content-Type-Options: nosniff');
    expect(text).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(text).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()');
  });
});
