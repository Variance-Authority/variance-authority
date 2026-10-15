/**
 * Where a Playwright run under `--shard k/n` is placed by whole files: the
 * reporter's `preprocess`.
 *
 * Playwright splits a shard by test groups, and under `fullyParallel` a group
 * is one test, so one file's tests land in several shards and each records a
 * part of it. Since 1.62 a reporter sees the whole collected suite before
 * Playwright shards it — after `--project`, `--grep` and `.only` — and may turn
 * Playwright's split off and exclude what is not its own. So the placement is
 * the one every runner's shard takes (`shardOf` in
 * `@variance-authority/sense/test-selection`): by the times the record holds, or
 * by file count when it holds none, every file whole, and stderr says which part.
 *
 * Below 1.62 Playwright would split the shard by test, and a run that asks for
 * one is refused: before anything starts when `--shard` is on the command line,
 * and at `onBegin`, failing the run, when the configuration sets `shard`.
 *
 * A file several projects run, or `repeatEach` repeats, is one file: all its
 * copies go to one shard. A setup or teardown project is Playwright's to run in
 * every shard that keeps a test depending on it, and it cannot be excluded, so
 * its files are not placed. A project none of whose files are this shard's is
 * excluded whole, so its dependencies do not run for nothing.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import type { FullConfig, Suite, TestRun } from '@playwright/test/reporter';
import { shardOf, type SuiteTimes } from '@variance-authority/sense/test-selection';
import { fileOwner } from './test-coordinate.js';

/** What `Reporter.preprocess` is handed. */
export interface Preprocess {
  readonly config: FullConfig;
  readonly suite: Suite;
  readonly testRun: TestRun;
}

/** Keep this shard's files and exclude the rest; `false` when the run asked for no shard. */
export async function placeWholeFiles(
  { config, suite, testRun }: Preprocess,
  root: string,
  times: () => Promise<SuiteTimes>,
  say: (line: string) => void,
): Promise<boolean> {
  const shard = config.shard;
  if (shard === null || shard === undefined) return false;
  testRun.skipSharding();
  const dependencies = new Set(
    suite.suites.flatMap((project) => {
      const full = project.project();
      return [...(full?.dependencies ?? []), ...(full?.teardown === undefined ? [] : [full.teardown])];
    }),
  );
  const placed = suite.suites.filter((project) => !dependencies.has(project.project()?.name ?? project.title));
  const fileSuites = placed.flatMap((project) => project.suites.filter((child) => child.type === 'file'));
  const owners = fileSuites.map((file) => fileOwner(root, file.location?.file ?? file.title));
  const part = shardOf(owners, { index: shard.current, count: shard.total }, await times());
  const mine = new Set(part.take.map((at) => owners[at]));
  for (const project of placed) {
    const files = project.suites.filter((child) => child.type === 'file');
    const kept = files.filter((file) => mine.has(fileOwner(root, file.location?.file ?? file.title)));
    if (kept.length === 0) testRun.exclude(project);
    else for (const file of files) if (!kept.includes(file)) testRun.exclude(file);
  }
  say(part.line);
  return true;
}

/** A shard as Playwright numbers it, `current` from 1. */
export interface PlaywrightShard {
  readonly current: number;
  readonly total: number;
}

/**
 * Why a run asking for `shard` is refused under Playwright `version`, which
 * has no `preprocess` and would split the shard test by test; `undefined` when
 * the run asked for no shard or Playwright can place it.
 */
export function shardRefusal(version: string, shard: PlaywrightShard | null | undefined): string | undefined {
  if (shard === null || shard === undefined) return undefined;
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (major > 1 || (major === 1 && minor >= 62)) return undefined;
  return (
    `variance-authority: refusing shard ${shard.current}/${shard.total}: Playwright ${version} would split it test by test, ` +
    'so a file could run in two shards; placing whole files needs Playwright 1.62 or newer'
  );
}

/** The version of the Playwright this package was installed beside, its peer. */
export function installedPlaywright(): string {
  return (createRequire(import.meta.url)('@playwright/test/package.json') as { version: string }).version;
}

/**
 * The `--shard k/n` a command line asks for, in either spelling Playwright's
 * parser takes, so a run is refused before anything starts. A shard set in the
 * configuration is read from it at `onBegin` instead.
 */
export function shardArgument(argv: readonly string[]): PlaywrightShard | undefined {
  for (const [at, argument] of argv.entries()) {
    const value = argument === '--shard' ? argv[at + 1] : argument.startsWith('--shard=') ? argument.slice('--shard='.length) : undefined;
    const parsed = value === undefined ? null : /^(\d+)\/(\d+)$/u.exec(value);
    if (parsed !== null) return { current: Number(parsed[1]), total: Number(parsed[2]) };
  }
  return undefined;
}
