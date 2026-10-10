import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

// The cut puts a call in front of a test's statements, on their own lines, so
// the columns after it move. A runner writes an inline snapshot where the
// matcher's stack frame says the call is: each one has to land where the test
// wrote it, under every seam that cuts.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const bin = (path: string): string => resolve(repository, 'node_modules', path);
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const written = `it('writes where a statement is', () => {
  const value = { answer: 42 };
  expect(value).toMatchInlineSnapshot();
});

it('writes where a concise body is', () => expect({ answer: 7 }).toMatchInlineSnapshot());
`;

const runners: Readonly<Record<'vitest' | 'jest' | 'rstest', (fixture: string) => readonly string[]>> = {
  vitest: (fixture) => [bin('vitest/vitest.mjs'), 'run', '-u', '--config', resolve(fixture, 'vitest.config.ts')],
  jest: (fixture) => [
    bin('jest/bin/jest.js'),
    '--config',
    resolve(fixture, 'jest.config.mjs'),
    '--watchman=false',
    '--ci=false',
    '-u',
  ],
  rstest: (fixture) => [bin('@rstest/core/bin/rstest.js'), 'run', '-u', '-c', resolve(fixture, 'rstest.config.mjs')],
};

/** The case file as `runner` leaves it after a `-u` run, with cuts `on` or off. */
async function updated(runner: string, args: (fixture: string) => readonly string[], cuts: 'on' | 'off'): Promise<string> {
  const fixture = resolve(repository, 'packages/sense/test/fixtures', `inline-snapshot-${runner}`);
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-inline-'));
  temporary.push(directory, resolve(fixture, 'test'));
  const file = resolve(fixture, 'test/inline.case.ts');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, written);
  await execute(process.execPath, args(fixture), {
    cwd: fixture,
    env: {
      ...process.env,
      VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, 'jest'),
      VARIANCE_AUTHORITY_CUTS: cuts,
    },
  });
  return readFile(file, 'utf8');
}

// Vitest and Rstest write no snapshot into a concise body's call even uncut,
// so the cut is held to what the runner writes without it.
describe.each(Object.entries(runners))('an inline snapshot under %s', (runner, args) => {
  it('is written where it is written without cuts', async () => {
    const uncut = await updated(runner, args, 'off');
    expect(uncut).toMatch(/expect\(value\)\.toMatchInlineSnapshot\(`[^`]*"answer": 42[^`]*`\);/);
    expect(await updated(runner, args, 'on')).toBe(uncut);
  }, 60_000);
});
