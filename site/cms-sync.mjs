#!/usr/bin/env node
// Write-back for the website's mini-CMS: puts the texts saved via /beheer (KV binding CMS, key "content",
// JSON {key: html}) into the HTML under site/public, so git holds what is live again. No dependencies.
//
//   node site/cms-sync.mjs --site-dir <deploy folder>            dry run: show what would change
//   node site/cms-sync.mjs --site-dir <deploy folder> --write    write the HTML files
//   node site/cms-sync.mjs --site-dir <deploy folder> --clear    after commit + deploy: remove the synced keys from KV
//
// --site-dir is the folder with the site's wrangler.jsonc (the CMS KV binding); the script runs
// `npx wrangler kv key get/put content --binding CMS --remote` there. Instead, --from file.json reads the
// content from a file (dry run and --write only). --html-dir is the folder with the pages (default site/public).
//
// Applying a key does what the Worker's HTMLRewriter does (setInnerContent(value, { html: true })): the inner
// HTML of the element with data-edit="key" becomes the stored value as is; the element's own tag and attributes
// stay. That holds for every block, also one with data-edit-type="tekst": its value is stored already escaped.
//
// --clear removes a key only when its KV value (read again just before writing) equals the inner HTML of that
// block in --html-dir, so a newer edit made in /beheer since the write-back stays. Orphaned keys stay too.

