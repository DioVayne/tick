import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FULL_EVERY, checkSteps, mergeNews, pickChecks, testWorkers } from '../land.mjs';
import { branch, git, ideas, makeRepo, onMain, tool } from './helpers.mjs';

// The checks in these repos: passes only when MANAGER was stripped from the environment.
const CHECK_OK = `"${process.execPath}" -e "process.exit(process.env.MANAGER ? 3 : 0)"`;
const CHECK_FAIL = `"${process.execPath}" -e "process.exit(1)"`;

const land = (env, args, extra = {}) =>
  tool('land.mjs', args, { cwd: env.repo, env: { TICK_WT_ROOT: path.join(env.dir, 'landwt'), TICK_LAND_CHECKS: CHECK_OK, ...extra } });
const manage = (env, args, extra = {}) =>
  tool('ideas.mjs', args, { cwd: env.repo, env: { TICK_WT_ROOT: path.join(env.dir, 'landwt'), TICK_LAND_CHECKS: CHECK_OK, ...extra } });
const head = (cwd, ref = 'main') => git(cwd, 'rev-parse', ref);
const queue = (env) => JSON.parse(fs.readFileSync(path.join(env.repo, '.git', 'tick-ideas.json'), 'utf8'));

function queued(env, name, files, area = 'app') {
  const wt = branch(env, name, files);
  const id = ideas(env.repo, 'add', name, '--area', area).out;
  ideas(env.repo, 'set', id, 'state=building', `branch=${name}`, `worktree=${wt}`);
  assert.equal(ideas(wt, 'ready').out, `READY ${id}`);
  return { id, wt };
}

test('gate: a queued branch is refused without MANAGER=1 and main stays as it was', () => {
  const env = makeRepo();
  queued(env, 'feature/x', { 'b.txt': 'b\n' });
  const before = head(env.repo);
  const r = land(env, ['feature/x']);
  assert.equal(r.code, 1);
  assert.equal(r.out, "STOPPED: this branch is in the Manager's queue: run `ideas.mjs ready` and tell the Manager");
  assert.equal(head(env.repo), before);
  assert.equal(head(env.origin), before);
  assert.equal(queue(env).items[0].state, 'ready');
});

test('gate: the Manager lands it (rebased, main fast-forwarded and pushed, MANAGER not passed to the checks)', () => {
  const env = makeRepo();
  const { id } = queued(env, 'feature/x', { 'b.txt': 'b\n' });
  onMain(env, { 'c.txt': 'c\n' }); // main moved on: the branch must be rebased
  const r = manage(env, ['land', id]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^LANDED Q-1 [0-9a-f]{7}$/m);
  const main = head(env.repo);
  assert.equal(head(env.origin), main);
  assert.equal(git(env.repo, 'log', '--format=%s', '-2'), 'feature/x\nmain change');
  assert.ok(fs.existsSync(path.join(env.repo, 'b.txt')), 'the main checkout is fast-forwarded');
  const item = queue(env).items[0];
  assert.equal(item.state, 'landed');
  assert.equal(item.landedCommit, main);
  assert.equal(queue(env).sinceFull, 1);
  assert.ok(!fs.existsSync(path.join(env.dir, 'landwt', '_land')), 'the landing worktree is removed');
});

test('a failing check stops the landing: main unchanged, item stopped with the reason', () => {
  const env = makeRepo();
  const { id } = queued(env, 'feature/x', { 'b.txt': 'b\n' });
  const before = head(env.repo);
  const r = manage(env, ['land', id], { TICK_LAND_CHECKS: CHECK_FAIL });
  assert.equal(r.code, 1);
  assert.equal(r.out.split('\n').filter((l) => l.startsWith('STOPPED: ')).length, 1);
  assert.equal(head(env.repo), before);
  assert.equal(head(env.origin), before);
  const item = queue(env).items[0];
  assert.equal(item.state, 'stopped');
  assert.match(item.note, /^STOPPED: checks failed/);
  assert.equal(ideas(env.repo, 'land', id).code, 1, 'a stopped item must be made ready again first');
});

test('a branch outside the queue can be landed without the flag', () => {
  const env = makeRepo();
  branch(env, 'fix/loose', { 'b.txt': 'b\n' });
  const r = land(env, ['fix/loose']);
  assert.equal(r.code, 0, r.out);
  assert.equal(head(env.origin), head(env.repo));
});

const NEWS = (rows) => `// header\nexport const NEWS = [\n${rows.join('\n')}\n];\n\nexport const MAX_ITEMS = 4;\n`;

