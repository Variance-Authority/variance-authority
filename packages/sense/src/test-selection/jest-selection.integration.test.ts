import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { at, FOUND, jestSelection } from './__fixtures__/jest-selection.js';
import { decodeTestCoverage } from './format.js';
import { writeTestCoverage } from './index.js';

// What a selection makes of a Jest run that has files to run: which it runs,
// which cases of a file it cuts, and how shards split them. The order under
// `--randomize`, and a run left with no file, are each a file of their own.
const { directory, run, runWith } = jestSelection();

describe('a Jest run handed a selection', () => {
  it('runs what the selection kept, and counts it against what Jest found', async () => {
    const { stderr, ran } = await run('kept', [at('test/alpha.case.ts'), at('test/gamma.case.ts')]);

    expect(ran).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
    expect(stderr).toContain('variance-authority: selected 3 of 5');
  });

  it('splits what the selection kept across shards, never what it skipped', async () => {
    const skip = [at('test/alpha.case.ts'), at('test/gamma.case.ts')];
    const first = await run('first', skip, '--shard', '1/2');
    const second = await run('second', skip, '--shard', '2/2');

    expect([...first.ran, ...second.ran].sort()).toEqual(FOUND.filter((file) => !/alpha|gamma/.test(file)));
  });

  it('lists only what the selection kept', async () => {
    const { stdout } = await run('listed', [at('test/alpha.case.ts')], '--listTests');

    expect(stdout).not.toContain('alpha.case.ts');
    expect(stdout).toContain('beta.case.ts');
  });
});

describe('a Jest run handed the cases to skip in a file it runs', () => {
  // Two files, two workers, and a Jest cache with no times in it, which Jest
  // would otherwise read as fast tests and run in band: the cut reaches a
  // worker the filter's process forked.
  it('runs the other cases of that file, in a worker, and records the file incomplete', async () => {
    const report = resolve(directory(), 'cut.json');
    await runWith('cut', {
      FIXTURE_SKIP: JSON.stringify(FOUND.filter((file) => !/alpha|beta/.test(file))),
      FIXTURE_CASES: JSON.stringify({ [at('test/alpha.case.ts')]: ['ran after the project\'s own setup file'] }),
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory(), 'jest-cache-cut'),
    }, '--maxWorkers=2', '--json', '--outputFile', report);
    const { testResults } = JSON.parse(await readFile(report, 'utf8')) as {
      testResults: { name: string; assertionResults: { title: string; status: string }[] }[];
    };
    const alpha = testResults.find((file) => file.name.endsWith('alpha.case.ts'))!;
    const recorded = decodeTestCoverage(await readFile(resolve(directory(), 'cut.bin'))).tests;

    expect(alpha.assertionResults.map(({ title, status }) => [title, status])).toEqual([
      ['takes the alpha path', 'passed'],
      ['ran after the project\'s own setup file', 'pending'],
      ['is skipped, and so never reaches the B branch this file is not selected for', 'pending'],
    ]);
    expect(recorded.map(({ file, complete }) => ({ file, complete }))).toEqual([
      { file: at('test/alpha.case.ts'), complete: false },
      { file: at('test/beta.case.ts'), complete: true },
    ]);
  });
});

describe('a Jest run whose cut is gone', () => {
  // A Jest started by a test inherits the variable, and the run that wrote the
  // cut removes the file when it completes.
  it('runs every case, as a run with no cut does', async () => {
    const { ran } = await runWith('gone', {
      FIXTURE_SKIP: JSON.stringify([]),
      VARIANCE_AUTHORITY_TEST_SELECTION_CUT: resolve(directory(), 'no-such-cut.json'),
    });

    expect(ran).toEqual(FOUND);
  });
});

describe('a Jest run under --shard, with the times a record holds', () => {
  it('places each file by its recorded time, and says what each shard takes', async () => {
    // Alpha is recorded as the slow one, so on two shards it is alone on the first.
    const timed = (k: number) => writeTestCoverage(resolve(directory(), `timed-${k}.bin`), {
      version: 3,
      instrumentation: instrumentationId('presence'),
      tests: FOUND.map((file) => ({ file, complete: true, preconditions: [], duration: file.includes('alpha') ? 9000 : 100 })),
      modules: [],
    });
    await Promise.all([timed(1), timed(2)]);

    const first = await run('timed-1', [], '--shard', '1/2');
    const second = await run('timed-2', [], '--shard', '2/2');

    expect(first.stderr).toContain('variance-authority: shard 1/2 by the times recorded at');
    expect(first.stderr).toContain('1 of 5 files, 9.0 s (shards 400 ms to 9.0 s)');
    expect(first.stderr).toMatch(/PASS .*alpha\.case\.ts/);
    expect(first.stderr).not.toMatch(/PASS .*beta\.case\.ts/);
    for (const name of ['beta', 'delta', 'each', 'gamma']) expect(second.stderr).toMatch(new RegExp(`PASS .*${name}\\.case\\.ts`));
    expect(second.stderr).not.toMatch(/PASS .*alpha\.case\.ts/);
  });

  it('passes a shard there are too few files to give one, and says so', async () => {
    const { stderr, ran } = await runWith('empty-shard', {}, '--shard', '6/6');

    expect(stderr).toContain('variance-authority: shard 6/6 by file count: 0 of 5 files;');
    expect(ran).toEqual([]);
  });
});
