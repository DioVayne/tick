#!/usr/bin/env node
// Lands one finished branch on main: the only way work reaches main once the Manager runs (see
// .claude/skills/manager/SKILL.md and "Manager" in ARCHITECTURE.md).
//
//   node tools/land.mjs <branch> [--item Q-n] [--full]   normally via: node tools/ideas.mjs land Q-n
//   node tools/land.mjs --full-check                     full npm test on main (before an Android/Play build)
//
// Steps: rebase the branch onto main in a temporary worktree under C:\dev\wt\_land (news.js and a few append-only
// files are merged automatically when that is safe) -> run the checks this change needs, in that worktree ->
// fast-forward main in the main checkout (H:) -> git push origin main. The Stop-hook then deploys HEAD of H:.
// One landing at a time (lock in the git common dir; a second one waits up to 45 minutes).
// Any failure prints one "STOPPED: <reason>" line, exits 1 and leaves main as it was.
//
// Test hooks (env): TICK_WT_ROOT (default C:\dev\wt), TICK_NODE_MODULES (default C:\dev\tick\node_modules),
// TICK_LAND_CHECKS (a command that replaces the computed checks), TICK_LAND_WAIT_MS.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fail, byBranch, commonDir, find, git, gitOk, mainCheckout, read, setField, update } from './ideas.mjs';

const WT_ROOT = process.env.TICK_WT_ROOT || 'C:\\dev\\wt';
const NODE_MODULES = process.env.TICK_NODE_MODULES || 'C:\\dev\\tick\\node_modules';
const WAIT_MS = Number(process.env.TICK_LAND_WAIT_MS || 45 * 60_000);
/** Every FULL_EVERY-th landing runs the whole test suite. */
export const FULL_EVERY = 5;
const QUEUED = "this branch is in the Manager's queue: run `ideas.mjs ready` and tell the Manager";

// ---------- which checks a change needs ----------

/** Files whose change can break any test: then the full suite runs. */
const SHARED = new Set(['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'test/tsconfig.json',
  'test/setup.ts', 'test/helpers.ts', 'test/env.d.ts', 'wrangler.example.jsonc']);