test('news.js: sentences added on main and on the branch are merged automatically', () => {
  const env = makeRepo({ 'public/news.js': NEWS([`  { date: '2026-11-25', items: ['news.a'] },`]) });
  const { id } = queued(env, 'feature/x', { 'public/news.js': NEWS([`  { date: '2026-11-26', items: ['news.branch'] },`, `  { date: '2026-11-25', items: ['news.a'] },`]) });
  onMain(env, { 'public/news.js': NEWS([`  { date: '2026-11-26', items: ['news.main'] },`, `  { date: '2026-11-25', items: ['news.a'] },`]) });
  const r = manage(env, ['land', id]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /merged public\/news\.js automatically/);
  assert.equal(fs.readFileSync(path.join(env.repo, 'public/news.js'), 'utf8'),
    NEWS([`  { date: '2026-11-26', items: ['news.main', 'news.branch'] },`, `  { date: '2026-11-25', items: ['news.a'] },`]));
});

test('i18n.js: keys added on both sides are merged; the same key on both sides stops', () => {
  const file = (keys) => `export const STRINGS = {\n  en: {\n    'a': 'A',\n${keys.map((k) => `    '${k}': '${k}',\n`).join('')}  },\n};\n`;
  const env = makeRepo({ 'public/i18n.js': file([]) });
  const { id } = queued(env, 'feature/x', { 'public/i18n.js': file(['branch.key']) });
  onMain(env, { 'public/i18n.js': file(['main.key']) });
  assert.equal(manage(env, ['land', id]).code, 0);
  const merged = fs.readFileSync(path.join(env.repo, 'public/i18n.js'), 'utf8');
  assert.match(merged, /'main\.key'[\s\S]*'branch\.key'/);

  const second = queued(env, 'feature/y', { 'public/i18n.js': file(['main.key', 'branch.key', 'same']).replace("'same': 'same'", "'same': 'Y'") });
  onMain(env, { 'public/i18n.js': file(['main.key', 'branch.key', 'same']) });
  const before = head(env.repo);
  const r = manage(env, ['land', second.id]);
  assert.equal(r.code, 1);
  assert.match(r.out, /^STOPPED: rebase conflict in public\/i18n\.js/m);
  assert.equal(head(env.repo), before);
});

test('a conflict in any other file stops the landing and leaves main unchanged', () => {
  const env = makeRepo({ 'src/x.ts': 'one\n' });
  const { id } = queued(env, 'feature/x', { 'src/x.ts': 'branch\n' });
  onMain(env, { 'src/x.ts': 'main\n' });
  const before = head(env.repo);
  const r = manage(env, ['land', id]);
  assert.equal(r.code, 1);
  assert.match(r.out, /^STOPPED: rebase conflict in src\/x\.ts/m);
  assert.equal(head(env.repo), before);
  assert.equal(head(env.origin), before);
  assert.equal(git(env.repo, 'status', '--porcelain'), '');
});

test('the main checkout must be on main and clean', () => {
  const env = makeRepo();
  const { id } = queued(env, 'feature/x', { 'b.txt': 'b\n' });
  fs.writeFileSync(path.join(env.repo, 'a.txt'), 'edited\n');
  const r = manage(env, ['land', id]);
  assert.match(r.out, /^STOPPED: .*uncommitted changes/m);
});

