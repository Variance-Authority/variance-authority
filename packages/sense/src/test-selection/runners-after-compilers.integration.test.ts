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
// file's own.

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
    await execute(process.execPath, args, {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
      },
    });
    const module = decodeTestCoverage(await readFile(coverageFile)).modules.find(
      (candidate) => candidate.file === named('src/tone.ts'),
    );
    const tests = [named('test/tone.case.ts')];
    expect(module?.blocks.map((block) => [block.name, block.startLine, block.endLine, block.testFiles])).toEqual([
      ['', 1, 8, tests],
      ['css.arg0', 2, 2, tests],
      ['label', 3, 6, tests],
      ['label', 4, 4, tests],
      ['label', 4, 4, tests],
      ['label', 5, 5, tests],
    ]);
    expect(module?.sourceDigest).toBe(digestString(await readFile(resolve(fixture, 'src/tone.ts'), 'utf8')));
  }, 60_000);
});