/** Text only: nothing runs (the user guide, notes, store listings, skills, the Android sources built by Gradle). */
const NO_TESTS = [/^docs\//, /^[^/]+\.md$/, /^store\//, /^\.claude\//, /^android\//, /^home-assistant\//, /^notes\//, /^LICENSE$/];
/** Extra tests for files that tests read as text instead of importing. */
/** Data files that nearly every module imports: their own tests (EXTRA) are enough, `vitest related` would run everything. */
const DATA = new Set(['public/i18n.js', 'public/news.js']);
const EXTRA = [
  [/^site\//, ['test/site.test.ts', 'test/site-cms.test.ts', 'test/site-cms-sync.test.ts']],
  [/^public\/i18n\.js$/, ['test/i18n.test.ts', 'test/i18n-sleutels.test.ts']],
  [/^public\/news\.js$/, ['test/whatsnew.test.ts', 'test/i18n.test.ts']],
  [/^public\//, ['test/offline.test.ts']],
];

/**
 * The checks for a list of changed files (paths relative to the repo, forward slashes).
 * @returns {{ full: boolean, reason: string, typecheck: boolean, vitest: string[], tools: boolean }}
 */
export function pickChecks(files, { full = false, envTouched = false, sinceFull = 0 } = {}) {
  const c = { full: false, reason: '', typecheck: false, vitest: [], tools: false };
  const shared = files.filter((f) => SHARED.has(f) || f.startsWith('migrations/'));
  if (full) c.reason = '--full';
  else if (shared.length) c.reason = `shared files changed (${shared.slice(0, 3).join(', ')})`;
  else if (envTouched) c.reason = 'the Env type in src/index.ts changed';
  else if (sinceFull + 1 >= FULL_EVERY) c.reason = `every ${FULL_EVERY}th landing`;
  if (c.reason) return { ...c, full: true };
  const vitest = new Set();
  for (const f of files) {
    if (f.startsWith('tools/')) { c.tools = true; continue; }
    if (NO_TESTS.some((r) => r.test(f))) continue;
    let extra = false;
    for (const [r, tests] of EXTRA) if (r.test(f)) { tests.forEach((t) => vitest.add(t)); extra = true; }
    if (f.startsWith('site/')) continue; // the site is not part of the app's type check
    c.typecheck = true;
    if (!DATA.has(f) && (!extra || /\.(ts|js|mjs)$/.test(f))) vitest.add(f);
  }
  c.vitest = [...vitest];
  c.reason = [c.typecheck && 'code', c.tools && 'tools', !c.typecheck && c.vitest.length && 'site/texts'].filter(Boolean).join(' + ') || 'text only';
  return c;
}

/** Did the diff of src/index.ts touch the `Env` type? */
function envTouched(cwd, base, head) {
  const r = git(['diff', '-U0', `${base}...${head}`, '--', 'src/index.ts'], cwd);
  if (!r.ok || !r.out) return false;
  const src = git(['show', `${head}:src/index.ts`], cwd).out.split('\n');
  const start = src.findIndex((l) => /^(export )?(interface|type) Env\b/.test(l));
  if (start < 0) return true; // Env moved or vanished: play safe
  let end = start;
  while (end < src.length && !/^\}/.test(src[end])) end++;
  for (const m of r.out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(m[1]);
    const to = from + Math.max(Number(m[2] ?? 1), 1) - 1;
    if (from <= end + 1 && to >= start + 1) return true;
  }
  return false;
}

// ---------- automatic merges ----------

const NEWS_LINE = /^\s*\{ date: '(\d{4}-\d{2}-\d{2})', items: \[(.*)\] \},\s*$/;

function splitTop(s) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === '\\') cur += s[++i] ?? ''; else if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseNews(text) {
  const lines = text.split('\n');
  const open = lines.findIndex((l) => /^export const NEWS = \[\s*$/.test(l));
  const close = lines.findIndex((l, i) => i > open && /^\];\s*$/.test(l));
  if (open < 0 || close < 0) return null;
  const entries = [];
  for (const l of lines.slice(open + 1, close)) {
    const m = NEWS_LINE.exec(l);
    if (!m) return null;
    entries.push({ date: m[1], items: splitTop(m[2]) });
  }
  return { pre: lines.slice(0, open + 1).join('\n'), post: lines.slice(close).join('\n'), entries };
}

/** news.js: adds the sentences the branch added (theirs vs base) to main's list (ours). Null when unsafe. */
export function mergeNews(base, ours, theirs) {
  const [b, o, t] = [base, ours, theirs].map(parseNews);
  if (!b || !o || !t) return null;
  if ((t.pre !== b.pre && t.pre !== o.pre) || (t.post !== b.post && t.post !== o.post)) return null;
  const baseItems = new Map(b.entries.map((e) => [e.date, e.items]));
  const theirItems = new Map(t.entries.map((e) => [e.date, e.items]));
  for (const [date, items] of baseItems) {
    if ((theirItems.get(date) || []).length < items.length || items.some((i) => !(theirItems.get(date) || []).includes(i))) return null; // branch removed something
  }
  const result = new Map(o.entries.map((e) => [e.date, [...e.items]]));
  for (const e of t.entries) {
    const added = e.items.filter((i) => !(baseItems.get(e.date) || []).includes(i));
    if (!added.length) continue;
    const list = result.get(e.date) || [];
    for (const i of added) if (!list.includes(i)) list.push(i);
    result.set(e.date, list);
  }
  const rows = [...result].sort((x, y) => y[0].localeCompare(x[0])).map(([d, items]) => `  { date: '${d}', items: [${items.join(', ')}] },`);
  return [o.pre, ...rows, o.post].join('\n');
}

/** Is `sub` (lines) a subsequence of `full` (lines)? Then `full` only added lines to `sub`. */
function onlyAdds(sub, full) {
  let j = 0;
  for (const l of full) if (j < sub.length && l === sub[j]) j++;
  return j === sub.length;
}

function duplicateKeys(text) {
  const seen = new Set();
  const dup = [];
  let section = '';
  for (const l of text.split('\n')) {
    const s = /^ {2}(\w+): \{/.exec(l);
    if (s) section = s[1];
    const k = /^ {4}'([^']+)'\s*:/.exec(l);
    if (k) { const id = `${section}.${k[1]}`; if (seen.has(id)) dup.push(k[1]); seen.add(id); }
  }
  return dup;
}

