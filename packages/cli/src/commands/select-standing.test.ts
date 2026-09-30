import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  testCoverageFile,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { selectOutput } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * A runner handed the skip list runs only what it was not told to skip, and
 * that run is laid into the journal and stamps it at `HEAD`. Every test it did
 * not run still stands on the text it last ran on, so a selection read from the
 * journal's commit alone finds nothing changed for it and skips it, however
 * much changed after it last ran. The runs recorded beside the journal say
 * where each test last ran, and these cases lay both down through `landRun`,
 * the way the seam does.
 */
describe('a test that did not run at the journal commit', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-standing-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs where a file it entered changed after it last ran', async () => {
    const { root, P } = await partialRun();

    const said = await selectOutput({ cwd: root, format: 'plain' });

    // `near` ran at the journal's commit, after both edits; `far` last ran at P.
    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain('skipping 1 of 2 test files recorded whole');
    expect(said.err).toContain(`1 test file last ran at ${P.slice(0, 12)}, before the journal's commit`);
  });

  it('runs where the runs record does not say where it last ran, and says so', async () => {
    const { root, file } = await partialRun();
    // A record written without `standing`, as a worktree's first partial run
    // writes it: the record cannot say where `far` stood, so it is read from
    // where the runs at this commit started.
    const { standing: _, ...runs } = (await readCommitRuns(file))!;
    writeFileSync(commitRunsFile(file), `${JSON.stringify(runs, null, 2)}\n`);

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain('the runs record beside the snapshot does not say where 1 test(s) last ran');
  });

  /** Every test runs at P; `far.ts` and `near.ts` change in H; only `near` runs at H. */
  async function partialRun(): Promise<{ root: string; file: string; P: string }> {
    const root = mkdtempSync(join(tmpdir(), 'va-select-standing-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet', '--initial-branch', 'main');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    mkdirSync(join(root, 'src'), { recursive: true });
    const commit = (value: number, message: string): string => {
      for (const name of NAMES) writeFileSync(join(root, `src/${name}.ts`), `export const ${name} = ${value};\n`);
      git('add', '-A');
      git('commit', '--quiet', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const file = testCoverageFile(root);
    const P = commit(1, 'P');
    await landRun(file, run(root, P, NAMES), root);
    const H = commit(2, 'H');
    await landRun(file, run(root, H, ['near']), root);
    expect(JSON.parse(readFileSync(commitRunsFile(file), 'utf8'))).toMatchObject({
      commit: H,
      over: P,
      files: ['test/near.test.ts'],
      standing: [{ commit: P, files: ['test/far.test.ts'] }],
    });
    process.chdir(root);
    await indexOutput({ cwd: root });
    return { root, file, P };
  }
});

const NAMES = ['far', 'near'];

/**
 * What a run records: the tests it ran, and the module each loaded, with the
 * digest of the text on disk. Recorded under the recipe the seam records with,
 * so the landing re-cuts a carried module whose text moved and keeps its test
 * whole, as it does after a real partial run.
 */
function run(root: string, commit: string, names: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: names.map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: names.map((name) => ({
      file: `src/${name}.ts`,
      sourceDigest: digestString(readFileSync(join(root, `src/${name}.ts`), 'utf8')),
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module' as const,
          digest: `block:${name}`,
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 1,
          source: true,
          testFiles: [`test/${name}.test.ts`],
        },
      ],
    })),
  };
}
