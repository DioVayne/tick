#!/usr/bin/env node
// The Manager's queue of ideas (see .claude/skills/manager/SKILL.md and "Manager" in ARCHITECTURE.md).
// One JSON file in the shared git folder (git rev-parse --git-common-dir), so it is shared by every worktree and
// never committed. Every read-modify-write holds a mkdir lock next to it.
//
//   node tools/ideas.mjs add "title" [--area app] [--how session|agent|here] [--note ..]
//   node tools/ideas.mjs list [--all]          open items (--all: also landed and dropped)
//   node tools/ideas.mjs show Q-n
//   node tools/ideas.mjs set Q-n key=value ..  keys: title area how state branch worktree session note release
//   node tools/ideas.mjs busy AREA             exit 1 when an open builder already works in AREA
//   node tools/ideas.mjs overlap               exit 1 when two open branches change the same file
//   node tools/ideas.mjs ready [--title ..] [--note ..]   builder, inside its worktree: "my work is done"
//   node tools/ideas.mjs land Q-n [--full]     Manager only: runs tools/land.mjs with MANAGER=1
//   node tools/ideas.mjs tidy                  remove worktrees and branches of landed/dropped items

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATES = ['waiting', 'building', 'ready', 'landing', 'landed', 'stopped', 'parked', 'dropped'];
/** States in which a builder holds its area and branch. */
export const OPEN = ['building', 'ready', 'landing', 'stopped'];
export const HOWS = ['here', 'agent', 'session'];
const FIELDS = ['title', 'area', 'how', 'state', 'branch', 'worktree', 'session', 'note', 'release'];
const LOG_MAX = 20;

export class Fail extends Error {}

