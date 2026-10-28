/**
 * How a Playwright test is named in the recording: the file that owns its
 * crossings, and the declaration path and id of the case inside it.
 *
 * Every half of the seam — the recorder, the fixtures that mark and join, the
 * vantage — spells a test the same way or it is two tests, so the spelling has
 * one home.
 */

import type { TestInfo } from '@playwright/test';
import { relative, resolve, sep } from 'node:path';

/** Which test a window belongs to, where the run is recording that. */
export interface ObservedTest {
  /** The declaration path inside the spec file, as a person reads it. */
  readonly name: string;
  /** Stable across retries, so a flake and its retry are one case read twice. */
  readonly id: string;
  /** The project that ran it, so a spec two projects run is two cases; absent for an unnamed one. */
  readonly project?: string;
}

/**
 * Where a test is declared, as the execution index names it.
 *
 * Playwright's own `titlePath` is the file relative to `testDir`, then each
 * enclosing `describe`, then the test's title; the project is not in it. The
 * file is the owner and the project is recorded beside the name, so the name is
 * the rest: the path a person reads in the report, and the one a `describe` in
 * a diff moves.
 */
export function testOf(testInfo: TestInfo): ObservedTest {
  const project = testInfo.project.name;
  return {
    name: testInfo.titlePath.slice(1).join(' > '),
    id: testInfo.testId,
    ...(project === '' ? {} : { project }),
  };
}

/** The test file a subject's crossings belong to, repository-relative. */
export function ownerOf(root: string, testInfo: TestInfo): string {
  return fileOwner(root, testInfo.file);
}

/** A test file, by its absolute path, as the recording names it: repository-relative. */
export function fileOwner(root: string, file: string): string {
  return relative(resolve(root), file).split(sep).join('/');
}

/** The key a worker files one case under: the attempts of a retry share it. */
export function caseKey(owner: string, id: string): string {
  return `${owner}\u0000${id}`;
}
