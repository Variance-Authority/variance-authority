import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { commitRunsFile, type CommitRuns } from './commit-runs.js';
import { decodeTestCoverage } from './format.js';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-vitest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const vitest = resolve(repository, 'node_modules/vitest/vitest.mjs');
// By path: the configuration is written into a temporary directory, where
// nothing resolves `@variance-authority/sense`.
const seamModule = resolve(repository, 'packages/sense/dist/test-selection/vitest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A configuration of the fixture that collects `include`, recording into `coverageFile`. */
const configuration = (coverageFile: string, include: readonly string[]) => `
import { withTestSelection } from ${JSON.stringify(seamModule)};

export default withTestSelection(
  {
    root: ${JSON.stringify(fixture)},
    test: { include: ${JSON.stringify(include)}, environment: 'node', setupFiles: ['test/setup.ts'] },
  },
  {
    root: ${JSON.stringify(fixture)},
    coverageFile: ${JSON.stringify(coverageFile)},
    include: (file) => file.startsWith(${JSON.stringify(resolve(fixture, 'src'))}),
  },
);
`;

/** One record, and a run of the fixture into it under a configuration that collects `include`. */
async function recordInto() {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-uncollected-'));
  temporary.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  let configs = 0;
  const run = async (include: readonly string[], flags: readonly string[] = []) => {
    const config = resolve(directory, `vitest.${configs += 1}.config.mts`);
    await writeFile(config, configuration(coverageFile, include), 'utf8');
    await execute(process.execPath, [vitest, 'run', ...flags, '--config', config], {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: directory },
    });
    const coverage = decodeTestCoverage(await readFile(coverageFile));
    const runs = JSON.parse(await readFile(commitRunsFile(coverageFile), 'utf8')) as CommitRuns;
    const crossed = new Set(coverage.modules.flatMap((module) =>
      module.blocks.flatMap((block) => [...block.testFiles, ...(block.loadedBy ?? [])])));
    return {
      tests: coverage.tests.map((test) => test.file),
      files: runs.files,
      standing: (runs.standing ?? []).flatMap((entry) => entry.files),
      crossed: [...crossed].sort(),
    };
  };
  return run;
}

const both = ['test/alpha.case.ts', 'test/beta.case.ts'];

describe('a test file the suite no longer collects', () => {
  // A configuration narrowed under a record: the file is on disk, and no run
  // of this suite will ever observe it again. Carried, its rows stand at the
  // commit it last ran at for good, and every reading reads the files changed
  // since then whole for it — a suite split into slices left 64 such files in
  // this repository's unit record.
  it('leaves the record when a run of the suite lands', async () => {
    const run = await recordInto();
    expect((await run(both)).tests).toEqual([at('test/alpha.case.ts'), at('test/beta.case.ts')]);

    const after = await run(['test/alpha.case.ts']);

    expect(after.tests).toEqual([at('test/alpha.case.ts')]);
    expect(after.files).toEqual([at('test/alpha.case.ts')]);
    expect(after.standing).toEqual([]);
    expect(after.crossed).toEqual([at('test/alpha.case.ts')]);
  }, 30_000);

  it('stays when the run named fewer files on its command line', async () => {
    // The collection is the configuration's; a file filter picks among it.
    const run = await recordInto();
    await run(both);

    const after = await run(both, ['test/alpha.case.ts']);

    expect(after.tests).toEqual([at('test/alpha.case.ts'), at('test/beta.case.ts')]);
    expect(after.crossed).toEqual([at('test/alpha.case.ts'), at('test/beta.case.ts')]);
  }, 30_000);

  it('stays when the run excluded it on its command line, as a narrowed run does', async () => {
    // `vitest $(variance select --format vitest)` hands the skipped files over
    // as `--exclude`, and Vitest folds those into the exclude it matches with.
    const run = await recordInto();
    await run(both);

    const after = await run(both, [`--exclude=${resolve(fixture, 'test/beta.case.ts')}`]);

    expect(after.tests).toEqual([at('test/alpha.case.ts'), at('test/beta.case.ts')]);
    expect(after.crossed).toEqual([at('test/alpha.case.ts'), at('test/beta.case.ts')]);
  }, 30_000);
});