// Elements without content; they can never hold a data-edit block or close one.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** Position just past the closing tag that matches an element opened right before `from`; -1 if none. */
function matchingClose(html, tag, from) {
  const re = new RegExp(`<!--[\\s\\S]*?-->|<(/?)${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  for (let m; (m = re.exec(html)); ) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      depth--;
      if (depth === 0) return { innerEnd: m.index, end: re.lastIndex };
    } else if (!m[2].trimEnd().endsWith('/')) {
      depth++;
    }
  }
  return null;
}

/** All data-edit blocks in one HTML string: key → { tag, label, type, innerStart, innerEnd, inner }. */
export function findBlocks(html) {
  const blocks = new Map();
  // Skip comments, so a commented-out block does not count.
  const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  START_TAG.lastIndex = 0;
  for (let m; (m = START_TAG.exec(masked)); ) {
    const [, tagName, attrs] = m;
    const key = attr(attrs, 'data-edit');
    if (key === null) continue;
    const tag = tagName.toLowerCase();
    if (VOID.has(tag)) throw new Error(`data-edit="${key}" sits on a void element <${tag}>`);
    if (blocks.has(key)) throw new Error(`data-edit="${key}" appears twice`);
    const close = matchingClose(masked, tag, START_TAG.lastIndex);
    if (!close) throw new Error(`data-edit="${key}": no closing </${tag}>`);
    const innerStart = START_TAG.lastIndex;
    blocks.set(key, {
      tag,
      label: attr(attrs, 'data-edit-label') ?? '',
      type: attr(attrs, 'data-edit-type') ?? '',
      innerStart,
      innerEnd: close.innerEnd,
      inner: html.slice(innerStart, close.innerEnd),
    });
  }
  return blocks;
}

/**
 * Applies the KV content to the pages. `pages` is { name: html }. Returns the new pages (unchanged ones keep
 * their string), one result per key ({ key, page, label, status: 'gewijzigd' | 'gelijk' | 'verweesd', before,
 * after }) and the NL/EN drift list. Pure: the input is not changed.
 */
export function applyContent(pages, content) {
  const where = new Map(); // key → { page, block }
  for (const [page, html] of Object.entries(pages)) {
    for (const [key, block] of findBlocks(html)) {
      if (where.has(key)) throw new Error(`data-edit="${key}" appears in ${where.get(key).page} and ${page}`);
      where.set(key, { page, block });
    }
  }

  const results = [];
  const edits = {}; // page → [{ innerStart, innerEnd, value }]
  for (const key of Object.keys(content).sort()) {
    const value = content[key];
    const hit = where.get(key);
    if (!hit) {
      results.push({ key, page: null, label: '', status: 'verweesd', before: null, after: value });
      continue;
    }
    const { page, block } = hit;
    const same = block.inner === value;
    results.push({ key, page, label: block.label, status: same ? 'gelijk' : 'gewijzigd', before: block.inner, after: value });
    if (!same) (edits[page] ??= []).push({ innerStart: block.innerStart, innerEnd: block.innerEnd, value });
  }

  const out = { ...pages };
  for (const [page, list] of Object.entries(edits)) {
    let html = pages[page];
    // From the end backwards, so earlier positions stay valid. Blocks never nest, so ranges never overlap.
    for (const e of list.sort((a, b) => b.innerStart - a.innerStart)) {
      html = html.slice(0, e.innerStart) + e.value + html.slice(e.innerEnd);
    }
    out[page] = html;
  }

  return { pages: out, results, drift: drift(content, where) };
}

/** Keys edited in one language only, while the other language has the same block. */
export function drift(content, where) {
  const list = [];
  for (const key of Object.keys(content).sort()) {
    if (!where.has(key)) continue;
    const other = key.startsWith('en-') ? key.slice(3) : 'en-' + key;
    if (where.has(other) && !Object.prototype.hasOwnProperty.call(content, other)) {
      list.push({ key, other, only: key.startsWith('en-') ? 'EN' : 'NL' });
    }
  }
  return list;
}

/** The KV content after --clear: without every key whose value equals its block in the pages. */
export function clearSynced(pages, content) {
  const inner = new Map();
  for (const html of Object.values(pages)) for (const [key, block] of findBlocks(html)) inner.set(key, block.inner);
  const kept = {};
  const removed = [];
  for (const [key, value] of Object.entries(content)) {
    if (inner.has(key) && inner.get(key) === value) removed.push(key);
    else kept[key] = value;
  }
  return { kept, removed };
}

/** One line, at most `max` characters, for the dry-run list; `from` skips a shared beginning. */
export function compact(html, max = 90, from = 0) {
  if (html === null || html === undefined) return '-';
  let s = html.replace(/\s+/g, ' ').trim();
  if (from > 0) s = '…' + s.slice(from);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Where to start showing two texts so their first difference is in view. */
export function diffStart(a, b, context = 30) {
  const x = a.replace(/\s+/g, ' ').trim();
  const y = b.replace(/\s+/g, ' ').trim();
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return Math.max(0, i - context);
}

// ---------------------------------------------------------------- command line

function parseArgs(argv) {
  const args = { htmlDir: 'site/public', siteDir: null, from: null, write: false, clear: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--clear') args.clear = true;
    else if (a === '--html-dir') args.htmlDir = argv[++i];
    else if (a === '--site-dir') args.siteDir = argv[++i];
    else if (a === '--from') args.from = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  if (!args.siteDir && !args.from) throw new Error('Give --site-dir <deploy folder> or --from <file.json>.');
  if (args.clear && !args.siteDir) throw new Error('--clear needs --site-dir (it writes to KV).');
  if (args.clear && args.write) throw new Error('Run --clear separately, after committing and deploying the written HTML.');
  return args;
}

async function main() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const args = parseArgs(process.argv.slice(2));

  const wrangler = (wranglerArgs) => {
    // One command string through the shell (npx is npx.cmd on Windows). Arguments with a space get quotes;
    // the command name must not (npx.cmd then looks for npm in the wrong folder).
    const quote = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);
    const cmd = ['npx', 'wrangler', ...wranglerArgs].map(quote).join(' ');
    const r = spawnSync(cmd, { cwd: args.siteDir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`wrangler ${wranglerArgs.join(' ')} failed:\n${r.stderr || r.stdout}`);
    return r.stdout;
  };
  const readKv = () => {
    const out = wrangler(['kv', 'key', 'get', 'content', '--binding', 'CMS', '--remote']).trim();
    if (!out || /^value not found/i.test(out)) return {};
    try {
      return JSON.parse(out);
    } catch {
      const s = out.indexOf('{');
      const e = out.lastIndexOf('}');
      if (s < 0 || e < s) throw new Error(`KV "content" is not JSON:\n${out.slice(0, 300)}`);
      return JSON.parse(out.slice(s, e + 1));
    }
  };

  // Every HTML file under --html-dir: keys are unique across the site.
  const pages = {};
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.html')) pages[path.relative(args.htmlDir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(args.htmlDir);

  if (args.clear) {
    const current = readKv(); // read again right before writing: a newer edit stays
    const { kept, removed } = clearSynced(pages, current);
    if (!removed.length) {
      console.log('Niets te wissen: geen sleutel in KV is gelijk aan de HTML.');
      return;
    }
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cms-sync-')), 'content.json');
    fs.writeFileSync(tmp, JSON.stringify(kept));
    try {
      wrangler(['kv', 'key', 'put', 'content', '--path', tmp, '--binding', 'CMS', '--remote']);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
    console.log(`Gewist uit KV (${removed.length}): ${removed.join(', ')}`);
    console.log(`Blijft in KV (${Object.keys(kept).length}): ${Object.keys(kept).join(', ') || '-'}`);
    return;
  }

  const content = args.from ? JSON.parse(fs.readFileSync(args.from, 'utf8').replace(/^﻿/, '')) : readKv();
  const { pages: out, results, drift: driftList } = applyContent(pages, content);

  for (const r of results) {
    if (r.status === 'verweesd') {
      console.log(`- ${r.key}: verweesd (staat niet meer in de HTML; niet aangeraakt)`);
      continue;
    }
    console.log(`- ${r.key} [${r.page}] "${r.label}": ${r.status}`);
    if (r.status === 'gewijzigd') {
      const from = diffStart(r.before, r.after);
      console.log(`    voor: ${compact(r.before, 90, from)}`);
      console.log(`    na:   ${compact(r.after, 90, from)}`);
    }
  }
  for (const d of driftList) console.log(`let op: alleen ${d.only} aangepast: ${d.key} (niet ${d.other})`);

  const changed = Object.keys(out).filter((p) => out[p] !== pages[p]);
  if (!args.write) {
    console.log(`\nDroogloop: ${changed.length} bestand(en) zouden veranderen. Gebruik --write om te schrijven.`);
    return;
  }
  for (const p of changed) fs.writeFileSync(path.join(args.htmlDir, p), out[p]);
  console.log(`\nGeschreven: ${changed.join(', ') || 'niets (alles was al gelijk)'}`);
}

if (typeof process !== 'undefined' && /cms-sync\.mjs$/.test(process.argv?.[1] ?? '')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
