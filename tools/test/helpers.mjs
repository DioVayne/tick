// Throwaway git repos for the tools tests (node --test tools/test/). Nothing here touches the real repo.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const ID = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };

const made = [];
process.on('exit', () => {
  for (const d of made) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left for the OS */ }
});

export function tmp(prefix = 'tick-tools-') {
  const root = process.env.TICK_TEST_TMP || os.tmpdir();
  fs.mkdirSync(root, { recursive: true });
  const d = fs.mkdtempSync(path.join(root, prefix));
  made.push(d);
  return d;
}

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ID } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repo on main with one commit, plus a bare "origin" it was pushed to. */
export function makeRepo(files = { 'a.txt': 'a\n' }) {
  const dir = tmp();
  const origin = path.join(dir, 'origin.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '--quiet', '--bare', '-b', 'main', origin);
  git(dir, 'init', '--quiet', '-b', 'main', repo);
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'start');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  return { dir, repo, origin, wtRoot: path.join(dir, 'wt') };
}

export function write(cwd, files) {
  for (const [f, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true });
    fs.writeFileSync(path.join(cwd, f), s);
  }
}

/** A branch with one commit that writes `files`, made in a worktree like a builder would. */
export function branch(env, name, files, msg = name) {
  const wt = path.join(env.wtRoot, name.replace(/\//g, '-'));
  git(env.repo, 'worktree', 'add', '--quiet', '-b', name, wt, 'main');
  write(wt, files);
  git(wt, 'add', '-A');
  git(wt, 'commit', '--quiet', '-m', msg);
  return wt;
}

/** Commit straight on main in the main checkout. */
export function onMain(env, files, msg = 'main change') {
  write(env.repo, files);
  git(env.repo, 'add', '-A');
  git(env.repo, 'commit', '--quiet', '-m', msg);
  git(env.repo, 'push', '--quiet', 'origin', 'main');
}

export function tool(script, args, { cwd, env = {} } = {}) {
  const base = { ...process.env, ...ID };
  delete base.MANAGER;
  const r = spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { cwd, encoding: 'utf8', env: { ...base, ...env } });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export const ideas = (cwd, ...args) => tool('ideas.mjs', args, { cwd });
