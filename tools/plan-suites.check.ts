import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/** Runs `plan-suites.mjs` on `event` where `shards` answers `answer(whole)`, and returns its legs and calls. */
function plan(event: string, answer: string, checkout: (root: string) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'va-ci-planning-'));
  try {
    checkout(root);
    for (const dir of ['tools', 'bin']) mkdirSync(join(root, dir));
    for (const file of ['plan-suites.mjs', 'ci-plan.mjs']) copyFileSync(join(ROOT, 'tools', file), join(root, 'tools', file));
    writeFileSync(join(root, 'vitest.config.mts'), 'export const SLICES = {unit:{workers:1}, integration:{workers:1}, chromium:{workers:1}};');
    const fake = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args=process.argv.slice(2);
const cache=process.env.VARIANCE_AUTHORITY_CACHE;
appendFileSync(process.env.CALLS,JSON.stringify({args,cache})+'\\n');
if (args[0]==='vitest') console.log('a.test.ts\\nb.test.ts');
if (args[1]==='shards') {
  const whole=!args.includes('--since');
  console.log(JSON.stringify((${answer})(whole)));
}
`;
    for (const name of ['node', 'yarn']) {
      const file = join(root, 'bin', name);
      writeFileSync(file, fake);
      chmodSync(file, 0o755);
    }
    const output = join(root, 'output');
    const calls = join(root, 'calls');
    execFileSync(process.execPath, ['tools/plan-suites.mjs'], { cwd: root, stdio: 'pipe', env: {
      ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, EVENT: event,
      RUNNER_TEMP: root,
      VARIANCE_AUTHORITY_CACHE: join(root, 'carried'), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(root, 'summary'), CALLS: calls,
    } });
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
    return {
      root,
      outputs,
      legs: JSON.parse(outputs.legs),
      calls: readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
    };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it('prices the whole suite and the selection from the one record every leg selects from', () => {
  // The whole suite is priced faster in two jobs, and the selection fits the
  // budget in one: the selection holds fewer runners, so it runs.
  const { root, legs, calls } = plan('pull_request',
    "(whole) => ({by:'recorded',shards:whole?2:1,matrix:whole?['1/2','2/2']:['1/1'],wall:whole?20000:30000,files:2})");
  expect(legs).toEqual(['unit', 'integration', 'chromium'].map((suite) => ({ suite, mode: 'selected', shard: '1/1' })));
  expect(calls.filter((call) => call.args[1] === 'carry')).toEqual([]);
  for (const call of calls.filter((call) => call.args[1] === 'shards')) expect(call.cache).toBe(join(root, 'carried'));
  // A pull request's selection is sized like a whole run: no one-job cap.
  expect(calls.find((call) => call.args.includes('--since'))?.args).not.toContain('--max');
});

it('runs a merge group\'s near wave of one job as the shard `1/1`, as every other job runs', () => {
  const { legs } = plan('merge_group', "() => ({by:'recorded',shards:1,matrix:['1/1'],wall:30000,files:2})");
  expect(legs).toEqual([{ part: 'rules' }, ...['unit', 'integration', 'chromium'].map((part) => ({ part, shard: '1/1' }))]);
});

it('hands a group of one its pull request head as tested, which every count and leg narrows by', () => {
  let head = '';
  const { outputs, calls } = plan('merge_group', "() => ({by:'recorded',shards:0,matrix:[],files:0})", (root) => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.test', ...args], { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('commit', '--quiet', '--allow-empty', '-m', 'base');
    git('checkout', '--quiet', '-b', 'pull');
    git('commit', '--quiet', '--allow-empty', '-m', 'pull');
    head = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', 'main');
    git('merge', '--quiet', '--no-ff', '--no-edit', 'pull');
  });
  expect(outputs['ran-at']).toBe(head);
  for (const call of calls.filter((call) => call.args[1] === 'shards')) expect(call.args).toEqual(expect.arrayContaining(['--ran-at', head]));
});

it('hands no tested commit to a group whose commit has one parent', () => {
  const { outputs, calls } = plan('merge_group', "() => ({by:'recorded',shards:1,matrix:['1/1'],wall:30000,files:2})");
  expect(outputs['ran-at']).toBe('');
  expect(calls.flatMap((call) => call.args)).not.toContain('--ran-at');
});
