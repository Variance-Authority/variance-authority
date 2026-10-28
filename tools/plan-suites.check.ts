import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

it('prices whole shards from their frozen mainline and selection from the carried layer', () => {
  const root = mkdtempSync(join(tmpdir(), 'va-ci-planning-'));
  try {
    for (const dir of ['tools', 'bin']) mkdirSync(join(root, dir));
    for (const file of ['plan-suites.mjs', 'ci-plan.mjs']) copyFileSync(join(ROOT, 'tools', file), join(root, 'tools', file));
    writeFileSync(join(root, 'vitest.config.mts'), 'export const SLICES = {unit:{workers:1}, integration:{workers:1}, chromium:{workers:1}};');
    // The owner's prices differ: the carried layer would keep one job, while
    // the frozen mainline the whole shards actually read prices two faster.
    const fake = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args=process.argv.slice(2);
const cache=process.env.VARIANCE_AUTHORITY_CACHE;
appendFileSync(process.env.CALLS,JSON.stringify({args,cache})+'\\n');
if (args[0]==='vitest') console.log('a.test.ts\\nb.test.ts');
if (args[1]==='shards') {
  const whole=cache?.endsWith('/whole-plan');
  console.log(JSON.stringify({by:'recorded',shards:whole?2:1,matrix:whole?['1/2','2/2']:['1/1'],wall:whole?20000:30000,files:2}));
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
      ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, EVENT: 'pull_request',
      BASELINE_READ: join(root, 'frozen'), BASELINE_HANDED: 'true', RUNNER_TEMP: root,
      VARIANCE_AUTHORITY_CACHE: join(root, 'carried'), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(root, 'summary'), CALLS: calls,
    } });
    const legs = JSON.parse(readFileSync(output, 'utf8').trim().slice('legs='.length));
    expect(legs).toHaveLength(6);
    expect(legs.every((leg: { mode: string }) => leg.mode === 'whole')).toBe(true);
    const read = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(read).toContainEqual({ args: ['tools/take-base.mjs', join(root, 'frozen'), 'true'], cache: join(root, 'whole-plan') });
    for (const call of read.filter((call) => call.args[1] === 'shards')) {
      expect(call.cache).toBe(join(root, call.args.includes('--max') ? 'carried' : 'whole-plan'));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