test('a second landing waits for the lock and gives up after the wait', () => {
  const env = makeRepo();
  branch(env, 'fix/loose', { 'b.txt': 'b\n' });
  const lock = path.join(env.repo, '.git', 'tick-land.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const r = land(env, ['fix/loose'], { TICK_LAND_WAIT_MS: '300' });
  assert.match(r.out, /^STOPPED: another landing has been running/m);
  assert.ok(fs.existsSync(lock), "someone else's lock is left alone");
  fs.rmSync(lock, { recursive: true });
  // a lock from a process that no longer exists is taken over
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  assert.equal(land(env, ['fix/loose']).code, 0);
});

test('pickChecks: only the checks a change needs', () => {
  assert.deepEqual(pickChecks(['docs/agenda.md', 'README.md', 'store/google-play/README.md']), { full: false, reason: 'text only', typecheck: false, vitest: [], tools: false });
  assert.deepEqual(pickChecks(['tools/ideas.mjs']), { full: false, reason: 'tools', typecheck: false, vitest: [], tools: true });
  const site = pickChecks(['site/public/index.html']);
  assert.equal(site.typecheck, false);
  assert.ok(site.vitest.includes('test/site.test.ts'));
  const code = pickChecks(['src/store.ts', 'test/store.test.ts', 'public/i18n.js', 'public/style.css']);
  assert.equal(code.full, false);
  assert.equal(code.typecheck, true);
  assert.deepEqual(code.vitest.sort(), ['src/store.ts', 'test/i18n-sleutels.test.ts', 'test/i18n.test.ts', 'test/offline.test.ts', 'test/store.test.ts']);
  for (const f of ['vitest.config.ts', 'package.json', 'test/setup.ts', 'migrations/0042_x.sql']) assert.equal(pickChecks([f]).full, true, f);
  assert.equal(pickChecks(['src/index.ts'], { envTouched: true }).full, true);
  assert.equal(pickChecks(['src/index.ts']).full, false);
  assert.equal(pickChecks(['docs/x.md'], { full: true }).full, true);
  assert.equal(pickChecks(['docs/x.md'], { sinceFull: FULL_EVERY - 2 }).full, false);
  assert.equal(pickChecks(['docs/x.md'], { sinceFull: FULL_EVERY - 1 }).full, true);
});

test('mergeNews refuses when the branch removed a sentence', () => {
  const base = NEWS([`  { date: '2026-11-25', items: ['news.a', 'news.b'] },`]);
  const ours = NEWS([`  { date: '2026-11-26', items: ['news.c'] },`, `  { date: '2026-11-25', items: ['news.a', 'news.b'] },`]);
  const theirs = NEWS([`  { date: '2026-11-25', items: ['news.a'] },`]);
  assert.equal(mergeNews(base, ours, theirs), null);
  const withWhen = NEWS([`  { date: '2026-11-25', items: ['news.a', 'news.b', { key: 'news.d', when: (c) => !!c.x }] },`]);
  assert.match(mergeNews(base, ours, withWhen), /items: \['news\.a', 'news\.b', \{ key: 'news\.d', when: \(c\) => !!c\.x \}\]/);
});

test('checks: vitest runs with few workers (default 2, TICK_TEST_WORKERS overrides)', () => {
  assert.equal(testWorkers({}), 2);
  assert.equal(testWorkers({ TICK_TEST_WORKERS: '3' }), 3);
  assert.equal(testWorkers({ TICK_TEST_WORKERS: 'x' }), 2);
  assert.equal(testWorkers({ TICK_TEST_WORKERS: '0' }), 2);
  const full = checkSteps({ full: true, vitest: [] }, 2).map(([, cmd]) => cmd);
  assert.deepEqual(full, ['npm run typecheck', 'npx vitest run --maxWorkers=2', 'npm run test:tools']);
  const some = checkSteps({ full: false, typecheck: true, tools: false, vitest: ['src/a.ts'] }, 3).map(([, cmd]) => cmd);
  assert.deepEqual(some, ['npm run typecheck', 'npx vitest related "src/a.ts" --run --passWithNoTests --maxWorkers=3']);
});

// --full-check through the real step list (not TICK_LAND_CHECKS): each step is replaced by a command that logs it.
const LOG_STEP = "require('fs').appendFileSync(process.env.STEP_LOG, process.env.TICK_LAND_STEP_CMD + String.fromCharCode(10))";
const STEP_ECHO = `"${process.execPath}" -e "${LOG_STEP}; process.exit(process.env.MANAGER ? 3 : 0)"`;
const STEP_FAIL_VITEST = `"${process.execPath}" -e "${LOG_STEP}; process.exit(/vitest/.test(process.env.TICK_LAND_STEP_CMD) ? 1 : 0)"`;
function fullCheckEnv(env, step) {
  const nm = path.join(env.dir, 'fake_node_modules');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'keep.txt'), 'x');
  return { TICK_LAND_CHECKS: '', TICK_LAND_STEP: step, STEP_LOG: path.join(env.dir, 'steps.log'), TICK_NODE_MODULES: nm, TICK_TEST_WORKERS: '' };
}
const stepsRun = (env) => (fs.existsSync(path.join(env.dir, 'steps.log')) ? fs.readFileSync(path.join(env.dir, 'steps.log'), 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean) : []);

test('--full-check runs typecheck, the full vitest run with 2 workers and the tools tests on main, then FULL OK', () => {
  const env = makeRepo();
  const r = land(env, ['--full-check'], fullCheckEnv(env, STEP_ECHO));
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(stepsRun(env), ['npm run typecheck', 'npx vitest run --maxWorkers=2', 'npm run test:tools']);
  assert.equal(r.out.split('\n').pop(), `FULL OK ${head(env.repo).slice(0, 7)}`);
  assert.equal(queue(env).lastGoodFull.commit, head(env.repo));
  assert.ok(fs.existsSync(path.join(env.dir, 'fake_node_modules', 'keep.txt')), 'node_modules link removed, not its target');
});

test('--full-check: a failing step prints STOPPED and exits 1', () => {
  const env = makeRepo();
  const r = land(env, ['--full-check'], fullCheckEnv(env, STEP_FAIL_VITEST));
  assert.equal(r.code, 1, r.out);
  const last = r.out.split('\n').pop();
  assert.match(last, /^STOPPED: full test run failed/);
  assert.doesNotMatch(last, /unexpected error/);
  assert.deepEqual(stepsRun(env), ['npm run typecheck', 'npx vitest run --maxWorkers=2']);
});

test('an unexpected error also prints STOPPED and exits 1', () => {
  const env = makeRepo();
  fs.writeFileSync(path.join(env.repo, '.git', 'tick-ideas.json'), '{ not json');
  const r = land(env, ['--full-check'], fullCheckEnv(env, STEP_ECHO));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out.split('\n').pop(), /^STOPPED: /);
});