/** Files where both sides usually only add lines (keys, index rows): a union merge is safe when that is true. */
const UNION = new Set(['public/i18n.js', 'docs/README.md', 'ARCHITECTURE.md']);

/** Tries to resolve one conflicted file during the rebase. Returns null when it is not safe. */
function resolve(file, cwd) {
  const stage = (n) => { const r = spawnSync('git', ['show', `:${n}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };
  const [base, ours, theirs] = [stage(1), stage(2), stage(3)]; // during a rebase "ours" is main, "theirs" the branch
  if (base == null || ours == null || theirs == null) return null;
  if (file === 'public/news.js') return mergeNews(base, ours, theirs);
  if (!UNION.has(file)) return null;
  const [b, o, t] = [base, ours, theirs].map((s) => s.split('\n'));
  if (!onlyAdds(b, o) || !onlyAdds(b, t)) return null;
  const tmp = fs.mkdtempSync(path.join(cwd, '.land-merge-'));
  try {
    const p = (n, s) => { const f = path.join(tmp, n); fs.writeFileSync(f, s); return f; };
    const r = spawnSync('git', ['merge-file', '-p', '--union', p('o', ours), p('b', base), p('t', theirs)], { encoding: 'utf8' });
    const merged = r.stdout;
    if (file.endsWith('.js') && duplicateKeys(merged).length > duplicateKeys(ours).length) return null;
    return merged;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function rebase(wt) {
  const env = { ...process.env, GIT_EDITOR: 'true' };
  let r = git(['rebase', 'main'], wt, { env });
  for (let round = 0; !r.ok && round < 200; round++) {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], wt).out.split('\n').filter(Boolean);
    if (!conflicted.length) break;
    for (const f of conflicted) {
      const merged = resolve(f, wt);
      if (merged == null) { git(['rebase', '--abort'], wt); throw new Fail(`rebase conflict in ${f} (main changed it too); rebase the branch onto main and resolve it`); }
      fs.writeFileSync(path.join(wt, f), merged);
      if (f.endsWith('.js') && spawnSync(process.execPath, ['--check', path.join(wt, f)]).status !== 0) {
        git(['rebase', '--abort'], wt);
        throw new Fail(`automatic merge of ${f} is not valid JavaScript; rebase the branch onto main and resolve it`);
      }
      gitOk(['add', '--', f], wt);
      console.log(`land: merged ${f} automatically`);
    }
    r = git(['rebase', '--continue'], wt, { env });
  }
  if (!r.ok) { git(['rebase', '--abort'], wt); throw new Fail(`rebase failed: ${(r.err || r.out).split('\n')[0]}`); }
  return gitOk(['rev-parse', 'HEAD'], wt);
}

// ---------- worktree, lock, checks ----------

function removeWorktree(main, dir) {
  const nm = path.join(dir, 'node_modules');
  try { if (fs.lstatSync(nm).isSymbolicLink()) fs.rmdirSync(nm); } catch { /* no link */ }
  if (fs.existsSync(dir)) git(['worktree', 'remove', '--force', dir], main);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'prune'], main);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function takeLandLock(dir) {
  const start = Date.now();
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')); } catch { /* being written */ }
      const age = Date.now() - fs.statSync(dir, { throwIfNoEntry: false })?.mtimeMs;
      if ((owner && !alive(owner.pid)) || (!owner && age > 60_000)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      if (Date.now() - start > WAIT_MS) throw new Fail(`another landing has been running for more than ${Math.round(WAIT_MS / 60000)} minutes`);
      if (!told) { console.log('land: another landing is running, waiting...'); told = true; }
      sleep(2000);
    }
  }
}

function sh(cmd, cwd, env) {
  console.log(`land: ${cmd}`);
  const r = spawnSync(cmd, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const outp = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status !== 0) {
    const tail = outp.trim().split('\n').slice(-25).join('\n');
    console.log(tail);
    const failed = [...outp.matchAll(/FAIL\s+(\S+\.test\.\S+)/g)].map((m) => m[1]);
    return { ok: false, hint: failed.length ? [...new Set(failed)].slice(0, 3).join(', ') : outp.trim().split('\n').filter(Boolean).pop()?.slice(0, 160) };
  }
  return { ok: true };
}

function prepareCopy(main, wt, files) {
  for (const f of ['wrangler.jsonc', '.dev.vars']) if (fs.existsSync(path.join(main, f))) fs.copyFileSync(path.join(main, f), path.join(wt, f));
  const override = !!process.env.TICK_LAND_CHECKS;
  if (!override && files.includes('package-lock.json')) return 'npm ci'; // other dependencies than C:\dev\tick has
  if (fs.existsSync(NODE_MODULES)) fs.symlinkSync(NODE_MODULES, path.join(wt, 'node_modules'), 'junction');
  else if (!override) throw new Fail(`no node_modules at ${NODE_MODULES}: run npm ci in C:\\dev\\tick first`);
  return null;
}

/** Runs the checks in the worktree; MANAGER is never passed on. Returns null when they pass, else a reason. */
function runChecks(wt, c, install) {
  const env = { ...process.env };
  delete env.MANAGER;
  if (process.env.TICK_LAND_CHECKS) return sh(process.env.TICK_LAND_CHECKS, wt, env).ok ? null : 'checks failed';
  if (install) { const r = sh(install, wt, env); if (!r.ok) return `npm ci failed: ${r.hint}`; }
  const steps = [];
  if (c.full) steps.push(['typecheck', 'npm run typecheck'], ['full test run', 'npm test']);
  else {
    if (c.typecheck) steps.push(['typecheck', 'npm run typecheck']);
    const existing = c.vitest.filter((f) => fs.existsSync(path.join(wt, f)));
    if (existing.length) steps.push(['tests', `npx vitest related ${existing.map((f) => `"${f}"`).join(' ')} --run --passWithNoTests`]);
    if (c.tools) steps.push(['tools tests', 'npm run test:tools']);
  }
  for (const [name, cmd] of steps) {
    const r = sh(cmd, wt, env);
    if (!r.ok) return `${name} failed${r.hint ? ` (${r.hint})` : ''}`;
  }
  return null;
}

// ---------- main ----------

function stopItem(cwd, id, reason) {
  if (!id) return;
  try { update(cwd, (q) => { const it = find(q, id); it.note = `STOPPED: ${reason}`; setField(it, 'state', 'stopped'); }); } catch { /* queue unreadable: the line below still says it */ }
}

function landBranch(cwd, branch, id, full) {
  const main = mainCheckout(cwd);
  if (!git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], main).ok) throw new Fail(`branch ${branch} does not exist`);
  if (gitOk(['branch', '--show-current'], main) !== 'main') throw new Fail(`${main} is not on main`);
  if (git(['status', '--porcelain', '--untracked-files=no'], main).out) throw new Fail(`${main} has uncommitted changes in tracked files`);
  const old = gitOk(['rev-parse', 'main'], main);
  const hasOrigin = git(['remote', 'get-url', 'origin'], main).ok;
  if (hasOrigin) {
    git(['fetch', '--quiet', 'origin', 'main'], main);
    const remote = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], main);
    if (remote.ok && !git(['merge-base', '--is-ancestor', remote.out, old], main).ok) throw new Fail('origin/main has commits that main does not have: pull main first');
  }
  if (!Number(gitOk(['rev-list', '--count', `main..${branch}`], main))) throw new Fail(`${branch} has nothing that main does not have`);

  const wt = path.join(WT_ROOT, '_land');
  fs.mkdirSync(WT_ROOT, { recursive: true });
  removeWorktree(main, wt);
  gitOk(['worktree', 'add', '--detach', wt, branch], main);
  try {
    console.log(`land: rebasing ${branch} onto main`);
    const sha = rebase(wt);
    const files = git(['diff', '--name-only', `${old}...${sha}`], wt).out.split('\n').filter(Boolean);
    const q = read(cwd);
    const c = pickChecks(files, { full, envTouched: envTouched(wt, old, sha), sinceFull: q.sinceFull });
    console.log(`land: ${files.length} files; checks: ${c.full ? `full (${c.reason})` : c.reason}`);
    const install = prepareCopy(main, wt, files);
    const failed = runChecks(wt, c, install);
    if (failed) {
      if (c.full) {
        const since = q.landings.filter((l) => !q.lastGoodFull || l.at > q.lastGoodFull.at).map((l) => `${l.id || '-'} (${l.commit.slice(0, 7)})`);
        throw new Fail(`${failed}; landings since the last good full run: ${since.length ? since.join(', ') : 'none'}`);
      }
      throw new Fail(failed);
    }
    if (gitOk(['rev-parse', 'main'], main) !== old) throw new Fail('main moved during the checks: land again');
    const ff = git(['merge', '--ff-only', '--quiet', sha], main);
    if (!ff.ok) throw new Fail(`fast-forward of main failed: ${ff.err.split('\n')[0]}`);
    if (hasOrigin) {
      const push = git(['push', '--quiet', 'origin', 'main'], main);
      if (!push.ok) {
        git(['reset', '--keep', old], main);
        throw new Fail(`git push failed, main put back: ${(push.err || push.out).split('\n').filter(Boolean).pop()}`);
      }
    }
    update(cwd, (qq) => {
      qq.landings = [...qq.landings, { id, branch, commit: sha, at: new Date().toISOString(), full: c.full }].slice(-100);
      if (c.full) { qq.sinceFull = 0; qq.lastGoodFull = { commit: sha, at: new Date().toISOString() }; } else qq.sinceFull = (qq.sinceFull || 0) + 1;
      if (id) { const it = find(qq, id); it.landedCommit = sha; it.note = ''; setField(it, 'state', 'landed'); }
    });
    return sha;
  } finally {
    removeWorktree(main, wt);
  }
}

function fullCheck(cwd) {
  const main = mainCheckout(cwd);
  const wt = path.join(WT_ROOT, '_check');
  fs.mkdirSync(WT_ROOT, { recursive: true });
  removeWorktree(main, wt);
  const sha = gitOk(['rev-parse', 'main'], main);
  gitOk(['worktree', 'add', '--detach', wt, sha], main);
  try {
    const install = prepareCopy(main, wt, []);
    const q = read(cwd);
    const failed = runChecks(wt, { full: true }, install);
    if (failed) {
      const since = q.landings.filter((l) => !q.lastGoodFull || l.at > q.lastGoodFull.at).map((l) => `${l.id || '-'} (${l.commit.slice(0, 7)})`);
      throw new Fail(`${failed}; landings since the last good full run: ${since.length ? since.join(', ') : 'none'}`);
    }
    update(cwd, (qq) => { qq.sinceFull = 0; qq.lastGoodFull = { commit: sha, at: new Date().toISOString() }; });
    return sha;
  } finally {
    removeWorktree(main, wt);
  }
}

export function main(argv, cwd = process.cwd()) {
  const pos = argv.filter((a) => !a.startsWith('--'));
  const itemIdx = argv.indexOf('--item');
  const id = itemIdx >= 0 ? argv[itemIdx + 1] : '';
  const branch = pos.find((p) => p !== id);
  const full = argv.includes('--full');
  let lock = '';
  try {
    const q = read(cwd);
    if (!argv.includes('--full-check')) {
      if (!branch) throw new Fail('usage: land.mjs <branch> [--item Q-n] [--full] | --full-check');
      const queued = byBranch(q, branch);
      if (queued && process.env.MANAGER !== '1') throw new Fail(QUEUED);
      if (id && (!queued || queued.id !== id)) throw new Fail(`${id} does not own branch ${branch}`);
    }
    const lockDir = path.join(commonDir(cwd), 'tick-land.lock');
    takeLandLock(lockDir);
    lock = lockDir;
    if (argv.includes('--full-check')) {
      const sha = fullCheck(cwd);
      console.log(`FULL OK ${sha.slice(0, 7)}`);
    } else {
      const sha = landBranch(cwd, branch, id, full);
      console.log(`LANDED ${id || branch} ${sha.slice(0, 7)}`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof Fail)) e = new Fail(`unexpected error: ${e.message}`);
    if (e.message !== QUEUED) stopItem(cwd, id, e.message);
    console.log(`STOPPED: ${e.message}`);
    return 1;
  } finally {
    if (lock) fs.rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
