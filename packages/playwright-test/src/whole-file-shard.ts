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
 * by checksum when it holds none, every file whole, and stderr says which part.
 *
 * A file several projects run, or `repeatEach` repeats, is one file: all its
 * copies go to one shard. A setup or teardown project is Playwright's to run in
 * every shard that keeps a test depending on it, and it cannot be excluded, so
 * its files are not placed. A project none of whose files are this shard's is
 * excluded whole, so its dependencies do not run for nothing.
 */

// compass: variance-authority.reach

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

/** The line a shard Playwright split by itself prints, because no `preprocess` ran to place it. */
export function unplacedLine(config: FullConfig): string | undefined {
  if (config.shard === null || config.shard === undefined) return undefined;
  return (
    `variance-authority: shard ${config.shard.current}/${config.shard.total} was split by Playwright ${config.version}, ` +
    'test by test, so a file can run in two shards; placing whole files needs Playwright 1.62 or newer'
  );
}
