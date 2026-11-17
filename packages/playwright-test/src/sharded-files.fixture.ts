import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';

// What the tests of a selected or sharded Playwright run drive: three spec files
// of three tests each under `fullyParallel`, recorded through
// `withTestSelection` into a directory of its own for each run.

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/sharded-files');
const directories: string[] = [];

/** A spec file of the fixture, by the path the record names it with. */
export const named = (file: string) => `packages/playwright-test/test/fixtures/sharded-files/tests/${file}`;

export const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/** Removes every directory a run recorded into. */
export async function removeRuns(): Promise<void> {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
}

export interface Run {
  /** Each file the line reporter says ran. */
  readonly ran: readonly string[];
  readonly stderr: string;
  /** What the run said on stdout and stderr together. */
  readonly output: string;
  readonly code: number;
  readonly coverageFile: string;
}

/**
 * One run of the fixture with `args` and `env`. `recorded` is a record the run
 * starts from, copied in so shards never share one; the record then holds what
 * it started from too.
 */
export async function run(
  args: readonly string[],
  { env = {}, recorded }: { readonly env?: Readonly<Record<string, string>>; readonly recorded?: string } = {},
): Promise<Run> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-sharded-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  if (recorded !== undefined) await copyFile(recorded, coverageFile);
  const done = await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache'), ...env },
    },
  ).then(
    (output) => ({ ...output, code: 0 }),
    (error: { stdout: string; stderr: string; code: number }) => ({ stdout: error.stdout, stderr: error.stderr, code: error.code }),
  );
  const ran = [...new Set([...done.stdout.matchAll(/^\[\d+\/\d+\] tests\/(\S+\.spec\.ts):/gmu)].map((line) => line[1]!))].sort();
  return { ran, stderr: done.stderr, output: `${done.stdout}${done.stderr}`, code: done.code, coverageFile };
}

/** A run that must pass: what it said, thrown, when it did not. */
export async function passing(args: readonly string[], recorded?: string): Promise<Run> {
  const done = await run(args, recorded === undefined ? {} : { recorded });
  if (done.code !== 0) throw new Error(`the fixture run exited ${done.code}:\n${done.output}`);
  return done;
}
