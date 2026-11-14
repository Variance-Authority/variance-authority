/**
 * A laptop worktree laid on the mainline's first published snapshot, and the
 * newer snapshot CI publishes under it, for the tests of a pinned milestone.
 *
 * Every helper takes the directory the test made, as `mainline-fixture.ts`
 * does, so two test files can share it without sharing state.
 */

import { readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import { commitRunsFile, declaredSuites, seedTestCoverage, testCoverageFile, withIndexLock, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { collectedBoth, git as gitIn, gitPublished, probedModule, publishRaw, PUSH, ranWhole, totalCoverage, totalModule } from './mainline-fixture.js';
import { mainlineBase } from './mainline-base.js';
import { suiteBase } from './suite-base.js';
import { publishSuite } from './suite-share.js';

/** A laptop's environment, which names no CI. */
export const LOCAL: Env = {};

/** Git in `at` as the fixture's author, who makes the commits a checkout adds. */
export function git(at: string, ...args: string[]): Promise<string> {
  return gitIn(at, '-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', ...args);
}

/** A laptop worktree at the mainline's first published commit, its record laid from it. */
export async function laidWorktree(home: string): Promise<{ ci: string; first: string; worktree: string; own: string }> {
  const { ci, origin, first } = await gitPublished(home);
  const primary = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, primary);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first } });
  const own = testCoverageFile(worktree, { suite: 'unit' });
  expect(await withIndexLock(own, (lock) => seedTestCoverage(lock, worktree, 'fixture'))).toMatchObject({ value: { from: 'mainline' } });
  return { ci, first, worktree, own };
}

/** CI pushes one more commit to main and publishes a whole run there, in which both test files run `applyDiscount`. */
export async function publishedNext(home: string, ci: string, sections?: (record: string) => Promise<void>): Promise<string> {
  const next = await pushedNext(ci);
  await publishedWhole(home, ci, next, sections);
  return next;
}

/** CI publishes a whole run at `commit`, main's head, in which both test files run `applyDiscount`. */
export async function publishedWhole(home: string, ci: string, commit: string, sections?: (record: string) => Promise<void>): Promise<void> {
  const laptop = process.env['VARIANCE_AUTHORITY_CACHE'];
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  const both = ['test/other.test.ts', 'test/total.test.ts'];
  // A record opened whole, as a run writes one: the module's first block is the module.
  await writeTestCoverage(testCoverageFile(ci, { suite: 'unit' }), totalCoverage(commit, both, [totalModule(both)]));
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), commit);
  await sections?.(testCoverageFile(ci, { suite: 'unit' }));
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  if (!('published' in done)) throw new Error(`the record was to reach mainline main: ${JSON.stringify(done)}`);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', laptop);
}

/**
 * CI pushes one more commit to main, and the merge queue publishes the run it
 * made there of `total.test.ts` alone: `other.test.ts` stands at `stood`, where
 * a run last ran it.
 */
export async function publishedPartialNext(home: string, ci: string, stood: string): Promise<string> {
  const laptop = process.env['VARIANCE_AUTHORITY_CACHE'];
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  const next = await pushedNext(ci);
  const record = testCoverageFile(ci, { suite: 'unit' });
  const both = ['test/other.test.ts', 'test/total.test.ts'];
  await writeTestCoverage(record, totalCoverage(next, both, [totalModule(both)]));
  const at = '2026-01-02T00:00:00.000Z';
  const runs = {
    commit: next,
    latest: at,
    runs: 1,
    landings: [{ files: ['test/total.test.ts'], first: at, latest: at, runs: 1 }],
    standing: [{ commit: stood, files: ['test/other.test.ts'] }],
  };
  await writeFile(commitRunsFile(record), `${JSON.stringify(runs, null, 2)}\n`);
  await publishRaw(home, ci, next, { withRuns: true, partial: true, share: 'git' });
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', laptop);
  return next;
}

/** One more commit on main, pushed. */
async function pushedNext(ci: string): Promise<string> {
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  const next = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  return next;
}

/** A run of `file` at `commit` that entered one module the fixture's source does not hold. */
export function ranAlone(commit: string, file: string): TestCoverage {
  return { version: 3, instrumentation: 'fixture', commit, tests: [{ file, complete: true, preconditions: [] }], modules: [probedModule([file])] };
}

/** The worktree fetches the mainline again, and finds its snapshot at `commit`. */
export async function refetch(home: string, worktree: string, commit: string): Promise<void> {
  await lineAged(home);
  const declared = declaredSuites(worktree)?.find((one) => one.name === 'unit');
  expect(await mainlineBase(worktree, declared, { env: LOCAL, fetch: 'always' })).toMatchObject({ commit });
}

/** The share's line was read within the minute a reader reuses it for: age it past that. */
export async function lineAged(home: string): Promise<void> {
  const cache = join(home, 'laptop-cache');
  const markers = (await readdir(cache, { recursive: true })).filter((path) => path.includes('variance-fetched'));
  await Promise.all(markers.map((path) => utimes(join(cache, path), 0, 0)));
}