export function git(args, cwd, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, ...opts });
  if (r.error) throw r.error;
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function gitOk(args, cwd) {
  const r = git(args, cwd);
  if (!r.ok) throw new Fail(`git ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}

/** The shared .git folder of the repo around `cwd` (the same for every worktree). */
export function commonDir(cwd = process.cwd()) {
  return path.resolve(gitOk(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd));
}

/** The main checkout (on H: for Tick): the folder that holds the shared .git. */
export function mainCheckout(cwd = process.cwd()) {
  return path.dirname(commonDir(cwd));
}

export const queueFile = (cwd) => path.join(commonDir(cwd), 'tick-ideas.json');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Holds a mkdir lock around fn. A lock older than `staleMs` is left over from a crash and is taken over. */
export function withLock(dir, fn, { waitMs = 30_000, staleMs = 60_000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > staleMs) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* gone in the meantime */ }
      if (Date.now() - start > waitMs) throw new Fail(`lock ${dir} is held (another command is running)`);
      sleep(50 + Math.random() * 100);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const empty = () => ({ next: 1, items: [], landings: [], sinceFull: 0, lastGoodFull: null });

export function load(file) {
  if (!fs.existsSync(file)) return empty();
  return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function save(file, q) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(q, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Read-modify-write of the queue under its lock. `fn` changes `q` in place and returns the result. */
export function update(cwd, fn) {
  const file = queueFile(cwd);
  return withLock(`${file}.lock`, () => {
    const q = load(file);
    const result = fn(q);
    save(file, q);
    return result;
  });
}

export const read = (cwd) => load(queueFile(cwd));

const now = () => new Date().toISOString();

export function note(item, msg) {
  item.updated = now();
  item.log = [...(item.log || []), { at: item.updated, msg }].slice(-LOG_MAX);
}

export function find(q, id) {
  const item = q.items.find((i) => i.id.toUpperCase() === String(id).toUpperCase());
  if (!item) throw new Fail(`${id} is not in the queue`);
  return item;
}

/** The open (not landed or dropped) item that owns this branch, if any. */
export const byBranch = (q, branch) =>
  q.items.find((i) => i.branch === branch && !['landed', 'dropped'].includes(i.state));

export function setField(item, key, value) {
  if (!FIELDS.includes(key)) throw new Fail(`unknown field "${key}" (use: ${FIELDS.join(', ')})`);
  if (key === 'state' && !STATES.includes(value)) throw new Fail(`unknown state "${value}" (use: ${STATES.join(', ')})`);
  if (key === 'how' && !HOWS.includes(value)) throw new Fail(`unknown how "${value}" (use: ${HOWS.join(', ')})`);
  if (key === 'worktree' && value) value = path.resolve(value);
  const old = item[key];
  item[key] = value;
  note(item, key === 'state' ? `${old || '-'} -> ${value}` : `${key}=${value}`);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const line = (i) =>
  `${i.id.padEnd(5)} ${i.state.padEnd(8)} ${(i.area || '-').padEnd(10)} ${(i.how || '-').padEnd(7)} ${i.title}` +
  (i.branch ? `  [${i.branch}]` : '');

/** Files changed on a branch since it left main. */
export function changedFiles(cwd, branch, base = 'main') {
  const r = git(['diff', '--name-only', `${base}...${branch}`], cwd);
  if (!r.ok) throw new Fail(`cannot compare ${branch} with ${base}: ${r.err}`);
  return r.out ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

const commands = {
  add({ pos, flags }, cwd) {
    const title = pos.join(' ').trim();
    if (!title) throw new Fail('usage: ideas.mjs add "title" [--area A] [--how session|agent|here] [--note ..]');
    const how = flags.how || 'session';
    if (!HOWS.includes(how)) throw new Fail(`unknown how "${how}"`);
    const item = update(cwd, (q) => {
      const it = { id: `Q-${q.next++}`, title, area: flags.area || '', how, state: 'waiting', branch: '', worktree: '',
        session: '', note: flags.note || '', release: '', created: now(), updated: now(), log: [] };
      note(it, 'added');
      q.items.push(it);
      return it;
    });
    console.log(item.id);
  },

  list({ flags }, cwd) {
    const q = read(cwd);
    const items = flags.all ? q.items : q.items.filter((i) => !['landed', 'dropped'].includes(i.state));
    if (!items.length) console.log('(queue is empty)');
    for (const i of items) console.log(line(i));
  },

  show({ pos }, cwd) {
    const i = find(read(cwd), pos[0]);
    console.log(line(i));
    for (const k of ['worktree', 'session', 'note', 'release', 'landedCommit', 'created', 'updated']) if (i[k]) console.log(`  ${k}: ${i[k]}`);
    for (const l of i.log || []) console.log(`  ${l.at.slice(0, 16).replace('T', ' ')}  ${l.msg}`);
  },

  set({ pos }, cwd) {
    const [id, ...pairs] = pos;
    if (!id || !pairs.length) throw new Fail('usage: ideas.mjs set Q-n key=value ...');
    update(cwd, (q) => {
      const item = find(q, id);
      for (const p of pairs) {
        const eq = p.indexOf('=');
        if (eq < 1) throw new Fail(`"${p}" is not key=value`);
        setField(item, p.slice(0, eq), p.slice(eq + 1));
      }
    });
    console.log(line(find(read(cwd), id)));
  },

  busy({ pos }, cwd) {
    const area = pos[0];
    if (!area) throw new Fail('usage: ideas.mjs busy AREA');
    const taken = read(cwd).items.filter((i) => i.area === area && OPEN.includes(i.state));
    if (!taken.length) return console.log(`free: ${area}`);
    console.log(`busy: ${area}: ${taken.map((i) => `${i.id} (${i.state})`).join(', ')}`);
    return 1;
  },

  overlap(_, cwd) {
    const open = read(cwd).items.filter((i) => OPEN.includes(i.state) && i.branch);
    const owners = new Map();
    for (const i of open) {
      let files;
      try { files = changedFiles(cwd, i.branch); } catch (e) { console.log(`${i.id}: ${e.message}`); continue; }
      for (const f of files) owners.set(f, [...(owners.get(f) || []), i.id]);
    }
    const both = [...owners].filter(([, ids]) => ids.length > 1);
    if (!both.length) return console.log(`no overlap (${open.length} open branches)`);
    for (const [f, ids] of both) console.log(`${f}: ${ids.join(', ')}`);
    return 1;
  },

  ready({ flags }, cwd) {
    const top = gitOk(['rev-parse', '--show-toplevel'], cwd);
    const branch = gitOk(['branch', '--show-current'], cwd);
    if (!branch || branch === 'main') throw new Fail('run this in your own worktree, on your feature/fix branch');
    if (git(['status', '--porcelain'], cwd).out) throw new Fail('uncommitted changes: commit (or remove) them first');
    const ahead = Number(gitOk(['rev-list', '--count', `main..${branch}`], cwd));
    if (!ahead) throw new Fail(`${branch} has no commits that main does not have`);
    const item = update(cwd, (q) => {
      const it = byBranch(q, branch) || q.items.find((i) => i.worktree && path.resolve(i.worktree) === path.resolve(top) && !['landed', 'dropped'].includes(i.state));
      if (!it) throw new Fail(`branch ${branch} is not in the queue; ask the Manager for its Q-number`);
      if (!it.branch) it.branch = branch;
      if (!it.worktree) it.worktree = path.resolve(top);
      if (flags.title && flags.title !== true) it.release = flags.title;
      if (flags.note && flags.note !== true) it.note = flags.note;
      setField(it, 'state', 'ready');
      return it;
    });
    console.log(`READY ${item.id}`);
  },

  land({ pos, flags }, cwd) {
    const id = pos[0];
    if (!id) throw new Fail('usage: ideas.mjs land Q-n [--full]');
    const item = update(cwd, (q) => {
      const it = find(q, id);
      if (it.state !== 'ready') throw new Fail(`${it.id} is ${it.state}, not ready`);
      if (!it.branch) throw new Fail(`${it.id} has no branch`);
      setField(it, 'state', 'landing');
      return it;
    });
    const script = fileURLToPath(new URL('./land.mjs', import.meta.url));
    const args = [script, item.branch, '--item', item.id, ...(flags.full ? ['--full'] : [])];
    const r = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, MANAGER: '1' } });
    // land.mjs sets landed/stopped itself; if it died before that, the item must not stay in "landing".
    update(cwd, (q) => {
      const it = find(q, id);
      if (it.state === 'landing') { setField(it, 'state', 'stopped'); it.note = 'STOPPED: land.mjs ended without a result'; }
    });
    return r.status ?? 1;
  },

  tidy(_, cwd) {
    const q = read(cwd);
    const main = mainCheckout(cwd);
    for (const i of q.items.filter((x) => ['landed', 'dropped'].includes(x.state))) {
      if (i.worktree && fs.existsSync(i.worktree)) {
        if (git(['status', '--porcelain'], i.worktree).out) { console.log(`${i.id}: ${i.worktree} has uncommitted changes, left alone`); continue; }
        const nm = path.join(i.worktree, 'node_modules');
        try { if (fs.lstatSync(nm).isSymbolicLink()) fs.rmdirSync(nm); } catch { /* no link */ }
        const r = git(['worktree', 'remove', '--force', i.worktree], main);
        console.log(r.ok ? `${i.id}: removed ${i.worktree}` : `${i.id}: ${r.err}`);
      }
      if (i.branch && git(['rev-parse', '--verify', '--quiet', `refs/heads/${i.branch}`], main).ok) {
        if (i.state === 'dropped') git(['tag', '-f', `archive/${i.branch.replace(/^(feature|fix)\//, '')}`, i.branch], main);
        const r = git(['branch', '-D', i.branch], main);
        console.log(r.ok ? `${i.id}: deleted branch ${i.branch}${i.state === 'dropped' ? ' (kept as tag archive/…)' : ''}` : `${i.id}: ${r.err}`);
      }
    }
    git(['worktree', 'prune'], main);
  },
};

export function run(argv, cwd = process.cwd()) {
  const [cmd, ...rest] = argv;
  const f = commands[cmd];
  if (!f) {
    console.error(`usage: ideas.mjs ${Object.keys(commands).join('|')} ...`);
    return 2;
  }
  try {
    return f(parseArgs(rest), cwd) ?? 0;
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.error(`ideas: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
