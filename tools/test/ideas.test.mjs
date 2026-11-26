import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TOOLS, branch, git, ideas, makeRepo } from './helpers.mjs';

const queue = (env) => JSON.parse(fs.readFileSync(path.join(env.repo, '.git', 'tick-ideas.json'), 'utf8'));

test('numbers items Q-1, Q-2, … and keeps the file in the git folder, not in the work tree', () => {
  const env = makeRepo();
  assert.equal(ideas(env.repo, 'add', 'First idea', '--area', 'app').out, 'Q-1');
  assert.equal(ideas(env.repo, 'add', 'Second', '--area', 'site').out, 'Q-2');
  ideas(env.repo, 'set', 'Q-2', 'state=dropped');
  assert.equal(ideas(env.repo, 'add', 'Third').out, 'Q-3');
  assert.equal(git(env.repo, 'status', '--porcelain'), '');
  const q = queue(env);
  assert.deepEqual(q.items.map((i) => [i.id, i.state, i.how]), [['Q-1', 'waiting', 'session'], ['Q-2', 'dropped', 'session'], ['Q-3', 'waiting', 'session']]);
  // list hides dropped items, --all shows them
  assert.doesNotMatch(ideas(env.repo, 'list').out, /Q-2/);
  assert.match(ideas(env.repo, 'list', '--all').out, /Q-2/);
});

test('a worktree sees the same queue', () => {
  const env = makeRepo();
  ideas(env.repo, 'add', 'Idea');
  const wt = branch(env, 'feature/x', { 'b.txt': 'b\n' });
  assert.match(ideas(wt, 'list').out, /Q-1/);
});

test('parallel adds never hand out the same number (lock)', async () => {
  const env = makeRepo();
  const runs = Array.from({ length: 8 }, (_, n) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(TOOLS, 'ideas.mjs'), 'add', `idea ${n}`], { cwd: env.repo });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out: out.trim() }));
  }));
  const results = await Promise.all(runs);
  assert.ok(results.every((r) => r.code === 0));
  assert.deepEqual(results.map((r) => r.out).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))), ['Q-1', 'Q-2', 'Q-3', 'Q-4', 'Q-5', 'Q-6', 'Q-7', 'Q-8']);
  assert.equal(queue(env).items.length, 8);
});

test('states: unknown states and fields are refused; every change is logged', () => {
  const env = makeRepo();
  ideas(env.repo, 'add', 'Idea');
  const bad = ideas(env.repo, 'set', 'Q-1', 'state=done');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown state/);
  assert.equal(ideas(env.repo, 'set', 'Q-1', 'colour=red').code, 1);
  assert.equal(ideas(env.repo, 'set', 'Q-9', 'state=parked').code, 1);
  for (const s of ['building', 'ready', 'landing', 'stopped', 'parked', 'waiting']) assert.equal(ideas(env.repo, 'set', 'Q-1', `state=${s}`).code, 0);
  const log = queue(env).items[0].log.map((l) => l.msg);
  assert.ok(log.includes('waiting -> building') && log.includes('parked -> waiting'));
});

test('busy: an area is taken while a builder is open in it, free when waiting, parked or landed', () => {
  const env = makeRepo();
  ideas(env.repo, 'add', 'Idea', '--area', 'app');
  assert.equal(ideas(env.repo, 'busy', 'app').code, 0);
  for (const s of ['building', 'ready', 'landing', 'stopped']) {
    ideas(env.repo, 'set', 'Q-1', `state=${s}`);
    const r = ideas(env.repo, 'busy', 'app');
    assert.equal(r.code, 1, s);
    assert.match(r.out, /Q-1/);
  }
  assert.equal(ideas(env.repo, 'busy', 'site').code, 0);
  for (const s of ['parked', 'landed', 'dropped', 'waiting']) {
    ideas(env.repo, 'set', 'Q-1', `state=${s}`);
    assert.equal(ideas(env.repo, 'busy', 'app').code, 0, s);
  }
});

test('overlap: names files that two open branches both change', () => {
  const env = makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  branch(env, 'feature/one', { 'a.txt': 'one\n', 'c.txt': 'c\n' });
  branch(env, 'feature/two', { 'b.txt': 'two\n' });
  ideas(env.repo, 'add', 'One'); ideas(env.repo, 'set', 'Q-1', 'state=building', 'branch=feature/one');
  ideas(env.repo, 'add', 'Two'); ideas(env.repo, 'set', 'Q-2', 'state=building', 'branch=feature/two');
  assert.equal(ideas(env.repo, 'overlap').code, 0);
  branch(env, 'feature/three', { 'a.txt': 'three\n' });
  ideas(env.repo, 'add', 'Three'); ideas(env.repo, 'set', 'Q-3', 'state=building', 'branch=feature/three');
  const r = ideas(env.repo, 'overlap');
  assert.equal(r.code, 1);
  assert.match(r.out, /^a\.txt: Q-1, Q-3$/m);
  assert.doesNotMatch(r.out, /b\.txt|c\.txt/);
  // a parked branch no longer counts
  ideas(env.repo, 'set', 'Q-3', 'state=parked');
  assert.equal(ideas(env.repo, 'overlap').code, 0);
});

test('ready: run by the builder in its worktree; needs a clean worktree with commits', () => {
  const env = makeRepo();
  ideas(env.repo, 'add', 'Idea', '--area', 'app');
  const wt = branch(env, 'feature/idea', { 'b.txt': 'b\n' });
  ideas(env.repo, 'set', 'Q-1', 'state=building', 'branch=feature/idea', `worktree=${wt}`);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'dirty\n');
  assert.match(ideas(wt, 'ready').err, /uncommitted/);
  git(wt, 'checkout', '--', 'b.txt');
  const r = ideas(wt, 'ready', '--title', 'Faster lists', '--note', 'all tests green');
  assert.equal(r.out, 'READY Q-1');
  const item = queue(env).items[0];
  assert.equal(item.state, 'ready');
  assert.equal(item.release, 'Faster lists');
  assert.equal(item.note, 'all tests green');
  assert.match(ideas(env.repo, 'ready').err, /own worktree/);
});
