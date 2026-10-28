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
 * one is refused by `withTestSelection`, when the configuration is evaluated and
 * before anything starts, whether `--shard` is on the command line or the
 * configuration sets `shard`.
 *
 * A file several projects run, or `repeatEach` repeats, is one file: all its
 * copies go to one shard. A setup or teardown project is Playwright's to run in
 * every shard that keeps a test depending on it, and it cannot be excluded, so
 * its files are not placed. A project none of whose files are this shard's is
 * excluded whole, so its dependencies do not run for nothing.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { FullConfig, Suite, TestRun } from '@playwright/test/reporter';
import { shardOf, type SuiteTimes } from '@variance-authority/sense/test-selection';
import { fileOwner } from './test-coordinate.js';

/** What `Reporter.preprocess` is handed. */
export interface Preprocess {
  readonly config: FullConfig;
  readonly suite: Suite;
  readonly testRun: TestRun;
}

/** Keep this shard's files and exclude the rest; a run that asked for no shard is left alone. */
export async function placeWholeFiles(
  { config, suite, testRun }: Preprocess,
  root: string,
  times: () => Promise<SuiteTimes>,
  say: (line: string) => void,
): Promise<void> {
  const shard = config.shard;
  if (shard === null || shard === undefined) return;
  testRun.skipSharding();
  // FIXME: a dependency project runs, and is recorded, in every shard that keeps a test
  // depending on it, so combining the shards' records refuses its files as run by two shards.
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
}

/** A shard as Playwright numbers it, `current` from 1. */
export interface PlaywrightShard {
  readonly current: number;
  readonly total: number;
}

/**
 * Why a run asking for `shard` is refused under Playwright `version`, which
 * has no `preprocess` and would split the shard test by test; `undefined` when
 * Playwright can place it.
 */
export function shardRefusal(version: string, shard: PlaywrightShard): string | undefined {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (major > 1 || (major === 1 && minor >= 62)) return undefined;
  return (
    `variance-authority: refusing shard ${shard.current}/${shard.total}: Playwright ${version} would split it test by test, ` +
    'so a file could run in two shards; placing whole files needs Playwright 1.62 or newer'
  );
}

/**
 * The version of `@playwright/test` the project at `from` resolves: the one
 * running its configuration. The peer this package was installed beside answers
 * only when `from` resolves none.
 */
export function installedPlaywright(from: string): string {
  const read = (require: NodeJS.Require) => (require('@playwright/test/package.json') as { version: string }).version;
  try {
    return read(createRequire(resolve(from, 'package.json')));
  } catch {
    return read(createRequire(import.meta.url));
  }
}

/**
 * The reporters a command line's `--reporter` names, split at commas as
 * Playwright splits them; `undefined` when it names none, and the
 * configuration's own reporters run.
 */
export function reporterArgument(argv: readonly string[]): readonly string[] | undefined {
  for (const [at, argument] of argv.entries()) {
    const value = argument === '--reporter' ? argv[at + 1] : argument.startsWith('--reporter=') ? argument.slice('--reporter='.length) : undefined;
    if (value !== undefined) return value.split(',');
  }
  return undefined;
}
