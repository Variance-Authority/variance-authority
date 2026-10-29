/**
 * A laptop worktree laid on the mainline's first published snapshot, and the
 * newer snapshot CI publishes under it, for the tests of a pinned milestone.
 *
 * Every helper takes the directory the test made, as `mainline-fixture.ts`
 * does, so two test files can share it without sharing state.
 */

import { readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { declaredSuites, seedTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import type { Env } from '../share-lines.js';
import { BEFORE, collectedBoth, DISCOUNTS, git as gitIn, gitPublished, probedModule, PUSH, ranWhole, recordIn } from './mainline-fixture.js';
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
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first } });
  const own = testCoverageFile(worktree, { suite: 'unit' });
  expect(await seedTestCoverage(own, worktree, 'fixture')).toMatchObject({ from: 'mainline' });
  return { ci, first, worktree, own };
}

/** CI pushes one more commit to main and publishes a whole run there, in which both test files run `applyDiscount`. */
export async function publishedNext(home: string, ci: string, sections?: (record: string) => Promise<void>): Promise<string> {
  const laptop = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  const next = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await recordIn(ci, next, ['test/other.test.ts', 'test/total.test.ts'], [DISCOUNTS]);
  // A record opened whole, as a run writes one: the module's first block is the module.
  await writeTestCoverage(testCoverageFile(ci, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit: next,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [] },
      { file: 'test/total.test.ts', complete: true, preconditions: [] },
    ],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(BEFORE),
      instrumented: true,
      blocks: [{
        ordinal: 0, kind: 'module', digest: digestString('module'), name: '', path: 'module',
        startLine: 1, endLine: 3, source: true, testFiles: ['test/other.test.ts', 'test/total.test.ts'],
      }],
    }],
  });
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), next);
  await sections?.(testCoverageFile(ci, { suite: 'unit' }));
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  if (!('published' in done)) throw new Error(`the record was to reach mainline main: ${JSON.stringify(done)}`);
  process.env['VARIANCE_AUTHORITY_CACHE'] = laptop;
  return next;
}

/** A run of `file` at `commit` that entered one module the fixture's source does not hold. */
export function ranAlone(commit: string, file: string): TestCoverage {
  return { version: 3, instrumentation: 'fixture', commit, tests: [{ file, complete: true, preconditions: [] }], modules: [probedModule([file])] };
}

/** The worktree fetches the mainline again, and finds its snapshot at `commit`. */
export async function refetch(home: string, worktree: string, commit: string): Promise<void> {
  // The share's line was read within the minute a reader reuses it for.
  const cache = join(home, 'laptop-cache');
  const markers = (await readdir(cache, { recursive: true })).filter((path) => path.includes('variance-fetched'));
  await Promise.all(markers.map((path) => utimes(join(cache, path), 0, 0)));
  const declared = declaredSuites(worktree)?.find((one) => one.name === 'unit');
  expect(await mainlineBase(worktree, declared, { env: LOCAL, refetch: true })).toMatchObject({ commit });
}
