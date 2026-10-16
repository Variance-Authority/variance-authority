import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { decodeTestCoverage } from './format.js';

// A compiler that reads the syntax it compiles refuses a probe it was not
// written for. In `compilers`, each runner's project transform is followed by
// an extractor that reads `css()`'s arrow and fails on anything but a
// condition between two strings, and moves every column after the call. Under
// every runner seam the probes go in after it, through the maps it and the
// runner's own transform return; the suite passes, and the record is the
// file's own. `shade`'s `then` never runs, so no test is charged with it,
// while its sibling, the code after the `if`, is. With `placement:
// 'before-transforms'` the probes go into the file as read, ahead of every
// transform, so the extractor reads them and refuses.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/compilers');
const bin = (path: string): string => resolve(repository, 'node_modules', path);
const named = (path: string): string => `${relative(repository, fixture)}/${path}`;
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** The fixture's environment: the record, the caches, and the placement where one is asked for. */
function environment(directory: string, placement?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...extra,
    ...process.env,
    VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
    VARIANCE_AUTHORITY_CACHE: directory,
    VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
    ...(placement === undefined ? {} : { VARIANCE_AUTHORITY_PLACEMENT: placement }),
  };
}

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', readonly string[]>> = {
  vitest: [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
  jest: [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false', '--ci=false'],
  rstest: [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
};

describe.each(Object.entries(runners))('a module a syntax-reading compiler rewrites, under %s', (_, args) => {
  it('compiles as it would unprobed, and records the regions the author wrote', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-compilers-'));
    temporary.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    // The extractor refusing the probed arrow fails the case, and so this run.
    await execute(process.execPath, args, { cwd: fixture, env: environment(directory) });
    const module = decodeTestCoverage(await readFile(coverageFile)).modules.find(
      (candidate) => candidate.file === named('src/tone.ts'),
    );
    const tests = [named('test/tone.case.ts')];
    expect(module?.blocks.map((block) => [block.name, block.path, block.startLine, block.endLine, block.testFiles])).toEqual([
      ['', 'module', 1, 12, tests],
      ['css.arg0', 'entry', 2, 2, tests],
      ['label', 'entry', 3, 6, tests],
      ['label', 'if#0/then', 4, 4, tests],
      ['label', 'if#0/else', 4, 4, tests],
      ['label', 'if#0/after', 5, 5, tests],
      ['shade', 'entry', 7, 10, tests],
      ['shade', 'if#0/then', 8, 8, []],
      ['shade', 'if#0/else', 8, 8, tests],
      ['shade', 'if#0/after', 9, 9, tests],
    ]);
    expect(module?.sourceDigest).toBe(digestString(await readFile(resolve(fixture, 'src/tone.ts'), 'utf8')));
  }, 60_000);

  it('places the probes ahead of the transforms with `placement: \'before-transforms\'`, where the extractor reads them', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-compilers-'));
    temporary.push(directory);
    const failed = await execute(process.execPath, args, { cwd: fixture, env: environment(directory, 'before-transforms') }).then(
      () => undefined,
      (error: { stdout: string; stderr: string }) => `${error.stdout}${error.stderr}`,
    );
    // The run fails, and on the probe the extractor found in the arrow.
    expect(failed).toMatch(/extractor: `[^`]*__va\([^`]*` is unable to have its styles extracted/);
  }, 60_000);
});

describe('a module a syntax-reading compiler rewrites at `enforce: \'post\'`, under rstest', () => {
  it('runs the probes after the post loader the project lists, so the extractor reads no probe', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-compilers-'));
    temporary.push(directory);
    // Post loaders run right to left: had the probes been listed after the
    // extractor, they would run ahead of it, and it would refuse the probed arrow.
    await execute(process.execPath, runners.rstest, {
      cwd: fixture,
      env: environment(directory, undefined, { VARIANCE_AUTHORITY_EXTRACTOR_ENFORCE: 'post' }),
    });
    const module = decodeTestCoverage(await readFile(resolve(directory, 'coverage.bin'))).modules.find(
      (candidate) => candidate.file === named('src/tone.ts'),
    );
    expect(module?.blocks.find((block) => block.name === 'css.arg0')?.testFiles).toEqual([named('test/tone.case.ts')]);
  }, 60_000);
});
