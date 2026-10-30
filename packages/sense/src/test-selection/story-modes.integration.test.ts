/**
 * The story a case writes does not depend on how its runner ran it: the same
 * stories under every Vitest pool, Jest in band and Rstest with isolation off,
 * and a reading for each attempt of a retried case under Vitest, Jest, Rstest
 * and the generic runner seam, the failed one stopped.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const stories = (await import('../../dist/story/format.cjs'))
  .default as typeof import('../story/format.cjs');
const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, '../../../..');
const fixtures = resolve(repository, 'packages/sense/test/fixtures');
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** What each story one run wrote says, sorted: its case, its visits in order, its notes and whether it stopped. */
async function told(
  fixture: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'variance-authority-story-modes-'),
  );
  temporary.push(directory);
  await execute(process.execPath, args, {
    cwd: resolve(fixtures, fixture),
    env: {
      ...process.env,
      ...env,
      VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
      VARIANCE_AUTHORITY_STORY: '1',
    },
  });
  const paths = (await readdir(directory, { recursive: true })).filter((path) =>
    path.endsWith('.story'),
  );
  const decoded = await Promise.all(
    paths.map(async (path) =>
      stories.decodeStory(await readFile(resolve(directory, path))),
    ),
  );
  return decoded
    .map(
      ({ name, visits, notes, stopped }) =>
        `${name}: visits ${[...visits].join(',')}, ${notes.map(([, text]) => text).join(' | ')}${stopped ? ', stopped' : ''}`,
    )
    .sort();
}

const vitest = (...flags: string[]): string[] => [
  resolve(repository, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--config',
  'vitest.default.config.ts',
  ...flags,
];

const jest = (...flags: string[]): string[] => [
  resolve(repository, 'node_modules/jest/bin/jest.js'),
  '--config',
  'jest.config.mjs',
  '--watchman=false',
  ...flags,
];

const rstest = (...flags: string[]): string[] => [
  resolve(repository, 'node_modules/@rstest/core/bin/rstest.js'),
  'run',
  '-c',
  resolve(fixtures, 'external-rstest/rstest.config.mjs'),
  ...flags,
];

describe('a story under each way its runner runs it', () => {
  // Each runner's modes beside one run in its default; a Vitest run takes two
  // workers, so the four started at once stay inside the slice's budget.
  it.each([
    [
      'Vitest',
      'external-vitest',
      vitest('--maxWorkers=2', '--pool=forks'),
      ['--pool=threads', '--pool=vmThreads', '--pool=vmForks', '--no-isolate'].map((flag) =>
        vitest('--maxWorkers=2', flag),
      ),
    ],
    [
      'Jest',
      'external-jest',
      jest('--maxWorkers=2'),
      [jest('--runInBand')],
    ],
    [
      'Rstest',
      'external-rstest',
      rstest(),
      [rstest('--isolate=false')],
    ],
  ] as const)('is the same under every way %s runs a file', async (_, fixture, baseline, modes) => {
    const expected = await told(fixture, baseline);
    expect(expected.length).toBeGreaterThan(0);
    const others = await Promise.all(modes.map((args) => told(fixture, args)));
    const flag = (args: readonly string[]): string => args.at(-1)!;
    expect(Object.fromEntries(modes.map((args, index) => [flag(args), others[index]]))).toEqual(
      Object.fromEntries(modes.map((args) => [flag(args), expected])),
    );
  }, 240_000);

  it.each([
    [
      'Vitest',
      'external-vitest',
      vitest('--retry=1'),
      { FIXTURE_INCLUDE: 'test/retried.retry.ts' },
    ],
    [
      'Jest',
      'external-jest',
      [
        resolve(repository, 'node_modules/jest/bin/jest.js'),
        '--config',
        'jest.config.mjs',
        '--watchman=false',
        '--testMatch',
        '<rootDir>/test/retried.retry.ts',
      ],
      {},
    ],
    [
      'Rstest',
      'external-rstest',
      [
        resolve(repository, 'node_modules/@rstest/core/bin/rstest.js'),
        'run',
        '-c',
        resolve(fixtures, 'external-rstest/rstest.config.mjs'),
        '--retry=1',
        '--include',
        'test/retried.retry.ts',
      ],
      {},
    ],
    [
      'the generic runner seam',
      'external-runner',
      [resolve(fixtures, 'external-runner/run.mjs'), '--retry'],
      {},
    ],
  ] as const)(
    'is a reading for each attempt of a case %s retried, the failed one stopped',
    async (_, fixture, args, env) => {
      const readings = await told(fixture, args, env);
      expect(readings).toHaveLength(2);
      expect(
        readings.find((reading) => reading.includes("handed value='alpha'")),
      ).toMatch(/, stopped$/);
      expect(
        readings.find((reading) => reading.includes("handed value='beta'")),
      ).not.toMatch(/, stopped$/);
    },
    120_000,
  );
});
