import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { encodeAsSetExecutionIndex, landRun, type TestCoverage } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering } from './covering.js';
import { probedModule } from './mainline-fixture.js';

/**
 * `--cases last` over runs the real `landRun` recorded: a second run at one
 * commit that ran a test file again retires cases recorded over two trees, so
 * they name no commit to diff from, and the comparison is refused.
 */

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

function run(commit: string, files: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [probedModule(files)],
  };
}

/** The run's cases: `near` entered `src/probed.ts` when `entered`. */
function cases(commit: string, entered: boolean) {
  return {
    fresh: encodeAsSetExecutionIndex({
      tests: [{ id: 'near.test.ts > near', file: 'near.test.ts', name: 'near', stopped: false }],
      modules: [{ file: 'src/probed.ts', blocks: [{
        kind: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true,
        crossings: entered ? [{ test: 0, distance: 0 }] : [],
      }] }],
    }),
    run: { tests: [{ file: 'near.test.ts', complete: true }], commit },
  };
}

it('refuses `--cases last` after a second run at one commit ran a test file again', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-cases-last-')));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  await writeFile(join(root, 'near.test.ts'), 'it("near", () => {});\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  const first = git(root, ['rev-parse', 'HEAD']);
  const execution = join(await realpath(await mkdtemp(join(tmpdir(), 'variance-cases-last-records-'))), 'coverage.bin');
  process.chdir(root);

  await landRun(execution, run(first, ['near.test.ts']), root, undefined, cases(first, true));
  await landRun(execution, run(first, ['near.test.ts']), root, undefined, cases(first, false));

  const refused = covering(parseCoveringArgs(readFlags(
    ['--file', 'src/probed.ts', '--cases', 'last', '--execution', execution],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));

  await expect(refused).rejects.toMatchObject({ exitCode: 2, kind: 'undiffed' });
  await expect(refused).rejects.toThrow('a run at the same commit ran one of its test files again');
});
