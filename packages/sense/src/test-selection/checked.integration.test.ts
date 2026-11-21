import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checksAt, type CheckedRun } from '../recorded-checks.js';

// One test file per runner holds the same cases: one that passes on the branch
// that bypasses its check, one that enters it, one that bypasses a check a
// helper of the file holds, and one retried case whose failed first attempt
// entered its check and whose passing second did not. Jest's retry is a file
// of its own, because `jest.retryTimes` is.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);

interface Runner {
  readonly fixture: string;
  /** How the runner joins a describe path into the case name it reports. */
  readonly join: string;
  readonly args: (fixture: string) => readonly string[];
  readonly env?: (directory: string) => NodeJS.ProcessEnv;
  /** The file its retried case is declared in. */
  readonly retries: string;
}

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', Runner>> = {
  vitest: {
    fixture: 'checked-vitest',
    join: ' > ',
    args: (fixture) => [bin('vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    retries: 'create-event.case.ts',
  },
  jest: {
    fixture: 'checked-jest',
    join: ' ',
    args: (fixture) => [bin('jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    env: (directory) => ({ VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'cache') }),
    retries: 'retries.case.ts',
  },
  rstest: {
    fixture: 'checked-rstest',
    join: ' > ',
    args: (fixture) => [bin('@rstest/core/bin/rstest.js'), 'run', '-c', resolve(fixture, 'rstest.config.mjs')],
    retries: 'create-event.case.ts',
  },
};

describe.each(Object.entries(runners))('a %s case that passes without entering a check its body calls', (runnerName, runner) => {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', runner.fixture);
  const tests = `${relative(repository, fixture)}/test`;
  let directory: string;
  let run: CheckedRun;
  const sources = new Map<string, readonly string[]>();

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), `variance-authority-checked-${runnerName}-`));
    const coverageFile = resolve(directory, 'coverage.bin');
    // Every case passes but the retried one's first attempt.
    await execute(process.execPath, runner.args(fixture), {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: directory,
        ...runner.env?.(directory),
      },
    });
    run = checksAt(coverageFile);
    for (const file of new Set(['create-event.case.ts', runner.retries])) {
      sources.set(file, (await readFile(resolve(fixture, 'test', file), 'utf8')).split('\n'));
    }
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** The fixture's line whose trailing comment names the call. */
  const at = (call: string, file = 'create-event.case.ts'): string =>
    `${tests}/${file}:${sources.get(file)!.findIndex((text) => text.endsWith(`// ${call}`)) + 1}`;
  const missing = () => {
    expect(run).toHaveProperty('missing');
    return 'missing' in run
      ? run.missing.map((one) => ({
          check: one.check,
          at: `${one.case.file}:${one.line}`,
          case: one.case.name,
          declared: `${one.case.file}:${one.case.line}`,
          ...(one.attempt === undefined ? {} : { attempt: one.attempt }),
        }))
      : [];
  };

  it('names the check a passing case bypassed, with the line of the case and of its call', () => {
    expect(missing()).toContainEqual({
      check: 'create-event/submitted-title',
      at: at('bypassed check'),
      case: ['create-event', 'submits the form'].join(runner.join),
      declared: at('bypassing case'),
    });
  });

  it('names a check a helper of the file holds at the line the case calls the helper', () => {
    expect(missing()).toContainEqual({
      check: 'create-event/helper-title',
      at: at('helper call'),
      case: ['create-event', 'verifies through a helper'].join(runner.join),
      declared: at('helper case'),
    });
  });

  it('names a check the passing retry left out, though the failed attempt before it entered it', () => {
    expect(missing()).toContainEqual({
      check: 'create-event/retried-title',
      at: at('retried check', runner.retries),
      case: 'retries',
      declared: at('retried case', runner.retries),
      attempt: 2,
    });
  });

  it('names no check a passing case entered, and nothing else', () => {
    expect(missing().map((one) => one.check).sort()).toEqual([
      'create-event/helper-title',
      'create-event/retried-title',
      'create-event/submitted-title',
    ]);
    expect(run).toMatchObject({ entered: 2, incomplete: [] });
  });
});
